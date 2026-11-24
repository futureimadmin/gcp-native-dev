/* Cloud Native architecture wizard (Google Cloud): choose services -> network and environments -> architecture diagram, identities
   -> Terraform -> provision the first environment. The other environments run the same Terraform from the CI/CD pipeline.
   Nothing is created until "Provision". */
'use strict';

const AW_STEPS = ['Services', 'Network', 'Architecture', 'Terraform', 'Provision'];
const AW_REGIONS = ['us-central1', 'us-east1', 'us-east4', 'us-west1', 'europe-west1', 'europe-west2', 'europe-west3', 'europe-west4', 'asia-south1', 'asia-southeast1', 'asia-northeast1', 'australia-southeast1'];
const OCTOPUS_URL = 'https://futureim.com/octopus-api-gateway';
const AW = { el: null, step: 0, catalog: null, sel: new Set(), gw: 'octopus', region: 'us-central1', nat: true, app: '', envs: [], preview: null, prevErr: '', file: 'main.tf', plan: null, planErr: '', run: null, ss: {}, busy: false, seq: 0, timer: null, tick: null, ready: false };

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
    AW.envs = envs.map((e, i) => ({ name: e.name, protected: !!e.protected, project: (tg[e.name] && tg[e.name].scope) || '', cidr: `10.${10 * (i + 1)}` }));
    const preset = AW.catalog.presets.find((x) => x.id === 'octopus-gke');
    awApplyPreset(preset, true);
    // an earlier run remembered its choices
    try {
      const f = joinPath(state.workspace, '.nativity' + BS + 'architecture.json');
      if (await inv('fs:exists', f)) {
        const s = JSON.parse(await inv('fs:readFile', f));
        if (Array.isArray(s.services)) { AW.sel = new Set(s.services.filter((id) => AW.catalog.services.some((x) => x.id === id && x.cat !== 'gateway'))); AW.gw = s.services.includes('octopus') ? 'octopus' : s.services.includes('apigee') ? 'apigee' : 'none'; }
        if (s.region) AW.region = s.region;
        if (s.options && typeof s.options.nat === 'boolean') AW.nat = s.options.nat;
      }
    } catch { /* first time */ }
    AW.ready = true;
  }
  AW.step = opts.startAt || 0;
  awDraw();
  awSchedule(0);
}

function awApplyPreset(p, quiet) {
  AW.sel = new Set(p.services.filter((id) => !['octopus', 'apigee'].includes(id)));
  AW.gw = p.services.includes('octopus') ? 'octopus' : p.services.includes('apigee') ? 'apigee' : 'none';
  if (!quiet) { awSchedule(0); awDrawBody(); }
}

function awSpec() {
  const ids = [...AW.sel];
  if (AW.gw !== 'none') ids.push(AW.gw);
  const cidr = {};
  for (const e of AW.envs) cidr[e.name] = e.cidr;
  return { app: AW.app, region: AW.region, env: AW.envs[0] && AW.envs[0].name, project: AW.envs[0] && AW.envs[0].project, services: ids, envs: AW.envs.map((e) => ({ name: e.name, protected: e.protected, project: e.project })), options: { nat: AW.nat, cidr } };
}

function awSchedule(ms = 250) {
  clearTimeout(AW.timer);
  AW.timer = setTimeout(async () => {
    const my = ++AW.seq;
    const r = await awCall('prov:archPreview', awSpec());
    if (my !== AW.seq) return;
    if (r.ok) { AW.preview = r.data; AW.prevErr = ''; } else { AW.preview = null; AW.prevErr = r.error; }
    awDrawBody();
  }, ms);
}

/* ------------------------------ frame ------------------------------ */

