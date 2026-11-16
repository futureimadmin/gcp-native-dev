/* Cloud Native Architecture page: choose environments, see the architecture of every connected cloud, review the plan, Provision.
   The cloud plugins describe the architecture and build the steps (main process); this page draws it and runs the plan with live progress. */
'use strict';

const LD = { app: '', envs: [], clouds: {}, plan: null, planErr: '', planning: false, seq: 0, tab: '', disc: {}, run: null, timer: null, el: null, tabState: null };
const ENV_NAME = /^[a-z][a-z0-9]{0,11}$/;
const APP_NAME = /^[a-z][a-z0-9-]{1,19}[a-z0-9]$/;
const ENV_PRESETS = [
  ['4 environments', ['dev', 'sit', 'uat', 'prod']], ['3 environments', ['dev', 'test', 'prod']], ['2 environments', ['dev', 'prod']], ['Just dev', ['dev']],
];
const connectedClouds = () => state.clouds.filter((c) => cloudSignedIn(c.id) && c.hasProvision !== false);
const envList = () => (state.proj && state.proj.envs && state.proj.envs.length ? state.proj.envs.map((e) => e.name) : ENVS);
const isProtectedEnv = (name) => !!(state.proj && state.proj.envs && state.proj.envs.find((e) => e.name === name && e.protected)) || (name === 'prod' && !(state.proj && state.proj.envs));

/* ------------------------------ entering Cloud Native mode ------------------------------ */

let pendingEnable = false;
let connectClose = null;

/** "Enable Cloud Native Development": needs at least one connected cloud, then shows the architecture of every connected cloud. */
async function enableMode() {
  if (!state.workspace) return status('Open a folder first.', true);
  if (!state.clouds.some((c) => cloudSignedIn(c.id))) await refreshAllClouds(); // statuses may still be loading at start-up
  const live = connectedClouds();
  if (!live.length) return connectCloudDialog();
  const cur = (state.proj || PROJ_DEFAULT).cloud;
  try { await saveProject({ enabled: true, cloud: live.some((c) => c.id === cur) ? cur : live[0].id }); } catch { return; }
  renderHome();
  if (live.length === 1 && live[0].id === 'gcp') { status('Cloud Native Development enabled. Set up your Google Cloud environments with the wizard.'); return openGcpWizard(); }
  status('Cloud Native Development enabled. Review the architecture, then Provision.');
  openLanding();
}

function connectCloudDialog() {
  pendingEnable = true;
  const rows = state.clouds.map((c) => {
    const s = state.cloudStatus[c.id] || {};
    return h('div', { class: 'card slim' }, h('span', { class: `dot ${s.signedIn ? 'ok' : 'off'}` }), h('b', { text: c.name }), h('small', { class: 't-dim', text: s.signedIn ? 'connected' : (s.installed === false ? `${c.name} CLI not installed` : 'not connected') }), h('span', { class: 'spacer' }),
      s.signedIn ? null : (s.installed === false ? h('button', { text: 'Get the CLI', onclick: () => inv('shell:openExternal', c.installUrl).catch(() => {}) }) : h('button', { class: 'primary', text: c.kind === 'private' ? 'Connect…' : 'Sign in', onclick: () => cloudLogin(c.id) })));
  });
  connectClose = modal('Connect to a cloud first', h('div', {},
    h('p', { text: 'Cloud Native Development builds your Dev, Test and Production environments inside the clouds you use. Connect to at least one cloud, and the architecture for each connected cloud will appear here.' }),
    ...rows, h('p', { class: 'hint', text: 'This window continues by itself as soon as a sign-in completes.' })), [
    h('button', { text: 'Check again', onclick: async () => { await refreshAllClouds(); if (connectedClouds().length) { connectClose(); pendingEnable = false; enableMode(); } else status('Still not connected to any cloud.', true); } }),
    h('button', { text: 'Not now', onclick: () => { pendingEnable = false; connectClose(); } }),
  ], { wide: true });
}

