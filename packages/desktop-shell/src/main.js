/**
 * Nativity Studio — Electron main process.
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
const toolsMod = require('./core/tools');
const runtime = require('./core/runtime');
const codeintel = require('./core/codeintel');
const javac = require('./core/javac');

app.setAppUserModelId('in.futureim.nativitystudio'); // groups the taskbar button and uses our icon
// Data folder follows the product name; carry settings over once from earlier names of this product.
{
  const next = path.join(app.getPath('appData'), 'Nativity Studio');
  try {
    if (!app.commandLine.hasSwitch('user-data-dir') && !fs.existsSync(next)) {
      const prev = ['OmniCloud Studio', 'Cloud Native Studio'].map((n) => path.join(app.getPath('appData'), n)).find((p) => fs.existsSync(p));
      if (prev) fs.cpSync(prev, next, { recursive: true });
    }
  } catch { /* start fresh */ }
  if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', next); // an explicit --user-data-dir wins (used for isolated test runs)
}

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
let tools;

function boot() {
  toolsMod.augmentPath();
  const ud = app.getPath('userData');
  store = new Store(path.join(ud, 'settings.json'), {
    editor: { fontSize: 13 },
    startup: { promptLogin: true },
    envOverrides: {},
    recents: [],
  });
  tools = toolsMod.create(store);
  tools.applyOverrides();
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
  ai.register({ ipcMain, wrap, host, store, secrets, terminal, send: sendToRenderer });
  runtime.register({ ipcMain, wrap, tools });
  codeintel.register({ ipcMain, wrap, getWorkspace: () => workspace });
  javac.register({ ipcMain, wrap, tools, getWorkspace: () => workspace, cacheRoot: path.join(app.getPath('userData'), 'cache') });
}

/* ------------------------------ window & menu ------------------------------ */

