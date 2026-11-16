/* Simplified marks for source-control hosts and build tools (drawn as inline SVG, no image files). They are stylised glyphs in each
   product's colours so the Source Control and Build sections are recognisable at a glance. Unknown ids get a coloured tile with initials.
   Plugins can add their own: LOGO_DEFS.myhost = [{ d: '...path...', fill: '#123456' }]. */
'use strict';

const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const tileDef = (label, bg, fg = '#fff', size = 9) => [{ rect: [1.5, 1.5, 21, 21, 5], fill: bg }, { text: label, x: 12, y: 15.2, size, fill: fg }];

const LOGO_DEFS = {
  /* --- source control --- */
  git: [{ d: 'M12 1.8 22.2 12 12 22.2 1.8 12z', fill: '#f05133' }, { d: 'M9 7.6v8.8M9 13h3.2a3 3 0 0 0 3-3', stroke: '#fff', sw: 1.7, fill: 'none' }, { d: circ(9, 7.2, 1.7), fill: '#fff' }, { d: circ(9, 16.8, 1.7), fill: '#fff' }, { d: circ(15.2, 9.6, 1.7), fill: '#fff' }],
  github: [{ d: circ(12, 12, 10.5), fill: '#e6edf3' }, { d: 'M7.2 9.2 8 5.8l3 2.2h2l3-2.2.8 3.4c.9 1.4 1.1 2.7.6 4.3-.9 3-3.2 3.9-5.4 3.9s-4.5-.9-5.4-3.9c-.5-1.6-.3-2.9.6-4.3z', fill: '#0d1117' }, { d: circ(9.8, 12.2, .9) + circ(14.2, 12.2, .9), fill: '#e6edf3' }],
  gitlab: [{ d: 'M2.8 14.6 4.6 8.6 7 14l2.2-6.8L12 14l2.8-6.8L17 14l2.4-5.4 1.8 6L12 21.5z', fill: '#fc6d26' }, { d: 'M7 14h10l-5 7.5z', fill: '#e24329' }, { d: 'M2.8 14.6 7 14l5 7.5z', fill: '#fca326' }, { d: 'M21.2 14.6 17 14l-5 7.5z', fill: '#fca326' }],
  bitbucket: [{ d: 'M3.4 4.6h17.2l-2.2 14.6c-.1.7-.6 1.1-1.3 1.1H6.9c-.7 0-1.2-.4-1.3-1.1z', fill: '#2684ff' }, { d: 'M9.1 14.6h5.8l.8-5.2H8.3z', fill: '#0a2a66' }],
  azuredevops: [{ rect: [1.5, 1.5, 21, 21, 4], fill: '#0078d4' }, { d: 'M5 16 12 6l7 10M8.4 12.6h7.2', stroke: '#fff', sw: 1.9, fill: 'none' }],
  gitea: [{ rect: [1.5, 1.5, 21, 21, 5], fill: '#609926' }, { d: 'M5.5 8h10v5.2a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4zM15.5 9.4h1.8a1.7 1.7 0 0 1 0 3.4h-1.8', stroke: '#fff', sw: 1.6, fill: 'none' }],
  generic: [{ rect: [1.5, 1.5, 21, 21, 5], fill: '#5c6659' }, { d: 'M9 6.8v10.4M9 13h3.2a3 3 0 0 0 3-3', stroke: '#fff', sw: 1.6, fill: 'none' }, { d: circ(9, 6.4, 1.6), fill: '#fff' }, { d: circ(9, 17.6, 1.6), fill: '#fff' }, { d: circ(15.2, 9.6, 1.6), fill: '#fff' }],
  /* --- build tools --- */
  maven: [{ rect: [1.5, 1.5, 21, 21, 5], fill: '#c71a36' }, { d: 'M5.6 17.4V7l4.2 6 4.2-6v10.4M17.8 7.2c1 .4 1.6 1.4 1.6 2.6', stroke: '#fff', sw: 2, fill: 'none' }],
  gradle: [{ rect: [1.5, 1.5, 21, 21, 5], fill: '#02303a' }, { d: 'M16.8 9.4a5 5 0 1 0 .9 4.2h-4.6', stroke: '#6fe3f0', sw: 1.9, fill: 'none' }, { d: circ(17, 8, 1.2), fill: '#6fe3f0' }],
  ant: [{ rect: [1.5, 1.5, 21, 21, 5], fill: '#a81c7d' }, { d: circ(7.5, 12, 2.2) + circ(12, 12, 1.8) + circ(16.5, 12, 2.4), fill: '#fff' }, { d: 'M8 9 6 6.5M12 10.4 11 6.5M16 9.6l2-3M8 15l-2 2.5M12 13.8l-1 3.7M16 14.4l2 3', stroke: '#fff', sw: 1.2, fill: 'none' }],
  npm: tileDef('npm', '#cb3837', '#fff', 8.5), yarn: tileDef('yarn', '#2c8ebb', '#fff', 7.5), pnpm: tileDef('pnpm', '#f69220', '#1a1a1a', 7.5), bun: tileDef('bun', '#f6dece', '#222', 8.5),
  pip: tileDef('pip', '#3776ab', '#ffd43b', 9), poetry: tileDef('poe', '#60a5fa', '#0b1b3d', 8), uv: tileDef('uv', '#8a5cf6', '#fff', 10),
  go: tileDef('Go', '#00add8', '#fff', 10), cargo: tileDef('Rs', '#c0602a', '#fff', 10), dotnet: tileDef('.NET', '#512bd4', '#fff', 7), make: tileDef('make', '#6b7280', '#fff', 7),
  cmake: tileDef('CMk', '#064f8c', '#fff', 7.5), bazel: tileDef('bzl', '#43a047', '#fff', 8), composer: tileDef('php', '#7a86b8', '#fff', 9), bundler: tileDef('gem', '#cc342d', '#fff', 8),
  flutter: tileDef('Fl', '#02569b', '#54c5f8', 10), sbt: tileDef('sbt', '#dc322f', '#fff', 8.5), terraform: tileDef('TF', '#7b42bc', '#fff', 10),
  /* --- misc --- */
  build: [{ rect: [1.5, 1.5, 21, 21, 5], fill: '#3b4a42' }, { d: 'm8 16 7-7M13 6l5 5-2 2-5-5zM6 18l2.5-.5', stroke: '#fff', sw: 1.6, fill: 'none' }],
  branch: [{ d: 'M8 5.5v13M8 14h4a4 4 0 0 0 4-4V8.5', stroke: '#a9c0b0', sw: 1.8, fill: 'none' }, { d: circ(8, 5, 2), fill: '#a9c0b0' }, { d: circ(8, 19, 2), fill: '#a9c0b0' }, { d: circ(16, 7, 2), fill: '#a9c0b0' }],
};

