/* Architecture canvas: drag Google Cloud icons from the palette onto a canvas.
   Rules (enforced when you drop, and checked again before provisioning):
   - application services (GKE, Cloud Run, functions, your own workloads) run in a PRIVATE SUBNET of a VPC, one platform per subnet
   - databases (Cloud SQL, AlloyDB ...) sit in a PRIVATE DATABASE SUBNET of a VPC
   - Memorystore and Apigee live in a Google-managed private range peered to the VPC: drop them on the VPC
   - Google-managed services (Firestore, Pub/Sub, Storage, BigQuery ...) need no VPC and live outside it
   The picture can be exported as PNG, JPG or SVG. The same document drives the Terraform. */
'use strict';

const CV_CW = 232;
const CV_CH = 66;
const CV_GAP = 16;
const CV = { doc: null, sel: null, mode: 'select', from: null, drag: null, zoom: 1, msg: null, svg: null, wrap: null, info: null, wired: false };

/* ------------------------------ what each thing is ------------------------------ */

/** { name, kind, role, zone, needs } for a node type. role: users | edge | app | data | psa | managed */
function cvInfo(type) {
  if (type === 'users') return { name: 'Users and clients', kind: 'users', role: 'users', zone: 'outside', needs: [] };
  const c = AW.custom.find((x) => cvCustomId(x) === type);
  if (c) return { name: c.name, kind: 'custom', role: c.tier === 'app' ? 'app' : c.tier === 'data' ? 'data' : 'managed', zone: c.tier === 'app' ? `svc:${type}` : c.tier === 'data' ? 'data' : 'google', needs: [], custom: true, apiOnly: true, sub: c.api };
  const s = AW.catalog && AW.catalog.services.find((x) => x.id === type);
  if (!s) return null;
  const z = s.zone;
  const role = z === 'edge' ? 'edge' : z === 'gke' || z === 'run' ? 'app' : z === 'data' ? 'data' : z === 'psa' ? 'psa' : 'managed';
  return { name: s.name, kind: s.id, role, zone: z, needs: s.needs || [], apiOnly: !!s.apiOnly, sub: CV_SUB[s.id] || (s.apiOnly ? 'API enabled' : '') };
}
const CV_SUB = { octopus: 'runs on GKE · from Marketplace', apigee: 'Google-managed, peered', gke: 'private nodes · workload identity', cloudrun: 'Direct VPC egress', cloudsql: 'private endpoint (PSC)', redis: 'private IP only', secrets: 'value kept out of state', functions: 'in a Cloud Run subnet', edge: 'static IP · OWASP rules' };
const cvSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
const cvCustomId = (c) => `x-${cvSlug(c.name) || 'service'}`;

/* ------------------------------ the document ------------------------------ */

const cvEmpty = () => ({ vpcs: [], subnets: [], nodes: [], edges: [], next: 1 });
const cvVpc = (id) => CV.doc.vpcs.find((v) => v.id === id);
const cvVpcOf = (target) => (target.kind === 'vpc' ? target.id : target.kind === 'subnet' ? (cvSubnet(target.id) || {}).vpc : null);
const cvVpcName = (v) => { const k = CV.doc.vpcs.indexOf(v); return `${AW.app}-${AW.envs[0] ? AW.envs[0].name : 'dev'}${k > 0 ? `-${k + 1}` : ''}-vpc`; };
const cvNodeVpc = (n) => (n && n.loc ? (n.loc.subnet ? (cvSubnet(n.loc.subnet) || {}).vpc : n.loc.vpc) || null : null);
/** Older documents had a single "vpc". */
function cvMigrate(doc) {
  if (doc.vpc && !doc.vpcs) { doc.vpcs = [{ id: 'v1', x: doc.vpc.x, y: doc.vpc.y }]; for (const sn of doc.subnets || []) sn.vpc = sn.vpc || 'v1'; for (const nd of doc.nodes || []) if (nd.loc && nd.loc.vpc === true) nd.loc.vpc = 'v1'; delete doc.vpc; }
  doc.vpcs = doc.vpcs || [];
  return doc;
}
const cvNode = (id) => CV.doc.nodes.find((n) => n.id === id);
const cvSubnet = (id) => CV.doc.subnets.find((s) => s.id === id);
const cvIn = (subnetId) => CV.doc.nodes.filter((n) => n.loc && n.loc.subnet === subnetId);
const cvOnVpc = (vid) => CV.doc.nodes.filter((n) => n.loc && n.loc.vpc === vid);
const cvOutside = () => CV.doc.nodes.filter((n) => n.loc && n.loc.x != null);

