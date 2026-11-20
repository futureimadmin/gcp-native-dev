/* Google Cloud set-up wizard.
   One organisation-wide landing zone (folders Standard + Compliant, an environment folder under each) that every application shares, then a
   project per application per environment, with billing linked, created inside the environment folders. Each application of the workspace is
   associated with its projects (own, shared, or ones that already exist), one by one or all at once.
   Steps: 1 Organization · 2 Environments · 3 Billing · 4 Applications · 5 Review · 6 Provision */
'use strict';

const GW = { step: 0, disc: null, discErr: '', org: null, noOrg: false, tree: null, treeBusy: false, tiers: { standard: { name: 'Standard' }, compliant: { name: 'Compliant' } }, compliance: { regime: 'regional-controls', location: 'us-central1' }, regimes: null,
  envs: [], envFolders: {}, billing: { standard: '', compliant: '' }, sameBilling: true, guardrails: true, devEditor: false, region: 'us-central1', apps: [], sharedName: 'platform', openApp: '', projects: null, projectsBusy: false,
  plan: null, planErr: '', planning: false, seq: 0, timer: null, run: null, ss: {}, el: null, ready: false, msg: '' };
const GW_STEPS = ['Organization', 'Environments', 'Billing', 'Applications', 'Review', 'Provision'];
const GW_PRESETS = [
  ['Classic', 'dev, sit | uat, preprod, prod', [['dev', 'standard'], ['sit', 'standard'], ['uat', 'compliant'], ['preprod', 'compliant'], ['prod', 'compliant']]],
  ['Lean', 'dev, test | prod', [['dev', 'standard'], ['test', 'standard'], ['prod', 'compliant']]],
  ['Simple', 'dev | prod', [['dev', 'standard'], ['prod', 'compliant']]],
];
const COMPLIANT_NAMES = new Set(['uat', 'preprod', 'pprod', 'prod', 'production', 'dr', 'staging', 'stage']);
const tierOfName = (n) => (COMPLIANT_NAMES.has(n) ? 'compliant' : 'standard');
const ENV_OK = /^[a-z][a-z0-9]{0,11}$/;
const gwCall = (method, ...args) => tryInv('prov:wizard', state.workspace, 'gcp', method, args);

/* ------------------------------ opening ------------------------------ */

function openGcpWizard(opts = {}) {
  if (!state.workspace) return status('Open a folder first.', true);
  openPage({ id: 'gcpwizard', title: 'GCP Setup', icon: '☁', pad: true, build(el) { GW.el = el; }, onClose() { GW.el = null; } });
  gwInit(opts);
}

const gwWaitText = () => `Looking up your organizations… ${Math.round((Date.now() - (GW.discStart || Date.now())) / 1000)}s`;

async function gwInit(opts) {
  GW.run = null; GW.plan = null; GW.planErr = ''; GW.ss = {}; GW.msg = '';
  const saved = (state.proj && state.proj.landing && state.proj.landing.gcp) || (state.settings.gcp && state.settings.gcp.landing) || null;
  if (!GW.ready) {
    if (saved) gwApplySaved(saved);
    else GW.envs = GW_PRESETS[0][2].map(([name, tier]) => ({ name, tier, protected: tier === 'compliant' }));
    GW.ready = true;
  }
  GW.step = opts.startAt != null ? opts.startAt : 0;
  await gwLoadApps();
  gwDraw();
  // organizations first (quick), so the first step is usable while billing accounts and existing projects are still being read
  GW.discStart = Date.now(); clearInterval(GW.discTick); GW.discTick = setInterval(() => { const el = document.querySelector('.gw-wait'); if (el) el.textContent = gwWaitText(); else clearInterval(GW.discTick); }, 1000);
  const q = await tryInv('prov:discoverOrgs', 'gcp');
  if (q.ok) { GW.disc = { billing: [], projects: [], ...q.data }; GW.discErr = ''; GW.discPartial = true; } else GW.discErr = q.error;
  if (GW.disc && GW.disc.signedIn !== false && GW.disc.orgs.length) { if (!GW.org && !GW.noOrg && GW.disc.orgs.length === 1) { gwPickOrg(GW.disc.orgs[0], true); } gwDraw(); }
  if (GW.disc && GW.disc.reauth) { clearInterval(GW.discTick); GW.discPartial = false; GW.discErr = 'Your Google Cloud session has expired. Google asks you to sign in again before anything can be read or created.'; gwDraw(); return; }
  const r = await tryInv('prov:discover', 'gcp', false);
  clearInterval(GW.discTick); GW.discPartial = false;
  if (r.ok) { GW.disc = r.data; GW.discErr = ''; } else if (!GW.disc) GW.discErr = r.error;
  if (GW.disc && GW.disc.signedIn === false) GW.discErr = 'Google Cloud is not signed in. Sign in from the Clouds view first.';
  if (GW.disc && !GW.org && !GW.noOrg) {
    const want = saved && saved.org ? GW.disc.orgs.find((o) => o.id === saved.org.id) : null;
    if (want) gwPickOrg(want, true); else if (GW.disc.orgs.length === 1) gwPickOrg(GW.disc.orgs[0], true); else if (saved && saved.mode === 'flat') GW.noOrg = true;
  } else if (GW.org) gwLoadTree();
  if (GW.disc && !GW.billing.standard && GW.disc.billing[0]) { GW.billing.standard = GW.disc.billing[0].id; GW.billing.compliant = GW.billing.compliant || GW.disc.billing[0].id; }
  // landing zone already prepared earlier: go straight to the applications
  if (opts.startAt == null && saved && (GW.org || GW.noOrg) && GW.envs.length) GW.step = 3;
  gwDraw();
}

function gwApplySaved(l) {
  if (l.org && l.org.id) GW.org = { id: l.org.id, name: l.org.name || l.org.id };
  if (l.mode === 'flat') GW.noOrg = true;
  if (l.compliance && l.compliance.regime) GW.compliance = { regime: l.compliance.regime, location: l.compliance.location || GW.compliance.location };
  if (Array.isArray(l.envs) && l.envs.length) GW.envs = l.envs.map((e) => ({ name: e.name, tier: e.tier || tierOfName(e.name), protected: !!e.protected, regime: e.regime || '' }));
  else if (state.proj && state.proj.envs && state.proj.envs.length) GW.envs = state.proj.envs.map((e) => ({ name: e.name, tier: e.tier || tierOfName(e.name), protected: !!e.protected }));
  else GW.envs = GW_PRESETS[0][2].map(([name, tier]) => ({ name, tier, protected: tier === 'compliant' }));
  if (l.envFolders) GW.envFolders = { ...l.envFolders };
  if (l.billing) GW.billing = { standard: l.billing.standard || '', compliant: l.billing.compliant || '' };
  if (typeof l.guardrails === 'boolean') GW.guardrails = l.guardrails;
  if (typeof l.devEditor === 'boolean') GW.devEditor = l.devEditor;
  if (l.region) GW.region = l.region;
  if (l.sharedName) GW.sharedName = l.sharedName;
}

