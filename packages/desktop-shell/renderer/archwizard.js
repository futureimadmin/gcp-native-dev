/* Cloud Native architecture wizard (Google Cloud): choose services -> network and environments -> architecture diagram, identities
   -> Terraform -> provision the first environment. The other environments run the same Terraform from the CI/CD pipeline.
   Nothing is created until "Provision". */
'use strict';

const AW_STEPS = ['Design', 'Network', 'Review', 'Terraform', 'Provision'];
const AW_REGIONS = ['us-central1', 'us-east1', 'us-east4', 'us-west1', 'europe-west1', 'europe-west2', 'europe-west3', 'europe-west4', 'asia-south1', 'asia-southeast1', 'asia-northeast1', 'australia-southeast1'];
const OCTOPUS_URL = 'https://futureim.com/octopus-api-gateway';
const AW = { el: null, step: 0, catalog: null, region: 'us-central1', nat: true, app: '', envs: [], preview: null, prevErr: '', custom: [], notes: '', disc: null, discBusy: false, discErr: '', org: null, billing: '', projects: null, projectsBusy: false, file: 'main.tf', plan: null, planErr: '', run: null, ss: {}, busy: false, seq: 0, timer: null, tick: null, ready: false };

const awCall = (method, ...args) => tryInv(method, 'gcp', ...args);

function openArchWizard(opts = {}) {
  if (!state.workspace) return status('Open a folder first.', true);
  openPage({ id: 'archwizard', title: 'Architecture', icon: '◈', pad: true, build(el) { AW.el = el; }, onClose() { AW.el = null; } });
  awInit(opts);
}

async function awInit(opts) {
  AW.run = null; AW.plan = null; AW.planErr = ''; AW.ss = {};
  if (!AW.catalog) {
    const r = await awCall('prov:archCatalog');
    if (!r.ok) { AW.el.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'msg err', text: r.error }))); return; }
    AW.catalog = r.data;
  }
  if (!AW.ready) {
    const p = state.proj || {};
    AW.app = (p.service || (p.apps && Object.keys(p.apps)[0]) || baseName(state.workspace) || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 21) || 'my-app';
    if (AW.app.length < 3) AW.app = `${AW.app}-app`;
    const envs = (p.envs && p.envs.length ? p.envs : [{ name: 'dev' }, { name: 'sit' }, { name: 'uat' }, { name: 'prod', protected: true }]);
    const tg = (p.targets && p.targets.gcp) || {};
    AW.envs = envs.map((e, i) => { const project = (tg[e.name] && tg[e.name].scope) || ''; return { name: e.name, protected: !!e.protected, project, mode: project ? 'existing' : i === 0 ? 'create' : 'later', create: { id: project || i > 0 ? '' : awNewProjectId(AW.app, e.name) }, cidr: `10.${10 * (i + 1)}` }; });
    // an earlier session remembered the canvas
    let saved = null;
    try {
      const f = joinPath(state.workspace, '.nativity' + BS + 'architecture.json');
      if (await inv('fs:exists', f)) saved = JSON.parse(await inv('fs:readFile', f));
    } catch { /* first time */ }
    if (saved) {
      if (Array.isArray(saved.custom)) AW.custom = saved.custom.slice(0, 12);
      AW.notes = String(saved.notes || '');
      if (saved.region) AW.region = saved.region;
      if (saved.options && typeof saved.options.nat === 'boolean') AW.nat = saved.options.nat;
    }
    AW.ready = true;
    if (saved && saved.canvas && Array.isArray(saved.canvas.nodes)) CV.doc = cvMigrate(saved.canvas);
    else { CV.doc = cvEmpty(); await awLoadPreset('octopus-gke', true); }
  }
  AW.step = opts.startAt || 0;
  awDraw();
  awSchedule(0);
}

/** A ready-made architecture on the canvas (or a blank one). */
async function awLoadPreset(id, quiet) {
  if (id === 'blank') { CV.doc = cvEmpty(); CV.sel = null; if (!quiet) { cvChanged(); } return; }
  const p = AW.catalog.presets.find((x) => x.id === id);
  if (!p) return;
  const r = await awCall('prov:archPreview', { app: AW.app || 'my-app', region: AW.region, env: 'dev', services: p.services, custom: [], edges: null, options: { nat: AW.nat }, envs: [{ name: 'dev' }] });
  if (!r.ok) return status(r.error, true);
  CV.doc = cvFromModel(r.data.model);
  CV.sel = null;
  if (!quiet) { cvMessage(`${p.name}: ${p.desc}`); cvChanged(); }
}

/** Something changed on the canvas: refresh the numbers (identities, CIDRs, APIs). */
function awDocChanged() { awSchedule(300); }