/** Can `type` be dropped on `target` ({kind:'canvas'|'vpc'|'subnet', id})? Returns '' when allowed, otherwise what to tell the user. `self` is the node being moved. */
function cvRule(type, target, self) {
  if (type === 'vpc') return target.kind === 'canvas' ? '' : 'Drop the VPC on the empty canvas, outside other VPCs.';
  if (type === 'subnet-app' || type === 'subnet-data') {
    if (!CV.doc.vpcs.length) return 'A subnet belongs inside a VPC. Add a VPC network first.';
    return target.kind === 'vpc' || target.kind === 'subnet' ? '' : 'Drop a subnet onto a VPC, so it is created inside it.';
  }
  const i = cvInfo(type);
  if (!i) return 'Unknown service.';
  const name = i.name;
  if (i.role === 'users' || i.role === 'edge') return target.kind === 'canvas' ? '' : `${name} is outside your network. Drop it on the canvas, outside the VPC.`;
  if (i.role === 'managed') return target.kind === 'canvas' ? '' : `${name} is a Google-managed service reached over Google’s own network: it needs no VPC or subnet. Drop it outside the VPC.`;
  if (i.role === 'psa') {
    if (!CV.doc.vpcs.length) return `${name} needs a VPC. Add a VPC network first.`;
    return target.kind === 'vpc' ? '' : target.kind === 'subnet' ? `${name} lives in a Google-managed private range peered to your VPC. Drop it on the VPC itself, not in a subnet.` : `${name} must be inside the VPC. Drop it onto the VPC.`;
  }
  if (i.role === 'app') {
    if (!CV.doc.vpcs.length) return `${name} needs a VPC and a private subnet. Add a VPC network, then a private subnet inside it, then drop ${name} there.`;
    if (target.kind === 'canvas') return `${name} must run inside a private subnet. Drop it onto a subnet of the VPC.`;
    if (target.kind === 'vpc') return `${name} must run in a private subnet, not directly in the VPC. Add an application subnet and drop it there.`;
    const sn = cvSubnet(target.id);
    if (sn.kind !== 'app') return `${name} is an application service and cannot go in a database subnet. Use an application subnet.`;
    const others = cvIn(sn.id).filter((n) => n.id !== (self && self.id));
    if (type === 'octopus') return others.some((n) => n.type === 'gke') ? '' : 'Octopus runs on GKE: drop it into the subnet of your GKE cluster (add GKE first).';
    if (others.some((n) => !(type === 'gke' && n.type === 'octopus'))) return `Each application service runs in its own private subnet, and “${cvInfo(others[0].type).name}” is already in this one. Add another application subnet.`;
    return '';
  }
  if (i.role === 'data') {
    if (!CV.doc.vpcs.length) return `${name} needs a VPC and a private database subnet. Add a VPC network, then a database subnet inside it.`;
    if (target.kind !== 'subnet') return `A database sits in a private database subnet. Drop ${name} onto a database subnet of the VPC.`;
    return cvSubnet(target.id).kind === 'data' ? '' : `${name} is a database: it needs its own private database subnet, not an application subnet.`;
  }
  return '';
}

/** What is wrong with the whole design right now (empty list = ready to provision). */
function cvProblems() {
  const out = [];
  const d = CV.doc;
  const has = (t) => d.nodes.some((n) => n.type === t);
  for (const n of d.nodes) {
    const i = cvInfo(n.type);
    if (!i) continue;
    const needsVpc = ['app', 'data', 'psa'].includes(i.role);
    if (needsVpc && !d.vpcs.length) out.push({ level: 'error', text: `${i.name} needs a VPC and a private subnet.` });
    else if (i.role === 'app' && !(n.loc && n.loc.subnet)) out.push({ level: 'error', text: `${i.name} is not inside a private subnet.` });
    else if (i.role === 'data' && !(n.loc && n.loc.subnet)) out.push({ level: 'error', text: `${i.name} is not inside a private database subnet.` });
    for (const need of i.needs) if (!has(need)) out.push({ level: 'error', text: `${i.name} needs ${(cvInfo(need) || { name: need }).name}.`, fix: need });
  }
  for (const s of d.subnets) if (!cvIn(s.id).length) out.push({ level: 'warn', text: `An empty ${s.kind === 'app' ? 'application' : 'database'} subnet will not be created.` });
  for (const v of d.vpcs) if (!d.subnets.some((x) => x.vpc === v.id) && !cvOnVpc(v.id).length) out.push({ level: 'warn', text: `${cvVpcName(v)} has no subnets yet.` });
  if (d.vpcs.length > 1) {
    out.push({ level: 'tip', text: 'Tip: one VPC per environment is the usual recommendation. Several are fine when you need to keep things apart; they are not connected unless a connection links services in different VPCs, and then Terraform peers them for you.' });
    const pairs = new Set();
    for (const e of d.edges) { const a = cvNodeVpc(cvNode(e.from)); const b = cvNodeVpc(cvNode(e.to)); if (a && b && a !== b) pairs.add([a, b].sort().join('|')); }
    for (const pr of pairs) { const [a, b] = pr.split('|'); out.push({ level: 'tip', text: `${cvVpcName(cvVpc(a))} and ${cvVpcName(cvVpc(b))} will be peered because services in them are connected.` }); }
  }
  return out;
}

/* ------------------------------ changing it ------------------------------ */

function cvMessage(text, err) { CV.msg = text ? { text, err: !!err } : null; const el = document.getElementById('cv-msg'); if (el) { el.textContent = text || ''; el.className = `cv-msg${err ? ' err' : ''}`; } if (text) status(text, !!err); }

function cvChanged() { cvRender(); awDocChanged(); }

/** Adds a palette item to the canvas at `point` (canvas coordinates) on `target`. */
function cvAdd(type, target, point) {
  const why = cvRule(type, target);
  if (why) { cvMessage(why, true); return false; }
  const d = CV.doc;
  let tip = '';
  if (type === 'vpc') {
    const last = d.vpcs[d.vpcs.length - 1];
    d.vpcs.push({ id: `v${d.next++}`, x: last ? last.x + 340 : Math.max(20, point.x - 150), y: last ? last.y : Math.max(20, point.y - 20) });
    if (d.vpcs.length > 1) tip = 'A second VPC: fine when you need to keep things apart. Tip: one VPC per environment is the usual recommendation; VPCs with a connection between them are peered.';
  } else if (type === 'subnet-app' || type === 'subnet-data') d.subnets.push({ id: `s${d.next++}`, kind: type === 'subnet-app' ? 'app' : 'data', vpc: cvVpcOf(target) });
  else {
    if (d.nodes.some((n) => n.type === type)) { cvMessage(`${cvInfo(type).name} is already on the canvas. One of each: move it instead.`, true); return false; }
    const i = cvInfo(type);
    const loc = target.kind === 'subnet' ? { subnet: target.id } : target.kind === 'vpc' ? { vpc: target.id } : { x: Math.max(10, point.x - CV_CW / 2), y: Math.max(10, point.y - CV_CH / 2) };
    d.nodes.push({ id: type, type, loc });
    CV.sel = { kind: 'node', id: type };
  }
  cvMessage(tip, false);
  if (!tip) cvMessage('');
  cvChanged();
  return true;
}