function awDraw() {
  if (!AW.el) return;
  AW.el.replaceChildren(h('div', { class: 'gw aw' },
    h('div', { class: 'gw-head' }, h('h2', { text: 'Cloud Native architecture' }), h('span', { class: 't-dim', text: `${AW.app} · Google Cloud` })),
    awStepper(), h('div', { id: 'aw-body' }, awBody()), awNav()));
}
function awDrawBody() { const b = document.getElementById('aw-body'); if (b) b.replaceChildren(awBody()); const n = document.getElementById('aw-nav'); if (n) n.replaceWith(awNav()); const s = document.getElementById('aw-stepper'); if (s) s.replaceWith(awStepper()); }

function awStepper() {
  return h('ol', { class: 'gw-steps', id: 'aw-stepper' }, ...AW_STEPS.map((s, i) => h('li', { class: `${i === AW.step ? 'on' : ''}${i < AW.step ? ' done' : ''}`, onclick: () => { if (!AW.run || AW.run.done) { AW.step = i; awDrawBody(); } } }, h('span', { class: 'n', text: i < AW.step ? '✔' : String(i + 1) }), h('span', { text: s }))));
}

function awBlock() {
  if (AW.step === 0) return AW.sel.size || AW.gw !== 'none' ? '' : 'Choose at least one service.';
  if (AW.step === 1) {
    if (!/^[a-z][a-z0-9-]{1,19}[a-z0-9]$/.test(AW.app)) return `"${AW.app}" is not a valid application name (3-21 characters, lower-case letters, digits, "-").`;
    const bases = AW.envs.map((e) => e.cidr);
    if (AW.envs.some((e) => !/^\d{1,3}\.\d{1,3}$/.test(e.cidr) || e.cidr.split('.').some((x) => Number(x) > 255))) return 'Address ranges look like 10.10 (the first two numbers of the environment’s /16).';
    if (new Set(bases).size !== bases.length) return 'Each environment needs its own address range, so the networks never overlap.';
    return '';
  }
  if (AW.step >= 2 && AW.prevErr) return AW.prevErr;
  return '';
}

function awNav() {
  const why = awBlock();
  const last = AW.step === AW_STEPS.length - 1;
  return h('div', { id: 'aw-nav', class: 'gw-nav' },
    h('button', { text: '◂ Back', disabled: AW.step === 0 || !!(AW.run && !AW.run.done), onclick: () => { AW.step = Math.max(0, AW.step - 1); awDrawBody(); } }),
    h('span', { class: why ? 'gw-why' : 't-dim', style: 'flex:1', text: why || '' }),
    last ? null : h('button', { class: 'primary big', text: 'Next ▸', disabled: !!why || (AW.step >= 1 && !AW.preview), onclick: () => { AW.step++; awDrawBody(); } }));
}

function awBody() {
  return [awStepServices, awStepNetwork, awStepArchitecture, awStepTerraform, awStepProvision][AW.step]();
}

/* ------------------------------ step 1: services ------------------------------ */

