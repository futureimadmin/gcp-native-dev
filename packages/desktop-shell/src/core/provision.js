/**
 * Environment provisioning (landing zones).
 * Each cloud plugin describes WHAT its environments look like (architecture diagram data) and HOW to create them (ordered steps).
 * This module validates the request, builds the plan, and runs the steps one at a time with live progress.
 *
 * SAFETY (same rule as cloudflow): the UI never sends command text. It sends names; the cloud plugin builds the commands
 * from validated names; the UI shows every command and can only run a plan by its one-time token. Commands are run without a
 * shell-concatenated user string (arguments are quoted by util.commandLine) and every value captured from one step to feed the
 * next is checked against a strict pattern first.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, commandLine } = require('./util');

const APP_RE = /^[a-z][a-z0-9-]{1,19}[a-z0-9]$/;
const ENV_RE = /^[a-z][a-z0-9]{0,11}$/; // short, no dashes: ends up inside project ids, stack names, namespaces, resource groups
const VALUE_RE = /^[A-Za-z0-9/_.:@-]{1,160}$/;
const MAX_ENVS = 8;

function register({ ipcMain, wrap, host, send, cloudflow }) {
  const plans = new Map(); // token -> plan
  const runs = new Map(); // runId -> { cancelled }
  let runSeq = 0;
  const discoveryCache = new Map(); // cloud -> { at, data }

  const prov = (id) => {
    const p = host.clouds.get(id);
    if (!p) throw new Error(`Unknown cloud "${id}".`);
    if (!p.provision) throw new Error(`${p.name} cannot provision environments yet.`);
    return p;
  };

  const ctxFor = (p) => ({ exec: (c, a, o) => exec(c, a, o), commandLine, cloud: p });

  async function discover(cloudId, fresh) {
    // gcloud / az can take several seconds to answer: share one lookup between callers and remember it for a few minutes
    const hit = discoveryCache.get(cloudId);
    if (hit && !fresh && Date.now() - hit.at < 5 * 60 * 1000) return hit.promise;
    const p = prov(cloudId);
    const promise = Promise.resolve(p.provision.discover(ctxFor(p)));
    discoveryCache.set(cloudId, { at: Date.now(), promise });
    promise.catch(() => discoveryCache.delete(cloudId));
    return promise;
  }

  function cleanEnvs(envs) {
    if (!Array.isArray(envs) || !envs.length) throw new Error('Choose at least one environment.');
    if (envs.length > MAX_ENVS) throw new Error(`At most ${MAX_ENVS} environments.`);
    const seen = new Set();
    return envs.map((e) => {
      const name = String(e && e.name || '').trim().toLowerCase();
      if (!ENV_RE.test(name)) throw new Error(`"${name}" is not a valid environment name. Use 1-12 lower-case letters and digits, starting with a letter (for example dev, qa, staging, prod).`);
      if (seen.has(name)) throw new Error(`The environment "${name}" is listed twice.`);
      seen.add(name);
      return { name, protected: !!(e && e.protected) || name === 'prod' || name === 'production' };
    });
  }

  /* ---------- discovery + plan ---------- */

  ipcMain.handle('prov:discover', wrap(async (cloudId, fresh) => discover(cloudId, !!fresh)));

  ipcMain.handle('prov:plan', wrap(async (ws, spec) => {
    const proj = await cloudflow.loadProj(ws);
    const app = String(spec && spec.app || proj.service || '').trim().toLowerCase();
    if (!APP_RE.test(app)) throw new Error('The application name must be 3-21 characters: lower-case letters, digits and "-", starting with a letter.');
    const envs = cleanEnvs(spec && spec.envs);
    const chosen = Object.entries((spec && spec.clouds) || {}).filter(([, c]) => c && c.enabled);
    if (!chosen.length) throw new Error('Select at least one cloud to provision.');
    const out = [];
    await Promise.all(chosen.map(([id]) => discover(id, false).catch(() => null))); // look up all clouds at the same time
    for (const [id, opts] of chosen) {
      const p = prov(id);
      const disc = await discover(id, false);
      if (!disc || disc.signedIn === false) throw new Error(`${p.name} is not connected. Sign in first.`);
      const region = opts.region && p.validateRegion(opts.region) ? opts.region : p.defaultRegion;
      const plan = await p.provision.plan({ app, envs, region, options: opts.options || {}, existing: (proj.targets && proj.targets[id]) || {}, workspace: ws }, disc);
      for (const s of plan.steps) {
        if (!s.id || !s.cmd || !Array.isArray(s.args)) throw new Error(`${p.name} produced an invalid step.`);
        s.display = commandLine(s.cmd, s.args);
        if (s.check) s.checkDisplay = commandLine(s.check.cmd, s.check.args);
      }
      out.push({ id, name: p.name, short: p.short || p.name, color: p.color, region, ...plan });
    }
    const protectedEnvs = envs.filter((e) => e.protected).map((e) => e.name);
    const token = crypto.randomUUID();
    plans.set(token, { ws, app, envs, clouds: out });
    setTimeout(() => plans.delete(token), 30 * 60 * 1000).unref();
    const view = out.map((c) => ({ ...c, steps: c.steps.map(({ id, env, title, display, checkDisplay, optional, writeFile }) => ({ id, env: env || '', title, display, checkDisplay: checkDisplay || '', optional: !!optional, file: writeFile ? writeFile.path : '' })) }));
    return { token, app, envs, protectedEnvs, clouds: view, totalSteps: out.reduce((n, c) => n + c.steps.length, 0) };
  }));

  /* ---------- run ---------- */

  const fill = (s, vars) => String(s).replace(/\{\{(\w+)\}\}/g, (_m, k) => {
    if (!(k in vars)) throw new Error(`Step needs "${k}", which an earlier step did not produce.`);
    return vars[k];
  });

  function tail(r) {
    return String(r.err || r.out || '').split(/\r?\n/).filter(Boolean).slice(-6).join('\n').slice(0, 1200);
  }

  async function runPlan(runId, plan) {
    const state = runs.get(runId);
    const logLines = [`Provisioning run ${new Date().toISOString()}  app=${plan.app}  environments=${plan.envs.map((e) => e.name).join(',')}`];
    const emit = (payload) => {
      send('prov:event', { runId, ...payload });
      if (payload.type === 'step' && payload.status !== 'running') logLines.push(`${new Date().toISOString()}  ${payload.cloud}  ${payload.step}  ${payload.status}${payload.message ? `  ${String(payload.message).replace(/\s+/g, ' ')}` : ''}`);
    };
    const results = [];
    for (const cloud of plan.clouds) {
      const vars = {};
      const envOk = new Map(plan.envs.map((e) => [e.name, true]));
      let stopped = false;
      emit({ type: 'cloud', cloud: cloud.id, status: 'running' });
      for (const step of cloud.steps) {
        if (state.cancelled) { stopped = true; break; }
        const mark = (status, message, output) => emit({ type: 'step', cloud: cloud.id, step: step.id, status, message: message || '', output: output || '' });
        if (stopped) { mark('pending', 'Not run because an earlier step failed.'); continue; }
        if (step.skipBecause) { mark('pending', `Skipped because step "${step.skipBecause}" failed for this environment.`); continue; }
        mark('running');
        try {
          if (step.writeFile) {
            const target = path.resolve(plan.ws, step.writeFile.path);
            if (!target.startsWith(path.resolve(plan.ws) + path.sep)) throw new Error('Refusing to write outside the project.');
            await fs.promises.mkdir(path.dirname(target), { recursive: true });
            await fs.promises.writeFile(target, step.writeFile.content, 'utf8');
            mark('ok', `Wrote ${step.writeFile.path}`);
            continue;
          }
          if (step.check) {
            const c = await exec(step.check.cmd, step.check.args.map((a) => fill(a, vars)), { timeout: step.check.timeout || 60000, cwd: plan.ws });
            const present = c.ok && (step.check.match ? new RegExp(step.check.match, 'i').test(c.out) : step.check.expect === 'ok' || !!c.out.trim());
            if (present) {
              if (step.capture) { const v = c.out.split(/\r?\n/).filter(Boolean).pop().trim(); if (VALUE_RE.test(v)) vars[step.capture] = v; }
              mark('skipped', 'Already exists');
              continue;
            }
          }
          const args = step.args.map((a) => fill(a, vars));
          let r = await exec(step.cmd, args, { timeout: step.timeout || 300000, cwd: plan.ws });
          // permissions and new identities take a few seconds to become visible: retry where the step says so
          for (let n = 0; !r.ok && n < (step.retries || 0) && !state.cancelled; n++) {
            mark('running', `Waiting for the cloud to catch up (try ${n + 2})…`);
            await new Promise((res) => setTimeout(res, step.retryDelay || 6000));
            r = await exec(step.cmd, args, { timeout: step.timeout || 300000, cwd: plan.ws });
          }
          if (!r.ok) {
            const benign = step.okIf && new RegExp(step.okIf, 'i').test(`${r.err}\n${r.out}`);
            if (!benign) throw new Error(tail(r) || `Exit code ${r.code}`);
          }
          if (step.capture) {
            const v = r.out.split(/\r?\n/).filter(Boolean).pop() || '';
            if (!VALUE_RE.test(v.trim())) throw new Error(`Unexpected output from the command: ${v.slice(0, 80)}`);
            vars[step.capture] = v.trim();
          }
          mark('ok', '', r.out.split(/\r?\n/).slice(-3).join('\n').slice(0, 400));
        } catch (e) {
          if (step.optional) { mark('warn', e.message); continue; }
          mark('failed', e.message);
          if (step.env) envOk.set(step.env, false);
          // steps for other environments are independent of this failure, but infrastructure-wide steps are not
          if (!step.env) stopped = true;
          else for (const later of cloud.steps) if (later.env === step.env && later !== step) later.skipBecause = step.id;
        }
      }
      const doneEnvs = [];
      for (const [env, ok] of envOk) if (ok && !stopped && !state.cancelled) doneEnvs.push(env);
      if (doneEnvs.length && cloud.targets) {
        const patch = {};
        for (const env of doneEnvs) if (cloud.targets[env]) patch[env] = { ...cloud.targets[env], provisionedAt: new Date().toISOString() };
        try { await cloudflow.recordTargets(plan.ws, cloud.id, patch, plan.envs, plan.app); } catch (e) { emit({ type: 'note', message: `Could not save the result to .cnd/project.json: ${e.message}` }); }
      }
      results.push({ cloud: cloud.id, envs: doneEnvs, failed: [...envOk].filter(([, ok]) => !ok).map(([e]) => e), stopped });
      emit({ type: 'cloud', cloud: cloud.id, status: results[results.length - 1].failed.length || stopped ? 'failed' : 'ok' });
    }
    discoveryCache.clear(); // what exists has changed
    require('./nativity').writeLog(plan.ws, `provision-${new Date().toISOString().replace(/[:.]/g, '-')}.log`, `${logLines.join('\n')}\n`);
    emit({ type: 'done', cancelled: !!state.cancelled, results });
    runs.delete(runId);
  }

  ipcMain.handle('prov:run', wrap(async (token, typed) => {
    const plan = plans.get(token);
    if (!plan) throw new Error('That plan expired. Review the plan again.');
    if (plan.envs.some((e) => e.protected) && String(typed || '').trim() !== 'provision') throw new Error('Type "provision" to confirm protected environments.');
    plans.delete(token);
    const runId = ++runSeq;
    runs.set(runId, { cancelled: false });
    // clear per-run markers
    for (const c of plan.clouds) for (const s of c.steps) delete s.skipBecause;
    setTimeout(() => runPlan(runId, plan).catch((e) => { send('prov:event', { runId, type: 'done', error: e.message, results: [] }); runs.delete(runId); }), 400);
    return { runId };
  }));

  ipcMain.handle('prov:cancel', wrap(async (runId) => { const r = runs.get(Number(runId)); if (r) r.cancelled = true; }));
}

module.exports = { register, APP_RE, ENV_RE };