function cvMove(id, target, point) {
  const n = cvNode(id);
  const why = cvRule(n.type, target, n);
  if (why) { cvMessage(why, true); cvRender(); return false; }
  n.loc = target.kind === 'subnet' ? { subnet: target.id } : target.kind === 'vpc' ? { vpc: target.id } : { x: Math.max(10, point.x - CV_CW / 2), y: Math.max(10, point.y - CV_CH / 2) };
  cvMessage('');
  cvChanged();
  return true;
}

function cvRemove(sel, force) {
  const d = CV.doc;
  if (!sel) return;
  if (sel.kind === 'node') { d.nodes = d.nodes.filter((n) => n.id !== sel.id); d.edges = d.edges.filter((e) => e.from !== sel.id && e.to !== sel.id); }
  else if (sel.kind === 'edge') d.edges = d.edges.filter((e) => e.id !== sel.id);
  else if (sel.kind === 'subnet') {
    const inside = cvIn(sel.id);
    if (inside.length && !force) { cvMessage(`Move or delete ${inside.map((n) => cvInfo(n.type).name).join(', ')} first: a subnet with services in it is not deleted.`, true); return; }
    d.subnets = d.subnets.filter((s) => s.id !== sel.id);
  } else if (sel.kind === 'vpc') {
    const subs = d.subnets.filter((x) => x.vpc === sel.id).map((x) => x.id);
    const inside = d.nodes.filter((n) => n.loc && ((n.loc.subnet && subs.includes(n.loc.subnet)) || n.loc.vpc === sel.id));
    if (inside.length && !force) { cvMessage('Remove what is inside the VPC first (services, then subnets).', true); return; }
    d.vpcs = d.vpcs.filter((v) => v.id !== sel.id); d.subnets = d.subnets.filter((x) => x.vpc !== sel.id);
  }
  CV.sel = null;
  cvMessage('');
  cvChanged();
}

function cvConnect(from, to) {
  if (from === to) return;
  if (CV.doc.edges.some((e) => e.from === from && e.to === to)) { cvMessage('Those two are already connected.', true); return; }
  CV.doc.edges.push({ id: `e${CV.doc.next++}`, from, to, label: '' });
  CV.sel = { kind: 'edge', id: `e${CV.doc.next - 1}` };
  cvChanged();
}

/* ------------------------------ layout ------------------------------ */

function cvLayout() {
  const d = CV.doc;
  const L = { nodes: {}, subnets: {}, vpcs: {}, psa: {}, nat: {}, W: 1400, H: 900 };
  const gw = CV_CW + 36;
  for (const v of d.vpcs) {
    const groups = d.subnets.filter((x) => x.vpc === v.id).map((x) => ({ kind: 'subnet', s: x, nodes: cvIn(x.id) }));
    if (cvOnVpc(v.id).length) groups.push({ kind: 'psa', nodes: cvOnVpc(v.id) });
    let y = v.y + 56;
    for (const g of groups) {
      const rows = Math.max(1, g.nodes.length);
      const h = 52 + rows * (CV_CH + CV_GAP) - CV_GAP + 18;
      const r = { x: v.x + 18, y, w: gw, h };
      if (g.kind === 'subnet') L.subnets[g.s.id] = r; else L.psa[v.id] = r;
      g.nodes.forEach((n, i) => { L.nodes[n.id] = { x: r.x + (gw - CV_CW) / 2, y: y + 52 + i * (CV_CH + CV_GAP), w: CV_CW, h: CV_CH }; });
      y += h + 22;
    }
    const natH = AW.nat ? 40 : 0;
    const vh = (y - v.y - 22) + (natH ? natH + 16 : 0) + 18 + (groups.length ? 0 : 60);
    if (natH) L.nat[v.id] = { x: v.x + 18, y: y - 22 + 16, w: gw, h: natH };
    L.vpcs[v.id] = { x: v.x, y: v.y, w: gw + 36, h: Math.max(160, vh) };
  }
  for (const n of cvOutside()) L.nodes[n.id] = { x: n.loc.x, y: n.loc.y, w: CV_CW, h: CV_CH };
  for (const r of [...Object.values(L.nodes), ...Object.values(L.vpcs)]) { L.W = Math.max(L.W, r.x + r.w + 60); L.H = Math.max(L.H, r.y + r.h + 60); }
  CV.layout = L;
  return L;
}

/** What is under a point of the canvas. */
function cvTargetAt(p) {
  const L = CV.layout || cvLayout();
  const inside = (r, q) => r && q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h;
  for (const [id, r] of Object.entries(L.subnets)) if (inside(r, p)) return { kind: 'subnet', id };
  for (const v of CV.doc.vpcs) if (inside(L.vpcs[v.id], p) || inside(L.psa[v.id], p)) return { kind: 'vpc', id: v.id };
  return { kind: 'canvas' };
}

/* ------------------------------ drawing ------------------------------ */

function cvSubnetTitle(s, nodes) {
  const names = nodes.map((n) => cvInfo(n.type).name);
  const short = (names.find((x) => x.startsWith('GKE')) || names[0] || '').replace(/ API Gateway| Autopilot| \(.*\)/g, '').slice(0, 14);
  return s.kind === 'data' ? 'Database subnet' : short ? `App subnet · ${short}` : 'App subnet';
}