async function gwLoadApps() {
  const known = (state.proj && state.proj.apps) || {};
  const prev = new Map(GW.apps.map((a) => [a.dir.toLowerCase(), a]));
  let found = [];
  try { found = await inv('plugin:invoke', 'cns.build-tools', 'scan', [state.workspace]); } catch { found = []; }
  const dirs = [];
  for (const p of found) if (!dirs.some((d) => d.dir.toLowerCase() === p.dir.toLowerCase())) dirs.push({ dir: p.dir, tool: p.tool, toolName: p.toolName });
  if (!dirs.length) dirs.push({ dir: state.workspace, tool: '', toolName: 'Folder' });
  const names = new Set();
  const uniq = (base) => { let n = base; let k = 2; while (names.has(n)) n = `${base.slice(0, 17)}-${k++}`; names.add(n); return n; };
  GW.apps = dirs.map((d) => {
    const old = prev.get(d.dir.toLowerCase());
    if (old) { names.add(old.name); return old; }
    const existing = Object.entries(known).find(([, a]) => a.dir && a.dir.toLowerCase() === d.dir.toLowerCase());
    return { name: existing ? existing[0] : uniq(sanitizeApp(baseName(d.dir) || baseName(state.workspace))), dir: d.dir, tool: d.tool, toolName: d.toolName, include: true, mode: dirs.length > 1 ? 'shared' : 'create', projects: {}, prepare: true, access: true, move: false, linked: !!existing };
  });
}

/* ------------------------------ organization + folders ------------------------------ */

async function gwPickOrg(o, quiet) {
  GW.org = { id: o.id, name: o.name }; GW.noOrg = false; GW.tree = null;
  await gwLoadTree();
  if (!quiet) gwDraw();
}

/** Assured Workloads folders need at least 4 characters, so a Compliant "uat" is named "uat-env". Must match the plan builder. */
const gwFolderName = (e) => (e.tier === 'compliant' && e.name.length < 4 ? `${e.name}-env` : e.name);

async function gwLoadTree() {
  if (!GW.org) return;
  GW.treeBusy = true; gwDraw();
  const r = await gwCall('tree', GW.org.id);
  GW.treeBusy = false;
  if (r.ok) {
    GW.tree = r.data;
    GW.envFolders = {};
    for (const e of GW.envs) { const f = r.data.folders.find((x) => x.name.toLowerCase() === gwFolderName(e).toLowerCase()); if (f) GW.envFolders[e.name] = f.id; }
  } else { GW.tree = null; GW.msg = `Could not read the folders: ${r.error}`; }
  if (!GW.regimes) { const g = await gwCall('regimes'); if (g.ok) GW.regimes = g.data; }
  gwDraw();
}

/* ------------------------------ plan ------------------------------ */

function gwSpec() {
  return {
    org: GW.org, region: GW.region, guardrails: GW.guardrails && !!GW.org, devEditor: GW.devEditor, sharedName: GW.sharedName, compliance: GW.compliance, adminProject: (GW.disc && GW.disc.currentProject) || '',
    envs: GW.envs.map((e) => ({ name: e.name, tier: e.tier, protected: e.protected, regime: e.regime || '' })), billing: GW.billing, envFolders: GW.envFolders,
    apps: GW.apps.filter((a) => a.include).map((a) => ({ name: a.name, dir: a.dir, mapping: { mode: a.mode, projects: a.projects, prepare: a.prepare, access: a.access, move: a.move && !!GW.org } })),
  };
}

function gwSchedulePlan(ms = 400) {
  clearTimeout(GW.timer);
  GW.timer = setTimeout(async () => {
    if (GW.run) return;
    const my = ++GW.seq;
    GW.planning = true; GW.planErr = ''; gwDrawBody();
    const r = await tryInv('prov:wizardPlan', state.workspace, 'gcp', gwSpec());
    if (my !== GW.seq) return;
    GW.planning = false;
    if (r.ok) GW.plan = r.data; else { GW.plan = null; GW.planErr = r.error; }
    gwDraw();
  }, ms);
}

/* ------------------------------ drawing ------------------------------ */

function gwDraw() {
  const el = GW.el;
  if (!el) return;
  el.replaceChildren(h('div', { class: 'gw' },
    h('div', { class: 'gw-head' }, h('h2', { text: 'Google Cloud set-up' }), h('span', { class: 't-dim', text: GW.disc && GW.disc.account ? `signed in as ${GW.disc.account}` : '' })),
    gwStepper(), h('div', { id: 'gw-body' }, gwBody()), gwNav()));
}
function gwDrawBody() { const b = $('gw-body'); if (b) b.replaceChildren(gwBody()); const n = document.getElementById('gw-nav'); if (n) n.replaceWith(gwNav()); }

function gwStepper() {
  return h('ol', { class: 'gw-steps' }, ...GW_STEPS.map((s, i) => h('li', { class: `${i === GW.step ? 'on' : ''}${i < GW.step ? ' done' : ''}`, onclick: () => { if (!GW.run && i <= gwMaxStep()) { GW.step = i; if (i >= 4) gwSchedulePlan(50); gwDraw(); } } }, h('span', { class: 'n', text: i < GW.step ? '✔' : String(i + 1) }), h('span', { text: s }))));
}
function gwMaxStep() { return GW.org || GW.noOrg ? 5 : 0; }

function gwBody() {
  const fns = [stepOrg, stepEnvs, stepBilling, stepApps, stepReview, stepRun];
  return fns[GW.step]();
}

function gwNav() {
  const first = GW.step === 0;
  const last = GW.step === 5;
  const why = gwBlock();
  const next = h('button', { class: 'primary big', text: GW.step === 4 ? 'Provision…' : 'Next ▸', disabled: !!why || GW.planning || (GW.step === 4 && !(GW.plan && !gwBlockers().length)), title: why || '', onclick: () => gwNext() });
  return h('div', { id: 'gw-nav', class: 'gw-nav' },
    h('button', { text: '◂ Back', disabled: first || !!(GW.run && !GW.run.done), onclick: () => { GW.step = Math.max(0, GW.step - 1); gwDraw(); } }),
    h('span', { class: why ? 'gw-why' : 't-dim', style: 'flex:1', text: why || GW.msg || '' }),
    last ? null : next);
}

