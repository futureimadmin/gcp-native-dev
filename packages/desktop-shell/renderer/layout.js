/* Layout: draggable splitters, sidebar toggle, maximize/minimize the bottom panel, and a focus mode for the editor. */
'use strict';

const LAYOUT_KEY = 'cns.layout';
const layout = { sideW: 320, aiW: 400, panelH: 240 };

function loadLayout() {
  try { Object.assign(layout, JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}')); } catch { /* defaults */ }
  applyLayout();
}

function saveLayout() {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* storage unavailable: layout just is not remembered */ }
}

function applyLayout() {
  const root = document.documentElement.style;
  root.setProperty('--side-w', `${layout.sideW}px`);
  root.setProperty('--ai-w', `${layout.aiW}px`);
  root.setProperty('--panel-h', `${layout.panelH}px`);
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function splitter(id, axis, onDrag) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const start = axis === 'x' ? e.clientX : e.clientY;
    el.classList.add('drag');
    document.body.classList.add('dragging');
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    const move = (ev) => { onDrag((axis === 'x' ? ev.clientX : ev.clientY) - start); applyLayout(); };
    const up = () => {
      el.classList.remove('drag');
      document.body.classList.remove('dragging');
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      saveLayout();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

function wireSplitters() {
  let base = 0;
  const grab = (key) => { base = layout[key]; };
  const watch = (id, key, axis, fn) => {
    const el = $(id);
    el.addEventListener('mousedown', () => grab(key), true);
    splitter(id, axis, (d) => { layout[key] = fn(base, d); });
  };
  watch('rs-side', 'sideW', 'x', (b, d) => clamp(b + d, 200, Math.round(window.innerWidth * 0.7)));
  watch('rs-ai', 'aiW', 'x', (b, d) => clamp(b - d, 280, Math.round(window.innerWidth * 0.7)));
  watch('rs-panel', 'panelH', 'y', (b, d) => clamp(b - d, 80, window.innerHeight - 200));
  // double-click a splitter to reset it
  $('rs-side').addEventListener('dblclick', () => { layout.sideW = 320; applyLayout(); saveLayout(); });
  $('rs-ai').addEventListener('dblclick', () => { layout.aiW = 400; applyLayout(); saveLayout(); });
  $('rs-panel').addEventListener('dblclick', () => { layout.panelH = 240; applyLayout(); saveLayout(); });
}

/* ---- sidebar / panel / focus mode ---- */

function sidebarHidden() { return document.body.classList.contains('side-hidden'); }
function setSidebarHidden(on) { document.body.classList.toggle('side-hidden', on); if (editor) editor.layout(); }
function toggleSidebar() { setSidebarHidden(!sidebarHidden()); }

function panelMaximized() { return $('panel').classList.contains('max'); }
function setPanelMax(on) {
  if (on) showPanel(document.querySelector('#panel-bar [data-panel].active') ? document.querySelector('#panel-bar [data-panel].active').dataset.panel : 'terminal');
  $('panel').classList.toggle('max', on);
  $('center').classList.toggle('panel-max', on);
  $('btn-panel-max').textContent = on ? '❐' : '□';
  $('btn-panel-max').title = on ? 'Restore panel (Ctrl+Shift+M)' : 'Maximize panel (Ctrl+Shift+M)';
  if (editor) editor.layout();
}
function togglePanelMax() { setPanelMax(!panelMaximized()); }

function minimizePanel() {
  setPanelMax(false);
  $('panel').classList.add('collapsed');
}

function toggleFocus() {
  const on = !document.body.classList.contains('focus-mode');
  document.body.classList.toggle('focus-mode', on);
  if (on) status('Focus mode. Press Ctrl+K Z or double-click a tab to leave.');
  if (editor) setTimeout(() => editor.layout(), 50);
}

/** Activity bar: clicking the active view collapses the sidebar, like most IDEs. */
function clickView(id) {
  const active = document.querySelector(`#activity button[data-view="${id}"]`);
  if (active && active.classList.contains('active') && !sidebarHidden()) return setSidebarHidden(true);
  setSidebarHidden(false);
  showView(id);
}

function wireLayout() {
  loadLayout();
  wireSplitters();
  $('btn-panel-max').onclick = togglePanelMax;
  $('btn-term-close').onclick = minimizePanel;
  $('panel-bar').addEventListener('dblclick', (e) => { if (e.target.id === 'panel-bar') togglePanelMax(); });
  CNS.command('layout.sidebar', toggleSidebar, 'View: Toggle Sidebar');
  CNS.command('layout.panelMax', togglePanelMax, 'View: Maximize / Restore Bottom Panel');
  CNS.command('layout.focus', toggleFocus, 'View: Focus Editor (hide all panels)');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) toggleFocus();
  });
  window.addEventListener('resize', () => { if (editor) editor.layout(); });
}