CNS.on('cloud-status', () => {
  if (pendingEnable && connectedClouds().length) { pendingEnable = false; if (connectClose) connectClose(); enableMode(); }
});

/* ------------------------------ the page ------------------------------ */

function openLanding() {
  if (!state.workspace) return status('Open a folder first.', true);
  const t = openPage({ id: 'landing', title: 'Cloud Native Architecture', icon: '🏗', pad: true, build(el) { LD.el = el; }, onClose() { LD.el = null; } });
  initLanding();
  return t;
}

function initLanding() {
  const p = state.proj || PROJ_DEFAULT;
  LD.app = LD.app || p.service || sanitizeApp(baseName(state.workspace));
  if (!LD.envs.length) LD.envs = (p.envs && p.envs.length ? p.envs : ['dev', 'sit', 'uat', 'prod'].map((n) => ({ name: n, protected: n === 'prod' }))).map((e) => ({ name: e.name, protected: !!e.protected }));
  for (const c of connectedClouds()) if (!LD.clouds[c.id]) LD.clouds[c.id] = { enabled: true, region: (p.cloud === c.id && p.region) || c.defaultRegion, options: {} };
  for (const id of Object.keys(LD.clouds)) if (!connectedClouds().some((c) => c.id === id)) delete LD.clouds[id];
  if (!LD.tab || !LD.clouds[LD.tab]) LD.tab = Object.keys(LD.clouds)[0] || '';
  LD.plan = null; LD.planErr = '';
  drawLanding();
  for (const id of Object.keys(LD.clouds)) tryInv('prov:discover', id, false).then((r) => { if (r.ok) { LD.disc[id] = r.data; if (!LD.run) drawLanding(); } });
  schedulePlan(50);
}

const sanitizeApp = (n) => (String(n).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '') || 'app').slice(0, 20).replace(/-+$/, '');

function specNow() {
  const clouds = {};
  for (const [id, c] of Object.entries(LD.clouds)) if (id !== 'gcp') clouds[id] = { enabled: c.enabled, region: c.region, options: c.options }; // Google Cloud has its own wizard
  return { app: LD.app, envs: LD.envs, clouds };
}

function schedulePlan(ms) {
  clearTimeout(LD.timer);
  LD.timer = setTimeout(async () => {
    if (LD.run && !LD.run.done) return;
    if (!Object.entries(LD.clouds).some(([id, c]) => id !== 'gcp' && c.enabled)) { LD.plan = null; LD.planning = false; LD.planErr = Object.keys(LD.clouds).includes('gcp') ? 'Google Cloud is set up with its own wizard. Connect another cloud to provision it here.' : 'Select a cloud to plan.'; drawLanding(); return; }
    const my = ++LD.seq;
    LD.planning = true; LD.planErr = '';
    drawLanding();
    const r = await tryInv('prov:plan', state.workspace, specNow());
    if (my !== LD.seq) return;
    LD.planning = false;
    if (r.ok) LD.plan = r.data; else { LD.plan = null; LD.planErr = r.error; }
    drawLanding();
  }, ms == null ? 600 : ms);
}

/* ---- environment editor ---- */