/** The in-IDE browser (cloud consoles, local servers) is a locked-down webview: no Node, own storage partition, http(s) only. */
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (e, u) => { if (!/^https?:\/\//i.test(u)) e.preventDefault(); });
  }
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    params.partition = 'persist:cns-browser';
    params.allowpopups = false;
    const ok = /^https:\/\//i.test(params.src || '') || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(params.src || '');
    if (!ok) event.preventDefault();
  });
});

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1000, minHeight: 620,
    title: 'Nativity Studio', backgroundColor: '#0e0f0c', show: false, icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: true },
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
        {
          label: 'New Java',
          submenu: [
            cmd('Java Class…', 'java.new', 'CmdOrCtrl+Alt+N', 'class'), cmd('Interface…', 'java.new', undefined, 'interface'), cmd('Enum…', 'java.new', undefined, 'enum'),
            cmd('Record…', 'java.new', undefined, 'record'), cmd('Annotation…', 'java.new', undefined, 'annotation'), sep, cmd('Class with main()…', 'java.new', undefined, 'main'), cmd('JUnit 5 Test…', 'java.new', undefined, 'test'),
          ],
        },
        sep,
        cmd('Open Folder…', 'folder.open', 'CmdOrCtrl+O'),
        { label: 'Open Recent', submenu: recents.length ? recents.map((r) => cmd(r.name, 'recent.open', undefined, r.path)) : [{ label: 'No recent projects', enabled: false }] },
        sep,
        cmd('Import from GitHub…', 'github.import'),
        cmd('Clone Git Repository…', 'git.clone'),
        sep,
        cmd('Save', 'file.save', 'CmdOrCtrl+S'),
        cmd('Save All', 'file.saveAll', 'CmdOrCtrl+Alt+S'),
        cmd('Save As…', 'file.saveAs'),
        cmd('Reload from Disk', 'file.reload'),
        sep,
        cmd('Close Tab', 'tab.close', 'CmdOrCtrl+W'),
        cmd('Close Other Tabs', 'tab.closeOthers'),
        cmd('Close All Tabs', 'tab.closeAll'),
        cmd('Reopen Closed Tab', 'tab.reopen'),
        sep,
        cmd('Copy Path', 'file.copyPath'),
        cmd('Copy Relative Path', 'file.copyRelPath'),
        cmd('Show in File Explorer', 'file.reveal'),
        cmd('Close Folder', 'folder.close'),
        sep,
        cmd('Settings…', 'settings.open', 'CmdOrCtrl+,'),
        sep,
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, sep,
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, sep,
        cmd('Find…', 'edit.find', 'CmdOrCtrl+F'), cmd('Find and Replace…', 'edit.replace', 'CmdOrCtrl+H'), cmd('Find Next', 'edit.findNext', 'F3'), cmd('Find Previous', 'edit.findPrev', 'Shift+F3'),
        cmd('Find in Files…', 'search.files', 'CmdOrCtrl+Shift+F'), cmd('Replace in Files…', 'search.replace', 'CmdOrCtrl+Shift+H'), sep,
        {
          label: 'Lines',
          submenu: [
            cmd('Duplicate Line Down', 'edit.duplicateDown'), cmd('Duplicate Line Up', 'edit.duplicateUp'), cmd('Move Line Up', 'edit.moveUp'), cmd('Move Line Down', 'edit.moveDown'),
            cmd('Delete Line', 'edit.deleteLine'), cmd('Join Lines', 'edit.joinLines'), cmd('Insert Line Above', 'edit.insertLineAbove'), cmd('Insert Line Below', 'edit.insertLineBelow'), sep,
            cmd('Sort Ascending', 'edit.sortAsc'), cmd('Sort Descending', 'edit.sortDesc'), cmd('Remove Duplicate Lines', 'edit.dupLinesRemove'), cmd('Trim Trailing Whitespace', 'edit.trimWs'),
          ],
        },
        {
          label: 'Selection',
          submenu: [
            cmd('Expand Selection', 'edit.expandSel'), cmd('Shrink Selection', 'edit.shrinkSel'), cmd('Select to Matching Bracket', 'edit.selectToBracket'), sep,
            cmd('Add Next Occurrence', 'edit.addNextOcc'), cmd('Select All Occurrences', 'edit.selectAllOcc'), cmd('Add Cursor Above', 'edit.cursorAbove'), cmd('Add Cursor Below', 'edit.cursorBelow'), cmd('Add Cursors to Line Ends', 'edit.cursorsLineEnds'),
          ],
        },
        {
          label: 'Transform',
          submenu: [
            cmd('UPPER CASE', 'edit.upper'), cmd('lower case', 'edit.lower'), cmd('Title Case', 'edit.title'), sep, cmd('camelCase', 'edit.camel'), cmd('PascalCase', 'edit.pascal'), cmd('snake_case', 'edit.snake'), cmd('kebab-case', 'edit.kebab'),
          ],
        },
        {
          label: 'Folding',
          submenu: [
            cmd('Fold', 'fold.fold'), cmd('Unfold', 'fold.unfold'), cmd('Toggle Fold', 'fold.toggle'), cmd('Fold Recursively', 'fold.recursive'), sep,
            cmd('Fold All', 'fold.all'), cmd('Unfold All', 'fold.unfoldAll'), cmd('Fold Level 1', 'fold.level1'), cmd('Fold Level 2', 'fold.level2'), cmd('Fold Level 3', 'fold.level3'),
          ],
        },
        {
          label: 'Indentation',
          submenu: [cmd('Indent Line', 'edit.indent'), cmd('Outdent Line', 'edit.outdent'), cmd('Reindent Lines', 'edit.reindent'), sep, cmd('Convert to Spaces', 'edit.toSpaces'), cmd('Convert to Tabs', 'edit.toTabs'), cmd('Detect Indentation', 'edit.detectIndent')],
        },
        sep,
        cmd('Toggle Line Comment', 'edit.comment'), cmd('Toggle Block Comment', 'edit.blockComment'), sep,
        cmd('Trigger Suggestions', 'edit.suggest'), cmd('Parameter Hints', 'edit.paramHints'), cmd('Quick Fix', 'edit.quickFix', 'CmdOrCtrl+.'), cmd('Show Hover', 'edit.hover'),
      ],
    },
    {
      label: 'Navigate',
      submenu: [
        cmd('Go to File…', 'nav.file', 'CmdOrCtrl+P'), cmd('Open Java Class…', 'nav.class', 'CmdOrCtrl+Shift+T'), cmd('Go to Symbol in Workspace…', 'nav.symbolWorkspace', 'CmdOrCtrl+T'),
        cmd('Go to Symbol in File…', 'edit.gotoSymbol', 'CmdOrCtrl+Shift+O'), cmd('Go to Line…', 'edit.gotoLine', 'CmdOrCtrl+G'), sep,
        cmd('Go to Definition', 'nav.def', 'F12'), cmd('Peek Definition', 'nav.peek', 'Alt+F12'), cmd('Go to Type Definition', 'nav.typeDef'), cmd('Find Usages', 'nav.usages', 'Shift+F12'),
        cmd('Show Implementations / Subclasses', 'nav.impl', 'CmdOrCtrl+Alt+B'), cmd('Go to Supertype', 'java.superType', 'CmdOrCtrl+U'), sep,
        cmd('Type Hierarchy', 'java.hierarchy', 'F4'), cmd('List Methods in This File', 'java.methods', 'CmdOrCtrl+F12'), cmd('List Methods of Class…', 'java.methodsOfClass', 'CmdOrCtrl+Shift+F12'), sep,
        cmd('Back', 'nav.back', 'Alt+Left'), cmd('Forward', 'nav.forward', 'Alt+Right'), cmd('Jump to Matching Bracket', 'edit.jumpBracket'), sep,
        cmd('Next Problem', 'nav.nextProblem', 'F8'), cmd('Previous Problem', 'nav.prevProblem', 'Shift+F8'), sep,
        cmd('Next Tab', 'tab.next', 'CmdOrCtrl+PageDown'), cmd('Previous Tab', 'tab.prev', 'CmdOrCtrl+PageUp'),
      ],
    },
    {
      label: 'Source',
      submenu: [
        cmd('Generate Code…', 'java.generate', 'Alt+Insert'), cmd('Generate Getters and Setters', 'java.gettersSetters'), cmd('Generate Getters', 'java.getters'), cmd('Generate Setters', 'java.setters'),
        cmd('Generate Constructor', 'java.constructor'), cmd('Generate toString()', 'java.toString'), cmd('Generate equals() and hashCode()', 'java.equalsHash'), cmd('Override Methods…', 'java.override'), sep,
        cmd('Organize Imports', 'java.organizeImports', 'CmdOrCtrl+Alt+O'), cmd('Add Import for Symbol', 'java.addImport', 'CmdOrCtrl+Shift+M'), sep,
        cmd('Format Document', 'edit.formatDoc', 'Shift+Alt+F'), cmd('Format Selection', 'edit.formatSel'), cmd('Rename Symbol', 'edit.rename', 'F2'),
      ],
    },
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
        cmd('Toggle Sidebar', 'layout.sidebar', 'CmdOrCtrl+B'),
        cmd('Reveal Active File in Explorer', 'file.revealExplorer', 'Alt+Shift+L'),
        cmd('Keep Explorer in Sync with Open File', 'view.linkExplorer'),
        cmd('Maximize / Restore Bottom Panel', 'layout.panelMax', 'CmdOrCtrl+Shift+M'),
        cmd('Focus Editor (hide all panels)', 'layout.focus', 'CmdOrCtrl+K Z'),
        cmd('Servers', 'view.servers'),
        cmd('Search', 'view.search'),
        cmd('Toggle Word Wrap', 'edit.toggleWrap', 'Alt+Z'), cmd('Toggle Minimap', 'edit.toggleMinimap'), cmd('Toggle Line Numbers', 'edit.toggleLineNumbers'), cmd('Toggle Whitespace', 'edit.toggleWhitespace'), cmd('Toggle Sticky Scroll', 'edit.toggleSticky'),
        cmd('Increase Editor Font', 'edit.fontUp'), cmd('Decrease Editor Font', 'edit.fontDown'), cmd('Reset Editor Font', 'edit.fontReset'),
        sep,
        { role: 'reload' }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Run',
      submenu: [
        cmd('Build (Java uses the built-in javac)', 'run.build', 'CmdOrCtrl+F9'),
        cmd('Compile Java (built-in javac)', 'java.compile'),
        cmd('Check This File Now', 'java.check'),
        cmd('Show Detected Projects (modules)', 'java.modules'),
        cmd('Clear Compile Problems', 'java.clearProblems'),
        cmd('Run', 'run.run', 'F5'),
        cmd('Debug', 'run.debug', 'CmdOrCtrl+F5'),
        cmd('Test', 'run.test'),
        cmd('Run This File', 'run.file', 'CmdOrCtrl+Shift+F10'),
        cmd('Stop', 'run.stop', 'Shift+F5'),
        sep,
        cmd('Run Configurations…', 'view.run'),
        cmd('Servers (Tomcat, local ports)…', 'view.servers'),
        cmd('Runtimes…', 'runtimes.open'),
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
        cmd('Claude Code (in the IDE)', 'ai.claude'),
        cmd('Gemini CLI (opens a console window)', 'ai.cli', undefined, 'gemini-cli'),
        cmd('Codex CLI (opens a console window)', 'ai.cli', undefined, 'codex-cli'),
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
    {
      label: 'Help',
      submenu: [
        cmd('Help Contents', 'help.open', 'F1'),
        cmd('Getting Started', 'help.open', undefined, 'start'),
        cmd('Plugin Development Guide', 'help.open', undefined, 'plugins'),
        cmd('Keyboard Shortcuts', 'help.open', undefined, 'keys'),
        sep,
        cmd('About Nativity Studio', 'help.about'),
      ],
    },
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
    if (!/^(editor|startup|ui|cloud|workspace|envOverrides|run)(\.|$)/.test(key)) throw new Error('That setting cannot be changed from the UI.');
    store.set(key, val);
  }));
  ipcMain.handle('secret:available', wrap(async () => secrets.available()));

  ipcMain.handle('shell:showItem', wrap(async (p) => { if (typeof p !== 'string' || !fs.existsSync(p)) throw new Error('Not found.'); shell.showItemInFolder(p); }));
  ipcMain.handle('shell:openExternal', wrap(async (url) => {
    if (!/^https:\/\//i.test(url)) throw new Error('Only https links can be opened.');
    await shell.openExternal(url);
  }));

  ipcMain.handle('term:run', wrap(async (command, cwd) => terminal.start(command, cwd)));
  ipcMain.handle('term:write', wrap(async (id, text) => terminal.write(id, text)));
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
