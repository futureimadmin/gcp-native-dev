/**
 * Cloud flow (provider-neutral).
 *  - per-project binding in <workspace>/.nativity/project.json (secret-free, shareable; older projects used .cnd/project.json)
 *  - generic "pipeline / deploy / resource" actions delegated to the active cloud provider
 *  - SAFETY: a provider only BUILDS a command. The UI shows it verbatim for confirmation and can run it only
 *    by one-time token via cloud:run; it can never submit arbitrary command text.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sanitizeName } = require('./util');
const nativity = require('./nativity');

const ENVS = ['dev', 'sit', 'uat', 'prod'];
const NAME_RE = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;
const GROUP_RE = /^[A-Za-z0-9._()-]{1,90}$/;
const SA_RE = /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;
const CALLABLE = new Set(['status', 'login', 'logout', 'scopes', 'setScope', 'inventory', 'consoleUrl', 'resources', 'resourceInfo', 'resourceLogs', 'objects', 'objectPreview']);

const DEFAULTS = { enabled: false, cloud: 'gcp', scope: '', env: 'dev', region: '', service: '', repo: 'cnd-apps', group: '', impersonate: '', envs: null, targets: {}, app: '', apps: {}, landing: {} };
const APP_NAME_RE = /^[a-z][a-z0-9-]{1,19}[a-z0-9]$/;
const ENV_NAME_RE = /^[a-z][a-z0-9]{0,11}$/;
const TARGET_KEYS = ['scope', 'group', 'impersonate', 'roleArn', 'stack', 'namespace', 'region', 'folder', 'tier', 'provisionedAt', 'mode'];
const envNames = (p) => (p.envs && p.envs.length ? p.envs.map((e) => e.name) : ENVS);

/** Environments chosen by the user: [{name, protected}] (or null = the classic dev / sit / uat / prod). */
function cleanEnvList(v) {
  if (v == null) return null;
  if (!Array.isArray(v) || !v.length || v.length > 8) throw new Error('Choose between 1 and 8 environments.');
  const seen = new Set();
  return v.map((e) => {
    const name = String((e && e.name) || '').trim().toLowerCase();
    if (!ENV_NAME_RE.test(name) || seen.has(name)) throw new Error(`Invalid or repeated environment name "${name}".`);
    seen.add(name);
    return { name, protected: !!(e && e.protected) || name === 'prod', ...(e && ['standard', 'compliant'].includes(e.tier) ? { tier: e.tier } : {}) };
  });
}

/** Where each environment lives in each cloud: { gcp: { dev: { scope, impersonate, ... } } } */
function cleanTargets(v) {
  const out = {};
  for (const [cloud, envs] of Object.entries(v || {})) {
    if (!/^[a-z0-9]{2,12}$/.test(cloud) || typeof envs !== 'object' || !envs) continue;
    out[cloud] = {};
    for (const [env, t] of Object.entries(envs)) {
      if (!ENV_NAME_RE.test(env) || typeof t !== 'object' || !t) continue;
      out[cloud][env] = {};
      for (const k of TARGET_KEYS) if (typeof t[k] === 'string' && t[k].length <= 200 && !/[\r\n]/.test(t[k])) out[cloud][env][k] = t[k];
    }
  }
  return out;
}

/** Applications of a workspace and where each one lives: { orders: { dir, targets: { gcp: { dev: { scope, ... } } } } } */
function cleanApps(v) {
  const out = {};
  for (const [name, a] of Object.entries(v || {}).slice(0, 60)) {
    if (!APP_NAME_RE.test(name) || !a || typeof a !== 'object') continue;
    out[name] = { dir: typeof a.dir === 'string' && a.dir.length < 400 && !/[\r\n]/.test(a.dir) ? a.dir : '', targets: cleanTargets(a.targets) };
  }
  return out;
}

