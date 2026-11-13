/* Built-in Java compiler (javac). Background error checking: after you save, and after you pause typing, the project is compiled
   (including your unsaved edits) and problems appear as a small red dot in the margin (hover for the message) and in the PROBLEMS tab.
   Build (Ctrl+F9) also prints the result in OUTPUT. */
'use strict';

const dx = { map: new Map(), running: false, pending: false, saving: false, last: null, timer: null };
const normPath = (p) => String(p || '').split('/').join(BS).toLowerCase();
const editorCfgX = () => state.settings.editor || {};
const checkOn = () => editorCfgX().checkErrors !== false; // background error checking, on by default
const checkDelayMs = () => { const s = editorCfgX().checkDelay; return s === 0 ? 0 : (Number(s) || 5) * 1000; }; // pause before checking while typing; 0 = only on save

function outLink(text, file, line, col, cls) {
  const el = h('span', { class: `${cls || ''} olink`, text, title: 'Click to open', onclick: () => openAt(file, line, col) });
  $('output-out').append(el, document.createTextNode(String.fromCharCode(10)));
  $('output-out').scrollTop = $('output-out').scrollHeight;
}

function relOf(p) { return state.workspace && p.toLowerCase().startsWith(state.workspace.toLowerCase()) ? p.slice(state.workspace.length).replace(/^[\\/]+/, '') : p; }

/* ------------------------------ red marks in the editor (small dot + hover message) ------------------------------ */

function decorationsFor(model, diags) {
  const out = [];
  for (const d of diags) {
    const line = Math.max(1, Math.min(d.line, model.getLineCount()));
    const col = Math.max(1, Math.min(d.col, model.getLineMaxColumn(line)));
    const w = model.getWordAtPosition({ lineNumber: line, column: col });
    const endCol = w && w.startColumn <= col ? w.endColumn : Math.max(col + 1, Math.min(model.getLineMaxColumn(line), col + 1));
    const err = d.severity === 'error';
    const msg = { value: `**${err ? 'Error' : 'Warning'}** — ${d.message.replace(/[\\`*_{}[\]()#+!|<>]/g, (c) => `\\${c}`)}` };
    out.push({
      range: new monaco.Range(line, col, line, Math.max(endCol, col + 1)),
      options: { glyphMarginClassName: err ? 'cns-glyph-error' : 'cns-glyph-warn', glyphMarginHoverMessage: msg, hoverMessage: msg, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
    });
  }
  return out;
}

function applyMarkersFor(tab) {
  if (!tab || tab.kind !== 'file' || !monaco || tab.model.isDisposed()) return;
  const diags = dx.map.get(normPath(tab.path)) || [];
  tab.diagDecos = tab.model.deltaDecorations(tab.diagDecos || [], decorationsFor(tab.model, diags));
}

function applyAllMarkers() { for (const t of state.tabs) if (t.kind === 'file') applyMarkersFor(t); }

function clearProblems() {
  dx.map.clear();
  dx.last = null;
  applyAllMarkers();
  renderProblems();
}

/* ------------------------------ PROBLEMS tab + status counter ------------------------------ */

function renderProblems() {
  const all = [...dx.map.values()].flat().sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) || a.file.localeCompare(b.file) || a.line - b.line);
  const errors = all.filter((d) => d.severity === 'error').length;
  const btn = document.querySelector('#panel-bar [data-panel="problems"]');
  if (btn) btn.textContent = all.length ? `PROBLEMS (${all.length})` : 'PROBLEMS';
  const st = $('st-problems');
  st.classList.toggle('hidden', !all.length);
  st.textContent = `✖ ${errors}  ⚠ ${all.length - errors}`;
  const list = $('problems-list');
  if (!all.length) {
    list.replaceChildren(h('div', { class: 'hint pad', text: dx.last ? 'No problems found by the last check.' : (checkOn() ? 'Java is checked in the background after you save or pause typing.' : 'Background checking is off. Press Build (Ctrl+F9) to compile.') }));
    return;
  }
  list.replaceChildren(h('div', { class: 'prob head' }, h('span', { class: 'pico' }), h('span', { class: 'pfile', text: 'File' }), h('span', { class: 'pline', text: 'Line' }), h('span', { class: 'pmsg', text: 'Message' })),
    ...all.map((d) => h('div', { class: `prob ${d.severity}`, title: d.file, onclick: () => openAt(d.file, d.line, d.col) },
      h('span', { class: 'pico', text: d.severity === 'error' ? '✖' : '⚠' }), h('span', { class: 'pfile', text: baseName(d.file) }), h('span', { class: 'pline', text: String(d.line) }), h('span', { class: 'pmsg', text: d.message }))));
}

/* ------------------------------ compile / check ------------------------------ */