/** The SVG of the canvas. `exporting` leaves out handles and selection. */
function cvBuild(exporting) {
  const d = CV.doc;
  const L = cvLayout();
  // the exported picture shows only what is drawn, with a margin and a title strip
  let vb = { x: 0, y: 0, w: L.W, h: L.H };
  if (exporting) {
    const rects = [...Object.values(L.nodes), ...Object.values(L.vpcs)];
    if (rects.length) { const x0 = Math.min(...rects.map((r) => r.x)) - 40; const y0 = Math.min(...rects.map((r) => r.y)) - 90; const x1 = Math.max(...rects.map((r) => r.x + r.w)) + 40; const y1 = Math.max(...rects.map((r) => r.y + r.h)) + 40; vb = { x: Math.max(0, x0), y: Math.max(0, y0), w: x1 - Math.max(0, x0), h: y1 - Math.max(0, y0) }; }
  }
  L.view = vb;
  const svg = sv('svg', { viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`, width: exporting ? vb.w : L.W * CV.zoom, height: exporting ? vb.h : L.H * CV.zoom, class: 'cv-svg', style: 'font-family:var(--font);display:block' }, dgDefs());
  const bg = sv('g');
  const grp = sv('g');
  const edg = sv('g');
  const crd = sv('g');
  const lab = sv('g');
  svg.append(sv('rect', { class: 'cv-bg', x: vb.x, y: vb.y, width: vb.w, height: vb.h, style: 'fill:var(--bg)' }), bg, grp, edg, crd, lab);
  if (!exporting) {
    // faint grid
    svg.insertBefore(sv('pattern', { id: 'cv-grid', width: 24, height: 24, patternUnits: 'userSpaceOnUse' }, sv('circle', { cx: 1, cy: 1, r: 1, style: 'fill:var(--line)' })), svg.firstChild);
    bg.append(sv('rect', { width: L.W, height: L.H, fill: 'url(#cv-grid)' }));
  }
  const sel = (kind, id) => !exporting && CV.sel && CV.sel.kind === kind && CV.sel.id === id;
  for (const v of d.vpcs) {
    const r0 = L.vpcs[v.id];
    const inf = (CV.info && CV.info.byVpc && CV.info.byVpc[v.id]) || {};
    const g = dgGroup(r0.x, r0.y, r0.w, r0.h, `VPC network · ${cvVpcName(v)}`, inf.cidr || '', { fill: 'var(--bg)', stroke: sel('vpc', v.id) ? 'var(--accent2)' : 'var(--accent)', sw: sel('vpc', v.id) ? 3 : 1.8, tint: 'var(--accent)', sub: 'Custom-mode network · services run only in private subnets' });
    g.setAttribute('data-vpc', v.id);
    grp.append(g);
    for (const s of d.subnets.filter((x) => x.vpc === v.id)) {
      const r = L.subnets[s.id];
      const nodes = cvIn(s.id);
      const cidr = (CV.info && CV.info.subnetCidr && CV.info.subnetCidr[s.id]) || '';
      const sg = dgGroup(r.x, r.y, r.w, r.h, cvSubnetTitle(s, nodes), cidr, { fill: 'var(--bg2)', stroke: sel('subnet', s.id) ? 'var(--accent2)' : 'var(--line)', sw: sel('subnet', s.id) ? 2.5 : 1.4, dash: '5 4', r: 11, tint: s.kind === 'data' ? 'var(--ok)' : '', sub: s.kind === 'data' ? 'Holds the database’s private endpoint' : 'One application platform per subnet · private only' });
      sg.setAttribute('data-subnet', s.id);
      grp.append(sg);
      if (!nodes.length) grp.append(sv('text', { x: r.x + r.w / 2, y: r.y + r.h / 2 + 14, 'text-anchor': 'middle', style: 'font-size:11.5px;fill:var(--dim);font-style:italic' }, s.kind === 'data' ? 'Drop a database here' : 'Drop an application service here'));
    }
    const pr = L.psa[v.id];
    if (pr) grp.append(dgGroup(pr.x, pr.y, pr.w, pr.h, 'Private service range', inf.psa || '', { fill: 'var(--bg2)', stroke: 'var(--cloud)', dash: '5 4', r: 11, tint: 'var(--cloud)', sub: 'Google-managed, peered into the VPC' }));
    const nt = L.nat[v.id];
    if (nt) grp.append(sv('g', { transform: `translate(${nt.x},${nt.y})` }, sv('rect', { width: nt.w, height: nt.h, rx: 10, style: 'fill:var(--bg2);stroke:var(--line)' }), sv('text', { x: nt.w / 2, y: 24, 'text-anchor': 'middle', style: 'font-size:11.5px;fill:var(--dim)' }, 'Cloud NAT · outbound only')));
  }
  // connections
  let rail = 0;
  const anchor = (a, b) => {
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    if (Math.abs(ac.x - bc.x) < CV_CW * 0.6) return bc.y > ac.y ? [{ x: ac.x, y: a.y + a.h }, { x: bc.x, y: b.y }] : [{ x: ac.x, y: a.y }, { x: bc.x, y: b.y + b.h }];
    return bc.x > ac.x ? [{ x: a.x + a.w, y: ac.y }, { x: b.x, y: bc.y }] : [{ x: a.x, y: ac.y }, { x: b.x + b.w, y: bc.y }];
  };
  for (const e of d.edges) {
    const A = L.nodes[e.from];
    const B = L.nodes[e.to];
    if (!A || !B) continue;
    const na = cvNode(e.from);
    const nb = cvNode(e.to);
    const insideVpc = (n) => n && n.loc && (n.loc.subnet || n.loc.vpc);
    let p;
    let q;
    let path;
    let mid;
    if (insideVpc(na) && insideVpc(nb)) {
      // both are inside the VPC: go round the right-hand side so the line never crosses another card
      p = { x: A.x + A.w, y: A.y + A.h / 2 };
      q = { x: B.x + B.w, y: B.y + B.h / 2 };
      const k = 26 + Math.min(60, Math.abs(q.y - p.y) / 5) + 8 * ((rail++) % 4);
      path = `M${p.x},${p.y} C${p.x + k},${p.y} ${q.x + k},${q.y} ${q.x},${q.y}`;
      mid = { x: Math.max(p.x, q.x) + k * 0.75 + 4, y: (p.y + q.y) / 2, left: true };
    } else {
      [p, q] = anchor(A, B);
      const vertical = Math.abs(p.x - q.x) < 1 || Math.abs(p.y - q.y) > Math.abs(p.x - q.x) * 2;
      const dx = Math.max(40, Math.abs(q.x - p.x) / 2);
      const dy = Math.max(30, Math.abs(q.y - p.y) / 2);
      path = vertical ? `M${p.x},${p.y} C${p.x},${p.y + Math.sign(q.y - p.y) * dy} ${q.x},${q.y - Math.sign(q.y - p.y) * dy} ${q.x},${q.y}` : `M${p.x},${p.y} C${p.x + Math.sign(q.x - p.x) * dx},${p.y} ${q.x - Math.sign(q.x - p.x) * dx},${q.y} ${q.x},${q.y}`;
      mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    }
    const kind = e.from === 'users' || e.to === 'users' ? 'public' : (cvInfo(e.to) || {}).role === 'managed' ? 'google' : 'private';
    const st = DG_EDGE_STYLE[kind];
    const on = sel('edge', e.id);
    const g = sv('g', { 'data-edge': e.id, style: 'cursor:pointer' },
      sv('path', { d: path, fill: 'none', 'stroke-width': 14, style: 'stroke:transparent' }),
      sv('path', { d: path, fill: 'none', style: `stroke:${on ? 'var(--accent2)' : st.stroke}`, 'stroke-width': on ? st.width + 1.5 : st.width, 'stroke-dasharray': st.dash, 'stroke-linecap': 'round', 'marker-end': `url(#dg-arrow-${st.marker})` }));
    edg.append(g);
    if (e.label) lab.append(dgPill(mid.x, mid.y, e.label, { stroke: st.stroke, left: !!mid.left }));
  }
  // cards
  for (const n of d.nodes) {
    const r = L.nodes[n.id];
    const i = cvInfo(n.type);
    if (!r || !i) continue;
    const g = dgCard({ id: n.id, kind: i.kind, label: i.name, sub: i.sub || '', apiOnly: i.apiOnly, sa: i.role === 'app' ? 'app' : '' }, r.x, r.y, r.w, r.h, [{ id: 'app', email: `${AW.app}-${AW.envs[0] ? AW.envs[0].name : 'dev'}-app` }]);
    g.setAttribute('data-node', n.id);
    g.style.cursor = CV.mode === 'connect' ? 'crosshair' : 'grab';
    crd.append(g);
    if (sel('node', n.id) || (CV.from === n.id && !exporting)) crd.append(sv('rect', { x: r.x - 3, y: r.y - 3, width: r.w + 6, height: r.h + 6, rx: 15, fill: 'none', style: `stroke:${CV.from === n.id ? 'var(--warn)' : 'var(--accent2)'}`, 'stroke-width': 2.5, 'stroke-dasharray': CV.from === n.id ? '5 3' : '', 'pointer-events': 'none' }));
  }
  // empty canvas hint
  if (!exporting && !d.vpcs.length && !d.nodes.length) lab.append(sv('text', { x: L.W / 2, y: L.H / 2, 'text-anchor': 'middle', style: 'font-size:15px;fill:var(--dim)' }, 'Drag icons from the left onto the canvas. Start with a VPC network.'));
  // title for exports
  if (exporting) lab.append(sv('text', { x: vb.x + 24, y: vb.y + 34, style: 'font-size:18px;font-weight:700;fill:var(--fg)' }, `${AW.app} · ${AW.envs[0] ? AW.envs[0].name : 'dev'} · Google Cloud`), sv('text', { x: vb.x + 24, y: vb.y + 54, style: 'font-size:11px;fill:var(--dim)' }, 'Logical architecture · created with Nativity Studio'));
  return svg;
}

function cvRender() {
  if (!CV.wrap) return;
  CV.svg = cvBuild(false);
  CV.wrap.replaceChildren(CV.svg);
  cvRenderSide();
}

/* ------------------------------ mouse ------------------------------ */

function cvPoint(ev) {
  const svg = CV.svg;
  const r = svg.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / CV.zoom, y: (ev.clientY - r.top) / CV.zoom };
}

function cvWire() {
  const w = CV.wrap;
  // dropping a palette icon
  w.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  w.ondrop = (e) => {
    e.preventDefault();
    const type = (e.dataTransfer.getData('text/plain') || '').replace(/^cv:/, '');
    if (!type) return;
    const p = cvPoint(e);
    cvAdd(type, cvTargetAt(p), p);
  };
  w.onmousedown = (e) => {
    const p = cvPoint(e);
    const nodeEl = e.target.closest('[data-node]');
    const edgeEl = e.target.closest('[data-edge]');
    const subEl = e.target.closest('[data-subnet]');
    const vpcEl = e.target.closest('[data-vpc]');
    w.focus();
    if (nodeEl) {
      const id = nodeEl.getAttribute('data-node');
      if (CV.mode === 'connect') {
        if (!CV.from) { CV.from = id; cvMessage(`Now click the service that ${cvInfo(cvNode(id).type).name} connects to.`); } else { const f = CV.from; CV.from = null; cvMessage(''); cvConnect(f, id); }
        return cvRender();
      }
      CV.sel = { kind: 'node', id };
      CV.drag = { kind: 'node', id, start: p, moved: false };
      return cvRender();
    }
    if (edgeEl) { CV.sel = { kind: 'edge', id: edgeEl.getAttribute('data-edge') }; return cvRender(); }
    if (subEl) { CV.sel = { kind: 'subnet', id: subEl.getAttribute('data-subnet') }; return cvRender(); }
    if (vpcEl) { const vid = vpcEl.getAttribute('data-vpc'); CV.sel = { kind: 'vpc', id: vid }; CV.drag = { kind: 'vpc', id: vid, start: p, from: { ...cvVpc(vid) }, moved: false }; return cvRender(); }
    CV.sel = null; CV.from = null;
    cvRender();
  };
  w.onmousemove = (e) => {
    const d = CV.drag;
    if (!d) return;
    const p = cvPoint(e);
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 4) return;
    d.moved = true;
    if (d.kind === 'vpc') { const v = cvVpc(d.id); v.x = Math.max(10, d.from.x + p.x - d.start.x); v.y = Math.max(10, d.from.y + p.y - d.start.y); return cvRender(); }
    // a ghost of the card follows the pointer
    cvRender();
    CV.svg.append(sv('g', { opacity: 0.7, 'pointer-events': 'none' }, dgCard({ kind: cvInfo(cvNode(d.id).type).kind, label: cvInfo(cvNode(d.id).type).name, sub: '' }, p.x - CV_CW / 2, p.y - CV_CH / 2, CV_CW, CV_CH, [])));
  };
  w.onmouseup = (e) => {
    const d = CV.drag;
    CV.drag = null;
    if (!d || !d.moved) return;
    if (d.kind === 'vpc') return cvChanged();
    const p = cvPoint(e);
    cvMove(d.id, cvTargetAt(p), p);
  };
  w.onmouseleave = () => { if (CV.drag && CV.drag.kind === 'node') { CV.drag = null; cvRender(); } };
  w.tabIndex = 0;
  w.onkeydown = (e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && CV.sel) { e.preventDefault(); cvRemoveAsk(); } if (e.key === 'Escape') { CV.from = null; CV.sel = null; cvMode('select'); } };
}