function envEditor() {
  const names = LD.envs.map((e) => e.name);
  const chips = LD.envs.map((e, i) => {
    const bad = !ENV_NAME.test(e.name) || names.indexOf(e.name) !== i;
    const input = h('input', { value: e.name, class: `envname${bad ? ' bad' : ''}`, spellcheck: 'false', maxlength: 12, title: 'Lower-case letters and digits, starting with a letter, up to 12 (for example dev, qa, staging, prod)' });
    input.onchange = () => { e.name = input.value.trim().toLowerCase(); if (e.name === 'prod') e.protected = true; drawLanding(); schedulePlan(); };
    const prot = h('input', { type: 'checkbox', checked: e.protected });
    prot.onchange = () => { e.protected = prot.checked; schedulePlan(); drawLanding(); };
    return h('div', { class: `envchip${e.protected ? ' prot' : ''}` }, input, h('label', { class: 'inline small', title: 'Production-like: stricter protection, read-only access for you, typed confirmation before provisioning' }, prot, ' protected'),
      LD.envs.length > 1 ? h('button', { class: 'subtle', text: '✕', title: 'Remove', onclick: () => { LD.envs.splice(i, 1); drawLanding(); schedulePlan(); } }) : null);
  });
  return h('div', { class: 'card' },
    h('div', { class: 'cardh' }, h('b', { text: '1. Environments' }), h('small', { class: 't-dim', text: 'Use as many as you need and name them as you like.' })),
    h('div', { class: 'row wrap' }, h('span', { class: 't-dim', text: 'Quick choice:' }), ...ENV_PRESETS.map(([label, list]) => h('button', { text: `${label} (${list.join(', ')})`, onclick: () => { LD.envs = list.map((n) => ({ name: n, protected: n === 'prod' })); drawLanding(); schedulePlan(); } }))),
    h('div', { class: 'envs' }, ...chips, LD.envs.length < 8 ? h('button', { class: 'primary', text: '+ Add environment', onclick: () => { let k = LD.envs.length + 1; let n = `env${k}`; while (names.includes(n)) n = `env${++k}`; LD.envs.push({ name: n, protected: false }); drawLanding(); schedulePlan(); } }) : null));
}

/* ---- diagram ---- */