const SVGNS_L = 'http://www.w3.org/2000/svg';

/** An <svg> element for a logo id. */
function logo(id, size = 16) {
  const def = LOGO_DEFS[id] || tileDef(String(id || '?').slice(0, 2).toUpperCase(), '#5c6659', '#fff', 9);
  const svg = document.createElementNS(SVGNS_L, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'logo');
  svg.setAttribute('aria-hidden', 'true');
  for (const s of def) {
    let el;
    if (s.text != null) { el = document.createElementNS(SVGNS_L, 'text'); el.textContent = s.text; el.setAttribute('x', s.x); el.setAttribute('y', s.y); el.setAttribute('text-anchor', 'middle'); el.setAttribute('font-size', s.size); el.setAttribute('font-weight', '800'); el.setAttribute('font-family', 'Segoe UI, Arial, sans-serif'); el.setAttribute('fill', s.fill); }
    else if (s.rect) { el = document.createElementNS(SVGNS_L, 'rect'); const [x, y, w, hh, r] = s.rect; el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', w); el.setAttribute('height', hh); el.setAttribute('rx', r); el.setAttribute('fill', s.fill); }
    else {
      el = document.createElementNS(SVGNS_L, 'path');
      el.setAttribute('d', s.d);
      el.setAttribute('fill', s.fill || 'none');
      if (s.stroke) { el.setAttribute('stroke', s.stroke); el.setAttribute('stroke-width', s.sw || 1.5); el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round'); }
    }
    svg.append(el);
  }
  return svg;
}
