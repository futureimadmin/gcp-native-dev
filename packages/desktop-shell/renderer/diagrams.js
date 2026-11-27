/* Diagrams in Markdown: a fenced block marked "mermaid" is drawn as a picture (flowcharts, sequence, class, ER, state, Gantt ...).
   The drawing library is bundled with the IDE (renderer/vendor), so nothing is downloaded and no text leaves the computer. */
'use strict';

let mmLoad = null;
let mmSeq = 0;

function mmIsDark() {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(document.body).backgroundColor || '');
  return !m || (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) < 140;
}

function loadMermaid() {
  if (mmLoad) return mmLoad;
  mmLoad = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/mermaid.min.js';
    s.onload = () => {
      try {
        window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: mmIsDark() ? 'dark' : 'default', fontFamily: 'inherit', flowchart: { useMaxWidth: true }, sequence: { useMaxWidth: true } });
        resolve(window.mermaid);
      } catch (e) { reject(e); }
    };
    s.onerror = () => { mmLoad = null; reject(new Error('The diagram library could not be loaded.')); };
    document.head.append(s);
  });
  return mmLoad;
}

/** Draws every diagram placeholder below root. A diagram that cannot be drawn shows the reason and its source, never a blank. */
async function mdDrawDiagrams(root, opts = {}) {
  const nodes = [...root.querySelectorAll('.md-diagram[data-src]')];
  if (!nodes.length) return;
  let mm;
  try { mm = await loadMermaid(); } catch (e) { for (const n of nodes) mdDiagramError(n, e.message); return; }
  let n = 0;
  for (const node of nodes) {
    if (!node.isConnected) continue;
    n++;
    const src = node.dataset.src;
    const id = 'mmd' + (++mmSeq);
    try {
      const { svg } = await mm.render(id, src);
      node.innerHTML = svg;
      node.classList.add('drawn');
      node.append(h('div', { class: 'md-diagram-bar' },
        h('button', { class: 'subtle', text: 'Copy SVG', onclick: () => navigator.clipboard.writeText(svg).then(() => status('Diagram copied as SVG.')).catch(() => status('Copy failed.', true)) }),
        opts.saveDir ? h('button', { class: 'subtle', text: 'Save SVG', title: 'Saves next to this document', onclick: async () => {
          const file = joinPath(opts.saveDir, `${opts.saveName || 'diagram'}-${n}.svg`);
          const r = await tryInv('fs:writeFile', file, svg);
          status(r.ok ? 'Saved ' + baseName(file) : r.error, !r.ok);
          if (r.ok && typeof refreshTree === 'function') refreshTree().catch(() => {});
        } }) : null));
    } catch (e) {
      const stale = document.getElementById('d' + id); if (stale) stale.remove(); // the library leaves an error picture behind
      mdDiagramError(node, String((e && e.message) || e).split(String.fromCharCode(10)).slice(0, 3).join(' '));
    }
  }
}

function mdDiagramError(node, why) {
  node.classList.add('failed');
  node.replaceChildren(h('div', { class: 'md-diagram-err' }, h('b', { text: 'This diagram could not be drawn.' }), h('div', { class: 'hint', text: why }),
    h('details', {}, h('summary', { text: 'Show the diagram text' }), h('pre', { text: node.dataset.src || '' }))));
}