function awSpec() {
  const parts = cvSpecParts();
  const cidr = {};
  for (const e of AW.envs) cidr[e.name] = e.cidr;
  return { app: AW.app, region: AW.region, env: AW.envs[0] && AW.envs[0].name, project: AW.envs[0] && awProjectIdOf(AW.envs[0]), services: parts.services, custom: parts.custom, edges: parts.edges, design: parts.design, canvas: CV.doc, notes: AW.notes, envs: AW.envs.map((e) => ({ name: e.name, protected: e.protected, project: awProjectIdOf(e), create: e.mode === 'create' ? { id: e.create.id, name: `${AW.app} ${e.name}`, billing: AW.billing, org: AW.org || '' } : null })), options: { nat: AW.nat, cidr } };
}

function awSchedule(ms = 250) {
  clearTimeout(AW.timer);
  AW.timer = setTimeout(async () => {
    const my = ++AW.seq;
    const r = await awCall('prov:archPreview', awSpec());
    if (my !== AW.seq) return;
    if (r.ok) { AW.preview = r.data; AW.prevErr = ''; cvSetInfo(r.data.model); } else { AW.preview = null; AW.prevErr = r.error; }
    // on the canvas only the labels and the buttons change: the canvas itself is not rebuilt (that would lose your drag)
    if (AW.step === 0) { cvRender(); awRefreshNav(); } else awDrawBody();
  }, ms);
}

function awRefreshNav() { const n = document.getElementById('aw-nav'); if (n) n.replaceWith(awNav()); }

/* ------------------------------ frame ------------------------------ */

function awDraw() {
  if (!AW.el) return;
  AW.el.replaceChildren(h('div', { class: 'gw aw' },
    h('div', { class: 'gw-head' }, h('h2', { text: 'Cloud Native architecture' }), h('span', { class: 't-dim', text: `${AW.app} · Google Cloud` })),
    awStepper(), h('div', { id: 'aw-body' }, awBody()), awNav()));
}
function awDrawBody() { const keep = AW.el ? AW.el.scrollTop : 0; const b = document.getElementById('aw-body'); if (b) b.replaceChildren(awBody()); if (AW.el) AW.el.scrollTop = keep; awRefreshNav(); const s = document.getElementById('aw-stepper'); if (s) s.replaceWith(awStepper()); }

function awStepper() {
  return h('ol', { class: 'gw-steps', id: 'aw-stepper' }, ...AW_STEPS.map((s, i) => h('li', { class: `${i === AW.step ? 'on' : ''}${i < AW.step ? ' done' : ''}`, onclick: () => { if (AW.run && !AW.run.done) return; for (let j = AW.step; j < i; j++) { const why = awBlock(j); if (why) { status(why, true); return; } } if (i > 0 && !AW.preview && i > AW.step) { status('One moment: the architecture is still being worked out.', true); return; } AW.step = i; awDrawBody(); } }, h('span', { class: 'n', text: i < AW.step ? '✔' : String(i + 1) }), h('span', { text: s }))));
}

/** Why a step cannot be left (empty = free to go). The Design step never blocks: the architecture is optional. */
function awBlock(step = AW.step) {
  if (step === 0) return '';
  if (step === 1) {
    if (!/^[a-z][a-z0-9-]{1,19}[a-z0-9]$/.test(AW.app)) return `"${AW.app}" is not a valid application name (3-21 characters, lower-case letters, digits, "-").`;
    const bases = AW.envs.map((e) => e.cidr);
    if (AW.envs.some((e) => !/^\d{1,3}\.\d{1,3}$/.test(e.cidr) || e.cidr.split('.').some((x) => Number(x) > 255))) return 'Address ranges look like 10.10 (the first two numbers of the environment’s /16).';
    if (new Set(bases).size !== bases.length) return 'Each environment needs its own address range, so the networks never overlap.';
    const ids = [];
    for (const e of AW.envs) {
      if (e.mode === 'later') continue;
      const id = awProjectIdOf(e);
      if (!id) return `${e.name}: choose a project, or create a new one.`;
      if (!AW_PROJECT_RE.test(id)) return `${e.name}: "${id}" is not a valid project id.`;
      if (e.mode === 'existing' && (AW.projects || []).some((p) => p.id === id && p.billed === false)) return `${e.name}: ${id} has no billing account.`;
      ids.push(id);
    }
    if (new Set(ids).size !== ids.length) return 'Each environment needs its own project.';
    if (AW.envs.some((e) => e.mode === 'create') && !AW.billing) return 'Choose the billing account the new projects are billed to.';
    return '';
  }
  if (step >= 2 && AW.prevErr) return AW.prevErr;
  return '';
}

/** What the Design step says under the canvas: a note, never a stop. */
function awDesignNote() {
  if (!CV.doc || (!CV.doc.nodes.length && !CV.doc.vpcs.length)) return 'No architecture drawn: a blank Terraform scaffold will be generated. You can add services at any time.';
  const errs = cvProblems().filter((p) => p.level === 'error');
  return errs.length ? `⚠ ${errs[0].text}${errs.length > 1 ? ` (and ${errs.length - 1} more)` : ''} Provisioning stops until this is fixed.` : '';
}