async function cvRemoveAsk() {
  const s = CV.sel;
  if (!s) return;
  cvRemove(s, false);
}

function cvMode(m) { CV.mode = m; CV.from = null; cvMessage(m === 'connect' ? 'Click the service a connection starts from, then the one it goes to.' : ''); cvRender(); cvRenderTools(); }

/* ------------------------------ palette, toolbar, side panel ------------------------------ */

function cvPaletteItem(type, label, glyphKind, color) {
  const it = h('div', { class: 'cv-item', draggable: 'true', title: `${label}: drag onto the canvas, or double-click`, 'data-type': type },
    h('span', { class: 'cv-ico', style: `background:${color || DG_KIND[glyphKind] || '#5f6368'}` }, awGlyph(glyphKind)), h('span', { class: 'cv-lbl', text: label }));
  it.ondragstart = (e) => { e.dataTransfer.setData('text/plain', `cv:${type}`); e.dataTransfer.effectAllowed = 'copy'; };
  // double-click: put it where it belongs (first suitable subnet, or free space)
  it.ondblclick = () => cvQuickAdd(type);
  return it;
}

function cvQuickAdd(type) {
  const i = cvInfo(type);
  const L = cvLayout();
  const vid = (CV.sel && CV.sel.kind === 'vpc' && CV.sel.id) || (CV.doc.vpcs[0] || {}).id;
  const rightEdge = Math.max(360, ...Object.values(L.vpcs).map((r) => r.x + r.w));
  let target = { kind: 'canvas' };
  let p = { x: 60 + CV_CW / 2, y: 120 + CV.doc.nodes.filter((n) => n.loc && n.loc.x != null).length * (CV_CH + CV_GAP) + CV_CH / 2 };
  if (i && i.role === 'managed') p = { x: rightEdge + 100 + CV_CW / 2, y: 100 + CV.doc.nodes.filter((n) => (cvInfo(n.type) || {}).role === 'managed').length * (CV_CH + CV_GAP) + CV_CH / 2 };
  if (type === 'vpc') p = { x: 480 + CV.doc.vpcs.length * 340, y: 80 };
  if (type === 'subnet-app' || type === 'subnet-data') target = vid ? { kind: 'vpc', id: vid } : { kind: 'canvas' };
  if (i && ['app', 'data'].includes(i.role) && CV.doc.vpcs.length) {
    const want = i.role === 'app' ? 'app' : 'data';
    const sn = CV.doc.subnets.find((x) => x.kind === want && !cvRule(type, { kind: 'subnet', id: x.id })) || CV.doc.subnets.find((x) => x.kind === want);
    target = sn ? { kind: 'subnet', id: sn.id } : { kind: 'canvas' };
  }
  if (i && i.role === 'psa' && vid) target = { kind: 'vpc', id: vid };
  cvAdd(type, target, p);
}