const SVGNS = 'http://www.w3.org/2000/svg';
function S(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
function wrapText(s, n) {
  const lines = [];
  let cur = '';
  for (const w of String(s).split(' ')) { if (cur && (`${cur} ${w}`).length > n) { lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
  if (cur) lines.push(cur);
  return lines;
}

const BOX_W = 236; const LINE = 14; const GAP_X = 24; const GAP_Y = 44;

function measureNode(n) {
  n._head = wrapText(n.label, 30);
  n._sub = n.sub ? wrapText(n.sub, 36) : [];
  n._items = [];
  for (const it of n.items || []) n._items.push(...wrapText(`• ${it}`, 36).map((l, i) => (i ? `  ${l}` : l)));
  n._w = BOX_W;
  n._h = 16 + n._head.length * 16 + n._sub.length * LINE + (n._items.length ? 8 : 0) + n._items.length * LINE + 12;
  for (const c of n.children || []) measureNode(c);
}
function subtreeWidth(n) {
  const kids = n.children || [];
  n._sw = kids.length ? Math.max(n._w, kids.reduce((a, c) => a + subtreeWidth(c), 0) + GAP_X * (kids.length - 1)) : n._w;
  return n._sw;
}
function rowHeights(n, d, rows) { rows[d] = Math.max(rows[d] || 0, n._h); for (const c of n.children || []) rowHeights(c, d + 1, rows); }
function placeNode(n, left, d, tops) {
  n._x = left + (n._sw - n._w) / 2; n._y = tops[d];
  const kids = n.children || [];
  const total = kids.reduce((a, c) => a + c._sw, 0) + GAP_X * Math.max(0, kids.length - 1);
  let x = left + (n._sw - total) / 2;
  for (const c of kids) { placeNode(c, x, d + 1, tops); x += c._sw + GAP_X; }
}

function drawArchitecture(arch, color) {
  const root = JSON.parse(JSON.stringify(arch.root));
  measureNode(root); subtreeWidth(root);
  const rows = []; rowHeights(root, 0, rows);
  const tops = []; let y = 14;
  rows.forEach((hh, i) => { tops[i] = y; y += hh + GAP_Y; });
  placeNode(root, 14, 0, tops);
  const width = root._sw + 28; const height = y - GAP_Y + 18;
  const edges = []; const boxes = [];
  const walk = (n) => {
    const cx = n._x + n._w / 2;
    for (const c of n.children || []) {
      const ccx = c._x + c._w / 2; const my = n._y + rows[tops.indexOf(n._y)] + GAP_Y / 2;
      edges.push(S('path', { d: `M${cx} ${n._y + n._h} V${my} H${ccx} V${c._y}`, class: 'a-edge' }));
      walk(c);
    }
    const kindClass = `a-${n.kind || 'group'}`;
    const g = S('g', { transform: `translate(${n._x},${n._y})`, class: `a-node ${kindClass}${n.protected ? ' a-prot' : ''}`, style: `--cc:${color}` });
    g.append(S('rect', { width: n._w, height: n._h, rx: 9, class: 'a-box' }));
    let ty = 20;
    for (const l of n._head) { g.append(S('text', { x: 12, y: ty, class: 'a-head' }, l)); ty += 16; }
    for (const l of n._sub) { g.append(S('text', { x: 12, y: ty - 2, class: 'a-sub' }, l)); ty += LINE; }
    if (n._items.length) ty += 4;
    for (const l of n._items) { g.append(S('text', { x: 12, y: ty, class: 'a-item' }, l)); ty += LINE; }
    g.append(S('text', { x: n._w - 10, y: 14, class: `a-badge ${n.status === 'exists' ? 'ex' : 'nw'}`, 'text-anchor': 'end' }, n.status === 'exists' ? 'EXISTS' : n.status === 'new' ? 'NEW' : ''));
    if (n.protected) g.append(S('text', { x: n._w - 10, y: n._h - 6, class: 'a-lock', 'text-anchor': 'end' }, 'PROTECTED'));
    boxes.push(g);
  };
  walk(root);
  return S('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'arch', role: 'img', 'aria-label': arch.title }, ...edges, ...boxes);
}

/* ---- per-cloud panels ---- */

function cloudOptions(c) {
  const st = LD.clouds[c.id];
  const d = LD.disc[c.id];
  const wrap = h('div', { class: 'opts' });
  const regions = c.regions && c.regions.length > 1 ? h('select', { onchange: (e) => { st.region = e.target.value; schedulePlan(); } }, c.regions.map((r) => h('option', { value: r, text: r, selected: r === st.region }))) : null;
  if (regions) wrap.append(h('label', { text: 'Region' }), regions);
  if (c.id === 'gcp') {
    if (!d) wrap.append(h('div', { class: 'hint', text: 'Looking up your organizations and billing accounts…' }));
    else {
      const o = st.options;
      const orgSel = h('select', { onchange: (e) => { o.orgId = e.target.value === 'flat' ? '' : e.target.value; o.mode = e.target.value === 'flat' ? 'flat' : 'folders'; schedulePlan(); } },
        ...d.orgs.map((x) => h('option', { value: x.id, text: `Folders in ${x.name}`, selected: o.mode !== 'flat' && (o.orgId || d.orgs[0].id) === x.id })),
        h('option', { value: 'flat', text: d.orgs.length ? 'No folders: projects side by side' : 'No organization found: projects side by side', selected: o.mode === 'flat' || !d.orgs.length }));
      const billSel = h('select', { onchange: (e) => { o.billingId = e.target.value; schedulePlan(); } }, d.billing.length ? d.billing.map((x) => h('option', { value: x.id, text: `${x.name} (${x.id})`, selected: (o.billingId || d.billing[0].id) === x.id })) : [h('option', { value: '', text: d.billingDenied ? 'Cannot list billing accounts (no permission)' : 'No billing account found' })]);
      wrap.append(h('label', { text: 'Where the environments go' }), orgSel, h('label', { text: 'Billing account for new projects' }), billSel);
      const adv = h('details', { class: 'adv-opts' }, h('summary', { text: 'Use an existing project for an environment (optional)' }),
        ...LD.envs.map((e) => { const inp = h('input', { placeholder: `existing project id for ${e.name} (leave empty to create one)`, value: (o.existing || {})[e.name] || '', spellcheck: 'false' }); inp.onchange = () => { o.existing = { ...(o.existing || {}), [e.name]: inp.value.trim() }; if (!inp.value.trim()) delete o.existing[e.name]; schedulePlan(); }; return h('div', { class: 'row' }, h('span', { class: 'envtag', text: e.name }), inp); }));
      wrap.append(adv);
    }
  }
  return wrap;
}

/** Google Cloud: organisation landing zone + applications, in its own wizard. */
function gcpCard(c) {
  const land = (state.proj && state.proj.landing && state.proj.landing.gcp) || null;
  const apps = Object.entries((state.proj && state.proj.apps) || {});
  return h('div', { class: 'card cloudpanel', style: `--cc:${c.color || '#4285f4'}` },
    h('div', { class: 'cardh' }, h('b', { text: 'Google Cloud' }), h('span', { class: 'spacer' }), h('button', { class: 'primary', text: land ? 'Open the set-up wizard' : 'Start the set-up wizard', onclick: () => openGcpWizard() })),
    h('p', { class: 'summary', text: 'In Google Cloud an environment is a folder. The wizard builds one landing zone for the whole organization: a Standard folder (dev, sit …) and a Compliant folder (uat, preprod, prod …), then creates a project with billing for each application in each environment folder, and associates your applications with them. It is done once per organization; later applications are just added.' }),
    land ? h('div', { class: 'kv' }, 'Organization: ', h('b', { text: land.org ? land.org.name : 'none (projects side by side)' }), `   ·   ${Object.keys(land.envFolders || {}).length || ''} environment folders`) : h('div', { class: 'hint', text: 'Not set up yet for this project.' }),
    apps.length ? h('table', { class: 'acc' }, ...apps.map(([n, a]) => h('tr', {}, h('td', { class: 'who', text: n }), h('td', { class: 't-dim', text: relOf(a.dir) || '.' }), h('td', { text: Object.entries((a.targets.gcp) || {}).map(([e, t]) => `${e}: ${t.scope}`).join('   ') })))) : null,
    apps.length ? h('div', { class: 'row' }, h('button', { text: 'Associate more applications…', onclick: () => openGcpWizard({ startAt: 3 }) })) : null);
}

function cloudPanel(c) {
  if (c.id === 'gcp') return gcpCard(c);
  const st = LD.clouds[c.id];
  const on = h('input', { type: 'checkbox', checked: st.enabled });
  on.onchange = () => { st.enabled = on.checked; drawLanding(); schedulePlan(120); };
  const head = h('div', { class: 'cardh' }, h('b', { text: `Provision in ${c.name}` }), h('span', { class: 'spacer' }), h('label', { class: 'inline' }, on, ' include'));
  const box = h('div', { class: 'card cloudpanel', style: `--cc:${c.color || '#888'}` }, head, cloudOptions(c));
  const pc = LD.plan && LD.plan.clouds.find((x) => x.id === c.id);
  if (!st.enabled) { box.append(h('div', { class: 'hint', text: 'Not included. Tick “include” to see the architecture and plan for this cloud.' })); return box; }
  if (LD.planning && !pc) { box.append(h('div', { class: 'hint', text: 'Working out the architecture…' })); return box; }
  if (LD.planErr && !pc) { box.append(h('div', { class: 'msg err', text: LD.planErr })); return box; }
  if (!pc) return box;
  const a = pc.architecture;
  box.append(
    h('h3', { text: a.title }), h('p', { class: 'summary', text: a.summary }),
    ...(pc.blockers || []).map((b) => h('div', { class: 'msg err', text: `⛔ ${b}` })), ...(pc.warnings || []).map((w) => h('div', { class: 'msg warn', text: `⚠ ${w}` })),
    h('div', { class: 'archwrap' }, drawArchitecture(a, c.color || '#4f7fc7')),
    h('div', { class: 'cols2' },
      h('div', {}, h('h4', { text: 'Who can do what' }), h('table', { class: 'acc' }, ...a.access.map((x) => h('tr', {}, h('td', { class: 'who', text: x.who }), h('td', { text: x.how }), h('td', { class: 't-dim', text: x.what }))))),
      h('div', {}, h('h4', { text: 'Why it is built this way' }), h('ul', {}, ...a.why.map((w) => h('li', { text: w }))),
        h('h4', { text: 'You need' }), h('ul', {}, ...(pc.prerequisites || []).map((w) => h('li', { text: w }))))),
    stepList(pc));
  return box;
}

function stepList(pc) {
  const byEnv = new Map();
  for (const s of pc.steps) { const k = (s.group === 'folders' ? 'folders · ' : s.group && s.group.startsWith('app:') ? `${s.group.slice(4)} · ` : s.group === 'shared' ? 'shared project · ' : '') + (s.env || (s.group ? '' : '(shared)') || '(organization)'); if (!byEnv.has(k)) byEnv.set(k, []); byEnv.get(k).push(s); }
  return h('details', { class: 'steps' }, h('summary', { text: `Show every step and command (${pc.steps.length})` }),
    ...[...byEnv.entries()].map(([env, list]) => h('div', { class: 'envsteps' }, h('div', { class: 'envtag', text: env }),
      ...list.map((s) => { const k = `${pc.id}|${s.id}`; const ss = (LD.ss || {})[k] || { status: 'pending', icon: '○', message: '' }; return h('div', { class: 'pstep', 'data-key': k }, h('span', { class: `st ${ss.status}`, text: ss.icon }), h('div', { class: 'sbody' }, h('div', { class: 'stitle', text: s.title }), h('code', { text: s.file ? `write ${s.file}` : s.display }), h('div', { class: 'smsg', text: ss.message }))); }))));
}

/* ---- page layout ---- */

function drawLanding() {
  const el = LD.el;
  if (!el) return;
  const live = connectedClouds();
  const appInput = h('input', { value: LD.app, spellcheck: 'false', class: APP_NAME.test(LD.app) ? '' : 'bad', maxlength: 21 });
  appInput.onchange = () => { LD.app = appInput.value.trim().toLowerCase(); drawLanding(); schedulePlan(); };
  const tabs = h('div', { class: 'ctabs' }, ...state.clouds.map((c) => {
    const connected = live.some((x) => x.id === c.id);
    return h('button', { class: `${LD.tab === c.id ? 'active' : ''}${connected ? '' : ' off'}`, style: `--cc:${c.color || '#888'}`, onclick: () => { LD.tab = c.id; drawLanding(); } },
      h('span', { class: `dot ${connected ? 'ok' : 'off'}` }), ` ${c.short || c.name}`, connected && LD.clouds[c.id] && !LD.clouds[c.id].enabled ? h('small', { text: ' (off)' }) : null);
  }));
  const current = state.clouds.find((c) => c.id === LD.tab);
  const body = !current ? h('div', { class: 'hint', text: 'No cloud selected.' })
    : LD.clouds[current.id] ? cloudPanel(current)
      : h('div', { class: 'card' }, h('b', { text: `${current.name} is not connected` }), h('p', { class: 'hint', text: 'Connect it to see its architecture and provision environments there.' }), h('button', { class: 'primary', text: current.kind === 'private' ? 'Connect…' : 'Sign in', onclick: () => cloudLogin(current.id) }));
  const ready = LD.plan && !LD.planning && LD.plan.clouds.every((c) => !(c.blockers || []).length) && !LD.planErr;
  const running = LD.run && !LD.run.done;
  const total = LD.plan ? LD.plan.totalSteps : 0;
  const names = LD.plan ? LD.plan.clouds.map((c) => c.short).join(' + ') : '';
  el.replaceChildren(
    h('div', { class: 'landing' },
      h('h2', { text: 'Cloud Native architecture' }),
      h('p', { class: 'hint', text: 'Pick the environments you want. Each connected cloud shows how they will be built there, using that cloud’s own best practice. Nothing is created until you press Provision.' }),
      h('div', { class: 'card' }, h('div', { class: 'cardh' }, h('b', { text: 'Application name' }), h('small', { class: 't-dim', text: 'Prefix of every project, stack, resource group and namespace' })), appInput),
      envEditor(),
      h('div', { class: 'cat bar', text: '2. Architecture per cloud' }), tabs, body,
      LD.run ? runPanel() : null,
      h('div', { class: 'provbar' },
        h('div', { class: 't-dim', text: LD.planning ? 'Updating the plan…' : (LD.planErr ? LD.planErr : (LD.plan ? `${LD.plan.envs.length} environment(s) in ${names}: ${total} steps` : 'Select a cloud to plan.')) }),
        h('span', { class: 'spacer' }),
        h('button', { text: 'Save a copy of the plan', disabled: !ready, onclick: savePlanDoc }),
        h('button', { class: 'primary big', text: running ? 'Provisioning…' : 'Provision', disabled: !ready || running, onclick: confirmProvision }))));
}

/* ------------------------------ provisioning ------------------------------ */

async function savePlanDoc() {
  if (!LD.plan) return;
  const lines = [`# Environment plan for ${LD.app}`, '', `Environments: ${LD.plan.envs.map((e) => e.name + (e.protected ? ' (protected)' : '')).join(', ')}`, ''];
  for (const c of LD.plan.clouds) {
    lines.push(`## ${c.name} (${c.region})`, '', c.architecture.summary, '');
    for (const w of c.architecture.why) lines.push(`- ${w}`);
    lines.push('', '### Steps', '');
    for (const s of c.steps) lines.push(`- ${s.env ? `[${s.env}] ` : ''}${s.title}`, `  \`${s.file ? `write ${s.file}` : s.display}\``);
    lines.push('');
  }
  const file = joinPath(state.workspace, `docs${BS}environments${BS}environment-plan.md`);
  await tryInv('fs:create', file, false);
  await inv('fs:writeFile', file, lines.join('\n'));
  await refreshTree();
  openAt(file, 1);
}

function confirmProvision() {
  const plan = LD.plan;
  if (!plan) return;
  const prot = plan.protectedEnvs;
  const typed = h('input', { placeholder: 'Type provision to continue' });
  const go = h('button', { class: 'primary', text: 'Provision now', disabled: prot.length > 0 });
  typed.oninput = () => (go.disabled = typed.value.trim() !== 'provision');
  const body = h('div', {},
    h('p', { text: `This creates ${plan.envs.length} environment(s) in ${plan.clouds.length} cloud(s). It runs ${plan.totalSteps} steps, one at a time. Steps for things that already exist are skipped, so it is safe to run again.` }),
    ...plan.clouds.map((c) => h('div', { class: 'kv' }, h('b', { text: c.short }), `  ${c.summary || ''}`)),
    h('p', { class: 'hint', text: 'Creating projects, registries and logs is normally free or very low cost while empty, but some resources bill by the hour once used. Remove an environment you no longer need.' }),
    prot.length ? h('p', { class: 'msg err', text: `Protected environment(s): ${prot.join(', ')}.` }) : null, prot.length ? typed : null);
  const close = modal('Provision environments', body, [h('button', { text: 'Cancel', onclick: () => close() }), Object.assign(go, { onclick: () => { close(); startProvision(typed.value.trim()); } })], { wide: true });
}

async function startProvision(typed) {
  const plan = LD.plan;
  const r = await tryInv('prov:run', plan.token, typed);
  if (!r.ok) return status(r.error, true);
  LD.ss = {};
  LD.run = { id: r.data.runId, done: false, results: [], failed: 0, steps: 0, ok: 0, error: '' };
  LD.plan.token = '';
  drawLanding();
  status('Provisioning started.');
}

function runPanel() {
  const r = LD.run;
  const total = LD.plan ? LD.plan.totalSteps : 0;
  const pct = total ? Math.round(((r.ok + r.failed) / total) * 100) : 0;
  return h('div', { class: 'card runcard' },
    h('div', { class: 'cardh' }, h('b', { text: r.done ? (r.failed || r.error ? 'Finished with problems' : 'Provisioning finished') : 'Provisioning…' }), h('span', { class: 'spacer' }),
      r.done ? null : h('button', { text: 'Stop after this step', onclick: () => tryInv('prov:cancel', r.id) })),
    h('div', { class: 'progress' }, h('div', { class: `bar${r.failed ? ' bad' : ''}`, style: `width:${pct}%` })),
    h('div', { class: 't-dim', text: `${r.ok + r.failed} of ${total} steps done${r.failed ? `, ${r.failed} failed` : ''}. Open “Show every step” in each cloud to follow along.` }),
    r.error ? h('div', { class: 'msg err', text: r.error }) : null,
    r.done ? h('div', { class: 'row' }, h('button', { class: 'primary', text: 'Back to editing', onclick: () => { LD.run = null; schedulePlan(50); drawLanding(); } }),
      h('button', { text: 'Open Clouds view', onclick: () => showView('clouds') })) : null);
}

cns.on('prov:event', (ev) => {
  const r = LD.run;
  if (!r || ev.runId !== r.id) return;
  if (ev.type === 'step') {
    LD.ss = LD.ss || {};
    LD.ss[`${ev.cloud}|${ev.step}`] = { status: ev.status, icon: { running: '⏳', ok: '✔', skipped: '↷', failed: '✘', warn: '⚠', pending: '○' }[ev.status] || '○', message: ev.message || '' };
    const row = document.querySelector(`.pstep[data-key="${CSS.escape(`${ev.cloud}|${ev.step}`)}"]`);
    if (row) {
      const icon = { running: '⏳', ok: '✔', skipped: '↷', failed: '✘', warn: '⚠', pending: '○' }[ev.status] || '○';
      const st = row.querySelector('.st'); st.textContent = icon; st.className = `st ${ev.status}`;
      row.querySelector('.smsg').textContent = ev.message || '';
      if (ev.status === 'failed' || ev.status === 'running') { const det = row.closest('details'); if (det) det.open = true; row.scrollIntoView({ block: 'nearest' }); }
    }
    if (ev.status === 'ok' || ev.status === 'skipped' || ev.status === 'warn') r.ok++;
    if (ev.status === 'failed') r.failed++;
    const bar = document.querySelector('.runcard .bar');
    const total = LD.plan ? LD.plan.totalSteps : 0;
    if (bar && total) { bar.style.width = `${Math.round(((r.ok + r.failed) / total) * 100)}%`; bar.classList.toggle('bad', r.failed > 0); }
  } else if (ev.type === 'done') {
    r.done = true; r.error = ev.error || ''; r.results = ev.results || [];
    LD.disc = {};
    loadProject().then(() => { refreshAllClouds(); drawLanding(); });
    for (const cid of Object.keys(LD.clouds)) tryInv('prov:discover', cid, true).then((d) => { if (d.ok) LD.disc[cid] = d.data; });
    const bad = r.failed || r.error;
    status(bad ? 'Provisioning finished with problems. See the failed steps.' : 'Environments provisioned. Use the environment switcher to work in any of them.', !!bad);
  } else if (ev.type === 'note') status(ev.message, true);
});

/* the application you are working in follows the file you have open */
CNS.on('tab-activated', (tab) => {
  if (!tab || tab.kind !== 'file' || !state.proj || !state.proj.enabled) return;
  let best = null;
  for (const [n, a] of Object.entries(state.proj.apps || {})) if (a.dir && normPath(tab.path).startsWith(normPath(a.dir) + BS) && (!best || a.dir.length > best[1].dir.length)) best = [n, a];
  if (best && best[0] !== state.proj.app) saveProject({ app: best[0] }).then(() => status(`Application: ${best[0]}`)).catch(() => {});
});