/** The organisation-level landing zone a cloud was set up with (folders, billing): shared by every application. No secrets. */
function cleanLanding(v) {
  const out = {};
  const s = (x, n = 120) => (typeof x === 'string' && x.length <= n && !/[\r\n]/.test(x) ? x : '');
  for (const [cloud, l] of Object.entries(v || {})) {
    if (!/^[a-z0-9]{2,12}$/.test(cloud) || !l || typeof l !== 'object') continue;
    const tiers = {};
    for (const t of ['standard', 'compliant']) if (l.tiers && l.tiers[t]) tiers[t] = { name: s(l.tiers[t].name, 60), id: s(l.tiers[t].id, 30) };
    const envFolders = {};
    for (const [e, id] of Object.entries(l.envFolders || {})) if (ENV_NAME_RE.test(e)) envFolders[e] = s(id, 30);
    const envs = (Array.isArray(l.envs) ? l.envs : []).slice(0, 12).filter((e) => e && ENV_NAME_RE.test(String(e.name))).map((e) => ({ name: String(e.name), tier: ['standard', 'compliant'].includes(e.tier) ? e.tier : 'standard', protected: !!e.protected, regime: s(e.regime, 80) }));
    out[cloud] = { org: l.org ? { id: s(l.org.id, 30), name: s(l.org.name) } : null, tiers, envFolders, envs, compliance: l.compliance ? { regime: s(l.compliance.regime, 80), location: s(l.compliance.location, 40) } : null, billing: { standard: s((l.billing || {}).standard, 40), compliant: s((l.billing || {}).compliant, 40) }, mode: s(l.mode, 12) };
  }
  return out;
}

/** Targets that apply right now: the active application's, or the workspace's own when no application is selected. */
const isProtectedEnv = (p) => !!(p.envs && p.envs.find((e) => e.name === p.env && e.protected)) || p.env === 'prod';
const activeTargets = (p) => (p.app && p.apps && p.apps[p.app] ? p.apps[p.app].targets : p.targets) || {};

