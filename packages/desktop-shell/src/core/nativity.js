/**
 * The .nativity folder: Nativity Studio's own folder inside every project (like .idea for IntelliJ or .vscode for VS Code).
 *
 *   .nativity/
 *     project.json     Cloud Native binding: cloud, environments and where each one lives (project ids, resource groups, stack names ...).
 *                      Contains no secrets. COMMIT it: teammates open the project already connected.
 *     workspace.json   Your personal session: open files, the build you last selected, favourite goals, ignored advisor tips.
 *                      Not committed (listed in .nativity/.gitignore).
 *     logs/            A log of every environment provisioning run (what was created, when, what failed). Not committed.
 *     README.md        Explains all of this to whoever finds the folder.
 *     .gitignore       Keeps the personal parts out of Git.
 *
 * What is deliberately NOT here: caches (compiled classes, Maven classpaths, indexes). They live in the user's app-data folder so a project
 * never fills up with generated files, and credentials (cloud sign-ins and API keys are never written into a project).
 * Older versions kept project.json in .cnd/; it is copied over the first time a project is opened.
 */
const fs = require('fs');
const path = require('path');

const DIR = '.nativity';
const GITIGNORE = '# Personal / generated: not shared through Git\nworkspace.json\nlogs/\n*.local.json\n';
const README = `# .nativity

This folder is created by **Nativity Studio** (the IDE) in every project you open with it, the same way IntelliJ creates \`.idea\` and VS Code creates \`.vscode\`.

| File | What it is | Commit it? |
|------|------------|------------|
| \`project.json\` | Cloud Native binding: which cloud this project uses, its environments (dev, test, prod ... your names) and where each one lives (project IDs, resource groups, stack names, namespaces). **No secrets.** | **Yes**: teammates open the project already connected |
| \`workspace.json\` | Your personal session: open files, the build you last selected, favourite build goals, advisor tips you switched off | No |
| \`logs/\` | A log of every environment provisioning run: what was created, when, and what failed | No |
| \`.gitignore\` | Keeps the personal parts above out of Git | Yes |

Caches (compiled classes, dependency classpaths, indexes) are **not** stored here: they live in the IDE's app-data folder.
Cloud sign-ins and API keys are **never** written into a project.

It is safe to delete this folder: the IDE recreates it. You lose the cloud binding (re-enable Cloud Native Development) and your session.
`;

const WS_DEFAULT = { version: 1, tabs: [], active: '', build: {}, advisor: {} };

function register({ ipcMain, wrap, getWorkspace }) {
  const wsDir = (ws) => path.join(ws, DIR);
  const wsFile = (ws) => path.join(wsDir(ws), 'workspace.json');
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const check = (ws) => { const cur = getWorkspace(); if (!cur || !ws || !same(ws, cur)) throw new Error('That folder is not the open project.'); return path.resolve(cur); };

  /** Creates the folder and its files, and brings an old .cnd/project.json across. Never overwrites anything that exists. */
  function ensure(ws) {
    const dir = wsDir(ws);
    fs.mkdirSync(dir, { recursive: true });
    const put = (name, text) => { const f = path.join(dir, name); if (!fs.existsSync(f)) fs.writeFileSync(f, text, 'utf8'); };
    put('README.md', README);
    put('.gitignore', GITIGNORE);
    const legacy = path.join(ws, '.cnd', 'project.json');
    if (!fs.existsSync(path.join(dir, 'project.json')) && fs.existsSync(legacy)) { try { fs.copyFileSync(legacy, path.join(dir, 'project.json')); } catch { /* optional */ } }
    put('workspace.json', `${JSON.stringify(WS_DEFAULT, null, 2)}\n`);
    return dir;
  }

  function read(ws) {
    try { return { ...WS_DEFAULT, ...JSON.parse(fs.readFileSync(wsFile(ws), 'utf8')) }; } catch { return { ...WS_DEFAULT }; }
  }

  ipcMain.handle('nativity:ensure', wrap(async (ws) => {
    const w = check(ws);
    let created = false;
    try { created = !fs.existsSync(wsDir(w)); ensure(w); } catch (e) { return { ok: false, error: e.message, state: { ...WS_DEFAULT } }; } // read-only folder: the IDE still works
    return { ok: true, created, dir: wsDir(w), state: read(w) };
  }));

  ipcMain.handle('nativity:set', wrap(async (ws, patch) => {
    const w = check(ws);
    if (!patch || typeof patch !== 'object') throw new Error('Nothing to save.');
    const cur = read(w);
    const next = { ...cur };
    if (Array.isArray(patch.tabs)) next.tabs = patch.tabs.filter((t) => typeof t === 'string' && t.length < 600).slice(0, 60);
    if (typeof patch.active === 'string') next.active = patch.active.slice(0, 600);
    if (patch.build && typeof patch.build === 'object') next.build = patch.build;
    if (patch.advisor && typeof patch.advisor === 'object') next.advisor = patch.advisor;
    const text = JSON.stringify(next, null, 2);
    if (text.length > 512 * 1024) throw new Error('The workspace state is too large.');
    ensure(w);
    fs.writeFileSync(wsFile(w), `${text}\n`, 'utf8');
    return true;
  }));
}

/** Where project.json lives (new location), plus the legacy one to read from when the new file does not exist yet. */
const projectFile = (ws) => path.join(ws, DIR, 'project.json');
const legacyProjectFile = (ws) => path.join(ws, '.cnd', 'project.json');

/** Appends a provisioning log under .nativity/logs and returns its path (best effort). */
function writeLog(ws, name, text) {
  try {
    const dir = path.join(ws, DIR, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, name);
    fs.writeFileSync(f, text, 'utf8');
    return f;
  } catch { return ''; }
}

module.exports = { register, DIR, projectFile, legacyProjectFile, writeLog };
