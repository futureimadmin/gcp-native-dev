/* Editor commands (find, replace, go to, refactor, folding, text transforms...), quick pick, Find in Files, tabs and file commands. */
'use strict';

/* ------------------------------ quick pick (used by Open Class, Go to File, methods list...) ------------------------------ */

function quickPick({ placeholder, items, onPick }) {
  const root = $('palette');
  const input = $('palette-input');
  const list = $('palette-list');
  let shown = [];
  let sel = 0;
  const rank = (it, q) => {
    if (!q) return 5;
    const name = (it.key || it.label).replace(/\(.*$/, '');
    const ln = name.toLowerCase();
    const lq = q.toLowerCase();
    if (ln.startsWith(lq)) return 0;
    const caps = name.replace(/[^A-Z0-9]/g, '');
    if (q === q.toUpperCase() && caps.toLowerCase().startsWith(lq)) return 1;
    if (ln.includes(`.${lq}`) || ln.includes(`_${lq}`)) return 2;
    if (ln.includes(lq)) return 3;
    let i = 0;
    for (const ch of ln) if (ch === lq[i]) i++;
    if (i === lq.length) return 4;
    return (it.detail || '').toLowerCase().includes(lq) ? 6 : -1;
  };
  const draw = () => {
    list.replaceChildren(...shown.map((it, i) => h('li', { class: i === sel ? 'sel' : '', onmousedown: (e) => { e.preventDefault(); choose(i); } },
      it.icon ? h('span', { class: 'qico', text: it.icon }) : null, h('span', { class: 'ql', text: it.label }), it.detail ? h('small', { class: 'qd', text: it.detail }) : null)));
    const cur = list.children[sel];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  };
  const filter = () => {
    const q = input.value.trim();
    shown = items.map((it) => ({ it, r: rank(it, q) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r || a.it.label.length - b.it.label.length).slice(0, 60).map((x) => x.it);
    sel = 0;
    draw();
  };
  const choose = (i) => { const it = shown[i]; if (!it) return; root.classList.add('hidden'); onPick(it); };
  root.classList.remove('hidden');
  input.value = '';
  input.placeholder = placeholder;
  filter();
  input.focus();
  input.oninput = filter;
  input.onblur = () => setTimeout(() => root.classList.add('hidden'), 150);
  input.onkeydown = (e) => {
    if (e.key === 'Escape') { root.classList.add('hidden'); if (editor) editor.focus(); }
    else if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
  };
}

/* ------------------------------ navigation history ------------------------------ */

const nav = { back: [], fwd: [] };
const closedTabs = [];

function navPoint() {
  return state.active && state.active.kind === 'file' && editor ? { path: state.active.path, pos: editor.getPosition() } : null;
}

async function openAt(file, line = 1, col = 1, noHistory) {
  if (!noHistory) { const p = navPoint(); if (p) { nav.back.push(p); if (nav.back.length > 60) nav.back.shift(); nav.fwd = []; } }
  await openFile(file);
  if (!editor) return;
  editor.revealLineInCenter(line);
  editor.setPosition({ lineNumber: line, column: col });
  editor.focus();
}

async function navGo(from, to) {
  const p = navPoint();
  const target = from.pop();
  if (!target) return status('Nothing there.');
  if (p) to.push(p);
  await openAt(target.path, target.pos.lineNumber, target.pos.column, true);
}

/* ------------------------------ editor actions ------------------------------ */

const ACTIONS = [
  // [command id, Monaco action id, title]
  ['edit.find', 'actions.find', 'Edit: Find…  (Ctrl+F)'], ['edit.replace', 'editor.action.startFindReplace', 'Edit: Find and Replace…  (Ctrl+H)'],
  ['edit.findNext', 'editor.action.nextMatchFindAction', 'Edit: Find Next  (F3)'], ['edit.findPrev', 'editor.action.previousMatchFindAction', 'Edit: Find Previous  (Shift+F3)'],
  ['edit.findSelNext', 'editor.action.nextSelectionMatchFindAction', 'Edit: Find Next Selection  (Ctrl+F3)'], ['edit.addNextOcc', 'editor.action.addSelectionToNextFindMatch', 'Edit: Add Next Occurrence to Selection  (Ctrl+D)'],
  ['edit.selectAllOcc', 'editor.action.selectHighlights', 'Edit: Select All Occurrences  (Ctrl+Shift+L)'],
  ['edit.gotoLine', 'editor.action.gotoLine', 'Navigate: Go to Line…  (Ctrl+G)'], ['edit.gotoSymbol', 'editor.action.quickOutline', 'Navigate: Go to Symbol in File…  (Ctrl+Shift+O)'],
  ['edit.formatDoc', 'editor.action.formatDocument', 'Edit: Format Document  (Shift+Alt+F)'], ['edit.formatSel', 'editor.action.formatSelection', 'Edit: Format Selection  (Ctrl+K Ctrl+F)'],
  ['edit.comment', 'editor.action.commentLine', 'Edit: Toggle Line Comment  (Ctrl+/)'], ['edit.blockComment', 'editor.action.blockComment', 'Edit: Toggle Block Comment  (Shift+Alt+A)'],
  ['edit.duplicateDown', 'editor.action.copyLinesDownAction', 'Edit: Duplicate Line Down  (Shift+Alt+Down)'], ['edit.duplicateUp', 'editor.action.copyLinesUpAction', 'Edit: Duplicate Line Up  (Shift+Alt+Up)'],
  ['edit.moveUp', 'editor.action.moveLinesUpAction', 'Edit: Move Line Up  (Alt+Up)'], ['edit.moveDown', 'editor.action.moveLinesDownAction', 'Edit: Move Line Down  (Alt+Down)'],
  ['edit.deleteLine', 'editor.action.deleteLines', 'Edit: Delete Line  (Ctrl+Shift+K)'], ['edit.joinLines', 'editor.action.joinLines', 'Edit: Join Lines'],
  ['edit.insertLineAbove', 'editor.action.insertLineBefore', 'Edit: Insert Line Above  (Ctrl+Shift+Enter)'], ['edit.insertLineBelow', 'editor.action.insertLineAfter', 'Edit: Insert Line Below  (Ctrl+Enter)'],
  ['edit.sortAsc', 'editor.action.sortLinesAscending', 'Edit: Sort Lines Ascending'], ['edit.sortDesc', 'editor.action.sortLinesDescending', 'Edit: Sort Lines Descending'],
  ['edit.trimWs', 'editor.action.trimTrailingWhitespace', 'Edit: Trim Trailing Whitespace'],
  ['edit.upper', 'editor.action.transformToUppercase', 'Edit: Transform to UPPER CASE'], ['edit.lower', 'editor.action.transformToLowercase', 'Edit: Transform to lower case'],
  ['edit.title', 'editor.action.transformToTitlecase', 'Edit: Transform to Title Case'], ['edit.camel', 'editor.action.transformToCamelcase', 'Edit: Transform to camelCase'],
  ['edit.snake', 'editor.action.transformToSnakecase', 'Edit: Transform to snake_case'], ['edit.pascal', 'editor.action.transformToPascalcase', 'Edit: Transform to PascalCase'],
  ['edit.kebab', 'editor.action.transformToKebabcase', 'Edit: Transform to kebab-case'],
  ['edit.cursorAbove', 'editor.action.insertCursorAbove', 'Edit: Add Cursor Above  (Ctrl+Alt+Up)'], ['edit.cursorBelow', 'editor.action.insertCursorBelow', 'Edit: Add Cursor Below  (Ctrl+Alt+Down)'],
  ['edit.cursorsLineEnds', 'editor.action.insertCursorAtEndOfEachLineSelected', 'Edit: Add Cursors to Line Ends  (Shift+Alt+I)'],
  ['edit.expandSel', 'editor.action.smartSelect.expand', 'Edit: Expand Selection  (Shift+Alt+Right)'], ['edit.shrinkSel', 'editor.action.smartSelect.shrink', 'Edit: Shrink Selection  (Shift+Alt+Left)'],
  ['edit.selectToBracket', 'editor.action.selectToBracket', 'Edit: Select to Matching Bracket'], ['edit.jumpBracket', 'editor.action.jumpToBracket', 'Navigate: Jump to Matching Bracket  (Ctrl+Shift+\\)'],
  ['edit.indent', 'editor.action.indentLines', 'Edit: Indent Line  (Ctrl+])'], ['edit.outdent', 'editor.action.outdentLines', 'Edit: Outdent Line  (Ctrl+[)'], ['edit.reindent', 'editor.action.reindentlines', 'Edit: Reindent Lines'],
  ['edit.toSpaces', 'editor.action.indentationToSpaces', 'Edit: Convert Indentation to Spaces'], ['edit.toTabs', 'editor.action.indentationToTabs', 'Edit: Convert Indentation to Tabs'], ['edit.detectIndent', 'editor.action.detectIndentation', 'Edit: Detect Indentation'],
  ['fold.all', 'editor.foldAll', 'Fold: Fold All  (Ctrl+K Ctrl+0)'], ['fold.unfoldAll', 'editor.unfoldAll', 'Fold: Unfold All  (Ctrl+K Ctrl+J)'], ['fold.toggle', 'editor.toggleFold', 'Fold: Toggle Fold  (Ctrl+K Ctrl+L)'],
  ['fold.fold', 'editor.fold', 'Fold: Fold  (Ctrl+Shift+[)'], ['fold.unfold', 'editor.unfold', 'Fold: Unfold  (Ctrl+Shift+])'], ['fold.recursive', 'editor.foldRecursively', 'Fold: Fold Recursively'],
  ['fold.level1', 'editor.foldLevel1', 'Fold: Fold Level 1'], ['fold.level2', 'editor.foldLevel2', 'Fold: Fold Level 2'], ['fold.level3', 'editor.foldLevel3', 'Fold: Fold Level 3'],
  ['edit.suggest', 'editor.action.triggerSuggest', 'Edit: Trigger Suggestions  (Ctrl+Space)'], ['edit.paramHints', 'editor.action.triggerParameterHints', 'Edit: Parameter Hints  (Ctrl+Shift+Space)'],
  ['edit.quickFix', 'editor.action.quickFix', 'Edit: Quick Fix  (Ctrl+.)'], ['edit.rename', 'editor.action.rename', 'Refactor: Rename Symbol  (F2)'], ['edit.hover', 'editor.action.showHover', 'Edit: Show Hover  (Ctrl+K Ctrl+I)'],
  ['nav.def', 'editor.action.revealDefinition', 'Navigate: Go to Definition  (F12)'], ['nav.peek', 'editor.action.peekDefinition', 'Navigate: Peek Definition  (Alt+F12)'],
  ['nav.typeDef', 'editor.action.goToTypeDefinition', 'Navigate: Go to Type Definition'], ['nav.decl', 'editor.action.revealDeclaration', 'Navigate: Go to Declaration'],
  ['nav.nextProblem', 'editor.action.marker.next', 'Navigate: Next Problem  (F8)'], ['nav.prevProblem', 'editor.action.marker.prev', 'Navigate: Previous Problem  (Shift+F8)'],
];

const runAction = (id) => {
  if (!editor || !state.active || state.active.kind !== 'file') return status('Open a file in the editor first.', true);
  editor.focus();
  const a = editor.getAction(id);
  if (a) a.run();
  else status('That action is not available for this file type.', true);
};

function toggleOption(name, on, off, label) {
  if (!editor) return;
  const cur = editor.getRawOptions()[name];
  const next = JSON.stringify(cur) === JSON.stringify(on) ? off : on;
  editor.updateOptions({ [name]: next });
  status(`${label}: ${JSON.stringify(next) === JSON.stringify(on) ? 'on' : 'off'}`);
}

function fontStep(d) {
  const cur = (state.settings.editor && state.settings.editor.fontSize) || 13;
  const n = d === 0 ? 13 : Math.max(8, Math.min(32, cur + d));
  state.settings.editor = { ...(state.settings.editor || {}), fontSize: n };
  setEditorFontSize(n);
  tryInv('settings:set', 'editor.fontSize', n);
  status(`Editor font size ${n}`);
}

/* ------------------------------ Go to File ------------------------------ */

let fileCache = { at: 0, list: [] };

async function cmdGotoFile() {
  if (!state.workspace) return status('Open a project first.', true);
  if (Date.now() - fileCache.at > 15000) { const r = await tryInv('search:listFiles', state.workspace); if (r.ok) fileCache = { at: Date.now(), list: r.data }; }
  quickPick({
    placeholder: 'Go to file — type part of a file name', items: fileCache.list.map((rel) => ({ label: baseName(rel), detail: dirName(rel), icon: '▤', key: baseName(rel), data: rel })),
    onPick: (it) => openAt(joinPath(state.workspace, it.data), 1, 1),
  });
}

/* ------------------------------ Find in Files ------------------------------ */

const SU = { q: '', rep: '', cs: false, ww: false, re: false, inc: '', showRep: false, result: null, busy: false, error: '' };

function renderSearchView(box) {
  const q = h('input', { value: SU.q, placeholder: 'Find in files', spellcheck: 'false' });
  const rep = h('input', { value: SU.rep, placeholder: 'Replace with', spellcheck: 'false' });
  const inc = h('input', { value: SU.inc, placeholder: 'Files to include, e.g. *.java, *.xml', spellcheck: 'false' });
  const tog = (key, label, title) => h('button', { class: SU[key] ? 'primary tgl' : 'tgl', text: label, title, onclick: () => { SU[key] = !SU[key]; renderSearchView(box); } });
  const run = () => { SU.q = q.value; SU.rep = rep.value; SU.inc = inc.value; doSearch(box); };
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  inc.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  q.addEventListener('input', () => { SU.q = q.value; });
  rep.addEventListener('input', () => { SU.rep = rep.value; });
  inc.addEventListener('input', () => { SU.inc = inc.value; });
  const res = SU.result;
  box.replaceChildren(
    h('header', {}, h('span', { text: 'FIND IN FILES' }), h('span', { class: 'actions' }, h('button', { title: 'Toggle replace', text: SU.showRep ? '▾ Replace' : '▸ Replace', onclick: () => { SU.q = q.value; SU.showRep = !SU.showRep; renderSearchView(box); } }))),
    h('div', { class: 'pad' }, q, SU.showRep ? rep : null, inc,
      h('div', { class: 'row' }, tog('cs', 'Aa', 'Match case'), tog('ww', 'W', 'Whole word'), tog('re', '.*', 'Regular expression'), h('span', { class: 'spacer' }),
        h('button', { class: 'primary', text: SU.busy ? 'Searching…' : 'Search', disabled: SU.busy, onclick: run }),
        SU.showRep ? h('button', { text: 'Replace all', disabled: !res || !res.total, onclick: () => doReplaceAll(box) }) : null),
      SU.error ? h('div', { class: 'msg err', text: SU.error }) : null,
      res ? h('div', { class: 'hint', text: `${res.total}${res.truncated ? '+' : ''} result${res.total === 1 ? '' : 's'} in ${res.files.length} file${res.files.length === 1 ? '' : 's'}` }) : null,
      res ? h('div', { class: 'results' }, res.files.map((f) => {
        const body = h('div', {}, f.matches.slice(0, 200).map((m) => h('div', { class: 'svc', title: `${f.rel}:${m.line}`, onclick: async () => { await openAt(f.file, m.line, m.col); editor.setSelection(new monaco.Range(m.line, m.col, m.line, m.col + m.len)); } }, h('small', { text: `${m.line}` }), h('span', { class: 'mt', text: m.text }))));
        const head = h('div', { class: 'cat', style: 'cursor:pointer', text: `${f.rel}  (${f.matches.length})`, onclick: () => body.classList.toggle('hidden') });
        return h('div', {}, head, body);
      })) : null));
  if (!res) setTimeout(() => q.focus(), 0);
}

async function doSearch(box) {
  if (!state.workspace) { SU.error = 'Open a project first.'; return renderSearchView(box); }
  SU.busy = true; SU.error = '';
  renderSearchView(box);
  const r = await tryInv('search:files', state.workspace, { query: SU.q, regex: SU.re, caseSensitive: SU.cs, wholeWord: SU.ww, include: SU.inc });
  SU.busy = false;
  if (r.ok) SU.result = r.data; else { SU.error = r.error; SU.result = null; }
  renderSearchView(box);
}

async function doReplaceAll(box) {
  const res = SU.result;
  if (!res || !res.total) return;
  if (!(await confirmBox(`Replace ${res.total} occurrence(s) in ${res.files.length} file(s)?`, `"${SU.q}" will be replaced by "${SU.rep}". Files are changed on disk; use Git to review or undo.`))) return;
  const r = await tryInv('search:replace', state.workspace, { query: SU.q, regex: SU.re, caseSensitive: SU.cs, wholeWord: SU.ww }, res.files.map((f) => f.file), SU.rep);
  if (!r.ok) { SU.error = r.error; return renderSearchView(box); }
  status(`Replaced ${r.data.replacements} occurrence(s) in ${r.data.files} file(s).`);
  await afterAiTurn(); // refresh Explorer and reload open, unmodified files
  doSearch(box);
}

function searchFor(text, opts = {}) {
  SU.q = text || SU.q;
  Object.assign(SU, { ww: !!opts.ww, re: false, inc: opts.inc || '', showRep: !!opts.replace || SU.showRep, result: null });
  showView('search');
  if (opts.run) doSearch($('view-search'));
}

function selectedWord() {
  if (!editor || !editor.getModel()) return '';
  const sel = editor.getSelection();
  const m = editor.getModel();
  if (sel && !sel.isEmpty()) return m.getValueInRange(sel).split(String.fromCharCode(10))[0].slice(0, 200);
  const w = m.getWordAtPosition(editor.getPosition());
  return w ? w.word : '';
}

/* ------------------------------ tabs and files ------------------------------ */

const fileTabs = () => state.tabs.filter((t) => t.kind === 'file');
function cycleTab(d) {
  if (state.tabs.length < 2) return;
  const i = state.tabs.indexOf(state.active);
  activate(state.tabs[(i + d + state.tabs.length) % state.tabs.length]);
}

async function saveAs() {
  const t = state.active;
  if (!t || t.kind !== 'file') return;
  const n = await promptText('Save as', 'new-name.ext', baseName(t.path));
  if (!n) return;
  const target = joinPath(dirName(t.path), n);
  try { await inv('fs:writeFile', target, t.model.getValue()); await refreshTree(); openFile(target); status(`Saved as ${n}`); } catch (e) { status(e.message, true); }
}

async function reloadFile() {
  const t = state.active;
  if (!t || t.kind !== 'file') return;
  if (t.model.getValue() !== t.saved && !(await confirmBox('Discard your edits and reload from disk?', baseName(t.path)))) return;
  try { const txt = await inv('fs:readFile', t.path); t.model.setValue(txt); t.saved = txt; renderTabs(); status('Reloaded from disk.'); } catch (e) { status(e.message, true); }
}

const copyText = (s, what) => navigator.clipboard.writeText(s).then(() => status(`${what} copied.`)).catch(() => status('Copy failed.', true));
const relPath = (p) => (state.workspace && p.toLowerCase().startsWith(state.workspace.toLowerCase()) ? p.slice(state.workspace.length).replace(/^[\\/]+/, '') : p);

async function runCurrentFile() {
  const t = state.active;
  if (!t || t.kind !== 'file') return status('Open a file to run.', true);
  await saveActive();
  const ext = (t.path.split('.').pop() || '').toLowerCase();
  const q = `"${t.path}"`;
  const cmd = { java: `java ${q}`, js: `node ${q}`, mjs: `node ${q}`, py: `python ${q}`, go: `go run ${q}`, sh: `bash ${q}`, ps1: `powershell -ExecutionPolicy Bypass -File ${q}`, bat: q, cmd: q, rb: `ruby ${q}`, php: `php ${q}`, cs: null }[ext];
  if (!cmd) return status(`Don't know how to run .${ext} files directly. Use Run in the toolbar for projects.`, true);
  showPanel('terminal');
  termPrint(`> ${cmd}\n`, 't-cmd');
  const r = await tryInv('term:run', cmd, dirName(t.path));
  if (!r.ok) termPrint(`${r.error}\n`, 't-err'); else runningId = r.data;
}

/* ------------------------------ editor setup + registration ------------------------------ */

function updateLanguageOptions() {
  if (!editor || !editor.getModel()) return;
  editor.updateOptions({ wordBasedSuggestions: editor.getModel().getLanguageId() === 'java' ? 'off' : 'currentDocument' });
}

function setupEditorFeatures() {
  if (!monaco || !editor) return;
  editor.updateOptions({
    wordBasedSuggestions: 'currentDocument', quickSuggestions: { other: true, comments: false, strings: false }, snippetSuggestions: 'bottom', suggestSelection: 'first',
    suggest: { maxVisibleSuggestions: 10, showWords: true, localityBonus: true, preview: true, insertMode: 'replace' },
    parameterHints: { enabled: true }, bracketPairColorization: { enabled: true }, guides: { bracketPairs: true, indentation: true }, stickyScroll: { enabled: true }, glyphMargin: true,
    renderWhitespace: 'selection', smoothScrolling: true, cursorSmoothCaretAnimation: 'on', mouseWheelZoom: true, formatOnPaste: false, linkedEditing: true, tabSize: 4, insertSpaces: true,
  });
  editor.onDidChangeModel(updateLanguageOptions);
  registerJavaFeatures();
  // keys Monaco already binds to something else
  editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F12, () => CNS.run('nav.usages'));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12, () => CNS.run('java.methods'));
  editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.LeftArrow, () => CNS.run('nav.back'));
  editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.RightArrow, () => CNS.run('nav.forward'));
}