function gwBlockers() { return (GW.plan && GW.plan.clouds[0].blockers) || []; }

/** Why the Next button is off (empty = ready). */
function gwBlock() {
  if (GW.step === 0) return GW.discErr || (GW.org || GW.noOrg ? '' : 'Choose your organization (or continue without folders).');
  if (GW.step === 1) {
    const bad = GW.envs.find((e) => !ENV_OK.test(e.name));
    if (!GW.envs.length) return 'Add at least one environment.';
    if (bad) return `"${bad.name}" is not a valid environment name (lower-case letters and digits, up to 12).`;
    if (new Set(GW.envs.map((e) => e.name)).size !== GW.envs.length) return 'Each environment name must be unique.';
    return '';
  }
  if (GW.step === 2) { const used = ['standard', 'compliant'].filter((t) => GW.envs.some((e) => e.tier === t)); const miss = used.find((t) => !/^[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}$/.test(GW.billing[t]) && gwNeedsBilling(t)); return miss ? `Choose a billing account for the ${GW.tiers[miss].name} environments.` : ''; }
  if (GW.step === 3) {
    const inc = GW.apps.filter((a) => a.include);
    if (!inc.length) return 'Select at least one application.';
    const bad = inc.find((a) => !/^[a-z][a-z0-9-]{1,19}[a-z0-9]$/.test(a.name));
    if (bad) return `"${bad.name}" is not a valid application name (3-21 characters, lower-case letters, digits, "-").`;
    const nb = inc.flatMap((a) => (a.mode === 'existing' ? GW.envs.map((e) => a.projects[e.name]) : [])).find((id) => id && gwNoBilling(id));
    if (nb) return `${nb} has no billing account. Link it to a billing account in Google Cloud first, or pick another project.`;
    const miss = inc.find((a) => a.mode === 'existing' && GW.envs.some((e) => !a.projects[e.name]));
    if (!miss && inc.some((a) => a.mode === 'existing' && a.move && !GW.org)) return 'Moving projects into folders needs an organization.';
    if (miss) return `${miss.name}: choose an existing project for every environment, or change how it is associated.`;
    return '';
  }
  return '';
}
const gwNeedsBilling = (t) => GW.apps.some((a) => a.include && a.mode !== 'existing' && GW.envs.some((e) => e.tier === t));

async function gwNext() {
  if (GW.step === 4) return gwConfirm();
  GW.step += 1; GW.msg = '';
  if (GW.step === 2 && GW.disc && !GW.billing.standard && GW.disc.billing[0]) { GW.billing.standard = GW.disc.billing[0].id; GW.billing.compliant = GW.billing.compliant || GW.disc.billing[0].id; }
  if (GW.step === 1 && GW.org) await gwLoadTree();
  if (GW.step === 4) gwSchedulePlan(50);
  gwDraw();
}

/* ---- step 1: organization ---- */

function stepOrg() {
  const d = GW.disc;
  if (!d && !GW.discErr) return h('div', { class: 'card' }, h('p', { class: 'gw-wait', text: gwWaitText() }), h('div', { class: 'hint', text: 'Google Cloud answers slowly the first time. If this takes more than a minute, check that gcloud works in a terminal.' }), h('button', { text: 'Try again', onclick: () => gwInit({ startAt: GW.step }) }));
  if (GW.discErr) return h('div', { class: 'card' }, h('div', { class: 'msg err', text: GW.discErr }), h('div', { class: 'row' }, GW.disc && GW.disc.reauth ? h('button', { class: 'primary', text: 'Sign in to Google Cloud', onclick: async () => { await cloudLogin('gcp'); gwInit({ startAt: 0 }); } }) : null, h('button', { text: 'Try again', onclick: () => gwInit({ startAt: 0 }) })), GW.disc && GW.disc.reauth ? h('div', { class: 'hint', text: 'A browser window opens for the sign-in. When it is done, come back here: the wizard continues by itself.' }) : null);
  const cards = d.orgs.map((o) => h('div', { class: `gw-org${GW.org && GW.org.id === o.id ? ' on' : ''}`, onclick: () => gwPickOrg(o) }, h('b', { text: o.name }), h('span', { class: 't-dim', text: `organization ${o.id}` }), GW.org && GW.org.id === o.id ? h('span', { class: 'chip ok', text: 'selected' }) : null));
  return h('div', {},
    h('p', { class: 'hint', text: 'Environments in Google Cloud are folders, and folders live inside an organization. Choose the organization to build the landing zone in: it is created once and shared by all your applications.' }),
    d.orgs.length ? h('div', { class: 'gw-orgs' }, ...cards) : h('div', { class: 'card' }, h('b', { text: 'No organization found for this account' }),
      h('p', { class: 'hint', text: d.orgsDenied ? 'Listing organizations was not allowed for this account. Ask an administrator for the “Organization Viewer” role, or continue without folders.' : 'Personal Google accounts (gmail.com) have no organization, so folders cannot be created. A free Cloud Identity or Google Workspace organization adds them. You can continue now with projects side by side (labelled with their tier) and move them into folders later.' }),
      h('div', { class: 'row' }, h('button', { text: 'Check again', onclick: () => gwInit({ startAt: 0 }) }), h('button', { class: GW.noOrg ? 'primary' : '', text: GW.noOrg ? '✔ Continue without folders' : 'Continue without folders', onclick: () => { GW.noOrg = true; GW.org = null; gwDraw(); } })),
      h('div', { class: 'row' }, h('span', { class: 't-dim', text: 'Know your organization id?' }), (() => { const i = h('input', { placeholder: 'e.g. 123456789012', style: 'max-width:200px', spellcheck: 'false' }); const b = h('button', { text: 'Use it', onclick: () => { const v = i.value.trim(); if (!/^\d{6,20}$/.test(v)) return status('An organization id is a number of 6 to 20 digits (Cloud Console > IAM & Admin > Settings).', true); gwPickOrg({ id: v, name: `organization ${v}` }); } }); return h('span', { class: 'row' }, i, b); })())),
    GW.org ? gwTreeCard() : null);
}