function cvPalette() {
  const cat = AW.catalog;
  const box = h('div', { class: 'cv-palette' });
  const gcp = serviceLogoUrl('gcp');
  box.append(h('div', { class: 'cv-phead' }, gcp ? h('img', { src: gcp, width: 22, height: 22, alt: 'Google Cloud' }) : null, h('b', { text: 'Google Cloud' })),
    h('div', { class: 'cv-hint', text: 'Drag onto the canvas, or double-click.' }),
    (() => { const q = h('input', { class: 'cv-search', placeholder: 'Search icons', spellcheck: 'false' }); q.oninput = () => { const t = q.value.trim().toLowerCase(); box.querySelectorAll('.cv-item').forEach((el) => { el.style.display = !t || el.textContent.toLowerCase().includes(t) ? '' : 'none'; }); }; return q; })());
  const sec = (title, items) => { if (items.length) box.append(h('div', { class: 'cv-sec', text: title }), ...items); };
  sec('Network', [cvPaletteItem('vpc', 'VPC network', 'custom', '#34a853'), cvPaletteItem('subnet-app', 'Private subnet · application', 'custom', '#4285f4'), cvPaletteItem('subnet-data', 'Private subnet · database', 'custom', '#0f9d58')]);
  sec('Entry', [cvPaletteItem('users', 'Users and clients', 'users', DG_KIND.users)]);
  for (const [k, label] of cat.categories) sec(label, cat.services.filter((s) => s.cat === k).map((s) => cvPaletteItem(s.id, s.name, s.id)));
  box.append(h('button', { class: 'wide', text: '＋ Add any Google Cloud service…', onclick: awAddServiceDialog }));
  if (AW.custom.length) sec('Added by you', AW.custom.map((c) => cvPaletteItem(cvCustomId(c), c.name, 'custom')));
  return box;
}