function dirtyJavaOverlay() {
  return state.tabs.filter((t) => t.kind === 'file' && /\.java$/i.test(t.path) && !t.model.isDisposed() && t.model.getValue() !== t.saved).map((t) => ({ file: t.path, content: t.model.getValue() }));
}

/** auto = background check (silent: no panels, no toasts). Otherwise a Build: saves files and prints to OUTPUT. */
async function javaCompile({ auto = false } = {}) {
  if (!state.workspace) return status('Open a project first.', true);
  if (dx.running) { dx.pending = true; return; }
  dx.running = true;
  try {
    if (!auto) { dx.saving = true; try { await saveAll(); } finally { dx.saving = false; } }
    setRunStatus(auto ? '' : '🔨 Compiling Java (javac)…');
    if (!auto) { showPanel('output'); outPrint(`${String.fromCharCode(10)}> javac (built-in compiler)${String.fromCharCode(10)}`, 't-cmd'); }
    const r = await tryInv('javac:compile', state.workspace, { overlay: auto ? dirtyJavaOverlay() : [] });
    setRunStatus('');
    if (!r.ok) { if (!auto) { status(r.error, true); outPrint(`${r.error}${String.fromCharCode(10)}`, 't-err'); } return; }
    const d = r.data;
    if (d.busy) return;
    if (d.fatal) { if (!auto) { status(d.fatal, true); outPrint(`${d.fatal}${String.fromCharCode(10)}`, 't-err'); } else if (!dx.fatalShown) { dx.fatalShown = true; status(d.fatal, true); } return; }

    dx.map = new Map();
    for (const x of d.diagnostics) { const k = normPath(x.file); dx.map.set(k, [...(dx.map.get(k) || []), x]); }
    dx.last = d;
    applyAllMarkers();
    renderProblems();

    if (!auto) {
      for (const n of d.notes || []) outPrint(`ℹ ${n}${String.fromCharCode(10)}`, 't-dim');
      for (const x of d.diagnostics) outLink(`${relOf(x.file)}:${x.line}:${x.col}  ${x.severity}: ${x.message}`, x.file, x.line, x.col, x.severity === 'error' ? 't-err' : 't-warn');
      if (d.unparsed) outPrint(`${d.unparsed}${String.fromCharCode(10)}`, 't-err');
      outPrint(d.errors ? `✘ ${d.errors} error(s), ${d.warnings} warning(s) in ${d.sourceCount} files (${(d.ms / 1000).toFixed(1)}s)${String.fromCharCode(10)}` : `✔ Compiled ${d.sourceCount} files, ${d.warnings} warning(s) (${(d.ms / 1000).toFixed(1)}s)${String.fromCharCode(10)}`, d.errors ? 't-err' : 't-cmd');
      status(d.errors ? `${d.errors} compile error(s) — see the red marks and PROBLEMS` : 'Compiled OK', d.errors > 0);
    }
  } finally {
    dx.running = false;
    if (dx.pending) { dx.pending = false; scheduleJavaCheck(400); }
  }
}

/** Queues a background check; a newer request replaces the older one (so typing keeps pushing it back). */
function scheduleJavaCheck(ms) {
  if (!checkOn() || !state.workspace) return;
  clearTimeout(dx.timer);
  dx.timer = setTimeout(() => javaCompile({ auto: true }), ms);
}

/** Next / previous problem in the open file (F8 / Shift+F8). */
function jumpProblem(dir) {
  const t = state.active;
  if (!t || t.kind !== 'file' || !editor) return;
  const diags = (dx.map.get(normPath(t.path)) || []).slice().sort((a, b) => a.line - b.line || a.col - b.col);
  if (!diags.length) return status('No problems in this file.');
  const pos = editor.getPosition();
  const after = (d) => d.line > pos.lineNumber || (d.line === pos.lineNumber && d.col > pos.column);
  const pick = dir > 0 ? (diags.find(after) || diags[0]) : ([...diags].reverse().find((d) => !after(d) && !(d.line === pos.lineNumber && d.col === pos.column)) || diags[diags.length - 1]);
  editor.setPosition({ lineNumber: pick.line, column: pick.col });
  editor.revealLineInCenter(pick.line);
  editor.focus();
}

function wireCompile() {
  CNS.command('java.compile', () => javaCompile({ auto: false }), 'Java: Compile Project (built-in javac)');
  CNS.command('java.check', () => javaCompile({ auto: true }), 'Java: Check for Errors Now');
  CNS.command('java.clearProblems', clearProblems, 'Java: Clear Compile Problems');
  CNS.command('view.problems', () => showPanel('problems'), 'View: Problems');
  CNS.command('nav.nextProblem', () => jumpProblem(1), 'Navigate: Next Problem  (F8)');
  CNS.command('nav.prevProblem', () => jumpProblem(-1), 'Navigate: Previous Problem  (Shift+F8)');
  $('st-problems').onclick = () => showPanel('problems');
  renderProblems();
}