function gwTreeCard() {
  const t = GW.tree;
  if (GW.treeBusy) return h('div', { class: 'card' }, 'Reading the folders of this organization…');
  if (!t) return h('div', { class: 'card' }, h('div', { class: 'msg err', text: GW.msg || 'The folders could not be read.' }), h('div', { class: 'hint', text: 'You can still continue: missing folders are created, and existing ones are found again when provisioning runs.' }));
  const names = new Set(GW.envs.map((e) => gwFolderName(e).toLowerCase()));
  return h('div', { class: 'card' }, h('b', { text: 'Folders already in this organization' }),
    t.folders.length ? h('div', { class: 'gw-found' }, ...t.folders.map((f) => h('span', { class: `chip${names.has(f.name.toLowerCase()) ? ' ok' : ''}`, title: names.has(f.name.toLowerCase()) ? 'Same name as an environment: it will be reused' : 'Left untouched', text: f.name }))) : h('div', { class: 'hint', text: 'None yet.' }),
    h('div', { class: 'hint', text: 'Green = has the name of an environment you will choose next and is reused instead of created. Everything else is left untouched.' }));
}

/* ---- step 2: environments ---- */

function stepEnvs() {
  const regimes = GW.regimes || { 'regional-controls': 'Regional controls (data location)' };
  const regimeSel = (value, onPick, allowDefault) => h('select', { class: 'gw-regime', onchange: (e) => onPick(e.target.value) }, ...(allowDefault ? [h('option', { value: '', text: 'default package', selected: !value })] : []), ...Object.entries(regimes).map(([id, label]) => h('option', { value: id, text: label, selected: id === value })));
  const col = (tier) => {
    const list = GW.envs.map((e, i) => ({ e, i })).filter((x) => x.e.tier === tier);
    const head = tier === 'standard'
      ? h('div', { class: 'gw-colh' }, h('span', { class: 'ico', text: '📁' }), h('b', { text: 'Standard folders' }))
      : h('div', {}, h('div', { class: 'gw-colh' }, h('span', { class: 'ico', text: '🛡' }), h('b', { text: 'Compliant folders' }), h('span', { class: 'chip', text: 'Assured Workloads' })),
        h('div', { class: 'row' }, h('span', { class: 't-dim', text: 'Compliance package' }), regimeSel(GW.compliance.regime, (v) => { GW.compliance.regime = v; gwDrawBody(); }, false)),
        h('div', { class: 'row' }, h('span', { class: 't-dim', text: 'Location' }), h('select', { onchange: (e) => { GW.compliance.location = e.target.value; } }, ['us-central1', 'us-east1', 'us', 'europe-west1', 'europe-west4', 'eu', 'asia-south1', 'asia-southeast1', 'australia-southeast1', 'northamerica-northeast1'].map((r) => h('option', { value: r, text: r, selected: r === GW.compliance.location })))));
    return h('div', { class: `gw-col ${tier}` }, head,
      h('div', { class: 'hint', text: tier === 'standard' ? 'A regular Google Cloud folder. For build, integration and test environments.' : 'A Google Cloud folder of type Compliant: an Assured Workloads folder. The compliance package restricts data locations and allowed services for every project inside, and turns on Access Transparency. For acceptance, pre-production and production.' }),
      ...list.map(({ e, i }) => {
        const bad = !ENV_OK.test(e.name) || GW.envs.filter((x) => x.name === e.name).length > 1;
        const inp = h('input', { value: e.name, class: `envname${bad ? ' bad' : ''}`, maxlength: 12, spellcheck: 'false' });
        inp.onchange = () => { delete GW.envFolders[e.name]; e.name = inp.value.trim().toLowerCase(); if (!e.__touched) e.tier = tierOfName(e.name); gwEnvChanged(); };
        const prot = h('input', { type: 'checkbox', checked: e.protected, onchange: (ev) => { e.protected = ev.target.checked; gwEnvChanged(true); } });
        const found = GW.envFolders[e.name];
        return h('div', { class: `envchip${e.protected ? ' prot' : ''}` }, inp,
          found ? h('span', { class: 'chip ok', title: `existing folder ${found} is reused`, text: 'exists' }) : null,
          tier === 'compliant' && e.name.length < 4 ? h('span', { class: 'chip', title: 'Assured Workloads folder names need at least 4 characters', text: `folder “${gwFolderName(e)}”` }) : null,
          tier === 'compliant' ? regimeSel(e.regime || '', (v) => { e.regime = v; }, true) : null,
          h('label', { class: 'inline small', title: 'Protected: typed confirmation before provisioning, read-only access for you' }, prot, ' protected'),
          h('button', { class: 'subtle', title: `Make it a ${tier === 'standard' ? 'Compliant' : 'Standard'} folder`, text: tier === 'standard' ? '⇨' : '⇦', onclick: () => { e.tier = tier === 'standard' ? 'compliant' : 'standard'; e.__touched = true; e.protected = e.tier === 'compliant'; gwEnvChanged(); } }),
          GW.envs.length > 1 ? h('button', { class: 'subtle', text: '✕', title: 'Remove', onclick: () => { GW.envs.splice(i, 1); gwEnvChanged(); } }) : null);
      }),
      h('button', { text: '+ Add environment', onclick: () => { let n = 1; while (GW.envs.some((x) => x.name === `env${n}`)) n++; GW.envs.push({ name: `env${n}`, tier, protected: tier === 'compliant', __touched: true }); gwEnvChanged(); } }));
  };
  return h('div', {},
    h('p', { class: 'hint', text: 'Every environment is a folder directly in the organization. Google Cloud has two folder types: Standard (dev, sit …) and Compliant (uat, preprod, prod …). Name the environments as you like and switch any of them between the two types.' }),
    h('div', { class: 'row wrap' }, h('span', { class: 't-dim', text: 'Quick choice:' }), ...GW_PRESETS.map(([n, d, list]) => h('button', { title: d, text: `${n}: ${d}`, onclick: () => { GW.envs = list.map(([name, tier]) => ({ name, tier, protected: tier === 'compliant' })); gwEnvChanged(); } }))),
    h('div', { class: 'gw-cols' }, col('standard'), col('compliant')),
    GW.envs.some((e) => e.tier === 'compliant') ? h('div', { class: 'scm-warn', text: GW.org ? 'Compliant folders are created with Assured Workloads (it needs the Assured Workloads Administrator role). Some compliance packages are a paid Google Cloud feature: see Assured Workloads pricing. If your organization has no access, that step fails with a clear message and the other environments still run.' : 'Compliant folders need an organization and Assured Workloads. Without an organization they are only a label on the projects.' }) : null,
    h('div', { class: 'card' },
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: GW.guardrails, disabled: !GW.org, onchange: (e) => { GW.guardrails = e.target.checked; } }), ' Add guardrails to the Standard folders (no default network in new projects)'),
      h('div', { class: 'hint', text: GW.org ? 'An organization policy, inherited by every project inside. Compliant folders get their controls from the compliance package.' : 'Guardrails need an organization.' }),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: GW.devEditor, onchange: (e) => { GW.devEditor = e.target.checked; } }), ' Give me Editor (not just read-only) on Standard projects'),
      h('label', { text: 'Default region' }), h('select', { onchange: (e) => { GW.region = e.target.value; } }, ['us-central1', 'us-east1', 'us-west1', 'europe-west1', 'europe-west4', 'asia-south1', 'asia-southeast1', 'australia-southeast1'].map((r) => h('option', { value: r, text: r, selected: r === GW.region })))));
}
function gwEnvChanged(redrawOnly) { gwDrawBody(); const st = document.querySelector('.gw-steps'); if (st && !redrawOnly) st.replaceWith(gwStepper()); if (GW.org && !redrawOnly) gwLoadTree(); }

