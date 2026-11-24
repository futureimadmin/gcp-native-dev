/* Architecture diagram: a layered, theme-aware SVG of the network, workloads, managed services and identities of one environment.
   Input is the model from the architecture builder (nodes, edges, network, accounts); output is an <svg> element. */
'use strict';

function sv(tag, attrs, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) e.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

const DG_KIND = {
  users: '#64748b', edge: '#ea4335', octopus: '#7c5cff', apigee: '#ff7043', cloudrun: '#4285f4', gke: '#326ce5', cloudsql: '#34a853', redis: '#d93025',
  firestore: '#f9ab00', storage: '#1a73e8', bigquery: '#669df6', pubsub: '#fa7b17', secrets: '#a142f4', kms: '#9334e6', ops: '#5f6368',
};

/** Pictograms on a 24 x 24 grid, drawn with a white stroke on the coloured tile. */
const DG_GLYPH = {
  users: () => [sv('circle', { cx: 12, cy: 8, r: 4 }), sv('path', { d: 'M4 21c0-5 4-7 8-7s8 2 8 7' })],
  edge: () => [sv('path', { d: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z' }), sv('path', { d: 'M8.5 12l2.5 2.5 4.5-5' })],
  octopus: () => [sv('rect', { x: 5, y: 4.5, width: 14, height: 3.5, rx: 1.5 }), sv('rect', { x: 5, y: 10.2, width: 14, height: 3.5, rx: 1.5 }), sv('rect', { x: 5, y: 15.9, width: 14, height: 3.5, rx: 1.5 })],
  apigee: () => [sv('path', { d: 'M5 8h12M14 5l3 3-3 3M19 16H7M10 13l-3 3 3 3' })],
  cloudrun: () => [sv('path', { d: 'M8 5l11 7-11 7z' })],
  gke: () => [sv('path', { d: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z' }), sv('circle', { cx: 12, cy: 12, r: 2.6 })],
  cloudsql: () => [sv('ellipse', { cx: 12, cy: 6, rx: 7, ry: 3 }), sv('path', { d: 'M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3' })],
  redis: () => [sv('path', { d: 'M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4' })],
  firestore: () => [sv('path', { d: 'M6 3h8l5 5v13H6zM14 3v5h5M9 13h7M9 17h7' })],
  storage: () => [sv('ellipse', { cx: 12, cy: 7, rx: 7, ry: 2.4 }), sv('path', { d: 'M5 7l2 13h10l2-13' })],
  bigquery: () => [sv('circle', { cx: 11, cy: 11, r: 6 }), sv('path', { d: 'M15.5 15.5L20 20M9 13v-3M11 13V8M13 13v-2' })],
  pubsub: () => [sv('circle', { cx: 12, cy: 12, r: 2.4 }), sv('path', { d: 'M7 7a7 7 0 000 10M17 7a7 7 0 010 10M4.5 4.5a11 11 0 000 15M19.5 4.5a11 11 0 010 15' })],
  secrets: () => [sv('circle', { cx: 8, cy: 12, r: 3.5 }), sv('path', { d: 'M11.5 12H21M18 12v3M15 12v2' })],
  kms: () => [sv('rect', { x: 6, y: 11, width: 12, height: 9, rx: 2 }), sv('path', { d: 'M8.5 11V8a3.5 3.5 0 017 0v3' })],
  ops: () => [sv('path', { d: 'M3 12h5l2-6 4 12 2-6h5' })],
};

function dgIcon(kind, x, y, size) {
  const c = DG_KIND[kind] || '#64748b';
  const id = `dg-g-${kind}`;
  const s = size / 24;
  return sv('g', { transform: `translate(${x},${y})` },
    sv('rect', { width: size, height: size, rx: 9, fill: `url(#${id})` }),
    sv('g', { transform: `translate(${(size - 24 * s * 0.78) / 2},${(size - 24 * s * 0.78) / 2}) scale(${s * 0.78})`, fill: 'none', stroke: '#fff', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, (DG_GLYPH[kind] || DG_GLYPH.ops)()),
    sv('title', {}, c));
}

function dgDefs() {
  const defs = sv('defs');
  for (const [k, c] of Object.entries(DG_KIND)) {
    defs.append(sv('linearGradient', { id: `dg-g-${k}`, x1: 0, y1: 0, x2: 1, y2: 1 }, sv('stop', { offset: '0%', 'stop-color': c, 'stop-opacity': 0.95 }), sv('stop', { offset: '100%', 'stop-color': c, 'stop-opacity': 0.65 })));
  }
  defs.append(sv('filter', { id: 'dg-shadow', x: '-10%', y: '-10%', width: '125%', height: '135%' }, sv('feDropShadow', { dx: 0, dy: 2, stdDeviation: 3, 'flood-color': '#000', 'flood-opacity': 0.22 })));
  for (const [id, color] of [['pub', 'var(--accent)'], ['priv', 'var(--dim)'], ['goog', 'var(--cloud)'], ['ops', 'var(--dim)']]) {
    defs.append(sv('marker', { id: `dg-arrow-${id}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, sv('path', { d: 'M0 1l9 4-9 4z', style: `fill:${color}` })));
  }
  return defs;
}

const DG_EDGE_STYLE = {
  public: { stroke: 'var(--accent)', width: 2.4, dash: '', marker: 'pub' },
  private: { stroke: 'var(--dim)', width: 1.8, dash: '', marker: 'priv' },
  google: { stroke: 'var(--cloud)', width: 1.5, dash: '6 4', marker: 'goog' },
  ops: { stroke: 'var(--dim)', width: 1.3, dash: '2 4', marker: 'ops' },
};

function dgPill(x, y, text, opts = {}) {
  const w = Math.max(30, text.length * (opts.mono ? 6.3 : 5.9) + 16);
  return sv('g', { transform: `translate(${x - (opts.left ? 0 : w / 2)},${y - 10})` },
    sv('rect', { width: w, height: 20, rx: 10, style: `fill:${opts.fill || 'var(--bg)'};stroke:${opts.stroke || 'var(--line)'}` }),
    sv('text', { x: w / 2, y: 14, 'text-anchor': 'middle', style: `font-size:10.5px;fill:${opts.color || 'var(--dim)'};${opts.mono ? 'font-family:var(--mono)' : ''}` }, text));
}

function dgCard(n, x, y, w, h, accounts) {
  const long = n.label.length > 26;
  const sa = n.sa && accounts.find((a) => a.id === n.sa);
  return sv('g', { transform: `translate(${x},${y})`, filter: 'url(#dg-shadow)' },
    sv('rect', { width: w, height: h, rx: 13, style: 'fill:var(--bg2);stroke:var(--line)' }),
    sv('rect', { x: 0, y: 14, width: 3.5, height: h - 28, rx: 2, fill: DG_KIND[n.kind] || '#64748b' }),
    dgIcon(n.kind, 14, (h - 38) / 2, 38),
    sv('text', { x: 62, y: n.sub ? h / 2 - 3 : h / 2 + 5, style: `font-size:${long ? 11.5 : 13}px;font-weight:600;fill:var(--fg)` }, n.label),
    n.sub ? sv('text', { x: 62, y: h / 2 + 14, style: 'font-size:10.5px;fill:var(--dim)' }, n.sub) : null,
    sa ? sv('g', { transform: `translate(${w - 20},${h - 9})` }, sv('circle', { r: 9, style: 'fill:var(--bg);stroke:var(--accent)', 'stroke-width': 1.3 }), sv('text', { y: 3.5, 'text-anchor': 'middle', style: 'font-size:8.5px;font-weight:700;fill:var(--accent)' }, 'SA'), sv('title', {}, `Runs as ${sa.email}`)) : null);
}

function dgGroup(x, y, w, h, title, cidr, o = {}) {
  return sv('g', { transform: `translate(${x},${y})` },
    sv('rect', { width: w, height: h, rx: o.r || 14, style: `fill:${o.fill || 'none'};stroke:${o.stroke || 'var(--line)'}`, 'stroke-width': o.sw || 1.4, 'stroke-dasharray': o.dash || '' }),
    o.tint ? sv('rect', { width: w, height: h, rx: o.r || 14, fill: o.tint, opacity: 0.06 }) : null,
    sv('text', { x: 16, y: 24, style: 'font-size:12.5px;font-weight:700;fill:var(--fg)' }, title),
    cidr ? sv('text', { x: w - 16, y: 24, 'text-anchor': 'end', style: 'font-size:11px;fill:var(--accent2);font-family:var(--mono)' }, cidr) : null,
    o.sub ? sv('text', { x: 16, y: 41, style: 'font-size:10.5px;fill:var(--dim)' }, o.sub) : null);
}

/** The diagram. */
function renderArchitecture(m, opts = {}) {
  const CW = 232;
  const CH = 66;
  const GAP = 16;
  const by = (z) => m.nodes.filter((n) => n.zone === z);
  const users = by('outside');
  const edge = by('edge');
  const appN = by('app');
  const psaN = [...by('psa'), ...by('peered')];
  const googN = by('google');
  const ops = by('ops')[0];
  const stack = (k) => (k ? k * (CH + GAP) - GAP : 0);

  const X = { users: 26, edge: 0, vpc: 0, vpcW: CW + 76, google: 0 };
  X.edge = X.users + CW + 72;
  X.vpc = X.edge + CW + 76;
  X.google = X.vpc + X.vpcW + 70;
  const W = X.google + CW + 40 + 26;
  const top = 96;

  const appH = appN.length ? 52 + stack(appN.length) + 18 + (m.network.subnets[0].secondary.length ? 14 : 0) : 0;
  const psaH = psaN.length ? 52 + stack(psaN.length) + 18 : 0;
  const natH = m.network.nat ? 40 : 0;
  const vpcH = 56 + appH + (appH && psaH ? 46 : 0) + psaH + (natH ? natH + 16 : 0) + 18;
  const googH = googN.length ? 58 + stack(googN.length) + 20 : 0;
  const mainH = Math.max(vpcH, googH, 300);
  const opsY = top + mainH + 52;
  const saY = opsY + (ops ? CH + 44 : 0);
  const H = saY + 78;

  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': `Architecture of ${m.app} in ${m.env}`, class: 'dg', style: 'font-family:var(--font);display:block' }, dgDefs());
  const layer = { bg: sv('g'), groups: sv('g'), edges: sv('g'), cards: sv('g'), labels: sv('g') };
  svg.append(layer.bg, layer.groups, layer.edges, layer.cards, layer.labels);

  // title and legend
  layer.bg.append(sv('text', { x: 26, y: 40, style: 'font-size:20px;font-weight:700;fill:var(--fg)' }, `${m.app} · ${m.env}`),
    sv('text', { x: 26, y: 62, style: 'font-size:12px;fill:var(--dim)' }, `Google Cloud · ${m.region} · ${m.services.length} services · ${m.accounts.length} identities, each with only the roles it needs`));
  const lg = [['public', 'Internet traffic'], ['private', 'Private network'], ['google', 'Google APIs (private access)'], ['ops', 'Logs and metrics']];
  lg.forEach(([k, t], i) => {
    const s = DG_EDGE_STYLE[k];
    const lx = W - 26 - 190;
    layer.bg.append(sv('line', { x1: lx, y1: 30 + i * 17, x2: lx + 28, y2: 30 + i * 17, style: `stroke:${s.stroke}`, 'stroke-width': s.width, 'stroke-dasharray': s.dash }), sv('text', { x: lx + 36, y: 34 + i * 17, style: 'font-size:10.5px;fill:var(--dim)' }, t));
  });

  // positions
  const pos = new Map();
  const mid = appN.length ? top + 56 + appH / 2 : top + mainH / 2; // entry points line up with the workloads
  users.forEach((n, i) => pos.set(n.id, { x: X.users, y: mid - CH / 2 + i * (CH + GAP) }));
  const edgeTop = mid - stack(edge.length) / 2;
  edge.forEach((n, i) => pos.set(n.id, { x: X.edge, y: edgeTop + i * (CH + GAP) }));

  // VPC container
  const vpcY = top;
  layer.groups.append(dgGroup(X.vpc, vpcY, X.vpcW, vpcH, `VPC · ${m.network.vpc}`, m.network.cidr, { fill: 'var(--bg)', stroke: 'var(--accent)', sw: 1.8, tint: 'var(--accent)', sub: `Custom-mode network · no public addresses` }));
  let cy = vpcY + 56;
  const gx = X.vpc + 18;
  const gw = X.vpcW - 36;
  const cardX = gx + (gw - CW) / 2;
  let appGroup = null;
  let psaGroup = null;
  if (appN.length) {
    const sub = m.network.subnets[0];
    layer.groups.append(dgGroup(gx, cy, gw, appH, 'App subnet', sub.cidr, { fill: 'var(--bg2)', dash: '5 4', r: 11, sub: sub.secondary.length ? `pods ${sub.secondary[0].cidr} · services ${sub.secondary[1].cidr}` : 'Private Google Access on' }));
    appN.forEach((n, i) => pos.set(n.id, { x: cardX, y: cy + 52 + (sub.secondary.length ? 14 : 0) - (sub.secondary.length ? 0 : 0) + i * (CH + GAP) }));
    appGroup = { x: gx, y: cy, w: gw, h: appH };
    cy += appH + 46;
  }
  if (psaN.length) {
    layer.groups.append(dgGroup(gx, cy, gw, psaH, 'Private service range', m.network.psa ? m.network.psa.cidr : '', { fill: 'var(--bg2)', dash: '5 4', r: 11, tint: 'var(--cloud)', sub: 'Google-managed, peered into the VPC' }));
    psaN.forEach((n, i) => pos.set(n.id, { x: cardX, y: cy + 52 + i * (CH + GAP) }));
    psaGroup = { x: gx, y: cy, w: gw, h: psaH };
    cy += psaH + 16;
  }
  if (natH) layer.groups.append(sv('g', { transform: `translate(${gx},${cy})` }, sv('rect', { width: gw, height: natH, rx: 10, style: 'fill:var(--bg2);stroke:var(--line)' }), sv('text', { x: gw / 2, y: 24, 'text-anchor': 'middle', style: 'font-size:11.5px;fill:var(--dim)' }, 'Cloud NAT · outbound only')));

  // managed Google services
  if (googN.length) {
    layer.groups.append(dgGroup(X.google - 18, top, CW + 36, googH, 'Google APIs', '', { fill: 'var(--bg)', stroke: 'var(--cloud)', sw: 1.5, tint: 'var(--cloud)', sub: 'Reached over Private Google Access' }));
    googN.forEach((n, i) => pos.set(n.id, { x: X.google, y: top + 58 + i * (CH + GAP) }));
  }
  if (ops) pos.set(ops.id, { x: X.vpc + (X.vpcW - CW) / 2, y: opsY });

  const mk = (a, b, kind, label, o = {}) => {
    const s = DG_EDGE_STYLE[kind] || DG_EDGE_STYLE.private;
    layer.edges.append(sv('path', { d: a, fill: 'none', style: `stroke:${s.stroke}`, 'stroke-width': s.width, 'stroke-dasharray': s.dash, 'stroke-linecap': 'round', 'marker-end': `url(#dg-arrow-${s.marker})` }));
    if (label) layer.labels.append(dgPill(o.lx, o.ly, label, { stroke: s.stroke, color: kind === 'public' ? 'var(--accent2)' : 'var(--dim)' }));
  };
  const right = (n) => ({ x: pos.get(n.id).x + CW, y: pos.get(n.id).y + CH / 2 });
  const left = (n) => ({ x: pos.get(n.id).x, y: pos.get(n.id).y + CH / 2 });
  const curve = (p, q) => { const dx = Math.max(40, (q.x - p.x) / 2); return `M${p.x},${p.y} C${p.x + dx},${p.y} ${q.x - dx},${q.y} ${q.x},${q.y}`; };
  const zoneOf = (id) => (m.nodes.find((n) => n.id === id) || {}).zone;
  const node = (id) => m.nodes.find((n) => n.id === id);

  const seen = new Set();
  for (const e of m.edges) {
    const A = node(e.from);
    const Bn = node(e.to);
    if (!A || !Bn || e.kind === 'ops') continue;
    const za = A.zone;
    const zb = Bn.zone;
    const key = `${za === 'app' || za === 'peered' || za === 'psa' ? 'vpc' : za}>${zb}`;
    if (zb === 'google') {
      // a fan from the app subnet to every Google service (one start point, so it stays readable)
      const p = appGroup ? { x: appGroup.x + appGroup.w, y: appGroup.y + appGroup.h / 2 } : right(A);
      const q = left(Bn);
      mk(curve(p, q), null, 'google', '', {});
      continue;
    }
    if (zb === 'psa' && (za === 'app')) {
      if (seen.has(key)) continue;
      seen.add(key);
      const x = appGroup.x + appGroup.w / 2;
      mk(`M${x},${appGroup.y + appGroup.h} L${x},${psaGroup.y - 2}`, null, 'private', 'private IP', { lx: x, ly: appGroup.y + appGroup.h + 23 });
      continue;
    }
    if (za === 'peered' && zb === 'app') {
      if (seen.has(key)) continue;
      seen.add(key);
      const x = appGroup.x + appGroup.w * 0.75;
      mk(`M${x},${psaGroup.y} L${x},${appGroup.y + appGroup.h + 2}`, null, 'private', 'routes to', { lx: x, ly: appGroup.y + appGroup.h + 23 });
      continue;
    }
    if (za === 'app' && zb === 'app') {
      const p = right(A);
      const q = right(Bn);
      const bulge = 30;
      mk(`M${p.x},${p.y} C${p.x + bulge},${p.y} ${q.x + bulge},${q.y} ${q.x},${q.y}`, null, 'private', '', {});
      continue;
    }
    // everything else: from the right side of the source to the left side of the target
    const p = right(A);
    const q = left(Bn);
    mk(curve(p, q), null, e.kind, e.label, { lx: (p.x + q.x) / 2, ly: (p.y + q.y) / 2 - (e.label ? 0 : 0) });
  }
  // logs and metrics: one dotted line from the VPC to the operations card
  if (ops) mk(`M${X.vpc + X.vpcW / 2},${vpcY + vpcH} L${X.vpc + X.vpcW / 2},${opsY - 3}`, null, 'ops', 'logs · metrics', { lx: X.vpc + X.vpcW / 2, ly: vpcY + vpcH + 26 });

  for (const n of m.nodes) { const p = pos.get(n.id); if (p) layer.cards.append(dgCard(n, p.x, p.y, CW, CH, m.accounts)); }

  // identities strip
  layer.groups.append(sv('text', { x: 26, y: saY + 4, style: 'font-size:11px;font-weight:700;fill:var(--dim);letter-spacing:.06em' }, 'IDENTITIES · LEAST PRIVILEGE'));
  let sx = 26;
  for (const a of m.accounts) {
    const label = `${a.title} · ${a.roles.length} role${a.roles.length === 1 ? '' : 's'}`;
    const wpx = label.length * 6.1 + 40;
    layer.groups.append(sv('g', { transform: `translate(${sx},${saY + 16})` },
      sv('rect', { width: wpx, height: 34, rx: 17, style: 'fill:var(--bg2);stroke:var(--accent)' }),
      sv('circle', { cx: 17, cy: 17, r: 9, style: 'fill:var(--accent)' }), sv('text', { x: 17, y: 20.5, 'text-anchor': 'middle', style: 'font-size:8.5px;font-weight:700;fill:var(--on-accent)' }, 'SA'),
      sv('text', { x: 32, y: 21, style: 'font-size:11.5px;fill:var(--fg)' }, label), sv('title', {}, `${a.email}\n${a.purpose}`)));
    sx += wpx + 12;
    if (sx > W - 200) break;
  }
  return svg;
}
