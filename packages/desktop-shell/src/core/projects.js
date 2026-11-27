/** New Project (templates contributed by plugins), Git clone and GitHub import. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { exec } = require('./util');
const { pipelineFiles } = require('./pipeline');

const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const HTTPS = /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._~/-]+$/;
const SSH = /^git@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+$/;
const SHORT = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function normalizeRepo(input) {
  const s = String(input || '').trim();
  if (SHORT.test(s)) return `https://github.com/${s}.git`;
  if (HTTPS.test(s) || SSH.test(s)) return s;
  throw new Error('Enter owner/repo or an https:// or git@ repository URL.');
}

const repoName = (url) => url.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).pop();

function register({ ipcMain, wrap, host, send, store, flow }) {
  ipcMain.handle('project:templates', wrap(async () => host.templates.map((t) => ({
    id: t.id, name: t.name, description: t.description || '', cloud: t.cloud || 'any', language: t.language || '', scaffold: !!t.scaffold, form: t.form || '',
    // a template that ships a Dockerfile can be a Cloud Native project (it runs the same way in every environment)
    container: !t.scaffold && (() => { try { return Object.keys(t.files('app', { groupId: 'org.sample', modulePath: 'github.com/sample/app' })).some((f) => /^Dockerfile$/i.test(f)); } catch { return false; } })(),
  }))));

  ipcMain.handle('project:create', wrap(async ({ parentDir, name, template, gitInit, cloudNative, options }) => {
    if (!NAME_OK.test(String(name))) throw new Error('Project name: letters, digits, ".", "_" or "-" (max 100).');
    const t = host.templates.find((x) => x.id === template);
    if (!t) throw new Error('Unknown template.');
    if (!parentDir || !fs.existsSync(parentDir)) throw new Error('Choose an existing parent folder.');
    const dir = path.join(parentDir, name);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`"${dir}" already exists and is not empty.`);
    if (t.scaffold) {
      // The framework's own CLI creates the project; the UI runs this exact command in the terminal panel.
      return { dir, git: false, cloud: t.cloud || 'any', scaffold: String(t.scaffold(name, options || {})), parentDir };
    }
    const files = { ...t.files(name, options || {}) };
    if (cloudNative && cloudNative.pipeline) Object.assign(files, pipelineFiles({ cloud: cloudNative.cloud, envs: cloudNative.envs, name }));
    const entries = Object.entries(files);
    if (!entries.length || entries.length > 200) throw new Error('Template produced an invalid file set.');
    for (const [rel, content] of entries) {
      const abs = path.resolve(dir, rel);
      if (!abs.startsWith(path.resolve(dir) + path.sep)) throw new Error('Template tried to write outside the project.');
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf8');
    }
    let git = false;
    if (gitInit) git = (await exec('git', ['init'], { cwd: dir, timeout: 15000 })).ok;
    return { dir, git, cloud: t.cloud || 'any' };
  }));

  ipcMain.handle('git:clone', wrap(async (input, parentDir) => {
    const url = normalizeRepo(input);
    const name = repoName(url);
    if (!NAME_OK.test(name)) throw new Error('Could not derive a folder name from that URL.');
    if (!parentDir || !fs.existsSync(parentDir)) throw new Error('Choose an existing parent folder.');
    const dest = path.join(parentDir, name);
    if (fs.existsSync(dest)) throw new Error(`"${dest}" already exists.`);
    return new Promise((resolve, reject) => {
      // Arguments are passed as an array without a shell, so the URL cannot inject commands.
      // GIT_TERMINAL_PROMPT=0 makes auth failures fail fast instead of hanging on a hidden prompt.
      const child = spawn('git', ['clone', '--progress', '--', url, dest], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true });
      let err = '';
      child.stderr.on('data', (d) => { err += d; send('git:progress', d.toString()); });
      child.on('error', (e) => reject(new Error(/ENOENT/.test(e.message) ? 'Git is not installed or not on PATH.' : e.message)));
      child.on('close', (code) => {
        if (code === 0) return resolve(dest);
        const hint = /Authentication|could not read Username|denied|403|404/i.test(err)
          ? ' Authentication failed or repository not found. For private repositories sign in with "gh auth login" or Git Credential Manager first.'
          : '';
        reject(new Error(`git clone failed (exit ${code}).${hint}\n${err.trim().split('\n').slice(-3).join('\n')}`));
      });
    });
  }));

  // Optional: list the signed-in user's repositories through the GitHub CLI.
  ipcMain.handle('git:ghRepos', wrap(async () => {
    const r = await exec('gh', ['repo', 'list', '--limit', '60', '--json', 'nameWithOwner,description,isPrivate'], { timeout: 25000 });
    if (!r.ok) throw new Error(/not recognized|not found|ENOENT/i.test(r.err) ? 'GitHub CLI (gh) is not installed.' : (r.err || 'Run "gh auth login" first.'));
    return JSON.parse(r.out || '[]');
  }));


  /** Dashboard: every recent project with its clouds, environments and a few facts. Read-only, never contacts a cloud. */
  ipcMain.handle('dash:projects', wrap(async () => {
    const list = (store.get('recents', []) || []).filter((r) => fs.existsSync(r.path)).slice(0, 60);
    const out = [];
    for (const r of list) {
      const dir = r.path;
      const has = (f) => fs.existsSync(path.join(dir, f));
      let kind = '';
      if (has('pom.xml')) kind = 'Java · Maven'; else if (has('build.gradle') || has('build.gradle.kts')) kind = 'Gradle'; else if (has('package.json')) kind = 'Node.js';
      else if (has('go.mod')) kind = 'Go'; else if (has('requirements.txt') || has('pyproject.toml')) kind = 'Python';
      else { try { if (fs.readdirSync(dir).some((f) => /\.(csproj|sln)$/.test(f))) kind = '.NET'; } catch { /* unreadable */ } }
      let branch = '';
      try { const h = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim(); branch = h.startsWith('ref:') ? h.replace('ref: refs/heads/', '') : h.slice(0, 7); } catch { /* not a git repository */ }
      let proj = null;
      try { proj = await flow.loadProj(dir); } catch { /* no project file */ }
      const envs = proj && proj.envs && proj.envs.length ? proj.envs.map((e) => e.name) : ['dev', 'sit', 'uat', 'prod'];
      const clouds = {}; // cloud id -> { env -> { region, account, at } }
      const take = (targets) => {
        for (const [cid, byEnv] of Object.entries(targets || {})) for (const [env, t] of Object.entries(byEnv || {})) {
          const c = (clouds[cid] = clouds[cid] || {});
          c[env] = { region: t.region || '', account: t.account || t.scope || '', at: t.provisionedAt || '', scope: t.scope || '', stack: t.stack || '', group: t.group || '' };
        }
      };
      if (proj) { take(proj.targets); for (const a of Object.values(proj.apps || {})) take(a.targets); }
      out.push({ path: dir, name: r.name || path.basename(dir), openedAt: r.at || 0, kind, branch, enabled: !!(proj && proj.enabled), active: proj && proj.enabled ? { cloud: proj.cloud, env: proj.env } : null, apps: proj ? Object.keys(proj.apps || {}) : [], envs, clouds });
    }
    return out;
  }));

  /** Live status of every created environment of one project. Read-only CLI look-ups, short timeouts, values validated before use. */
  const OKV = {
    gcp: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, region: /^[a-z0-9-]{3,25}$/, stack: /^[A-Za-z][A-Za-z0-9-]{0,127}$/,
    profile: /^[A-Za-z0-9._-]{1,60}$/, group: /^[A-Za-z0-9._()-]{1,90}$/, guid: /^[0-9a-fA-F-]{36}$/,
  };
  const bad = (st, msg) => ({ state: st, detail: msg });
  async function envStatus(cloud, t) {
    if (cloud === 'gcp') {
      if (!OKV.gcp.test(t.scope)) return bad('unknown', 'No project recorded');
      const r = await exec('gcloud', ['projects', 'describe', t.scope, '--format=value(lifecycleState)'], { timeout: 20000 });
      if (!r.ok) return bad(/not found|does not exist|PERMISSION_DENIED|403/i.test(r.err) ? 'gone' : 'unknown', /not found|does not exist/i.test(r.err) ? 'Project not found' : 'Could not check (sign in?)');
      const s = r.out.trim();
      return s === 'ACTIVE' ? bad('ok', 'Project active') : bad(s === 'DELETE_REQUESTED' ? 'gone' : 'warn', 'Project ' + s.toLowerCase());
    }
    if (cloud === 'aws') {
      if (!OKV.stack.test(t.stack) || !OKV.region.test(t.region)) return bad('unknown', 'No stack recorded');
      const args = ['cloudformation', 'describe-stacks', '--stack-name', t.stack, '--region', t.region, '--query', 'Stacks[0].StackStatus', '--output', 'text'];
      if (OKV.profile.test(t.scope) && t.scope !== 'default') args.push('--profile', t.scope);
      const r = await exec('aws', args, { timeout: 25000 });
      if (!r.ok) return bad(/does not exist/i.test(r.err) ? 'gone' : 'unknown', /does not exist/i.test(r.err) ? 'Stack not found' : 'Could not check (sign in?)');
      const s = r.out.trim();
      return bad(/_COMPLETE$/.test(s) && !/ROLLBACK|DELETE/.test(s) ? 'ok' : /IN_PROGRESS$/.test(s) ? 'warn' : 'bad', 'Stack ' + s.toLowerCase().replace(/_/g, ' '));
    }
    if (cloud === 'azure') {
      if (!OKV.group.test(t.group) || !OKV.guid.test(t.scope)) return bad('unknown', 'No resource group recorded');
      const r = await exec('az', ['group', 'show', '--name', t.group, '--subscription', t.scope, '--query', 'properties.provisioningState', '-o', 'tsv'], { timeout: 25000 });
      if (!r.ok) return bad(/could not be found|ResourceGroupNotFound/i.test(r.err) ? 'gone' : 'unknown', /not be found|NotFound/i.test(r.err) ? 'Resource group not found' : 'Could not check (sign in?)');
      return bad(r.out.trim() === 'Succeeded' ? 'ok' : 'warn', 'Resource group ' + r.out.trim().toLowerCase());
    }
    return bad('unknown', 'No live check for this cloud');
  }
  ipcMain.handle('dash:status', wrap(async (dir) => {
    const proj = await flow.loadProj(String(dir));
    const jobs = [];
    const seen = new Set();
    const take = (targets) => { for (const [cid, byEnv] of Object.entries(targets || {})) for (const [env, t] of Object.entries(byEnv || {})) {
      const key = cid + '/' + env + '/' + (t.scope || '') + '/' + (t.stack || '') + '/' + (t.group || ''); if (seen.has(key)) continue; seen.add(key);
      jobs.push(envStatus(cid, t || {}).then((s) => ({ cloud: cid, env, ...s }))); } };
    take(proj.targets); for (const a of Object.values(proj.apps || {})) take(a.targets);
    return Promise.all(jobs.slice(0, 24));
  }));

  /** Folder scan: find projects below a folder (Cloud Native project files, or a git / build file) and add them to the dashboard. */
  const SKIP = new Set(['node_modules', '.git', 'target', 'build', 'dist', '.gradle', '.idea', '.vscode', 'bin', 'obj', 'venv', '.venv', '__pycache__', 'AppData', '$Recycle.Bin']);
  ipcMain.handle('dash:scan', wrap(async (root) => {
    const base = path.resolve(String(root || ''));
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) throw new Error('That folder does not exist.');
    const found = [];
    const isProject = (d) => ['.nativity/project.json', '.cnd/project.json', '.git', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'package.json', 'go.mod', 'pyproject.toml', 'requirements.txt'].some((f) => fs.existsSync(path.join(d, f)));
    let visited = 0;
    const walk = (d, depth) => {
      if (found.length >= 60 || visited++ > 4000) return;
      if (isProject(d)) { found.push(d); return; } // a project: do not look inside it
      if (depth >= 3) return;
      let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) walk(path.join(d, e.name), depth + 1);
    };
    walk(base, 0);
    const list = (store.get('recents', []) || []).filter((r) => fs.existsSync(r.path));
    const have = new Set(list.map((r) => r.path.toLowerCase()));
    let added = 0;
    for (const d of found) if (!have.has(d.toLowerCase())) { list.push({ path: d, name: path.basename(d), at: 0 }); added++; }
    store.set('recents', list.slice(0, 60));
    return { found: found.length, added };
  }));

  ipcMain.handle('app:recents', wrap(async () => (store.get('recents', []) || []).filter((r) => fs.existsSync(r.path))));
  ipcMain.handle('app:addRecent', wrap(async (p) => {
    const list = (store.get('recents', []) || []).filter((r) => r.path !== p);
    list.unshift({ path: p, name: path.basename(p), at: Date.now() });
    store.set('recents', list.slice(0, 60));
  }));
  ipcMain.handle('app:removeRecent', wrap(async (p) => {
    store.set('recents', (store.get('recents', []) || []).filter((r) => r.path !== p));
  }));
}

module.exports = { register };