function awStepServices() {
  const cat = AW.catalog;
  const byId = (id) => cat.services.find((s) => s.id === id);
  const toggle = (id) => { if (AW.sel.has(id)) AW.sel.delete(id); else AW.sel.add(id); awSchedule(0); awDrawBody(); };
  const card = (s) => {
    const on = AW.sel.has(s.id) || (AW.gw !== 'none' && (byId(AW.gw).needs || []).includes(s.id));
    const forced = AW.gw !== 'none' && (byId(AW.gw).needs || []).includes(s.id);
    return h('label', { class: `aw-svc${on ? ' on' : ''}${forced ? ' forced' : ''}`, title: s.desc },
      h('input', { type: 'checkbox', checked: on, disabled: forced, onchange: () => toggle(s.id) }),
      h('span', { class: 'aw-ico', style: `background:${DG_KIND[s.id] || '#64748b'}` }, awGlyph(s.id)),
      h('span', { class: 'aw-txt' }, h('b', { text: s.name }), h('small', { text: s.desc }), forced ? h('em', { text: `needed by ${byId(AW.gw).name}` }) : null));
  };
  const gwCard = (id, title, badge, desc, note) => {
    const on = AW.gw === id;
    return h('div', { class: `aw-gw${on ? ' on' : ''}${id === 'octopus' ? ' rec' : ''}`, onclick: () => { AW.gw = id; awSchedule(0); awDrawBody(); } },
      h('div', { class: 'aw-gwh' }, h('input', { type: 'radio', name: 'aw-gw', checked: on }), h('b', { text: title }), badge ? h('span', { class: `chip${id === 'octopus' ? ' ok' : ''}`, text: badge }) : null),
      h('div', { class: 'hint', text: desc }),
      note ? h('div', { class: 'aw-note', text: note }) : null,
      id === 'octopus' ? h('a', { href: '#', class: 'md-a', text: 'About Octopus API Gateway ↗', onclick: (e) => { e.preventDefault(); e.stopPropagation(); inv('shell:openExternal', OCTOPUS_URL).catch(() => {}); } }) : null);
  };
  const oct = byId('octopus');
  const apg = byId('apigee');
  const section = (key, label) => h('div', {}, h('h4', { text: label }), h('div', { class: 'aw-grid' }, ...cat.services.filter((s) => s.cat === key).map(card)));
  return h('div', {},
    h('p', { class: 'hint', text: 'Choose what your application uses. The wizard draws the architecture, creates a service account for each workload with only the roles it needs, and writes the Terraform.' }),
    h('div', { class: 'row wrap' }, h('span', { class: 't-dim', text: 'Start from:' }), ...cat.presets.map((p) => h('button', { title: p.desc, text: p.name, onclick: () => awApplyPreset(p) }))),
    h('h4', { text: 'API gateway' }),
    h('div', { class: 'aw-gws' },
      gwCard('octopus', oct.name, 'Recommended', oct.desc, oct.note),
      gwCard('apigee', apg.name, 'Google-managed', apg.desc, apg.note),
      gwCard('none', 'No gateway', '', 'Expose your services directly (Cloud Run URL or a load balancer).', '')),
    section('compute', 'Compute'), section('data', 'Data'), section('messaging', 'Messaging'),
    h('div', {}, h('h4', { text: 'Security and edge' }), h('div', { class: 'aw-grid' }, ...cat.services.filter((s) => s.cat === 'security').map(card))),
    AW.preview && AW.preview.model.added.length ? h('div', { class: 'scm-warn', text: `Added because they are needed: ${AW.preview.model.added.map((id) => byId(id).name).join(', ')}.` }) : null);
}