function awNav() {
  const why = awBlock();
  const last = AW.step === AW_STEPS.length - 1;
  return h('div', { id: 'aw-nav', class: 'gw-nav' },
    h('button', { text: '◂ Back', disabled: AW.step === 0 || !!(AW.run && !AW.run.done), onclick: () => { AW.step = Math.max(0, AW.step - 1); awDrawBody(); } }),
    h('span', { class: why ? 'gw-why' : 't-dim', style: 'flex:1', text: why || (AW.step === 0 ? awDesignNote() : '') }),
    last ? null : h('button', { class: 'primary big', text: 'Next ▸', disabled: !!why || !AW.preview, onclick: () => { AW.step++; awDrawBody(); } }));
}

function awBody() {
  return [awStepDesign, awStepNetwork, awStepReview, awStepTerraform, awStepProvision][AW.step]();
}

/* ------------------------------ step 1: design on the canvas ------------------------------ */

function awStepDesign() {
  return h('div', {},
    h('div', { class: 'aw-logical' }, h('b', { text: 'Design your architecture.' }), h('span', { text: ' Drag icons from the left onto the canvas. Application services (GKE, Cloud Run, functions …) and databases must sit in a private subnet of a VPC: add a VPC, add private subnets in it, then drop services there. Google-managed services such as Firestore, Pub/Sub, Storage or BigQuery need no VPC. This is a logical picture: connect the services the way your application really talks to them (or describe it in words), and export it as an image.' })),
    cvView(),
    h('div', { class: 'aw-license' }, h('b', { text: 'About the logos. ' }), h('span', { text: LOGO_NOTICE }), h('span', { text: ' They are kept in the IDE’s logos folder (renderer/assets/logos).' })));
}

/** Any Google Cloud service by API name (the palette already holds the catalog). */
function awAddServiceDialog() {
  const nm = h('input', { placeholder: 'Name, for example Translation', maxlength: 40 });
  const api = h('input', { placeholder: 'API, for example translate.googleapis.com', spellcheck: 'false' });
  const tier = h('select', {}, h('option', { value: 'google', text: 'A Google-managed service (no VPC needed)' }), h('option', { value: 'app', text: 'My workload: runs in its own private subnet' }), h('option', { value: 'data', text: 'A database: in a private database subnet' }));
  const role = h('input', { placeholder: 'Optional role for the application, for example roles/cloudtranslate.user', spellcheck: 'false' });
  const msg = h('div', { class: 'msg' });
  const add = () => {
    const c = { name: nm.value.trim(), api: api.value.trim(), tier: tier.value, role: role.value.trim() };
    const bad = !c.name ? 'Give the service a name.' : !/^[a-z][a-z0-9-]*\.googleapis\.com$/.test(c.api) ? 'The API looks like translate.googleapis.com (find it in the Google Cloud console under APIs & Services).' : c.role && !/^roles\/[A-Za-z0-9._]+$/.test(c.role) ? 'A role looks like roles/cloudtranslate.user.' : AW.custom.some((x) => cvCustomId(x) === cvCustomId(c)) ? 'That service is already added.' : '';
    if (bad) { msg.className = 'msg err'; msg.textContent = bad; return; }
    AW.custom.push(c); awDrawBody(); close(); cvMessage(`${c.name} added to the palette: drag it onto the canvas.`);
  };
  const close = modal('Add a service', h('div', { class: 'aw-add' },
    h('p', { class: 'hint', text: 'Anything in Google Cloud: its API is turned on when you provision and it appears in the architecture. Terraform resources are generated only for the services marked so; add the rest in infra/terraform.' }),
    h('label', { text: 'Name' }), nm, h('label', { text: 'API to enable' }), api, h('label', { text: 'Where does it run?' }), tier, h('label', { text: 'Role for your application (least privilege)' }), role, msg),
  [h('button', { text: 'Cancel', onclick: () => close() }), h('button', { class: 'primary', text: 'Add to the palette', onclick: add })], { wide: true });
  nm.focus();
}