/* ---- step 3: billing ---- */

function stepBilling() {
  const d = GW.disc || { billing: [] };
  const used = ['standard', 'compliant'].filter((t) => GW.envs.some((e) => e.tier === t));
  const pick = (t) => {
    const sel = h('select', { onchange: (e) => { GW.billing[t] = e.target.value; if (GW.sameBilling) for (const o of used) GW.billing[o] = e.target.value; gwDrawBody(); } },
      h('option', { value: '', text: 'Choose a billing account…' }), ...d.billing.map((b) => h('option', { value: b.id, text: `${b.name}  (${b.id})`, selected: b.id === GW.billing[t] })));
    const manual = h('input', { placeholder: 'or type a billing account id, e.g. 012345-6789AB-CDEF01', value: d.billing.some((b) => b.id === GW.billing[t]) ? '' : GW.billing[t], spellcheck: 'false' });
    manual.onchange = () => { GW.billing[t] = manual.value.trim().toUpperCase(); if (GW.sameBilling) for (const o of used) GW.billing[o] = GW.billing[t]; gwDrawBody(); };
    return h('div', { class: 'card' }, h('b', { text: `${GW.tiers[t].name} environments (${GW.envs.filter((e) => e.tier === t).map((e) => e.name).join(', ')})` }), sel, d.billing.length ? null : manual);
  };
  return h('div', {},
    h('p', { class: 'hint', text: 'Every project needs a billing account to use Cloud Run, Artifact Registry and most services. Creating the empty project itself costs nothing.' }),
    d.billing.length ? null : h('div', { class: 'scm-warn', text: d.billingDenied ? 'This account is not allowed to list billing accounts. Type the id below (ask a billing administrator for the “Billing Account User” role on it).' : 'No open billing account is visible to this account. Create one in the Cloud Console or ask a billing administrator for access.' }),
    used.length > 1 ? h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: GW.sameBilling, onchange: (e) => { GW.sameBilling = e.target.checked; if (GW.sameBilling) for (const o of used) GW.billing[o] = GW.billing[used[0]]; gwDrawBody(); } }), ' Use the same billing account for both') : null,
    ...used.map((t) => (GW.sameBilling && t !== used[0] ? null : pick(t))),
    GW.apps.some((a) => a.include && a.mode === 'existing') && !gwNeedsBilling('standard') && !gwNeedsBilling('compliant') ? h('div', { class: 'hint', text: 'All applications use existing projects, so no billing is needed.' }) : null);
}

/* ---- step 4: applications ---- */

function stepApps() {
  const inc = GW.apps.filter((a) => a.include);
  const bulk = h('div', { class: 'card gw-bulk' },
    h('b', { text: 'Associate the selected applications' }),
    h('div', { class: 'row wrap' },
      h('button', { text: 'Select all', onclick: () => { GW.apps.forEach((a) => (a.include = true)); gwDrawBody(); } }), h('button', { text: 'Select none', onclick: () => { GW.apps.forEach((a) => (a.include = false)); gwDrawBody(); } }),
      h('span', { class: 't-dim', text: `${inc.length} of ${GW.apps.length} selected` })),
    h('div', { class: 'row wrap' }, h('span', { class: 't-dim', text: 'Apply to all selected:' }),
      h('button', { title: 'Each application gets its own project in every environment folder', text: '◧ Own project per application', onclick: () => gwBulk('create') }),
      h('button', { title: 'All selected applications share one project per environment', text: '◫ One shared project per environment', onclick: () => gwBulk('shared') }),
      h('button', { title: 'Link them to projects that already exist', text: '🔗 Existing projects…', onclick: () => gwBulkExisting() })),
    GW.apps.some((a) => a.mode === 'shared') ? h('div', { class: 'row' }, h('span', { class: 't-dim', text: 'Shared project name:' }), h('input', { value: GW.sharedName, style: 'max-width:200px', spellcheck: 'false', onchange: (e) => { GW.sharedName = e.target.value.trim().toLowerCase() || 'platform'; gwDrawBody(); } })) : null);
  return h('div', {},
    h('p', { class: 'hint', text: `Each application in this workspace is associated with a Google Cloud project per environment (${GW.envs.map((e) => e.name).join(', ')}). By default every application gets its own projects inside the environment folders. Open more applications later and run this step again: the landing zone is reused.` }),
    bulk, gwQuotaNote(),
h('div', { class: 'gw-apps' }, ...GW.apps.map(gwAppRow)),
    h('div', { class: 'row' }, h('button', { text: '+ Add another application…', onclick: gwAddApp })));
}

function gwBulk(mode) { GW.apps.filter((a) => a.include).forEach((a) => { a.mode = mode; }); gwDrawBody(); }

async function gwEnsureProjects() {
  if (GW.projects || GW.projectsBusy) return;
  GW.projectsBusy = true; gwDrawBody();
  const r = await gwCall('projects');
  GW.projectsBusy = false;
  GW.projects = r.ok ? r.data : [];
  if (!r.ok) status(r.error, true);
  gwDrawBody();
}