function register({ ipcMain, wrap, host, terminal, send }) {
  const prepared = new Map();

  const provider = (id) => {
    const p = host.clouds.get(id);
    if (!p) throw new Error(`Unknown cloud "${id}".`);
    return p;
  };

  const projFile = (ws) => nativity.projectFile(ws);

  async function loadProj(ws) {
    let j = {};
    try { j = JSON.parse(await fs.promises.readFile(projFile(ws), 'utf8')); } catch {
      try { j = JSON.parse(await fs.promises.readFile(nativity.legacyProjectFile(ws), 'utf8')); } catch { /* not enabled yet */ }
    }
    if (j.projectId && !j.scope) j.scope = j.projectId; // v1 files
    const p = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (k in j) p[k] = j[k];
    try { p.envs = cleanEnvList(p.envs); } catch { p.envs = null; }
    p.targets = cleanTargets(p.targets);
    p.apps = cleanApps(p.apps);
    p.landing = cleanLanding(p.landing);
    if (p.app && !p.apps[p.app]) p.app = '';
    if (!host.clouds.has(p.cloud)) p.cloud = host.clouds.has('gcp') ? 'gcp' : [...host.clouds.keys()][0] || 'gcp';
    const prov = host.clouds.get(p.cloud);
    if (!p.region && prov && prov.defaultRegion) p.region = prov.defaultRegion;
    if (!p.service) p.service = sanitizeName(path.basename(ws));
    const tg = activeTargets(p);
    const t = tg[p.cloud] && tg[p.cloud][p.env];
    if (t) { if (t.scope) p.scope = t.scope; if (t.group) p.group = t.group; if (t.impersonate) p.impersonate = t.impersonate; }
    if (p.app) p.service = p.app;
    if (!p.group) p.group = `${p.service}-${p.env}-rg`;
    p.protectedEnv = isProtectedEnv(p);
    return p;
  }

  async function saveProj(ws, patch) {
    const cur = await loadProj(ws);
    const next = { ...cur };
    const cloud = patch && patch.cloud ? patch.cloud : cur.cloud;
    const prov = provider(cloud);
    if (patch && 'envs' in patch) next.envs = cleanEnvList(patch.envs);
    if (patch && 'targets' in patch) next.targets = cleanTargets(patch.targets);
    if (patch && 'apps' in patch) next.apps = cleanApps(patch.apps);
    if (patch && 'landing' in patch) next.landing = cleanLanding(patch.landing);
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in DEFAULTS) || ['envs', 'targets', 'apps', 'landing'].includes(k)) continue;
      if (k === 'app') { if (v && !next.apps[v]) throw new Error('Unknown application.'); next.app = v || ''; continue; }
      if (k === 'enabled') next.enabled = !!v;
      else if (k === 'cloud') next.cloud = cloud;
      else if (k === 'env') { if (!envNames(next).includes(v)) throw new Error('Unknown environment.'); next.env = v; }
      else if (k === 'scope') { if (v && !prov.validateScope(v)) throw new Error('Invalid scope for this cloud.'); next.scope = v || ''; }
      else if (k === 'region') { if (v && !prov.validateRegion(v)) throw new Error('Invalid region.'); next.region = v || ''; }
      else if (k === 'service' || k === 'repo') { if (v && !NAME_RE.test(v)) throw new Error(`Invalid ${k} name.`); next[k] = v || ''; }
      else if (k === 'group') { if (v && !GROUP_RE.test(v)) throw new Error('Invalid resource group name.'); next.group = v || ''; }
      else if (k === 'impersonate') { if (v && !SA_RE.test(v)) throw new Error('Invalid service account.'); next.impersonate = v || ''; }
    }
    if (patch && patch.cloud && patch.cloud !== cur.cloud) {
      // switching cloud resets cloud-specific fields
      if (!('scope' in patch)) next.scope = '';
      if (!('region' in patch)) next.region = prov.defaultRegion || '';
      if (!('impersonate' in patch)) next.impersonate = '';
    }
    // an environment can live in its own project / account / resource group: switching environment (or cloud) follows it
    if (patch && (('env' in patch) || ('cloud' in patch) || ('app' in patch))) {
      const tg = activeTargets(next);
      const t = tg[next.cloud] && tg[next.cloud][next.env];
      if (t) {
        if (!('scope' in patch) && t.scope) next.scope = t.scope;
        if (!('group' in patch) && t.group) next.group = t.group;
        next.impersonate = 'impersonate' in patch ? next.impersonate : (t.impersonate || '');
      }
      if (next.app) next.service = next.app;
    }
    next.protectedEnv = isProtectedEnv(next);
    await persist(ws, next);
    return next;
  }

  async function persist(ws, next) {
    const { protectedEnv, ...disk } = next;
    await fs.promises.mkdir(path.dirname(projFile(ws)), { recursive: true });
    await fs.promises.writeFile(projFile(ws), `${JSON.stringify({ environments: envNames(disk), ...disk }, null, 2)}\n`, 'utf8');
  }

  /** After the GCP wizard: remember the landing zone and where every application's environments live; turn Cloud Native mode on. */
  async function recordApps(ws, cloud, apps, envs, landing) {
    const cur = await loadProj(ws);
    const next = { ...cur };
    const merged = { ...cur.apps };
    for (const [name, a] of Object.entries(apps || {})) {
      const old = merged[name] || { dir: '', targets: {} };
      merged[name] = { dir: a.dir || old.dir, targets: { ...old.targets, [cloud]: { ...((old.targets || {})[cloud] || {}), ...(a.targets || {}) } } };
    }
    next.apps = cleanApps(merged);
    if (envs) next.envs = cleanEnvList(envs);
    if (landing) next.landing = cleanLanding({ ...cur.landing, [cloud]: landing });
    next.enabled = true;
    next.cloud = cloud;
    if (!next.app || !next.apps[next.app]) next.app = Object.keys(apps || {})[0] || Object.keys(next.apps)[0] || '';
    if (!envNames(next).includes(next.env)) next.env = envNames(next)[0];
    const tg = activeTargets(next);
    const t = tg[cloud] && tg[cloud][next.env];
    if (t) { if (t.scope) next.scope = t.scope; if (t.group) next.group = t.group; next.impersonate = t.impersonate || ''; }
    if (next.app) next.service = next.app;
    await persist(ws, next);
    return next;
  }

  const cloudHasTargets = (p) => !!(p.targets && p.targets[p.cloud] && Object.keys(p.targets[p.cloud]).length);

  /** Called after provisioning: remembers where each environment was created, and turns Cloud Native mode on. */
  async function recordTargets(ws, cloud, byEnv, envs, app) {
    const cur = await loadProj(ws);
    const next = { ...cur };
    next.targets = cleanTargets({ ...cur.targets, [cloud]: { ...(cur.targets[cloud] || {}), ...byEnv } });
    next.envs = cleanEnvList(envs);
    next.enabled = true;
    if (!cur.enabled || !cloudHasTargets(cur)) next.cloud = cloud;
    if (app && NAME_RE.test(app)) next.service = app;
    if (!envNames(next).includes(next.env)) next.env = envNames(next)[0];
    const t = next.targets[next.cloud] && next.targets[next.cloud][next.env];
    if (t) { if (t.scope) next.scope = t.scope; if (t.group) next.group = t.group; next.impersonate = t.impersonate || ''; }
    await persist(ws, next);
    return next;
  }

  const inWorkspace = (ws, rel) => {
    const abs = path.resolve(ws, rel);
    if (!abs.startsWith(path.resolve(ws) + path.sep)) throw new Error('Refusing to write outside the workspace.');
    return abs;
  };

  /* ---------- provider access ---------- */

  ipcMain.handle('cloud:list', wrap(async () => [...host.clouds.values()].map((p) => ({
    id: p.id, name: p.name, short: p.short || p.name, kind: p.kind || 'public', color: p.color || '#888',
    installUrl: (p.cli && p.cli.install) || '', plugin: p.plugin, regions: p.regions || [], defaultRegion: p.defaultRegion || '',
    scopeLabel: p.scopeLabel || 'Scope', hasProvision: !!p.provision, hasActions: !!(p.actions && (p.actions.deploy || p.actions.pipeline || p.actions.resource)),
  }))));

  ipcMain.handle('cloud:call', wrap(async (id, method, args) => {
    if (!CALLABLE.has(method)) throw new Error('Not allowed.');
    const p = provider(id);
    const fn = p[method];
    if (typeof fn !== 'function') throw new Error(`${p.name} does not support "${method}".`);
    if (method === 'login') {
      const emit = (evt, payload) => send('cloud:event', { provider: id, evt, payload });
      fn.call(p, emit);
      return true;
    }
    return fn.apply(p, args || []);
  }));

  /* ---------- project binding ---------- */

  ipcMain.handle('proj:get', wrap(async (ws) => loadProj(ws)));
  ipcMain.handle('proj:set', wrap(async (ws, patch) => saveProj(ws, patch)));

  /* ---------- generated files ---------- */

  async function writeGenerated(ws, gen, overwrite) {
    const target = inWorkspace(ws, gen.path);
    if (fs.existsSync(target) && !overwrite) throw new Error('EXISTS');
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, gen.content, 'utf8');
    return target;
  }

  ipcMain.handle('pipeline:status', wrap(async (ws) => {
    const proj = await loadProj(ws);
    const prov = provider(proj.cloud);
    const gen = prov.actions.generatePipeline ? prov.actions.generatePipeline(proj, ws) : null;
    return { supported: !!gen, path: gen ? gen.path : '', hasPipeline: !!gen && fs.existsSync(path.join(ws, gen.path)) };
  }));

  ipcMain.handle('pipeline:generate', wrap(async (ws, overwrite) => {
    const proj = await loadProj(ws);
    const prov = provider(proj.cloud);
    if (!prov.actions.generatePipeline) throw new Error(`${prov.name} has no CI/CD pipeline template.`);
    return writeGenerated(ws, prov.actions.generatePipeline(proj, ws), overwrite);
  }));

  ipcMain.handle('cloud:bootstrap', wrap(async (ws, envs, overwrite) => {
    const proj = await loadProj(ws);
    const prov = provider(proj.cloud);
    if (!prov.actions.bootstrap) throw new Error(`${prov.name} has no infrastructure bootstrap.`);
    const chosen = (envs || ENVS).filter((e) => ENVS.includes(e));
    return writeGenerated(ws, prov.actions.bootstrap(proj, chosen), overwrite);
  }));

  ipcMain.handle('cloud:resourceKinds', wrap(async (ws) => {
    const proj = await loadProj(ws);
    const prov = provider(proj.cloud);
    return prov.actions.resourceKinds ? prov.actions.resourceKinds(proj) : [];
  }));

  /* ---------- prepare -> confirm -> run ---------- */

  ipcMain.handle('cloud:prepare', wrap(async (ws, kind, params) => {
    const proj = await loadProj(ws);
    if (!proj.enabled) throw new Error('Cloud Native Development is not enabled for this project.');
    const prov = provider(proj.cloud);
    if (!proj.scope) throw new Error(`Select a ${prov.scopeLabel || 'scope'} first.`);
    const envService = `${proj.service}-${proj.env}`;
    if (!NAME_RE.test(envService)) throw new Error(`Invalid service name "${envService}".`);
    if (!['pipeline', 'deploy', 'resource'].includes(kind)) throw new Error('Unknown action.');
    if (!prov.actions[kind]) throw new Error(`${prov.name} does not support this action.`);
    const built = await prov.actions[kind](proj, kind === 'resource' ? params || {} : ws, ws);
    if (!built || !built.command) throw new Error('Provider returned no command.');
    const token = crypto.randomUUID();
    prepared.set(token, { command: built.command, cwd: ws, title: built.title });
    setTimeout(() => prepared.delete(token), 10 * 60 * 1000).unref();
    return { token, title: built.title, command: built.command, env: proj.env, scope: proj.scope, cloud: prov.name, protected: proj.protectedEnv };
  }));

  ipcMain.handle('cloud:run', wrap(async (token) => {
    const e = prepared.get(token);
    if (!e) throw new Error('That command expired. Start the action again.');
    prepared.delete(token);
    return { id: terminal.start(e.command, e.cwd), title: e.title };
  }));

  return { loadProj, saveProj, recordTargets, recordApps };
}

module.exports = { register, ENVS, NAME_RE };
