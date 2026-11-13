/** New Project (templates contributed by plugins), Git clone and GitHub import. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { exec } = require('./util');

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

function register({ ipcMain, wrap, host, send, store }) {
  ipcMain.handle('project:templates', wrap(async () => host.templates.map((t) => ({
    id: t.id, name: t.name, description: t.description || '', cloud: t.cloud || 'any', language: t.language || '',
  }))));

  ipcMain.handle('project:create', wrap(async ({ parentDir, name, template, gitInit }) => {
    if (!NAME_OK.test(String(name))) throw new Error('Project name: letters, digits, ".", "_" or "-" (max 100).');
    const t = host.templates.find((x) => x.id === template);
    if (!t) throw new Error('Unknown template.');
    if (!parentDir || !fs.existsSync(parentDir)) throw new Error('Choose an existing parent folder.');
    const dir = path.join(parentDir, name);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`"${dir}" already exists and is not empty.`);
    const files = t.files(name);
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

  ipcMain.handle('app:recents', wrap(async () => (store.get('recents', []) || []).filter((r) => fs.existsSync(r.path))));
  ipcMain.handle('app:addRecent', wrap(async (p) => {
    const list = (store.get('recents', []) || []).filter((r) => r.path !== p);
    list.unshift({ path: p, name: path.basename(p), at: Date.now() });
    store.set('recents', list.slice(0, 15));
  }));
  ipcMain.handle('app:removeRecent', wrap(async (p) => {
    store.set('recents', (store.get('recents', []) || []).filter((r) => r.path !== p));
  }));
}

module.exports = { register };