/** The three things that can be done to a project that already exists. Nothing already in it is ever removed or replaced. */
function existingOptions(o, redraw) {
  const box = (key, label, hint, disabled) => h('label', { class: 'gw-opt', title: hint }, h('input', { type: 'checkbox', checked: !!o[key], disabled: !!disabled, onchange: (e) => { o[key] = e.target.checked; if (redraw) redraw(); } }), h('span', {}, h('b', { text: label }), h('small', { text: hint })));
  return h('div', { class: 'gw-opts' },
    box('prepare', 'Prepare it for Nativity', 'Turns on the needed APIs, adds an Artifact Registry repository and creates new service accounts cnd-<env>-sa, cnd-runtime-sa and cnd-cicd-sa with their roles. Existing roles, custom roles and service accounts stay exactly as they are.'),
    box('access', 'Give me access', 'Adds your Viewer role and the right to impersonate cnd-<env>-sa. Other people\u2019s permissions are untouched.'),
    box('move', 'Move it into the environment folder', GW.org ? 'The project joins the Standard / Compliant folder of its environment and then inherits that folder\u2019s roles and organization policies (guardrails too). Roles set on the project itself are kept. Needs Project Mover on the project.' : 'Needs an organization (folders).', !GW.org),
    h('div', { class: 'hint', text: 'All three off = just link the project to this application; nothing in Google Cloud changes.' }));
}

/** Projects this plan would create, and what the billing account already holds. Google limits projects per billing account (often 5 on newer accounts; it differs), so say it early. */
function gwQuotaNote() {
  const inc = GW.apps.filter((a) => a.include);
  const own = inc.filter((a) => a.mode === 'create').length * GW.envs.length;
  const shared = inc.some((a) => a.mode === 'shared') ? GW.envs.length : 0;
  const n = own + shared;
  if (!n) return null;
  const acct = ((GW.disc && GW.disc.billing) || []).find((b) => b.id === GW.billing.standard) || {};
  const used = typeof acct.used === 'number' ? acct.used : null;
  const tight = used != null ? used + n > 5 : n > 5;
  return h('div', { class: `card gw-quota${tight ? ' tight' : ''}` },
    h('b', { text: `${n} new project${n === 1 ? '' : 's'} will be linked to billing${used != null ? ` (this billing account already has ${used})` : ''}.` }),
    h('div', { class: 'hint', text: tight ? 'Google limits how many projects one billing account can hold, often 5 on newer accounts (yours may differ). This plan can go over that. Prefer one shared project per environment, or ask Google to raise the limit. The wizard cannot read your exact limit.' : 'One shared project per environment keeps this small. Google limits projects per billing account (often 5 on newer accounts; yours may differ).' }));
}

/** Existing projects that can be used: billing must be on (unknown = allowed, the plan checks again). */
const gwUsable = () => (GW.projects || []).filter((p) => p.billed !== false);
const gwNoBilling = (id) => { const p = (GW.projects || []).find((x) => x.id === id); return !!p && p.billed === false; };

function projectPicker(value, onPick, placeholder) {
  const list = (GW.projects || []);
  const inp = h('input', { value: value || '', list: 'gw-projects', placeholder: placeholder || 'project id', spellcheck: 'false', style: 'min-width:190px' });
  inp.onchange = () => onPick(inp.value.trim());
  return inp;
}

async function gwBulkExisting() {
  await gwEnsureProjects();
  const inc = GW.apps.filter((a) => a.include);
  if (!inc.length) return status('Select the applications first.', true);
  const inputs = GW.envs.map((e) => { const i = h('input', { placeholder: `project id for ${e.name}`, list: 'gw-projects', spellcheck: 'false' }); return [e, i]; });
  const opts = { prepare: true, access: true, move: false };
  const dl = h('datalist', { id: 'gw-projects' }, ...gwUsable().map((p) => h('option', { value: p.id, label: `${p.name} ${p.parent ? `· ${p.parent}` : ''}` })));
  const close = modal('Link the selected applications to existing projects', h('div', {}, h('p', { class: 'hint', text: `${inc.length} application(s) will use the same project for each environment. Pick or type the project ids.` }), dl,
    ...inputs.map(([e, i]) => h('div', { class: 'row' }, h('span', { class: 'envtag', text: e.name }), i)),
    existingOptions(opts)), [
    h('button', { text: 'Cancel', onclick: () => close() }),
    h('button', { class: 'primary', text: 'Apply', onclick: () => { for (const a of inc) { a.mode = 'existing'; a.prepare = opts.prepare; a.access = opts.access; a.move = opts.move; a.projects = {}; for (const [e, i] of inputs) if (i.value.trim()) a.projects[e.name] = i.value.trim(); } close(); gwDrawBody(); } })], { wide: true });
}

function gwAppRow(a) {
  const open = GW.openApp === a.name;
  const summary = a.mode === 'create' ? 'own project per environment' : a.mode === 'shared' ? `shared project “${GW.sharedName}”` : `existing projects${!a.prepare && !a.access && !a.move ? ' (link only)' : [a.move ? 'move into folder' : '', a.prepare ? 'prepare' : '', a.access ? 'my access' : ''].filter(Boolean).length ? ` (${[a.move ? 'move into folder' : '', a.prepare ? 'prepare' : '', a.access ? 'my access' : ''].filter(Boolean).join(', ')})` : ''}`;
  const nm = h('input', { value: a.name, class: 'gw-appname', spellcheck: 'false', maxlength: 21, onchange: (e) => { a.name = e.target.value.trim().toLowerCase(); gwDrawBody(); } });
  const head = h('div', { class: `gw-app${a.include ? '' : ' off'}` },
    h('input', { type: 'checkbox', checked: a.include, onchange: (e) => { a.include = e.target.checked; gwDrawBody(); } }),
    a.tool ? logo(a.tool === 'npm' ? 'npm' : a.tool, 18) : logo('build', 18), nm,
    h('span', { class: 't-dim gw-dir', title: a.dir, text: relOf(a.dir) || '(this folder)' }),
    a.linked ? h('span', { class: 'chip ok', title: 'Already associated with projects', text: 'associated' }) : null,
    h('span', { class: 'gw-sum', text: summary }),
    h('button', { class: 'subtle', text: open ? '▾ Details' : '▸ Details', onclick: () => { GW.openApp = open ? '' : a.name; if (!open && a.mode === 'existing') gwEnsureProjects(); gwDrawBody(); } }));
  if (!open) return head;
  const radio = (mode, label) => h('label', { class: 'inline' }, h('input', { type: 'radio', name: `m-${a.name}`, checked: a.mode === mode, onchange: () => { a.mode = mode; if (mode === 'existing') gwEnsureProjects(); gwDrawBody(); } }), ` ${label}`);
  return h('div', { class: 'gw-appbox' }, head,
    h('div', { class: 'gw-detail' },
      radio('create', 'Create a project for this application in each environment folder'), radio('shared', `Use the shared project “${GW.sharedName}” of each environment`), radio('existing', 'Use projects that already exist'),
      a.mode === 'existing' ? h('div', {}, h('datalist', { id: 'gw-projects' }, ...gwUsable().map((p) => h('option', { value: p.id, label: `${p.name} ${p.parent ? `· ${p.parent}` : ''}` }))), GW.projectsBusy ? h('div', { class: 'hint', text: 'Loading your projects…' }) : null,
        ...GW.envs.map((e) => h('div', { class: 'row' }, h('span', { class: 'envtag', text: e.name }), projectPicker(a.projects[e.name], (v) => { if (v) a.projects[e.name] = v; else delete a.projects[e.name]; gwDrawBody(); }, `existing project for ${e.name}`))),
        GW.envs.length > 1 && new Set(GW.envs.map((e) => a.projects[e.name])).size === 1 && a.projects[GW.envs[0].name] ? h('div', { class: 'hint', text: 'The same project is used for every environment, so it acts as one shared project. That is fine for a first set-up; environments are then separated by service account and labels, not by project.' }) : null,
        existingOptions(a, () => gwDrawBody())) : null));
}

