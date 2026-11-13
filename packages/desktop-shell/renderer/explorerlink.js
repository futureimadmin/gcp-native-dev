/* Links the editor and the Explorer (for every language): reveal the open file in the tree, keep the tree in sync with the open tab,
   a clickable path bar above the editor, and a right-click menu on tabs. */
'use strict';

const normTreePath = (p) => String(p || '').split('/').join(BS).toLowerCase();
const linkOn = () => (state.settings.ui || {}).linkExplorer !== false; // "Link with editor": on by default

/** Expands the Explorer down to `target` (file or folder) and highlights it. focus: also switch to the Explorer view. */
async function explorerReveal(target, opts = {}) {
  if (!state.workspace || !target) return;
  if (opts.focus) { document.body.classList.remove('side-hidden'); showView('explorer'); }
  const want = normTreePath(target);
  let last = null;
  for (let i = 0; i < 40; i++) {
    let best = null;
    for (const n of document.querySelectorAll('#tree .node[data-path]')) {
      const np = normTreePath(n.dataset.path);
      if (np === want) { best = { n, exact: true }; break; }
      if (want.startsWith(np + BS) && (!best || np.length > normTreePath(best.n.dataset.path).length)) best = { n, exact: false };
    }
    if (!best) return;
    if (best.exact) {
      document.querySelectorAll('#tree .node.sel').forEach((x) => x.classList.remove('sel'));
      best.n.classList.add('sel');
      best.n.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (best.n === last || !best.n._toggle) return; // nothing deeper to open: the item is not shown (for example a hidden folder)
    last = best.n;
    await best.n._toggle(true);
  }
}

let linkTimer = null;
function linkExplorerTo(tab) {
  if (!linkOn() || !tab || tab.kind !== 'file') return;
  const view = $('view-explorer');
  if (!view || view.classList.contains('hidden') || document.body.classList.contains('side-hidden')) return;
  clearTimeout(linkTimer);
  linkTimer = setTimeout(() => explorerReveal(tab.path, { focus: false }), 120);
}

/* ------------------------------ path bar (breadcrumbs) ------------------------------ */

function renderCrumbs(tab) {
  const bar = $('crumbs');
  if (!bar) return;
  if (!tab || tab.kind !== 'file') { bar.classList.add('hidden'); return; }
  const full = tab.path.split('/').join(BS);
  const inWs = state.workspace && full.toLowerCase().startsWith(state.workspace.toLowerCase());
  const baseDir = inWs ? state.workspace : '';
  const rel = inWs ? full.slice(state.workspace.length).replace(/^[\\/]+/, '') : full;
  const parts = rel.split(BS).filter(Boolean);
  const kids = [];
  let acc = baseDir;
  if (inWs) { kids.push(h('span', { class: 'crumb root', text: baseName(state.workspace), title: 'Reveal project folder', onclick: () => explorerReveal(state.workspace, { focus: true }) })); kids.push(h('span', { class: 'sep', text: '›' })); }
  parts.forEach((seg, i) => {
    acc = acc ? joinPath(acc, seg) : seg;
    const target = acc;
    const last = i === parts.length - 1;
    kids.push(h('span', { class: `crumb${last ? ' cur' : ''}`, text: seg, title: last ? 'Reveal in Explorer' : `Reveal ${seg} in Explorer`, onclick: () => explorerReveal(target, { focus: true }) }));
    if (!last) kids.push(h('span', { class: 'sep', text: '›' }));
  });
  kids.push(h('span', { class: 'spacer' }), h('button', { class: 'subtle crumb-btn', text: '⌖ Reveal in Explorer', title: 'Show this file in the Explorer (Alt+Shift+L)', onclick: () => explorerReveal(tab.path, { focus: true }) }));
  bar.replaceChildren(...kids);
  bar.classList.remove('hidden');
}

/* ------------------------------ tab menu + commands ------------------------------ */

function tabMenuItems(t) {
  if (t.kind !== 'file') return [{ label: 'Close', run: () => closeTab(t) }];
  return [
    { label: 'Reveal in Explorer', run: () => explorerReveal(t.path, { focus: true }) },
    { label: 'Show in File Explorer (Windows)', run: () => tryInv('shell:showItem', t.path) },
    { label: 'Copy Path', run: () => copyText(t.path, 'Path') },
    { label: 'Copy Relative Path', run: () => copyText(relPath(t.path), 'Relative path') },
    { label: 'Close', run: () => closeTab(t) },
    { label: 'Close Others', run: () => state.tabs.filter((x) => x !== t && x.kind !== 'home').forEach((x) => closeTab(x)) },
    { label: 'Close All', run: () => state.tabs.filter((x) => x.kind !== 'home').forEach((x) => closeTab(x)) },
  ];
}

function wireExplorerLink() {
  CNS.command('file.revealExplorer', () => { const t = state.active; if (t && t.kind === 'file') explorerReveal(t.path, { focus: true }); else status('Open a file first.', true); }, 'Explorer: Reveal Active File  (Alt+Shift+L)');
  CNS.command('view.linkExplorer', async () => {
    const on = !linkOn();
    state.settings.ui = { ...(state.settings.ui || {}), linkExplorer: on };
    await tryInv('settings:set', 'ui.linkExplorer', on);
    $('btn-link').classList.toggle('on', on);
    status(`Explorer follows the open file: ${on ? 'on' : 'off'}`);
    if (on && state.active) linkExplorerTo(state.active);
  }, 'Explorer: Toggle Keep in Sync with Open File');
  $('btn-link').onclick = () => CNS.run('view.linkExplorer');
  $('btn-link').classList.toggle('on', linkOn());
  renderCrumbs(state.active);
}
