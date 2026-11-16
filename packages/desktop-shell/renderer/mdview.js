/* Markdown files open in the normal editor with a small switch in the top-right corner of the page:
     ✎ Edit      the text editor
     👁 Preview   the rendered document (read only)
     ◫ Split     editor and preview side by side; they scroll together and update as you type
   The choice is remembered per file and used as the starting view for the next Markdown file. Ctrl+Shift+V toggles Edit / Preview. */
'use strict';

const MDV = { modes: new Map(), timer: null, bar: null, view: null, syncing: false };
const isMdPath = (p) => /\.(md|markdown|mdown|mkd|mdx)$/i.test(p || '');
const mdKey = (p) => String(p).split('/').join(BS).toLowerCase();
const mdDefault = () => ((state.settings.ui || {}).mdMode) || 'edit';
const mdMode = (tab) => MDV.modes.get(mdKey(tab.path)) || mdDefault();

function mdBuild() {
  if (MDV.bar) return;
  const wrap = $('editor-wrap');
  MDV.view = h('div', { id: 'md-preview', class: 'hidden', tabindex: '0' });
  MDV.bar = h('div', { id: 'md-bar', class: 'hidden', role: 'toolbar', 'aria-label': 'Markdown view' },
    ...[['edit', '✎', 'Edit', 'Edit the Markdown text'], ['preview', '👁', 'Preview', 'Show the rendered document (Ctrl+Shift+V)'], ['split', '◫', 'Split', 'Editor and preview side by side']].map(([m, ico, label, tip]) => h('button', { 'data-mode': m, title: tip, onclick: () => mdSet(m) }, h('span', { text: ico }), ` ${label}`)));
  wrap.append(MDV.view, MDV.bar);
  // keep the preview and the editor at the same place in split view
  MDV.view.addEventListener('scroll', () => { if (MDV.syncing || mdCur() !== 'split' || !editor) return; MDV.syncing = true; const r = MDV.view.scrollTop / Math.max(1, MDV.view.scrollHeight - MDV.view.clientHeight); editor.setScrollTop(r * Math.max(0, editor.getScrollHeight() - editor.getLayoutInfo().height)); setTimeout(() => (MDV.syncing = false), 30); });
  if (editor) editor.onDidScrollChange(() => { if (MDV.syncing || mdCur() !== 'split') return; MDV.syncing = true; const r = editor.getScrollTop() / Math.max(1, editor.getScrollHeight() - editor.getLayoutInfo().height); MDV.view.scrollTop = r * Math.max(0, MDV.view.scrollHeight - MDV.view.clientHeight); setTimeout(() => (MDV.syncing = false), 30); });
  if (editor) editor.onDidChangeModelContent(() => { const t = state.active; if (t && t.kind === 'file' && isMdPath(t.path) && mdMode(t) !== 'edit') { clearTimeout(MDV.timer); MDV.timer = setTimeout(mdRender, 180); } });
}

const mdCur = () => { const t = state.active; return t && t.kind === 'file' && isMdPath(t.path) ? mdMode(t) : ''; };

function mdRender() {
  const t = state.active;
  if (!MDV.view || !t || t.kind !== 'file' || !isMdPath(t.path)) return;
  const keep = MDV.view.scrollTop;
  MDV.view.replaceChildren(renderMarkdown(t.model.getValue(), { dir: dirName(t.path), onOpen: (rel) => mdOpenRelative(t.path, rel) }));
  MDV.view.scrollTop = keep;
}

async function mdOpenRelative(from, rel) {
  if (!rel) return;
  const target = joinPath(dirName(from), decodeURIComponent(rel).split('/').join(BS));
  if (await inv('fs:exists', target).catch(() => false)) openAt(target, 1);
  else status(`File not found: ${rel}`, true);
}

function mdApply(tab) {
  mdBuild();
  const on = !!tab && tab.kind === 'file' && isMdPath(tab.path);
  const wrap = $('editor-wrap');
  MDV.bar.classList.toggle('hidden', !on);
  if (!on) { MDV.view.classList.add('hidden'); wrap.removeAttribute('data-md'); return; }
  const mode = mdMode(tab);
  wrap.dataset.md = mode;
  MDV.view.classList.toggle('hidden', mode === 'edit');
  MDV.bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  if (mode !== 'edit') mdRender();
  if (mode === 'edit' && editor) editor.focus();
  if (editor) setTimeout(() => editor.layout(), 0);
}

async function mdSet(mode) {
  const t = state.active;
  if (!t || t.kind !== 'file' || !isMdPath(t.path)) return;
  MDV.modes.set(mdKey(t.path), mode);
  state.settings.ui = { ...(state.settings.ui || {}), mdMode: mode };
  tryInv('settings:set', 'ui.mdMode', mode);
  mdApply(t);
}

function wireMarkdown() {
  mdBuild();
  CNS.on('tab-activated', mdApply);
  CNS.command('md.toggle', () => { const t = state.active; if (t && t.kind === 'file' && isMdPath(t.path)) mdSet(mdMode(t) === 'edit' ? 'preview' : 'edit'); else status('Open a Markdown file first.', true); }, 'Markdown: Toggle Edit / Preview  (Ctrl+Shift+V)');
  CNS.command('md.edit', () => mdSet('edit'), 'Markdown: Edit');
  CNS.command('md.preview', () => mdSet('preview'), 'Markdown: Preview');
  CNS.command('md.split', () => mdSet('split'), 'Markdown: Split (editor and preview)');
  if (editor) editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyV, () => CNS.run('md.toggle'));
  document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v') && document.activeElement && document.activeElement.id === 'md-preview') { e.preventDefault(); CNS.run('md.toggle'); } });
}