async function gwAddApp() {
  const dir = await inv('dialog:selectFolder', 'Choose the application folder').catch(() => null);
  if (!dir) return;
  if (GW.apps.some((a) => a.dir.toLowerCase() === dir.toLowerCase())) return status('That folder is already in the list.', true);
  let base = sanitizeApp(baseName(dir));
  let n = 2;
  while (GW.apps.some((a) => a.name === base)) base = `${sanitizeApp(baseName(dir)).slice(0, 17)}-${n++}`;
  GW.apps.push({ name: base, dir, tool: '', toolName: 'Folder', include: true, mode: 'create', projects: {}, prepare: true, access: true, move: false });
  gwDrawBody();
}

/* ---- step 5: review ---- */

function stepReview() {
  if (GW.planning || (!GW.plan && !GW.planErr)) return h('div', { class: 'card' }, 'Working out the landing zone…');
  if (GW.planErr) return h('div', { class: 'card' }, h('div', { class: 'msg err', text: GW.planErr }));
  const pc = GW.plan.clouds[0];
  return h('div', {},
    h('h3', { text: pc.architecture.title }), h('p', { class: 'summary', text: pc.architecture.summary }), topologyNote(GW.apps.some((a) => a.include && a.tool)),
    ...(pc.blockers || []).map((b) => h('div', { class: 'msg err', text: `⛔ ${b}` })), ...(pc.warnings || []).map((w) => h('div', { class: 'msg warn', text: `⚠ ${w}` })),
    h('div', { class: 'archwrap' }, drawArchitecture(pc.architecture, '#4285f4')),
    h('div', { class: 'cols2' },
      h('div', {}, h('h4', { text: 'Who can do what' }), h('table', { class: 'acc' }, ...pc.architecture.access.map((x) => h('tr', {}, h('td', { class: 'who', text: x.who }), h('td', { text: x.how }), h('td', { class: 't-dim', text: x.what }))))),
      h('div', {}, h('h4', { text: 'Why it is built this way' }), h('ul', {}, ...pc.architecture.why.map((w) => h('li', { text: w }))), h('h4', { text: 'You need' }), h('ul', {}, ...pc.prerequisites.map((w) => h('li', { text: w }))))),
    h('div', { class: 'hint', text: `${GW.plan.totalSteps} steps: ${pc.summary}. Steps for things that already exist are skipped, so running it again is safe.` }),
    stepList(pc));
}

/* ---- step 6: provision ---- */

function gwConfirm() {
  const plan = GW.plan;
  if (!plan) return;
  const prot = plan.protectedEnvs;
  const typed = h('input', { placeholder: 'Type provision to continue' });
  const go = h('button', { class: 'primary', text: 'Provision now', disabled: prot.length > 0 });
  typed.oninput = () => (go.disabled = typed.value.trim() !== 'provision');
  const close = modal('Provision the landing zone', h('div', {},
    h('p', { text: `This creates ${GW.org ? 'the folders (where missing) and ' : ''}projects for ${GW.apps.filter((a) => a.include).length} application(s) in ${GW.envs.length} environment(s): ${plan.totalSteps} steps, one at a time. Existing folders and projects are reused.` }),
    h('p', { class: 'hint', text: 'Empty projects and folders are free. Billing starts only when you deploy paid services into a project.' }),
    prot.length ? h('p', { class: 'msg err', text: `Protected environment(s): ${prot.join(', ')}.` }) : null, prot.length ? typed : null),
  [h('button', { text: 'Cancel', onclick: () => close() }), Object.assign(go, { onclick: () => { close(); gwStart(typed.value.trim()); } })], { wide: true });
}

async function gwStart(typed) {
  const r = await tryInv('prov:run', GW.plan.token, typed);
  if (!r.ok) return status(r.error, true);
  GW.run = { id: r.data.runId, done: false, ok: 0, failed: 0, results: [], error: '', t0: Date.now(), now: '' };
  clearInterval(GW.tick); GW.tick = setInterval(gwTick, 1000);
  GW.ss = {}; LD.ss = GW.ss; GW.step = 5;
  gwDraw();
}

/** Elapsed time, estimated time left and the step that is running right now, refreshed every second. */
const gwFmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function gwTick() {
  const r = GW.run, el = document.querySelector('.runnow');
  if (!r || r.done) { clearInterval(GW.tick); if (el) el.textContent = ''; return; }
  if (!el) return;
  const total = GW.plan ? GW.plan.totalSteps : 0, did = r.ok + r.failed, ms = Date.now() - r.t0;
  const left = did > 1 && total > did ? ` · about ${gwFmt((ms / did) * (total - did))} left` : '';
  el.textContent = `Step ${Math.min(did + 1, total)} of ${total}: ${r.now || 'starting…'}  (${gwFmt(ms)} elapsed${left})`;
}

function gwGroupCounts(pc) {
  const m = new Map();
  for (const x of pc.steps) { const k = (x.group === 'folders' ? 'folders' : x.group || 'all') + (x.env ? ` · ${x.env}` : ''); const o = m.get(k) || { n: 0, d: 0, f: 0 }; o.n++; const st = (GW.ss[`${pc.id}|${x.id}`] || {}).status; if (['ok', 'skipped', 'warn'].includes(st)) o.d++; if (st === 'failed') o.f++; m.set(k, o); }
  return m;
}