function awGlyph(kind) {
  const g = sv('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: '#fff', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  for (const part of (DG_GLYPH[kind] || DG_GLYPH.ops)()) g.append(part);
  return g;
}

/* ------------------------------ step 2: network and environments ------------------------------ */

const AW_PROJECT_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const awNewProjectId = (app, env) => { const rand = Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(2, 8).padEnd(6, 'x'); return `${`${app}-${env}`.slice(0, 22).replace(/-+$/, '')}-${rand}`; };
const awProjectIdOf = (e) => (e.mode === 'create' ? e.create.id : e.mode === 'later' ? '' : e.project);

/** Organizations, billing accounts and the projects you can use: read once, here, so nobody is sent to another wizard to get a project. */
async function awLoadDiscovery() {
  AW.discBusy = true; AW.discErr = ''; AW.disc = null;
  const r = await tryInv('prov:discover', 'gcp', false);
  AW.discBusy = false;
  if (r.ok && r.data && r.data.reauth) AW.discErr = 'reauth';
  else if (r.ok && r.data && r.data.signedIn === false) AW.discErr = 'Google Cloud is not signed in. Sign in from the Clouds view first.';
  else if (r.ok) { AW.disc = r.data; if (AW.org == null) AW.org = (r.data.orgs[0] || {}).id || ''; if (!AW.billing && r.data.billing[0]) AW.billing = r.data.billing[0].id; } else AW.discErr = r.error;
  if (AW.step === 1) awDrawBody();
}

async function awEnsureProjects() {
  if (AW.projects || AW.projectsBusy) return;
  AW.projectsBusy = true;
  const r = await tryInv('prov:wizard', state.workspace, 'gcp', 'projects', []);
  AW.projectsBusy = false;
  AW.projects = r.ok ? r.data : [];
  if (AW.step === 1) awDrawBody();
}

function awStepNetwork() {
  if (!AW.disc && !AW.discBusy && !AW.discErr) awLoadDiscovery();
  const appIn = h('input', { value: AW.app, maxlength: 21, spellcheck: 'false' });
  appIn.onchange = () => { AW.app = appIn.value.trim().toLowerCase(); for (const e of AW.envs) if (e.mode === 'create' && !e.idTouched) e.create.id = awNewProjectId(AW.app, e.name); awSchedule(0); awDrawBody(); };
  const reg = h('select', { onchange: (e) => { AW.region = e.target.value; awSchedule(0); awDrawBody(); } }, ...AW_REGIONS.map((r) => h('option', { value: r, text: r, selected: r === AW.region })));
  const nat = h('input', { type: 'checkbox', checked: AW.nat, onchange: (e) => { AW.nat = e.target.checked; awSchedule(0); awDrawBody(); } });
  const d = AW.disc;
  const anyCreate = AW.envs.some((e) => e.mode === 'create');
  const anyExisting = AW.envs.some((e) => e.mode === 'existing');
  if (anyExisting) awEnsureProjects();

  const orgSel = h('select', { onchange: (e) => { AW.org = e.target.value; awSchedule(0); } }, h('option', { value: '', text: 'No organization: create at the top level', selected: !AW.org }), ...(d ? d.orgs : []).map((o) => h('option', { value: o.id, text: `${o.name} (${o.id})`, selected: o.id === AW.org })));
  const billSel = h('select', { onchange: (e) => { AW.billing = e.target.value; awSchedule(0); awDrawBody(); } }, ...(d && d.billing.length ? d.billing : [{ id: '', name: 'No open billing account found' }]).map((b) => h('option', { value: b.id, text: `${b.name}${b.id ? ` (${b.id})` : ''}${typeof b.used === 'number' ? ` · ${b.used} projects linked` : ''}`, selected: b.id === AW.billing })));
  const creates = AW.envs.filter((e) => e.mode === 'create').length;
  const acct = (d && d.billing.find((b) => b.id === AW.billing)) || {};
  const tight = typeof acct.used === 'number' && acct.used + creates > 5;

  const rows = AW.envs.map((e, i) => {
    const modeSel = h('select', { onchange: (ev) => { e.mode = ev.target.value; if (e.mode === 'create' && !e.create.id) e.create.id = awNewProjectId(AW.app, e.name); awSchedule(0); awDrawBody(); } },
      h('option', { value: 'create', text: 'Create a new project', selected: e.mode === 'create' }), h('option', { value: 'existing', text: 'Use an existing project', selected: e.mode === 'existing' }), ...(i > 0 ? [h('option', { value: 'later', text: 'Decide later', selected: e.mode === 'later' })] : []));
    const idIn = h('input', { value: awProjectIdOf(e) || '', placeholder: 'project id', spellcheck: 'false', disabled: e.mode === 'later', ...(e.mode === 'existing' ? { list: 'aw-projects' } : {}) });
    idIn.onchange = () => { const v = idIn.value.trim(); if (e.mode === 'create') { e.create.id = v; e.idTouched = true; } else e.project = v; awSchedule(0); awDrawBody(); };
    const id = awProjectIdOf(e);
    const bad = id && !AW_PROJECT_RE.test(id);
    const unbilled = e.mode === 'existing' && (AW.projects || []).find((p) => p.id === id && p.billed === false);
    const cidr = h('input', { value: e.cidr, style: 'max-width:90px;font-family:var(--mono)', spellcheck: 'false' });
    cidr.onchange = () => { e.cidr = cidr.value.trim(); awSchedule(0); awDrawBody(); };
    const ok = /^\d{1,3}\.\d{1,3}$/.test(e.cidr);
    return h('tr', {}, h('td', { class: 'who' }, h('b', { text: e.name }), i === 0 ? h('span', { class: 'chip ok', text: 'provisioned now' }) : h('span', { class: 'chip', text: 'resources by the pipeline' }), e.protected ? h('span', { class: 'chip', text: 'protected' }) : null),
      h('td', {}, modeSel, idIn, bad ? h('div', { class: 'msg err', text: '6-30 characters: lower-case letters, digits and "-", starting with a letter.' }) : null, unbilled ? h('div', { class: 'msg err', text: `${id} has no billing account: link one in Google Cloud, or create a new project.` }) : null),
      h('td', {}, cidr), h('td', { class: 't-dim', style: 'font-family:var(--mono)', text: ok ? `${e.cidr}.0.0/16` : '—' }));
  });

  const state1 = AW.discBusy ? h('div', { class: 'card' }, 'Reading your organizations, billing accounts and projects…')
    : AW.discErr === 'reauth' ? h('div', { class: 'card' }, h('div', { class: 'msg err', text: 'Your Google Cloud session has expired. Sign in again to see your billing accounts and projects.' }), h('div', { class: 'row' }, h('button', { class: 'primary', text: 'Sign in to Google Cloud', onclick: async () => { await cloudLogin('gcp'); awLoadDiscovery(); } }), h('button', { text: 'Try again', onclick: awLoadDiscovery })))
      : AW.discErr ? h('div', { class: 'card' }, h('div', { class: 'msg err', text: AW.discErr }), h('button', { text: 'Try again', onclick: awLoadDiscovery })) : null;

  return h('div', {},
    h('p', { class: 'hint', text: 'Every environment needs a Google Cloud project with billing. Create a new one right here, or use one you already have. Every environment gets its own VPC with its own address range. You provision the first environment now; the pipeline builds the others from the same Terraform.' }),
    h('div', { class: 'cols2' },
      h('div', { class: 'card' }, h('label', { text: 'Application name' }), appIn, h('label', { text: 'Region' }), reg,
        h('label', { class: 'inline' }, nat, ' Let private workloads reach the internet outbound (Cloud NAT). Nothing can reach them inbound.')),
      h('div', { class: 'card' }, h('b', { text: 'New projects' }),
        d ? h('div', {}, h('label', { text: 'Create them in' }), orgSel, h('label', { text: 'Bill them to' }), billSel,
          creates ? h('div', { class: `hint${tight ? ' gw-why' : ''}`, text: `${creates} new project${creates === 1 ? '' : 's'} will be linked to this billing account${typeof acct.used === 'number' ? `, which already has ${acct.used}` : ''}. Google limits how many projects one billing account can hold (often 5 on newer accounts; yours may differ).` }) : h('div', { class: 'hint', text: 'You are using existing projects only: nothing new is created.' }),
          !(d.billing || []).length && anyCreate ? h('div', { class: 'msg err', text: 'No open billing account was found for this sign-in. Ask a billing administrator for access, or use an existing project.' }) : null)
          : h('div', { class: 'hint', text: AW.discBusy ? 'Reading your account…' : 'Sign in to choose where new projects are created and billed.' }))),
    state1,
    h('datalist', { id: 'aw-projects' }, ...(AW.projects || []).filter((p) => p.billed !== false).map((p) => h('option', { value: p.id, label: p.name || '' }))),
    h('table', { class: 'acc aw-envs' }, h('tr', {}, h('td', { class: 'who', text: 'Environment' }), h('td', { class: 'who', text: 'Google Cloud project' }), h('td', { class: 'who', text: 'Address range' }), h('td', { class: 'who', text: 'Network' })), ...rows));
}

/** After a good run: the projects are what the IDE uses for each environment from now on. */
async function awRecordProjects() {
  try {
    const cur = (state.proj && state.proj.targets) || {};
    const gcp = { ...(cur.gcp || {}) };
    AW.envs.forEach((e, i) => { const id = awProjectIdOf(e); if (id && (i === 0 || e.mode === 'create')) gcp[e.name] = { ...(gcp[e.name] || {}), scope: id, region: AW.region }; });
    await saveProject({ targets: { ...cur, gcp }, cloud: 'gcp', enabled: true });
  } catch { /* the message is shown by saveProject */ }
}

/* ------------------------------ step 3: architecture ------------------------------ */

function awStepReview() {
  if (!AW.preview) return h('div', { class: 'card' }, AW.prevErr ? h('div', { class: 'msg err', text: AW.prevErr }) : 'Working out the details…');
  const m = AW.preview.model;
  const acct = (a) => h('details', { class: 'aw-acct', open: a.id === 'app' },
    h('summary', {}, h('b', { text: a.title }), h('code', { text: a.email }), h('span', { class: 'chip', text: `${a.roles.length} role${a.roles.length === 1 ? '' : 's'}` })),
    h('div', { class: 'hint', text: a.purpose }),
    h('table', { class: 'acc' }, ...a.roles.map((r) => h('tr', {}, h('td', { class: 'who' }, h('code', { text: r.role })), h('td', { class: 't-dim', text: r.scope }), h('td', { text: r.why || '' })))),
    a.grantable ? h('div', { class: 'hint', text: `It may grant only: ${a.grantable.join(', ')}. Anything else is refused by Google Cloud.` }) : null);
  const nets = m.vpcs.length ? m.vpcs : [];
  const apis = h('details', { class: 'aw-apis' }, h('summary', {}, h('b', { text: `APIs that will be enabled (${m.allApis.length})` }), h('span', { class: 't-dim', text: ' every API of every service on the canvas, turned on before Terraform runs' })),
    h('table', { class: 'acc' }, ...m.apis.map((r) => h('tr', {}, h('td', { class: 'who', text: r.service }), h('td', {}, ...r.apis.map((a) => h('code', { class: 'aw-api', text: a })))))));
  return h('div', {},
    h('div', { class: 'aw-logical' }, h('b', { text: 'What will be created.' }), h('span', { text: ' The picture you drew is logical; this is what Terraform builds from it: the network (a private subnet for each application platform and a separate one for the database), one identity per workload with only the roles it needs, and every API turned on.' })),
    m.warnings.length ? h('div', { class: 'scm-warn' }, ...m.warnings.map((w) => h('div', { text: `• ${w}` }))) : null,
    apis,
    h('div', { class: 'cols2' },
      h('div', {}, h('h4', { text: 'Identities: least privilege' }), h('p', { class: 'hint', text: 'Your code runs as its own service account. Roles are given on the single bucket, topic, secret or key where Google allows it, not on the whole project. Terraform has a separate identity that only provisioning uses.' }), ...m.accounts.map(acct)),
      h('div', {}, h('h4', { text: 'Network plan' }),
        nets.length ? null : h('div', { class: 'hint', text: 'No VPC: everything you chose is Google-managed and needs no network of yours.' }),
        ...nets.map((net) => h('table', { class: 'acc' },
          h('tr', {}, h('td', { class: 'who', text: `VPC${nets.length > 1 ? ` ${net.k + 1}` : ''}` }), h('td', { text: net.vpc }), h('td', { style: 'font-family:var(--mono)', text: net.cidr })),
          ...net.subnets.map((s) => h('tr', {}, h('td', { class: 'who', text: `${s.tier === 'data' ? 'Database' : 'Application'} · ${s.id.replace('svc:', '')}` }), h('td', { class: 't-dim', text: `${s.purpose} · private` }), h('td', { style: 'font-family:var(--mono)', text: s.cidr }))),
          ...net.subnets.flatMap((s) => s.secondary.map((x) => h('tr', {}, h('td', { class: 'who', text: `GKE ${x.name}` }), h('td', { class: 't-dim', text: 'secondary range of the GKE subnet' }), h('td', { style: 'font-family:var(--mono)', text: x.cidr })))),
          net.gkeMaster ? h('tr', {}, h('td', { class: 'who', text: 'GKE control plane' }), h('td', { class: 't-dim', text: 'private endpoint range' }), h('td', { style: 'font-family:var(--mono)', text: net.gkeMaster })) : null,
          net.psa ? h('tr', {}, h('td', { class: 'who', text: 'Private services' }), h('td', { class: 't-dim', text: net.psa.purpose }), h('td', { style: 'font-family:var(--mono)', text: net.psa.cidr })) : null,
          h('tr', {}, h('td', { class: 'who', text: 'Outbound' }), h('td', { class: 't-dim', text: net.nat ? 'Cloud NAT, no inbound' : 'none: workloads have no internet access' }), h('td', { text: '' })))),
        (m.peerings || []).length ? h('div', { class: 'hint', text: `Peered: ${m.peerings.map((p) => `${m.vpcs[p.a].vpc} ↔ ${m.vpcs[p.b].vpc}`).join(', ')}.` }) : null,
        h('div', { class: 'hint', text: `Other environments use their own /16: ${AW.envs.map((e) => `${e.name} ${e.cidr}.0.0/16`).join(', ')}.` }))));
}

/** Describe the connections in sentences; they replace the connections on the canvas. */
function awDescribeDialog() {
  if (!CV.doc || CV.doc.nodes.length < 2) return cvMessage('Put at least two services on the canvas first.', true);
  const t = h('textarea', { rows: 6, placeholder: 'For example: Users call Octopus. Octopus routes /orders to GKE and /payments to Cloud Run. GKE writes to Cloud SQL and publishes to Pub/Sub. Cloud Run reads from Redis.' });
  t.value = AW.notes;
  const msg = h('div', { class: 'msg' });
  const go = () => {
    AW.notes = t.value.slice(0, 2000);
    const choices = CV.doc.nodes.map((n) => ({ id: n.id, label: cvInfo(n.type).name }));
    const r = awParseDescription(AW.notes, choices, AW.catalog.services);
    if (!r.edges.length) { msg.className = 'msg err'; msg.textContent = 'I could not find a connection in that. Name two services and say how they relate, for example “GKE calls Cloud Run”.'; return; }
    CV.doc.edges = r.edges.map((e) => ({ id: `e${CV.doc.next++}`, from: e.from, to: e.to, label: e.label }));
    close();
    cvMessage(`${r.edges.length} connection${r.edges.length === 1 ? '' : 's'} drawn from your description.${r.unmatched.length ? ` Not on the canvas: ${r.unmatched.join(', ')}.` : ''}`);
    cvChanged();
  };
  const close = modal('Describe your architecture', h('div', {}, h('p', { class: 'hint', text: 'Say which service calls which. The connections on the canvas are replaced by what you describe. It is read inside the IDE: nothing is sent anywhere.' }), t, msg), [h('button', { text: 'Cancel', onclick: () => close() }), h('button', { class: 'primary', text: 'Draw the connections', onclick: go })], { wide: true });
  t.focus();
}

/* ------------------------------ step 4: Terraform ------------------------------ */

function awStepTerraform() {
  if (!AW.preview) return h('div', { class: 'card' }, AW.prevErr ? h('div', { class: 'msg err', text: AW.prevErr }) : 'Generating the Terraform…');
  const files = [...AW.preview.files, { path: '.github/workflows/infra.yml', content: AW.preview.workflow }];
  if (!files.some((f) => f.path === AW.file)) AW.file = files[0].path;
  const cur = files.find((f) => f.path === AW.file);
  return h('div', {},
    h('div', { class: 'row' }, h('img', { src: serviceLogoUrl('terraform'), width: 22, height: 22, alt: 'Terraform' }), h('b', { text: 'Terraform' })),
    h('p', { class: 'hint', text: 'This is real Terraform for the architecture, written to infra/terraform in your project when you provision. It uses variables for everything that differs between environments, so the same code builds dev, sit, uat and prod.' }),
    h('div', { class: 'aw-code' },
      h('div', { class: 'aw-files' }, ...files.map((f) => h('button', { class: `aw-file${f.path === AW.file ? ' on' : ''}`, text: f.path, onclick: () => { AW.file = f.path; awDrawBody(); } }))),
      h('div', { class: 'aw-src' }, h('div', { class: 'row' }, h('code', { text: cur.path }), h('span', { class: 'spacer' }), h('button', { text: 'Copy', onclick: () => { navigator.clipboard.writeText(cur.content).then(() => status('Copied.')); } })), h('pre', { text: cur.content }))));
}

/* ------------------------------ step 5: provision ------------------------------ */

async function awMakePlan() {
  AW.busy = true; AW.planErr = ''; awDrawBody();
  const r = await tryInv('prov:archPlan', state.workspace, 'gcp', awSpec());
  AW.busy = false;
  if (r.ok) AW.plan = r.data; else { AW.plan = null; AW.planErr = r.error; }
  awDrawBody();
}

async function awStart() {
  const r = await tryInv('prov:run', AW.plan.token, '');
  if (!r.ok) return status(r.error, true);
  AW.run = { id: r.data.runId, done: false, ok: 0, failed: 0, error: '', t0: Date.now(), now: '' };
  AW.ss = {};
  clearInterval(AW.tick); AW.tick = setInterval(awTick, 1000);
  awDrawBody();
}

function awTick() {
  const r = AW.run; const el = document.querySelector('.aw-now');
  if (!r || r.done) { clearInterval(AW.tick); if (el) el.textContent = ''; return; }
  if (!el) return;
  const total = AW.plan ? AW.plan.totalSteps : 0; const did = r.ok + r.failed; const ms = Date.now() - r.t0;
  el.textContent = `Step ${Math.min(did + 1, total)} of ${total}: ${r.now || 'starting…'}  (${gwFmt(ms)} elapsed)`;
}

function awStepProvision() {
  const m = AW.preview && AW.preview.model;
  const env = AW.envs[0];
  const header = h('div', { class: 'card' },
    h('b', { text: `Provision ${env ? env.name : ''} now` }),
    h('p', { class: 'hint', text: `${AW.envs.some((e) => e.mode === 'create') ? `First creates the new project${AW.envs.filter((e) => e.mode === 'create').length > 1 ? 's' : ''} (${AW.envs.filter((e) => e.mode === 'create').map((e) => `${e.create.id} for ${e.name}`).join(', ')}) and links billing. ` : ''}Then creates the network, identities and services of ${m ? m.services.length : 0} chosen services in ${env ? awProjectIdOf(env) : 'the project'} with Terraform. The other environments (${AW.envs.slice(1).map((e) => e.name).join(', ') || 'none'}) are built by the pipeline from the same code, in order, so nothing is changed by hand.`}));
  if (!AW.plan && !AW.run) {
    return h('div', {}, header,
      AW.planErr ? h('div', { class: 'msg err', text: AW.planErr }) : null,
      h('div', { class: 'row' }, h('button', { class: 'primary big', text: AW.busy ? 'Preparing…' : 'Review the steps', disabled: AW.busy, onclick: awMakePlan })),
      h('div', { class: 'hint', text: 'Nothing is created yet. You see every command first.' }));
  }
  const pc = AW.plan.clouds[0];
  const total = AW.plan.totalSteps;
  const r = AW.run;
  const pct = r && total ? Math.round(((r.ok + r.failed) / total) * 100) : 0;
  const steps = h('details', { class: 'steps', open: !!r }, h('summary', { text: `All ${total} steps and commands` }),
    ...pc.steps.map((s) => { const k = `gcp|${s.id}`; const ss = AW.ss[k] || { status: 'pending', icon: '○', message: '' };
      return h('div', { class: 'pstep', 'data-key': k }, h('span', { class: `st ${ss.status}`, text: ss.icon }), h('div', { class: 'ptxt' }, h('div', { text: s.title }), h('code', { class: 'pcmd', text: s.display }), h('div', { class: 'smsg t-dim', text: ss.message || '' }))); }));
  const done = r && r.done;
  const ok = done && !r.failed && !r.error;
  return h('div', {}, header,
    ...(pc.blockers || []).map((b) => h('div', { class: 'msg err', text: `⛔ ${b}` })), ...(pc.warnings || []).map((w) => h('div', { class: 'msg warn', text: `⚠ ${w}` })),
    h('div', { class: 'card runcard' },
      h('div', { class: 'cardh' }, h('b', { text: !r ? `${total} steps ready` : done ? (ok ? 'Development is provisioned' : 'Finished with problems') : 'Provisioning…' }), h('span', { class: 'spacer' }),
        !r ? h('button', { class: 'primary big', text: `Provision ${env.name}`, disabled: !!(pc.blockers || []).length, onclick: awStart }) : done ? null : h('button', { text: 'Stop after this step', onclick: () => tryInv('prov:cancel', r.id) })),
      r ? h('div', { class: 'progress' }, h('div', { class: `bar${r.failed ? ' bad' : ''}`, style: `width:${pct}%` })) : null,
      r ? h('div', { class: 'aw-now t-dim', text: done ? '' : 'Starting…' }) : null,
      r && r.error ? h('div', { class: 'msg err', text: r.error }) : null),
    ok ? awNext(m, env) : null,
    steps);
}

function awNext(m, env) {
  return h('div', { class: 'card' }, h('b', { text: 'What now' }),
    h('ul', { class: 'aw-list' },
      h('li', { text: 'The Terraform is in infra/terraform and the pipeline in .github/workflows/infra.yml. Commit both.' }),
      h('li', { text: `Create one GitHub environment per environment (${AW.envs.map((e) => e.name).join(', ')}) and set GCP_PROJECT, GCP_WORKLOAD_IDENTITY_PROVIDER and GCP_TF_SERVICE_ACCOUNT in each. The pipeline then builds ${AW.envs.slice(1).map((e) => e.name).join(', ') || 'the others'} in order.` }),
      m.gateway === 'octopus' ? h('li', {}, 'Install Octopus API Gateway into the cluster from Google Cloud Marketplace and point it at the identity and static IP in the Terraform outputs. ', h('a', { href: '#', class: 'md-a', text: 'About Octopus ↗', onclick: (e) => { e.preventDefault(); inv('shell:openExternal', OCTOPUS_URL).catch(() => {}); } })) : null,
      AW.envs.some((e) => e.mode === 'later') ? h('li', { text: `Set the project of ${AW.envs.filter((e) => e.mode === 'later').map((e) => e.name).join(', ')} in infra/terraform/envs/<env>.tfvars (project_id) before the pipeline runs there: they were left for later.` }) : null,
      h('li', { text: 'Deploy your code from the pipeline or the IDE. Provisioning never deploys it.' })),
    h('div', { class: 'row' }, h('button', { text: 'Open the infra folder', onclick: () => explorerReveal && explorerReveal(joinPath(state.workspace, 'infra'), { focus: true }) })));
}

cns.on('prov:event', (ev) => {
  const r = AW.run;
  if (!r || ev.runId !== r.id) return;
  if (ev.type === 'step') {
    const key = `gcp|${ev.step}`;
    AW.ss[key] = { status: ev.status, icon: { running: '⏳', ok: '✔', skipped: '↷', failed: '✘', warn: '⚠', pending: '○' }[ev.status] || '○', message: ev.message || '' };
    const row = document.querySelector(`.aw .pstep[data-key="${CSS.escape(key)}"]`);
    if (row) { const st = row.querySelector('.st'); st.textContent = AW.ss[key].icon; st.className = `st ${ev.status}`; row.querySelector('.smsg').textContent = ev.message || ''; if (ev.status === 'running' || ev.status === 'failed') { const d = row.closest('details'); if (d) d.open = true; row.scrollIntoView({ block: 'nearest' }); } }
    if (ev.status === 'running') { const st = AW.plan.clouds[0].steps.find((x) => x.id === ev.step); r.now = st ? st.title : ev.step; }
    if (['ok', 'skipped', 'warn'].includes(ev.status)) r.ok++;
    if (ev.status === 'failed') r.failed++;
    awTick();
    const bar = document.querySelector('.aw .runcard .bar');
    if (bar && AW.plan.totalSteps) { bar.style.width = `${Math.round(((r.ok + r.failed) / AW.plan.totalSteps) * 100)}%`; bar.classList.toggle('bad', r.failed > 0); }
  } else if (ev.type === 'done') {
    r.done = true; r.error = ev.error || '';
    clearInterval(AW.tick);
    if (!r.error && !r.failed) awRecordProjects();
    awDrawBody();
    if (typeof refreshTree === 'function') refreshTree();
  }
});