function cvRenderTools() {
  const t = document.getElementById('cv-tools');
  if (!t) return;
  const btn = (text, on, fn, title) => h('button', { class: on ? 'on' : '', text, title: title || '', onclick: fn });
  t.replaceChildren(
    btn('↖ Select', CV.mode === 'select', () => cvMode('select'), 'Select and move'),
    btn('⇢ Connect', CV.mode === 'connect', () => cvMode('connect'), 'Click one service, then another'),
    btn('🗑 Delete', false, () => (CV.sel ? cvRemove(CV.sel, false) : cvMessage('Select something first.', true)), 'Delete the selection (or press Delete)'),
    h('span', { class: 'cv-sep' }),
    h('select', { title: 'Start from a ready-made architecture', onchange: (e) => { const v = e.target.value; e.target.value = ''; if (v) awLoadPreset(v); } }, h('option', { value: '', text: 'Start from…' }), ...AW.catalog.presets.map((p) => h('option', { value: p.id, text: p.name })), h('option', { value: 'blank', text: 'Blank canvas' })),
    btn('✎ Describe…', false, awDescribeDialog, 'Write sentences; the connections are drawn for you'),
    h('span', { class: 'spacer' }),
    btn('−', false, () => { CV.zoom = Math.max(0.4, CV.zoom - 0.1); cvRender(); }), h('span', { class: 't-dim', text: `${Math.round(CV.zoom * 100)}%` }), btn('+', false, () => { CV.zoom = Math.min(1.6, CV.zoom + 0.1); cvRender(); }),
    btn('Fit', false, () => { const L = cvLayout(); const w = (CV.wrap && CV.wrap.clientWidth) || 1000; CV.zoom = Math.max(0.4, Math.min(1.2, (w - 24) / L.W)); cvRender(); cvRenderTools(); }),
    h('span', { class: 'cv-sep' }),
    h('select', { title: 'Export the picture', onchange: (e) => { const v = e.target.value; e.target.value = ''; if (v) cvExport(v); } }, h('option', { value: '', text: '⬇ Export…' }), h('option', { value: 'png', text: 'PNG image' }), h('option', { value: 'jpg', text: 'JPG image' }), h('option', { value: 'svg', text: 'SVG (editable)' })));
}

/** Problems and the selected connection, under the canvas. */
function cvRenderSide() {
  const el = document.getElementById('cv-side');
  if (!el) return;
  const probs = cvProblems();
  const sel = CV.sel && CV.sel.kind === 'edge' ? CV.doc.edges.find((e) => e.id === CV.sel.id) : null;
  el.replaceChildren(...[
    h('div', { id: 'cv-msg', class: `cv-msg${CV.msg && CV.msg.err ? ' err' : ''}`, text: CV.msg ? CV.msg.text : '' }),
    sel ? h('div', { class: 'cv-edge' }, h('span', { class: 't-dim', text: `${(cvInfo(sel.from) || {}).name} → ${(cvInfo(sel.to) || {}).name}` }),
      (() => { const i = h('input', { value: sel.label, placeholder: 'label (optional)', maxlength: 30 }); i.onchange = () => { sel.label = i.value.trim(); cvChanged(); }; return i; })(), h('button', { text: 'Remove connection', onclick: () => cvRemove(CV.sel) })) : null,
    ...probs.map((p) => h('div', { class: `cv-prob ${p.level}` }, h('span', { text: p.level === 'error' ? '⛔' : p.level === 'tip' ? 'ℹ' : '⚠' }), h('span', { text: p.text }), p.fix ? h('button', { text: 'Add it', onclick: () => cvQuickAdd(p.fix) }) : null)),
    !probs.length ? h('div', { class: 'cv-prob ok' }, h('span', { text: '✔' }), h('span', { text: 'The architecture follows the rules: every application service and database is in a private subnet of a VPC.' })) : null].filter(Boolean));
}

/** The whole design view: palette, toolbar, canvas, problems. */
function cvView() {
  if (!CV.doc) CV.doc = cvEmpty();
  const view = h('div', { class: 'cv-view' }, cvPalette(), h('div', { class: 'cv-main' }, h('div', { id: 'cv-tools', class: 'cv-tools' }), h('div', { class: 'cv-wrap', id: 'cv-wrap' }), h('div', { id: 'cv-side', class: 'cv-side' })));
  CV.wrap = view.querySelector('#cv-wrap');
  setTimeout(() => { cvWire(); cvRender(); const L = cvLayout(); const w = (CV.wrap && CV.wrap.clientWidth) || 1000; CV.zoom = Math.max(0.5, Math.min(1, (w - 24) / L.W)); cvRender(); cvRenderTools(); }, 0);
  return view;
}

/* ------------------------------ presets and the spec ------------------------------ */

