/* Workbench: Monaco editor, tabs (including the Workspace home tab), Explorer tree, terminal and bottom panel. */
'use strict';

let monaco = null;
let editor = null;
const extLang = new Map();
const homeTab = { kind: 'home' };
let selected = null; // explorer selection {path,isDir}

/* ------------------------------ Monaco ------------------------------ */

function initMonaco() {
  return new Promise((resolve, reject) => {
    const base = new URL('../node_modules/monaco-editor/min/vs', location.href).href;
    window.require.config({ paths: { vs: base } });
    window.MonacoEnvironment = {
      getWorkerUrl: () => 'data:text/javascript;charset=utf-8,' + encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${base.replace(/vs$/, '')}'};importScripts('${base}/base/worker/workerMain.js');`),
    };
    window.require(['vs/editor/editor.main'], () => {
      monaco = window.monaco;
      for (const l of monaco.languages.getLanguages()) for (const e of l.extensions || []) extLang.set(e.toLowerCase(), l.id);
      monaco.editor.defineTheme('cns-dark', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#0e0f0c', 'editor.lineHighlightBackground': '#151713' } });
      editor = monaco.editor.create($('editor'), {
        theme: 'cns-dark', automaticLayout: true, minimap: { enabled: true },
        fontFamily: 'Monospaced, "Courier New", monospace', // NetBeans default editor font
        fontSize: (state.settings.editor && state.settings.editor.fontSize) || 13, model: null,
      }, {
        openCodeEditor: async (input, source) => {
          const sel = input.options && input.options.selection;
          const here = source && source.getModel() && source.getModel().uri.toString() === input.resource.toString();
          if (here) { if (sel) { source.setSelection(sel); source.revealLineInCenter(sel.startLineNumber); } return source; }
          if (input.resource.scheme === 'file') await openAt(input.resource.fsPath, sel ? sel.startLineNumber : 1, sel ? sel.startColumn : 1);
          return editor;
        },
      });
      editor.onDidChangeCursorPosition((e) => ($('st-pos').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`));
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveActive);
      resolve();
    }, reject);
  });
}

function langFor(file) {
  const i = file.lastIndexOf('.');
  const ext = i >= 0 ? file.slice(i).toLowerCase() : '';
  const special = { '.tf': 'hcl', '.tfvars': 'hcl', '.bicep': 'bicep' };
  return special[ext] || extLang.get(ext) || (baseName(file).toLowerCase() === 'dockerfile' ? 'dockerfile' : 'plaintext');
}

function setEditorFontSize(n) {
  if (editor) editor.updateOptions({ fontSize: n });
}

/* ------------------------------ tabs ------------------------------ */

function renderTabs() {
  $('tabs').replaceChildren(...state.tabs.map((t) => {
    const home = t.kind === 'home';
    const page = t.kind === 'page';
    const dirty = t.kind === 'file' && t.model.getValue() !== t.saved;
    return h('div', { class: 'tab' + (t === state.active ? ' active' : ''), title: home ? 'Workspace' : page ? t.title : t.path, onclick: () => activate(t), ondblclick: () => CNS.run('layout.focus'), oncontextmenu: (ev) => { ev.preventDefault(); ctxMenu(ev.clientX, ev.clientY, tabMenuItems(t)); } },
      h('span', { text: home ? '⌂ Workspace' : page ? `${t.icon || '▣'} ${t.title}` : baseName(t.path) }),
      h('span', { class: 'dot', text: dirty ? '●' : '' }),
      h('span', { class: 'x', text: '✕', onclick: (e) => { e.stopPropagation(); closeTab(t); } }));
  }));
}

function activate(tab) {
  if (state.active && state.active.kind === 'file' && editor) state.active.viewState = editor.saveViewState();
  state.active = tab;
  const home = !tab || tab.kind === 'home';
  const page = !!tab && tab.kind === 'page';
  $('home').classList.toggle('hidden', !home);
  $('editor').classList.toggle('hidden', home || page);
  document.querySelectorAll('#pages > .page').forEach((p) => p.classList.toggle('hidden', !(page && p === tab.el)));
  $('pages').classList.toggle('hidden', !page);
  if (!home && !page && editor) {
    editor.setModel(tab.model);
    if (typeof updateLanguageOptions === 'function') updateLanguageOptions();
    if (tab.viewState) editor.restoreViewState(tab.viewState);
    editor.focus();
    $('st-lang').textContent = tab.model.getLanguageId();
  } else {
    $('st-lang').textContent = '';
    $('st-pos').textContent = '';
  }
  renderTabs();
  markTree();
  if (typeof renderCrumbs === 'function') renderCrumbs(tab);
  if (typeof linkExplorerTo === 'function') linkExplorerTo(tab);
}

function showHome() {
  if (!state.tabs.includes(homeTab)) state.tabs.unshift(homeTab);
  renderHome();
  activate(homeTab);
}

async function openFile(file) {
  const sameFile = (p) => String(p || '').split('/').join(BS).toLowerCase() === file.split('/').join(BS).toLowerCase();
  const existing = state.tabs.find((t) => t.path && sameFile(t.path));
  if (existing) return activate(existing);
  let text;
  try { text = await inv('fs:readFile', file); } catch (e) { return status(e.message, true); }
  const uri = monaco.Uri.file(file);
  const stale = monaco.editor.getModel(uri);
  if (stale) stale.dispose();
  const model = monaco.editor.createModel(text, langFor(file), uri);
  const tab = { kind: 'file', path: file, model, saved: text, viewState: null };
  model.onDidChangeContent((e) => { renderTabs(); if (typeof onFileEdited === 'function') onFileEdited(tab); if (typeof trimDiagnostics === 'function' && !e.isFlush) trimDiagnostics(tab, e.changes); });
  state.tabs.push(tab);
  activate(tab);
  if (typeof applyMarkersFor === 'function') applyMarkersFor(tab);
  if (typeof scheduleJavaCheck === 'function' && tab.path.toLowerCase().endsWith('.java')) scheduleJavaCheck(1200, tab.path); // check a Java file as soon as it is opened
}

async function saveTab(t) {
  const text = t.model.getValue();
  await inv('fs:writeFile', t.path, text);
  t.saved = text;
  if (typeof afterSave === 'function') afterSave(t);
  if (typeof javaFileSaved === 'function') javaFileSaved(t);
}

async function saveActive() {
  const t = state.active;
  if (!t || t.kind !== 'file') return;
  try { await saveTab(t); renderTabs(); status(`Saved ${baseName(t.path)}`); } catch (e) { status(e.message, true); }
}

async function saveAll() {
  for (const t of state.tabs) if (t.kind === 'file' && t.model.getValue() !== t.saved) await saveTab(t).catch((e) => status(e.message, true));
  renderTabs();
}

async function closeTab(tab) {
  if (tab.kind === 'file' && tab.model.getValue() !== tab.saved) {
    if (!(await confirmBox(`Discard unsaved changes to ${baseName(tab.path)}?`, 'Your edits will be lost.'))) return;
  }
  const i = state.tabs.indexOf(tab);
  state.tabs.splice(i, 1);
  if (tab.kind === 'file') { closedTabs.push(tab.path); tab.model.dispose(); }
  if (tab.kind === 'page') { tab.el.remove(); if (tab.onClose) tab.onClose(); }
  if (!state.tabs.length) return showHome();
  activate(state.active === tab ? state.tabs[Math.min(i, state.tabs.length - 1)] : state.active);
}

function closeAllFileTabs() {
  for (const t of state.tabs.filter((x) => x.kind === 'file')) t.model.dispose();
  state.tabs = state.tabs.filter((t) => t.kind === 'home' || t.kind === 'page');
}

function activeSelection() {
  if (!editor || !state.active || state.active.kind !== 'file') return '';
  const sel = editor.getSelection();
  return sel && !sel.isEmpty() ? editor.getModel().getValueInRange(sel) : '';
}

function insertAtCursor(text) {
  if (!editor || !state.active || state.active.kind !== 'file') return false;
  const sel = editor.getSelection();
  editor.executeEdits('ai', [{ range: sel, text, forceMoveMarkers: true }]);
  editor.focus();
  return true;
}

/* ------------------------------ explorer ------------------------------ */

function markTree() {
  const want = state.active && state.active.kind === 'file' ? String(state.active.path).split('/').join(BS).toLowerCase() : null;
  document.querySelectorAll('.node').forEach((n) => n.classList.toggle('sel', !!want && String(n.dataset.path).split('/').join(BS).toLowerCase() === want));
}


/* Java-style layouts (Maven, Gradle, Ant): source folders are promoted to "Source Packages" etc., and packages are shown
   as dotted names (com.example.app) instead of nested folders. */
const SRC_ROOTS = [
  ['src/main/java', 'Source Packages', '☕', true], ['src/main/kotlin', 'Kotlin Packages', '☕', true], ['src/main/scala', 'Scala Packages', '☕', true], ['src/main/groovy', 'Groovy Packages', '☕', true],
  ['src/main/resources', 'Resources', '🗂', false], ['src/main/webapp', 'Web Pages', '🌐', false],
  ['src/test/java', 'Test Packages', '🧪', true], ['src/test/kotlin', 'Test Kotlin Packages', '🧪', true], ['src/test/resources', 'Test Resources', '🗂', false],
];
const BUILD_FILE = /^(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|build\.xml)$/;

async function promotedRoots(dir, names) {
  if (!names.some((n) => BUILD_FILE.test(n))) return [];
  const out = [];
  for (const [rel, label, icon, pkg] of SRC_ROOTS) {
    const p = joinPath(dir, rel.split('/').join(BS));
    if (await inv('fs:exists', p).catch(() => false)) out.push({ path: p, label, icon, pkg, isDir: true, name: label });
  }
  if (!out.some((r) => r.label === 'Source Packages') && names.includes('build.xml') && names.includes('src')) {
    out.unshift({ path: joinPath(dir, 'src'), label: 'Source Packages', icon: '☕', pkg: true, isDir: true, name: 'src' });
  }
  return out;
}

/** Collapses chains of folders that hold only one sub-folder: com / example / app  ->  com.example.app */
async function compressPackage(entry) {
  let cur = entry;
  let label = entry.name;
  for (let i = 0; i < 12; i++) {
    let kids = [];
    try { kids = await inv('fs:readDir', cur.path); } catch { break; }
    if (kids.length === 1 && kids[0].isDir) { label += `.${kids[0].name}`; cur = kids[0]; } else break;
  }
  return { ...cur, label };
}

async function buildDir(container, dir, opts = {}) {
  let entries = [];
  try { entries = await inv('fs:readDir', dir); } catch (e) { container.append(h('div', { class: 'empty', text: e.message })); return; }
  const addNode = (e, { label, icon, bold, expand, pkg }) => {
    const caret = h('span', { class: 'caret', text: e.isDir ? '▸' : '' });
    const node = h('div', { class: 'node' + (bold ? ' group' : ''), 'data-path': e.path, title: e.path }, caret, icon ? h('span', { class: 'ico', text: icon }) : null, h('span', { text: label || e.name }));
    const kids = h('div', { class: 'children hidden' });
    let loadP = null; // the load in progress or finished, so callers (like Reveal) can wait for it
    const toggle = async (open) => {
      kids.classList.toggle('hidden', !open);
      caret.textContent = open ? '▾' : '▸';
      if (open && !loadP) loadP = buildDir(kids, e.path, { pkg });
      if (open) await loadP;
    };
    node.addEventListener('click', async () => {
      selected = e;
      if (e.isDir) await toggle(kids.classList.contains('hidden'));
      else openFile(e.path);
    });
    node.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); selected = e; ctxMenu(ev.clientX, ev.clientY, fileMenuItems(e)); });
    node._toggle = toggle; // lets "reveal in Explorer" open folders programmatically
    container.append(node, kids);
    if (expand) toggle(true);
  };

  if (!opts.pkg) {
    const roots = await promotedRoots(dir, entries.map((x) => x.name));
    for (const r of roots) addNode(r, { label: r.label, icon: r.icon, bold: true, pkg: r.pkg, expand: r.label === 'Source Packages' });
  }
  for (const e0 of entries) {
    let e = e0;
    let label = e.name;
    let icon = '';
    if (opts.pkg && e.isDir) { e = await compressPackage(e0); label = e.label; icon = '📦'; }
    else if (/\.(java|kt|scala|groovy)$/i.test(e.name)) icon = '☕';
    addNode(e, { label, icon, pkg: opts.pkg });
  }
}

async function refreshTree() {
  const tree = $('tree');
  tree.replaceChildren();
  $('tree-empty').classList.toggle('hidden', !!state.workspace);
  if (!state.workspace) return;
  tree.append(makeRootNode());
  await buildDir(tree, state.workspace);
  markTree();
}

function makeRootNode() {
  const node = h('div', { class: 'node root', 'data-path': state.workspace, title: 'Right-click for Cloud Native Dev' },
    h('span', { class: 'caret', text: '▾' }), h('b', { text: baseName(state.workspace) }), h('span', { class: 'root-badge' }));
  node.addEventListener('click', () => { selected = { path: state.workspace, isDir: true }; });
  node.addEventListener('contextmenu', (ev) => { ev.preventDefault(); selected = { path: state.workspace, isDir: true }; ctxMenu(ev.clientX, ev.clientY, projectMenuItems()); });
  queueMicrotask(updateRootBadge);
  return node;
}

function fileMenuItems(entry) {
  return [
    { label: 'Rename…', run: async () => {
      const n = await promptText('Rename', 'New name', baseName(entry.path));
      if (n) try { await inv('fs:rename', entry.path, joinPath(dirName(entry.path), n)); await refreshTree(); } catch (e) { status(e.message, true); }
    } },
    { label: 'Move to Recycle Bin', run: async () => {
      if (await confirmBox(`Move ${baseName(entry.path)} to the Recycle Bin?`, 'You can restore it from there.')) {
        try { await inv('fs:trash', entry.path); await refreshTree(); } catch (e) { status(e.message, true); }
      }
    } },
  ];
}

async function createEntry(isDir) {
  if (!state.workspace) return status('Open a folder first.', true);
  const base = selected ? (selected.isDir ? selected.path : dirName(selected.path)) : state.workspace;
  const name = await promptText(isDir ? 'New folder' : 'New file', isDir ? 'folder-name' : 'file.ext');
  if (!name) return;
  const target = joinPath(base, name);
  try { await inv('fs:create', target, isDir); } catch (e) { return status(e.message, true); }
  await refreshTree();
  if (!isDir) openFile(target);
}

/* ------------------------------ terminal / bottom panel ------------------------------ */

let runningId = null;
let termStdin = 0; // when set, terminal input goes to that process (e.g. a sign-in prompt) instead of starting a command
const termWaiters = new Map(); // id -> fn(exitCode)
const termRoutes = new Map(); // id -> fn(text, stream): send output to another panel
const termHistory = [];
let histIdx = 0;
const promptStr = () => `${state.cwd ? baseName(state.cwd) : '~'}>`;

function termPrint(text, cls) {
  const out = $('term-out');
  out.append(h('span', { class: cls || '', text }));
  out.scrollTop = out.scrollHeight;
}

function resolveDir(cwd, target) {
  const parts = /^[a-zA-Z]:/.test(target) ? [] : cwd.split(/[\\/]/).filter(Boolean);
  for (const seg of target.split(/[\\/]/)) {
    if (seg === '..') { if (parts.length > 1) parts.pop(); } else if (seg && seg !== '.') parts.push(seg);
  }
  const out = parts.join(BS);
  return /^[a-zA-Z]:$/.test(out) ? out + BS : out;
}

async function termRun(line) {
  if (termStdin) { termPrint(line + String.fromCharCode(10), 't-cmd'); tryInv('term:write', termStdin, line + String.fromCharCode(10)); return; }
  const cmd = line.trim();
  termPrint(`${promptStr()} ${cmd}\n`, 't-cmd');
  if (!cmd) return;
  termHistory.push(cmd);
  histIdx = termHistory.length;
  const cd = /^cd\s+(?:\/d\s+)?(.+)$/i.exec(cmd);
  if (cd) {
    const abs = resolveDir(state.cwd || '', cd[1].replace(/^["']|["']$/g, ''));
    const r = await tryInv('fs:readDir', abs);
    if (!r.ok) return termPrint(`The system cannot find the path: ${abs}\n`, 't-err');
    state.cwd = abs;
    $('term-prompt').textContent = promptStr();
    return;
  }
  if (/^(cls|clear)$/i.test(cmd)) { $('term-out').replaceChildren(); return; }
  const r = await tryInv('term:run', cmd, state.cwd);
  if (!r.ok) return termPrint(`${r.error}\n`, 't-err');
  runningId = r.data;
}

function showPanel(which) {
  $('panel').classList.remove('collapsed');
  document.querySelectorAll('#panel-bar [data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === which));
  $('panel-terminal').classList.toggle('hidden', which !== 'terminal');
  $('panel-output').classList.toggle('hidden', which !== 'output');
  $('panel-problems').classList.toggle('hidden', which !== 'problems');
  if (which === 'terminal') $('term-input').focus();
}

const togglePanel = () => ($('panel').classList.contains('collapsed') ? showPanel('terminal') : minimizePanel());

function wireWorkbench() {
  cns.on('term:data', ({ id, stream, text }) => { const r = termRoutes.get(id); if (r) r(text, stream); else termPrint(text, stream === 'err' ? 't-err' : ''); });
  cns.on('term:exit', ({ id, code }) => {
    if (id === runningId) runningId = null;
    termRoutes.delete(id);
    const waiter = termWaiters.get(id);
    if (waiter) { termWaiters.delete(id); try { waiter(code); } catch (e) { console.error(e); } }
    const title = state.cloudRuns.get(id);
    if (title) {
      state.cloudRuns.delete(id);
      termPrint(`${code === 0 ? '✔' : '✘'} ${title} ${code === 0 ? 'finished' : `failed (exit ${code})`}\n`, code === 0 ? 't-cmd' : 't-err');
      status(`${title} ${code === 0 ? 'finished' : 'failed'}`, code !== 0);
      if (code === 0) CNS.emit('cloud-run-finished', title);
    } else if (code) termPrint(`(exit ${code})\n`, 't-dim');
  });
  document.querySelectorAll('#panel-bar [data-panel]').forEach((b) => b.addEventListener('click', () => showPanel(b.dataset.panel)));
  $('btn-term-clear').onclick = () => { $('term-out').replaceChildren(); $('output-out').replaceChildren(); };
  $('btn-term-close').onclick = () => $('panel').classList.add('collapsed');
  $('term-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = e.target.value; e.target.value = ''; termRun(v); }
    else if (e.key === 'ArrowUp' && termHistory.length) { histIdx = Math.max(0, histIdx - 1); e.target.value = termHistory[histIdx] || ''; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { histIdx = Math.min(termHistory.length, histIdx + 1); e.target.value = termHistory[histIdx] || ''; }
    else if (e.key === 'c' && e.ctrlKey && runningId) { inv('term:kill', runningId).catch(() => {}); termPrint('^C\n', 't-dim'); }
  });
  $('btn-new-file').onclick = () => createEntry(false);
  $('btn-new-folder').onclick = () => createEntry(true);
  $('btn-refresh').onclick = refreshTree;
  $('btn-open-folder').onclick = () => openFolderDialog();
  $('tree').addEventListener('contextmenu', (e) => {
    if (e.target === $('tree') && state.workspace) { e.preventDefault(); ctxMenu(e.clientX, e.clientY, projectMenuItems()); }
  });
  window.addEventListener('beforeunload', () => state.tabs.forEach((t) => t.kind === 'file' && t.model.dispose()));
}