function stepRun() {
  const r = GW.run;
  if (!r) return h('div', { class: 'card' }, 'Nothing is running.');
  const pc = GW.plan.clouds[0];
  const total = GW.plan.totalSteps;
  const pct = total ? Math.round(((r.ok + r.failed) / total) * 100) : 0;
  const result = r.done ? gwResult(pc) : null;
  return h('div', {},
    h('div', { class: 'card runcard' },
      h('div', { class: 'cardh' }, h('b', { text: r.done ? (r.failed || r.error ? 'Finished with problems' : 'Landing zone ready') : 'Provisioning…' }), h('span', { class: 'spacer' }), r.done ? null : h('button', { text: 'Stop after this step', onclick: () => tryInv('prov:cancel', r.id) })),
      h('div', { class: 'progress' }, h('div', { class: `bar${r.failed ? ' bad' : ''}`, style: `width:${pct}%` })),
      h('div', { class: 'runnow', text: r.done ? '' : 'Starting…' }),
      h('div', { class: 'rungroups' }, ...[...gwGroupCounts(pc).entries()].map(([k, o]) => h('span', { class: `chip${o.f ? ' bad' : o.d === o.n ? ' ok' : ''}`, 'data-g': k, text: `${k}: ${o.d}/${o.n}` }))),
      h('div', { class: 't-dim', text: `${r.ok + r.failed} of ${total} steps done${r.failed ? `, ${r.failed} failed` : ''}.` }), r.error ? h('div', { class: 'msg err', text: r.error }) : null),
    result, stepList(pc));
}

function gwResult(pc) {
  const done = new Map();
  for (const x of GW.run.results) for (const a of x.apps || []) done.set(a, true);
  const rec = pc.record || { apps: {} };
  const rows = Object.entries(rec.apps).map(([name, a]) => h('tr', {}, h('td', { class: 'who', text: name }), ...GW.envs.map((e) => { const t = (a.targets || {})[e.name]; return h('td', {}, t ? h('a', { href: '#', class: 'md-a', title: 'Open in the Cloud Console', text: t.scope, onclick: (ev) => { ev.preventDefault(); inv('shell:openExternal', `https://console.cloud.google.com/home/dashboard?project=${encodeURIComponent(t.scope)}`).catch(() => {}); } }) : '—', done.has(name) ? null : h('span', { class: 't-err', text: ' ?' })); })));
  const ok = GW.run.done && !GW.run.failed && !GW.run.error;
  return h('div', { class: 'card' },
    topologyNote(GW.apps.some((a) => a.include && a.tool)),
    h('b', { text: 'Where each application lives' }),
    h('table', { class: 'acc' }, h('tr', {}, h('td', { class: 'who', text: 'Application' }), ...GW.envs.map((e) => h('td', { class: 'who', text: e.name }))), ...rows),
    h('div', { class: 'hint', text: 'Saved in .nativity/project.json. Pick the application and environment in the Clouds view; the IDE then uses that project and impersonates its deployer account.' }),
    h('div', { class: 'row' }, h('button', { class: 'primary', text: 'Open Clouds view', onclick: () => showView('clouds') }), h('button', { text: ok ? 'Done' : 'Back to review', onclick: () => { if (ok) { const t = state.tabs.find((x) => x.kind === 'page' && x.id === 'gcpwizard'); if (t) closeTab(t); } else { GW.run = null; GW.step = 4; gwSchedulePlan(50); gwDraw(); } } })));
}

cns.on('prov:event', (ev) => {
  const r = GW.run;
  if (!r || ev.runId !== r.id) return;
  if (ev.type === 'step') {
    const key = `gcp|${ev.step}`;
    GW.ss[`gcp|${ev.step}`] = { status: ev.status, icon: { running: '⏳', ok: '✔', skipped: '↷', failed: '✘', warn: '⚠', pending: '○' }[ev.status] || '○', message: ev.message || '' };
    const row = document.querySelector(`.pstep[data-key="${CSS.escape(key)}"]`);
    if (row) {
      const st = row.querySelector('.st'); st.textContent = GW.ss[key].icon; st.className = `st ${ev.status}`;
      row.querySelector('.smsg').textContent = ev.message || '';
      if (ev.status === 'failed' || ev.status === 'running') { const det = row.closest('details'); if (det) det.open = true; row.scrollIntoView({ block: 'nearest' }); }
    }
    if (ev.status === 'running') { const st = GW.plan.clouds[0].steps.find((x) => x.id === ev.step); r.now = st ? st.title : ev.step; }
    if (['ok', 'skipped', 'warn'].includes(ev.status)) r.ok++;
    if (ev.status === 'failed') r.failed++;
    gwTick();
    const gc = gwGroupCounts(GW.plan.clouds[0]);
    document.querySelectorAll('.rungroups .chip').forEach((c) => { const o = gc.get(c.dataset.g); if (o) { c.textContent = `${c.dataset.g}: ${o.d}/${o.n}`; c.classList.toggle('ok', o.d === o.n); c.classList.toggle('bad', !!o.f); } });
    const bar = document.querySelector('.runcard .bar');
    if (bar && GW.plan.totalSteps) { bar.style.width = `${Math.round(((r.ok + r.failed) / GW.plan.totalSteps) * 100)}%`; bar.classList.toggle('bad', r.failed > 0); }
  } else if (ev.type === 'done') {
    r.done = true; r.error = ev.error || ''; r.results = ev.results || [];
    const saved = { org: GW.org, mode: GW.org ? 'folders' : 'flat', compliance: GW.compliance, envs: GW.envs.map((e) => ({ name: e.name, tier: e.tier, protected: e.protected, regime: e.regime || '' })), envFolders: GW.envFolders, billing: GW.billing, guardrails: GW.guardrails, devEditor: GW.devEditor, region: GW.region, sharedName: GW.sharedName };
    state.settings.gcp = { ...(state.settings.gcp || {}), landing: saved };
    tryInv('settings:set', 'gcp.landing', saved);
    loadProject().then(() => { refreshAllClouds(); gwDraw(); });
    GW.disc = null; tryInv('prov:discover', 'gcp', true).then((d) => { if (d.ok) GW.disc = d.data; });
    const bad = r.failed || r.error;
    status(bad ? 'Provisioning finished with problems. See the failed steps.' : 'Google Cloud landing zone ready and applications associated.', !!bad);
  } else if (ev.type === 'note') status(ev.message, true);
});