/** A document from a list of services, arranged the way the rules require (needs the architecture builder's suggestion for connections). */
function cvFromModel(m) {
  const doc = cvEmpty();
  doc.vpcs = [{ id: 'v1', x: 330, y: 70 }];
  const subFor = new Map();
  const mk = (kind) => { const sn = { id: `s${doc.next++}`, kind, vpc: 'v1' }; doc.subnets.push(sn); return sn; };
  let yU = 120;
  let yG = 70;
  for (const n of m.nodes) {
    if (n.id === 'ops') continue;
    if (n.zone === 'outside') { doc.nodes.push({ id: n.id, type: n.id, loc: { x: 30, y: yU } }); yU += CV_CH + CV_GAP + 20; continue; }
    if (n.zone === 'edge') { doc.nodes.push({ id: n.id, type: n.id, loc: { x: 30, y: yU } }); yU += CV_CH + CV_GAP + 20; continue; }
    if (n.zone === 'gke' || n.zone === 'run' || String(n.zone).startsWith('svc:')) { if (!subFor.has(n.zone)) subFor.set(n.zone, mk('app')); doc.nodes.push({ id: n.id, type: n.id, loc: { subnet: subFor.get(n.zone).id } }); continue; }
    if (n.zone === 'data') { if (!subFor.has('data')) subFor.set('data', mk('data')); doc.nodes.push({ id: n.id, type: n.id, loc: { subnet: subFor.get('data').id } }); continue; }
    if (n.zone === 'psa') { doc.nodes.push({ id: n.id, type: n.id, loc: { vpc: 'v1' } }); continue; }
    doc.nodes.push({ id: n.id, type: n.id, loc: { x: 760, y: yG } }); yG += CV_CH + CV_GAP;
  }
  for (const e of m.suggestedEdges || []) if (e.to !== 'ops') doc.edges.push({ id: `e${doc.next++}`, from: e.from, to: e.to, label: e.label || '' });
  return doc;
}

/** What the backend needs from the canvas. */
function cvSpecParts() {
  const d = CV.doc || cvEmpty();
  const known = new Set(AW.catalog.services.map((s) => s.id));
  const customIds = new Set(AW.custom.map(cvCustomId));
  return {
    services: d.nodes.map((n) => n.type).filter((t) => known.has(t)),
    custom: AW.custom.filter((c) => d.nodes.some((n) => n.type === cvCustomId(c))),
    edges: d.edges.filter((e) => cvNode(e.from) && cvNode(e.to)).map((e) => ({ from: e.from, to: e.to, label: e.label })),
    design: { vpcs: d.vpcs.map((v) => ({ id: v.id })), subnets: d.subnets.map((x) => ({ id: x.id, kind: x.kind, vpc: x.vpc })), nodes: d.nodes.map((n) => ({ type: n.type, subnet: (n.loc && n.loc.subnet) || null, vpc: (n.loc && n.loc.vpc) || null })) },
    customIds,
  };
}

/** After a preview: the CIDR of each subnet, for the labels. */
function cvSetInfo(model) {
  if (!model) return;
  const info = { byVpc: {}, subnetCidr: {} };
  CV.doc.vpcs.forEach((v, k) => {
    const mv = (model.vpcs || [])[k];
    if (!mv) return;
    info.byVpc[v.id] = { cidr: mv.cidr, psa: mv.psa ? mv.psa.cidr : '' };
    const byZone = {};
    for (const x of mv.subnets) byZone[x.id] = x.cidr;
    for (const x of CV.doc.subnets.filter((y) => y.vpc === v.id)) {
      const inside = cvIn(x.id).map((n) => cvInfo(n.type)).filter(Boolean);
      const zone = inside.length ? inside[0].zone : '';
      if (byZone[zone]) info.subnetCidr[x.id] = byZone[zone];
    }
  });
  CV.info = info;
}

/* ------------------------------ export ------------------------------ */

async function cvExport(format) {
  if (!CV.doc || (!CV.doc.vpcs.length && !CV.doc.nodes.length)) return cvMessage('The canvas is empty: nothing to export.', true);
  try {
    const css = getComputedStyle(document.documentElement);
    const svg = cvBuild(true);
    const L = CV.layout;
    // a self-contained picture: theme colours resolved, logos embedded
    for (const img of svg.querySelectorAll('image[data-logo]')) {
      const u = new URL(img.getAttribute('data-logo'), location.href);
      const file = decodeURIComponent(u.pathname).replace(/^\/([A-Za-z]:)/, '$1');
      try { img.setAttribute('href', `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(await inv('fs:readFile', file))))}`); } catch { /* left out */ }
    }
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const V = L.view;
    svg.setAttribute('width', V.w);
    svg.setAttribute('height', V.h);
    svg.querySelector('.cv-bg').setAttribute('style', `fill:${css.getPropertyValue('--bg').trim() || '#0e0f0c'}`);
    // theme variables become plain colours and fonts, written into the attributes before the file is made (a font name has quotes in it)
    const resolve = (v) => String(v).replace(/var\((--[\w-]+)\)/g, (_m, name) => (css.getPropertyValue(name).trim() || '#888').replace(/"/g, "'"));
    for (const el of [svg, ...svg.querySelectorAll('*')]) for (const attr of ['style', 'fill', 'stroke']) { const v = el.getAttribute(attr); if (v && v.includes('var(')) el.setAttribute(attr, resolve(v)); }
    const text = new XMLSerializer().serializeToString(svg);
    const dir = joinPath(state.workspace, 'docs');
    await inv('fs:create', dir, true).catch(() => {});
    const file = joinPath(dir, `${AW.app}-architecture.${format}`);
    if (format === 'svg') await inv('fs:writeFile', file, text);
    else {
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('The picture could not be rendered.')); img.src = url; });
      const scale = 2;
      const cv = document.createElement('canvas');
      cv.width = V.w * scale; cv.height = V.h * scale;
      const g = cv.getContext('2d');
      g.fillStyle = format === 'jpg' ? (css.getPropertyValue('--bg').trim() || '#0e0f0c') : 'rgba(0,0,0,0)';
      if (format === 'jpg') g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(img, 0, 0, cv.width, cv.height);
      const data = cv.toDataURL(format === 'jpg' ? 'image/jpeg' : 'image/png', 0.92).split(',')[1];
      await inv('fs:writeImage', file, data);
    }
    cvMessage(`Saved ${file}`);
    if (typeof refreshTree === 'function') refreshTree();
    return file;
  } catch (e) { cvMessage(e.message, true); return null; }
}