function registerEditorCommands() {
  const C = (id, fn, title) => CNS.command(id, fn, title);
  for (const [id, action, title] of ACTIONS) C(id, () => runAction(action), title);
  C('edit.undo', () => { if (editor) { editor.focus(); editor.trigger('menu', 'undo', null); } }, 'Edit: Undo');
  C('edit.redo', () => { if (editor) { editor.focus(); editor.trigger('menu', 'redo', null); } }, 'Edit: Redo');
  C('edit.selectAll', () => { if (editor) { editor.focus(); editor.trigger('menu', 'selectAll', null); } }, 'Edit: Select All');
  C('edit.cursorUndo', () => { if (editor) editor.trigger('menu', 'cursorUndo', null); }, 'Edit: Cursor Undo');
  C('edit.toggleWrap', () => toggleOption('wordWrap', 'on', 'off', 'Word wrap'), 'View: Toggle Word Wrap  (Alt+Z)');
  C('edit.toggleMinimap', () => toggleOption('minimap', { enabled: false }, { enabled: true }, 'Minimap'), 'View: Toggle Minimap');
  C('edit.toggleLineNumbers', () => toggleOption('lineNumbers', 'off', 'on', 'Line numbers'), 'View: Toggle Line Numbers');
  C('edit.toggleWhitespace', () => toggleOption('renderWhitespace', 'all', 'selection', 'Show whitespace'), 'View: Toggle Whitespace');
  C('edit.toggleSticky', () => toggleOption('stickyScroll', { enabled: false }, { enabled: true }, 'Sticky scroll'), 'View: Toggle Sticky Scroll');
  C('edit.fontUp', () => fontStep(1), 'View: Increase Editor Font');
  C('edit.fontDown', () => fontStep(-1), 'View: Decrease Editor Font');
  C('edit.fontReset', () => fontStep(0), 'View: Reset Editor Font');
  C('nav.file', cmdGotoFile, 'Navigate: Go to File…  (Ctrl+P)');
  C('nav.back', () => navGo(nav.back, nav.fwd), 'Navigate: Back  (Alt+Left)');
  C('nav.forward', () => navGo(nav.fwd, nav.back), 'Navigate: Forward  (Alt+Right)');
  C('nav.usages', () => { const w = selectedWord(); if (!w) return status('Place the cursor on a name.', true); const ext = state.active && state.active.kind === 'file' ? (state.active.path.split('.').pop() || '') : ''; searchFor(w, { ww: true, inc: ext ? `*.${ext}` : '', run: true }); }, 'Navigate: Find Usages  (Shift+F12)');
  C('search.files', () => searchFor(selectedWord(), {}), 'Search: Find in Files…  (Ctrl+Shift+F)');
  C('search.replace', () => searchFor(selectedWord(), { replace: true }), 'Search: Replace in Files…  (Ctrl+Shift+H)');
  C('view.search', () => showView('search'), 'View: Search');
  C('tab.close', () => { const t = state.active; if (t && t.kind !== 'home') closeTab(t); }, 'Tab: Close  (Ctrl+W)');
  C('tab.closeOthers', () => { const keep = state.active; state.tabs.filter((t) => t !== keep && t.kind !== 'home').forEach((t) => closeTab(t)); }, 'Tab: Close Others');
  C('tab.closeAll', () => { state.tabs.filter((t) => t.kind !== 'home').forEach((t) => closeTab(t)); }, 'Tab: Close All');
  C('tab.next', () => cycleTab(1), 'Tab: Next  (Ctrl+PageDown)');
  C('tab.prev', () => cycleTab(-1), 'Tab: Previous  (Ctrl+PageUp)');
  C('tab.reopen', () => { const p = closedTabs.pop(); if (p) openFile(p); else status('No closed tab to reopen.'); }, 'Tab: Reopen Closed Tab');
  C('file.saveAs', saveAs, 'File: Save As…');
  C('file.reload', reloadFile, 'File: Reload from Disk');
  C('file.copyPath', () => state.active && state.active.kind === 'file' && copyText(state.active.path, 'Path'), 'File: Copy Path');
  C('file.copyRelPath', () => state.active && state.active.kind === 'file' && copyText(relPath(state.active.path), 'Relative path'), 'File: Copy Relative Path');
  C('file.reveal', () => { const p = state.active && state.active.kind === 'file' ? state.active.path : state.workspace; if (p) tryInv('shell:showItem', p); }, 'File: Show in File Explorer');
  C('file.openTerminalHere', () => { if (state.active && state.active.kind === 'file') state.cwd = dirName(state.active.path); $('term-prompt').textContent = promptStr(); showPanel('terminal'); }, 'Terminal: Open in This File\'s Folder');
  C('run.file', runCurrentFile, 'Run: Run This File');
  C('edit.dupLinesRemove', () => {
    if (!editor || !editor.getModel()) return;
    const m = editor.getModel();
    const seen = new Set();
    const keep = m.getValue().split(String.fromCharCode(10)).filter((l) => (seen.has(l) && l.trim() ? false : (seen.add(l), true)));
    editor.executeEdits('dedupe', [{ range: m.getFullModelRange(), text: keep.join(String.fromCharCode(10)) }]);
  }, 'Edit: Remove Duplicate Lines');
}