function awGlyph(kind) {
  const g = sv('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: '#fff', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  for (const part of (DG_GLYPH[kind] || DG_GLYPH.ops)()) g.append(part);
  return g;
}

/* ------------------------------ step 2: network and environments ------------------------------ */

function awStepNetwork() {
  const appIn = h('input', { value: AW.app, maxlength: 21, spellcheck: 'false' });
  appIn.onchange = () => { AW.app = appIn.value.trim().toLowerCase(); awSchedule(0); awDrawBody(); };
  const reg = h('select', { onchange: (e) => { AW.region = e.target.value; awSchedule(0); awDrawBody(); } }, ...AW_REGIONS.map((r) => h('option', { value: r, text: r, selected: r === AW.region })));
  const nat = h('input', { type: 'checkbox', checked: AW.nat, onchange: (e) => { AW.nat = e.target.checked; awSchedule(0); awDrawBody(); } });
  const first = AW.envs[0];
  const rows = AW.envs.map((e, i) => {
    const proj = h('input', { value: e.project, placeholder: 'project id', spellcheck: 'false' });
    proj.onchange = () => { e.project = proj.value.trim(); awSchedule(0); awDrawBody(); };
    const cidr = h('input', { value: e.cidr, style: 'max-width:90px;font-family:var(--mono)', spellcheck: 'false' });
    cidr.onchange = () => { e.cidr = cidr.value.trim(); awSchedule(0); awDrawBody(); };
    const ok = /^\d{1,3}\.\d{1,3}$/.test(e.cidr);
    return h('tr', {}, h('td', { class: 'who' }, h('b', { text: e.name }), i === 0 ? h('span', { class: 'chip ok', text: 'provisioned now' }) : h('span', { class: 'chip', text: 'by the pipeline' }), e.protected ? h('span', { class: 'chip', text: 'protected' }) : null),
      h('td', {}, proj), h('td', {}, cidr), h('td', { class: 't-dim', style: 'font-family:var(--mono)', text: ok ? `${e.cidr}.0.0/16` : '—' }));
  });
  const missing = !first || !first.project;
  return h('div', {},
    h('p', { class: 'hint', text: 'Every environment gets its own VPC with its own address range, so they never overlap and can be connected later. You provision the first one now; the pipeline builds the others from the same Terraform.' }),
    h('div', { class: 'cols2' },
      h('div', { class: 'card' }, h('label', { text: 'Application name' }), appIn, h('label', { text: 'Region' }), reg,
        h('label', { class: 'inline' }, nat, ' Let private workloads reach the internet outbound (Cloud NAT). Nothing can reach them inbound.')),
      h('div', { class: 'card' }, h('b', { text: 'Private addresses' }),
        h('ul', { class: 'aw-list' }, h('li', { text: 'App subnet: workloads, with private access to Google APIs' }), h('li', { text: 'Data subnet: reserved for private endpoints' }),
          h('li', { text: 'GKE pods and services: secondary ranges of the app subnet' }), h('li', { text: 'Private service range: Cloud SQL, Memorystore and Apigee, peered into the VPC' })))),
    missing ? h('div', { class: 'scm-warn' }, 'The first environment has no Google Cloud project yet. ', h('button', { text: 'Set up the environments first', onclick: () => openGcpWizard() }), ' (folders, projects, billing), then come back, or type an existing project id below.') : null,
    h('table', { class: 'acc aw-envs' }, h('tr', {}, h('td', { class: 'who', text: 'Environment' }), h('td', { class: 'who', text: 'Google Cloud project' }), h('td', { class: 'who', text: 'Address range' }), h('td', { class: 'who', text: 'Network' })), ...rows));
}

/* ------------------------------ step 3: architecture ------------------------------ */

function awStepArchitecture() {
  if (!AW.preview) return h('div', { class: 'card' }, AW.prevErr ? h('div', { class: 'msg err', text: AW.prevErr }) : 'Drawing the architecture…');
  const m = AW.preview.model;
  const svgBox = h('div', { class: 'aw-diagram' });
  svgBox.append(renderArchitecture(m));
  const acct = (a) => h('details', { class: 'aw-acct', open: a.id === 'app' },
    h('summary', {}, h('b', { text: a.title }), h('code', { text: a.email }), h('span', { class: 'chip', text: `${a.roles.length} role${a.roles.length === 1 ? '' : 's'}` })),
    h('div', { class: 'hint', text: a.purpose }),
    h('table', { class: 'acc' }, ...a.roles.map((r) => h('tr', {}, h('td', { class: 'who' }, h('code', { text: r.role })), h('td', { class: 't-dim', text: r.scope }), h('td', { text: r.why || '' })))),
    a.grantable ? h('div', { class: 'hint', text: `It may grant only: ${a.grantable.join(', ')}. Anything else is refused by Google Cloud.` }) : null);
  const net = m.network;
  return h('div', {},
    h('div', { class: 'row' }, h('b', { text: `${m.app} · ${m.env}` }), h('span', { class: 'spacer' }),
      h('button', { text: 'Save diagram (SVG)', onclick: () => awSaveSvg(svgBox) })),
    svgBox,
    m.warnings.length ? h('div', { class: 'scm-warn' }, ...m.warnings.map((w) => h('div', { text: `• ${w}` }))) : null,
    h('div', { class: 'cols2' },
      h('div', {}, h('h4', { text: 'Identities: least privilege' }), h('p', { class: 'hint', text: 'Your code runs as its own service account. Roles are given on the single bucket, topic, secret or key where Google allows it, not on the whole project. Terraform has a separate identity that only provisioning uses.' }), ...m.accounts.map(acct)),
      h('div', {}, h('h4', { text: 'Network plan' }),
        h('table', { class: 'acc' },
          h('tr', {}, h('td', { class: 'who', text: 'VPC' }), h('td', { text: net.vpc }), h('td', { style: 'font-family:var(--mono)', text: net.cidr })),
          ...net.subnets.map((s) => h('tr', {}, h('td', { class: 'who', text: s.id === 'app' ? 'App subnet' : 'Data subnet' }), h('td', { class: 't-dim', text: s.purpose }), h('td', { style: 'font-family:var(--mono)', text: s.cidr }))),
          ...net.subnets.flatMap((s) => s.secondary.map((x) => h('tr', {}, h('td', { class: 'who', text: `GKE ${x.name}` }), h('td', { class: 't-dim', text: 'secondary range of the app subnet' }), h('td', { style: 'font-family:var(--mono)', text: x.cidr })))),
          net.gkeMaster ? h('tr', {}, h('td', { class: 'who', text: 'GKE control plane' }), h('td', { class: 't-dim', text: 'private endpoint range' }), h('td', { style: 'font-family:var(--mono)', text: net.gkeMaster })) : null,
          net.psa ? h('tr', {}, h('td', { class: 'who', text: 'Private services' }), h('td', { class: 't-dim', text: net.psa.purpose }), h('td', { style: 'font-family:var(--mono)', text: net.psa.cidr })) : null,
          h('tr', {}, h('td', { class: 'who', text: 'Outbound' }), h('td', { class: 't-dim', text: net.nat ? 'Cloud NAT, no inbound' : 'none: workloads have no internet access' }), h('td', { text: '' }))),
        h('div', { class: 'hint', text: `Other environments use their own /16: ${AW.envs.map((e) => `${e.name} ${e.cidr}.0.0/16`).join(', ')}.` }))));
}

async function awSaveSvg(box) {
  const svg = box.querySelector('svg');
  const css = getComputedStyle(document.documentElement);
  let text = new XMLSerializer().serializeToString(svg);
  // make the file self-contained: resolve the theme variables it uses
  text = text.replace(/var\((--[\w-]+)\)/g, (_m, v) => css.getPropertyValue(v).trim() || '#888');
  text = text.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  try {
    const dir = joinPath(state.workspace, 'docs');
    await inv('fs:create', dir, true).catch(() => {});
    const file = joinPath(dir, `${AW.app}-architecture-${AW.envs[0].name}.svg`);
    await inv('fs:writeFile', file, text);
    status(`Saved ${file}`);
    if (typeof refreshTree === 'function') refreshTree();
  } catch (e) { status(e.message, true); }
}

/* ------------------------------ step 4: Terraform ------------------------------ */

function awStepTerraform() {
  if (!AW.preview) return h('div', { class: 'card' }, AW.prevErr ? h('div', { class: 'msg err', text: AW.prevErr }) : 'Generating the Terraform…');
  const files = [...AW.preview.files, { path: '.github/workflows/infra.yml', content: AW.preview.workflow }];
  if (!files.some((f) => f.path === AW.file)) AW.file = files[0].path;
  const cur = files.find((f) => f.path === AW.file);
  return h('div', {},
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
    h('p', { class: 'hint', text: `Creates the network, identities and services of ${m ? m.services.length : 0} chosen services in ${env && env.project ? env.project : 'the project'} with Terraform. The other environments (${AW.envs.slice(1).map((e) => e.name).join(', ') || 'none'}) are built by the pipeline from the same code, in order, so nothing is changed by hand.`}));
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
    awDrawBody();
    if (typeof refreshTree === 'function') refreshTree();
  }
});
