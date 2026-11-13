/**
 * Cloud Native Studio — Electron main process.
 * Thin core (windows, files, settings, terminal, menus) + a plugin host. Clouds, AI providers, templates and
 * analyzers all arrive through plugins (see core/pluginhost.js and docs/PLUGINS.md).
 */
const { app, BrowserWindow, Menu, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const { Store, Secrets } = require('./core/store');
const terminalMod = require('./core/terminal');
const { PluginHost } = require('./core/pluginhost');
const cloudflow = require('./core/cloudflow');
const projects = require('./core/projects');
const ai = require('./core/ai');

const DEV = process.argv.includes('--dev') || !!process.env.CND_DEBUG;
let win = null;
let workspace = null;

const sendToRenderer = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

/** Every IPC handler returns {ok,data} or {ok:false,error}; the renderer never sees a thrown exception. */
const wrap = (fn) => async (_e, ...a) => {
  try {
    return { ok: true, data: await fn(...a) };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
};

let store;
let secrets;
let terminal;
let host;

function boot() {
  const ud = app.getPath('userData');
  store = new Store(path.join(ud, 'settings.json'), {
    editor: { fontSize: 13 },
    startup: { promptLogin: true },
    envOverrides: {},
    recents: [],
  });
  secrets = new Secrets(path.join(ud, 'secrets.json'), safeStorage);
  terminal = terminalMod.create({ sendToRenderer, envProvider: () => ({ ...process.env, ...(store.get('envOverrides', {}) || {}) }) });
  host = new PluginHost({
    store, secrets, sendToRenderer, terminal,
    builtinDir: path.join(__dirname, 'plugins', 'builtin'),
    userPluginDir: path.join(ud, 'plugins'),
    getWorkspace: () => workspace,
  });
  host.loadAll();
  cloudflow.register({ ipcMain, wrap, host, terminal, send: sendToRenderer });
  projects.register({ ipcMain, wrap, host, send: sendToRenderer, store });
  ai.register({ ipcMain, wrap, host, store, secrets, terminal });
}

/* ------------------------------ window & menu ------------------------------ */

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1000, minHeight: 620,
    title: 'Cloud Native Studio', backgroundColor: '#0e0f0c', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (process.env.CND_DEBUG) {
    win.webContents.on('console-message', (_e, level, message, line, source) => console.log(`[renderer:${level}] ${message} (${source}:${line})`));
    win.webContents.on('did-fail-load', (_e, code, desc) => console.log('[renderer] did-fail-load', code, desc));
  }
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

function buildMenu() {
  const cmd = (label, id, accelerator, arg) => ({ label, accelerator, click: () => sendToRenderer('menu', { id, arg }) });
  const recents = (store.get('recents', []) || []).filter((r) => fs.existsSync(r.path)).slice(0, 10);
  const clouds = [...host.clouds.values()];
  const contributed = (group) => [...host.plugins.values()]
    .filter((p) => p.enabled)
    .flatMap((p) => ((p.contributes.menus || {})[group] || []).map((m) => cmd(m.label, m.command, m.accelerator)));
  const sep = { type: 'separator' };

  const template = [
    {
      label: 'File',
      submenu: [
        cmd('New Project…', 'project.new', 'CmdOrCtrl+Shift+N'),
        cmd('New File', 'file.new', 'CmdOrCtrl+N'),
        sep,
        cmd('Open Folder…', 'folder.open', 'CmdOrCtrl+O'),
        { label: 'Open Recent', submenu: recents.length ? recents.map((r) => cmd(r.name, 'recent.open', undefined, r.path)) : [{ label: 'No recent projects', enabled: false }] },
        sep,
        cmd('Import from GitHub…', 'github.import'),
        cmd('Clone Git Repository…', 'git.clone'),
        sep,
        cmd('Save', 'file.save', 'CmdOrCtrl+S'),
        cmd('Save All', 'file.saveAll', 'CmdOrCtrl+Alt+S'),
        cmd('Close Folder', 'folder.close'),
        sep,
        cmd('Settings…', 'settings.open', 'CmdOrCtrl+,'),
        sep,
        { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, sep, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        cmd('Workspace Home', 'workspace.show', 'CmdOrCtrl+Shift+H'),
        cmd('Explorer', 'view.explorer', 'CmdOrCtrl+Shift+E'),
        cmd('Clouds', 'view.clouds', 'CmdOrCtrl+Shift+C'),
        cmd('Modernize', 'view.modernize'),
        cmd('AI Assistant', 'ai.toggle', 'CmdOrCtrl+Shift+A'),
        cmd('Terminal', 'view.terminal', 'CmdOrCtrl+`'),
        cmd('Command Palette…', 'palette.open', 'CmdOrCtrl+Shift+P'),
        sep,
        { role: 'reload' }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Cloud',
      submenu: [
        cmd('Cloud Accounts…', 'view.clouds'),
        { label: 'Sign In', submenu: clouds.map((c) => cmd(c.name, 'cloud.login', undefined, c.id)) },
        sep,
        cmd('Enable / Disable Cloud Native Development', 'cloud.toggleMode'),
        cmd('Run CI/CD Pipeline', 'cloud.pipeline.run'),
        cmd('Deploy', 'cloud.deploy'),
        cmd('Create Cloud Resource…', 'cloud.resource'),
        cmd('Generate CI/CD Pipeline', 'cloud.pipeline.generate'),
        cmd('Bootstrap Environments (Terraform)…', 'cloud.bootstrap'),
        cmd('Switch Environment…', 'cloud.switchEnv'),
        cmd('Open Cloud Console', 'cloud.console'),
        ...(contributed('cloud').length ? [sep, ...contributed('cloud')] : []),
      ],
    },
    {
      label: 'AI',
      submenu: [
        cmd('AI Assistant', 'ai.toggle'),
        cmd('Launch Claude Code (terminal)', 'ai.cli', undefined, 'claude-code'),
        cmd('Launch Gemini CLI (terminal)', 'ai.cli', undefined, 'gemini-cli'),
        cmd('Launch Codex CLI (terminal)', 'ai.cli', undefined, 'codex-cli'),
        ...(contributed('ai').length ? [sep, ...contributed('ai')] : []),
      ],
    },
    {
      label: 'Modernize',
      submenu: [
        cmd('Assess Project for Migration', 'modernize.assess'),
        cmd('Generate Migration Plan…', 'modernize.plan'),
        ...(contributed('modernize').length ? [sep, ...contributed('modernize')] : []),
      ],
    },
    ...(contributed('tools').length ? [{ label: 'Tools', submenu: contributed('tools') }] : []),
    { label: 'Help', submenu: [cmd('Plugin Guide', 'help.plugins'), cmd('About Cloud Native Studio', 'help.about')] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------ core IPC ------------------------------ */

const MAX_TEXT_BYTES = 5 * 1024 * 1024;

function registerCoreIpc() {
  ipcMain.handle('fs:readDir', wrap(async (dir) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries
      .filter((d) => d.name !== '.git')
      .map((d) => ({ name: d.name, path: path.join(dir, d.name), isDir: d.isDirectory() }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  }));
  ipcMain.handle('fs:readFile', wrap(async (file) => {
    const st = await fs.promises.stat(file);
    if (st.size > MAX_TEXT_BYTES) throw new Error('File is larger than 5 MB; not opened.');
    const buf = await fs.promises.readFile(file);
    if (buf.subarray(0, 8000).includes(0)) throw new Error('Binary file; not opened.');
    return buf.toString('utf8');
  }));
  ipcMain.handle('fs:writeFile', wrap(async (file, text) => { await fs.promises.writeFile(file, text, 'utf8'); }));
  ipcMain.handle('fs:create', wrap(async (target, isDir) => {
    if (fs.existsSync(target)) throw new Error('Already exists.');
    if (isDir) await fs.promises.mkdir(target, { recursive: true });
    else { await fs.promises.mkdir(path.dirname(target), { recursive: true }); await fs.promises.writeFile(target, ''); }
  }));
  ipcMain.handle('fs:rename', wrap(async (from, to) => {
    if (fs.existsSync(to)) throw new Error('Target already exists.');
    await fs.promises.rename(from, to);
  }));
  ipcMain.handle('fs:trash', wrap(async (target) => { await shell.trashItem(target); })); // Recycle Bin: recoverable
  ipcMain.handle('fs:exists', wrap(async (p) => fs.existsSync(p)));

  ipcMain.handle('dialog:selectFolder', wrap(async (title) => {
    const r = await dialog.showOpenDialog(win, { title: title || 'Select folder', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  }));
  ipcMain.handle('dialog:confirm', wrap(async (message, detail) => {
    const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Cancel', 'OK'], defaultId: 1, cancelId: 0, message, detail });
    return r.response === 1;
  }));

  ipcMain.handle('settings:get', wrap(async () => store.all()));
  ipcMain.handle('settings:set', wrap(async (key, val) => {
    if (!/^(editor|startup|ui|cloud|workspace|envOverrides)(\.|$)/.test(key)) throw new Error('That setting cannot be changed from the UI.');
    store.set(key, val);
  }));
  ipcMain.handle('secret:available', wrap(async () => secrets.available()));

  ipcMain.handle('shell:openExternal', wrap(async (url) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Only https links can be opened.');
    await shell.openExternal(url);
  }));

  ipcMain.handle('term:run', wrap(async (command, cwd) => terminal.start(command, cwd)));
  ipcMain.handle('term:kill', wrap(async (id) => terminal.kill(id)));

  ipcMain.handle('host:plugins', wrap(async () => host.describe()));
  ipcMain.handle('host:setEnabled', wrap(async (id, on) => { host.setEnabled(id, on); return host.describe(); }));
  ipcMain.handle('host:openPluginsDir', wrap(async () => {
    const dir = path.join(app.getPath('userData'), 'plugins');
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
  }));
  ipcMain.handle('plugin:invoke', wrap(async (id, channel, args) => host.invoke(id, channel, args)));

  ipcMain.handle('app:info', wrap(async () => ({
    version: app.getVersion(), platform: process.platform, userData: app.getPath('userData'),
    secureStorage: secrets.available(), electron: process.versions.electron,
  })));
  ipcMain.handle('app:setWorkspace', wrap(async (p) => { workspace = p || null; }));
  ipcMain.handle('app:refreshMenu', wrap(async () => buildMenu()));
  ipcMain.handle('app:rendererScript', wrap(async (id) => {
    const p = host.plugins.get(id);
    return p && p.enabled && p.renderer ? p.renderer : '';
  }));
}

/* ------------------------------ lifecycle ------------------------------ */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    boot();
    registerCoreIpc();
    buildMenu();
    createWindow();
  });
  app.on('window-all-closed', () => {
    if (terminal) terminal.killAll();
    app.quit();
  });
}
