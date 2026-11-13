/* Multi-cloud UI: accounts, sign-in, scope pickers, per-project Cloud Native binding, CI/CD / deploy / resources. */
'use strict';

const ENVS = ['dev', 'sit', 'uat', 'prod'];
const PROJ_DEFAULT = { enabled: false, cloud: 'gcp', scope: '', env: 'dev', region: '', service: '', repo: 'cnd-apps', group: '', impersonate: '' };

const cloudMeta = (id) => state.clouds.find((c) => c.id === id) || { id, name: id, short: id, scopeLabel: 'Scope', regions: [] };
const cnOn = () => !!(state.workspace && state.proj && state.proj.enabled);
const boundCloud = () => cloudMeta((state.proj || PROJ_DEFAULT).cloud);
const cloudSignedIn = (id) => !!(state.cloudStatus[id] && state.cloudStatus[id].signedIn);
const cnReady = () => cnOn() && cloudSignedIn(state.proj.cloud) && !!state.proj.scope;
const scopeShort = (s) => (s && s.length > 24 ? `${s.slice(0, 8)}…` : s || '');

/* ------------------------------ status ------------------------------ */

async function loadClouds() {
  const order = ['gcp', 'aws', 'azure', 'k8s'];
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  state.clouds = (await inv('cloud:list').catch(() => [])).sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

async function refreshCloud(id) {
  state.cloudStatus[id] = { ...(state.cloudStatus[id] || {}), loading: true };
  renderPills();
  const r = await tryInv('cloud:call', id, 'status', []);
  state.cloudStatus[id] = r.ok ? { ...r.data, loading: false } : { installed: false, signedIn: false, detail: r.error, loading: false };
  CNS.emit('cloud-status', id);
  applyMode();
  renderCloudView();
  if ($('home') && !$('home').classList.contains('hidden')) renderHome();
  return state.cloudStatus[id];
}

const refreshAllClouds = () => Promise.all(state.clouds.map((c) => refreshCloud(c.id)));

/* ------------------------------ project binding ------------------------------ */

async function loadProject() {
  state.proj = { ...PROJ_DEFAULT };
  if (state.workspace) {
    const r = await tryInv('proj:get', state.workspace);
    if (r.ok) state.proj = r.data;
  }
  applyMode();
  renderCloudView();
}

async function saveProject(patch) {
  const r = await tryInv('proj:set', state.workspace, patch);
  if (!r.ok) { status(r.error, true); throw new Error(r.error); }
  state.proj = r.data;
  applyMode();
  renderCloudView();
  return r.data;
}

function updateRootBadge() {
  const p = state.proj;
  const on = cnOn();
  document.querySelectorAll('.root-badge').forEach((b) => (b.textContent = on ? `☁ ${boundCloud().short} · ${scopeShort(p.scope) || 'no scope'} · ${p.env}` : ''));
}

/** Everything that changes with mode, project, env, or sign-in. */
function applyMode() {
  const on = cnOn();
  const p = state.proj || PROJ_DEFAULT;
  document.body.classList.toggle('cn-mode', on);
  document.body.dataset.env = on ? p.env : '';
  document.querySelectorAll('.cn-only').forEach((b) => b.classList.toggle('hidden', !on));
  document.querySelectorAll('.cn-action').forEach((b) => (b.disabled = !cnReady()));
  $('titlebar-mode').textContent = on ? 'CLOUD NATIVE' : '';
  const st = $('st-cn');
  st.classList.toggle('hidden', !on);
  st.textContent = on ? `☁ CLOUD NATIVE · ${boundCloud().short} · ${scopeShort(p.scope) || 'select ' + (boundCloud().scopeLabel || 'scope').toLowerCase()} · ${p.env}` : '';
  const signed = state.clouds.filter((c) => cloudSignedIn(c.id));
  $('st-cloud').textContent = signed.length ? `Signed in: ${signed.map((c) => c.short).join(', ')}` : 'No cloud sign-in';
  updateRootBadge();
  renderPills();
}

function renderPills() {
  const box = $('cloud-pills');
  if (!box) return;
  box.replaceChildren(...state.clouds.map((c) => {
    const s = state.cloudStatus[c.id] || {};
    const cls = s.loading ? 'pending' : s.signedIn ? 'ok' : 'off';
    return h('button', { class: 'pill', title: s.signedIn ? `${c.name}\n${s.identity || ''}${s.scope ? `\n${s.scope}` : ''}` : `${c.name}: not signed in`, onclick: () => { showView('clouds'); focusCloud(c.id); } },
      h('span', { class: `dot ${cls}` }), h('span', { text: c.short }), s.signedIn && s.scope ? h('small', { text: scopeShort(s.scope) }) : null);
  }));
}

/* ------------------------------ sign in / scope ------------------------------ */

cns.on('cloud:event', async ({ provider, evt, payload }) => {
  if (evt === 'log') log(String(payload).trim(), 't-dim');
  if (evt === 'done') {
    const s = await refreshCloud(provider);
    status(payload === 0 && s.signedIn ? `Signed in to ${cloudMeta(provider).name}.` : `${cloudMeta(provider).name}: sign-in did not complete. See OUTPUT.`, !(payload === 0 && s.signedIn));
    if (s.signedIn && !(s.scope) && cloudMeta(provider).kind !== 'private') chooseScope(provider);
    CNS.emit('cloud-signed-in', provider);
  }
});

async function cloudLogin(id) {
  const c = cloudMeta(id);
  const s = state.cloudStatus[id] || {};
  if (s.installed === false) {
    const body = h('div', {}, h('p', { text: `${c.short} command-line tools were not found on this computer.` }),
      h('p', { class: 'hint', text: 'Install them, restart the IDE (or click Refresh) and sign in again.' }));
    const close = modal(`${c.name} CLI not installed`, body, [
      h('button', { text: 'Close', onclick: () => close() }),
      c.installUrl ? h('button', { class: 'primary', text: 'Open install page', onclick: () => { inv('shell:openExternal', c.installUrl).catch(() => {}); close(); } }) : null,
    ]);
    return;
  }
  showPanel('output');
  status(`Signing in to ${c.name}…`);
  const r = await tryInv('cloud:call', id, 'login', []);
  if (!r.ok) status(r.error, true);
}

async function cloudLogout(id) {
  const c = cloudMeta(id);
  const s = state.cloudStatus[id] || {};
  if (!(await confirmBox(`Sign out of ${c.name}?`, `This signs out the ${c.short} command-line tools on this computer; other tools that use the same login are affected.`))) return;
  await tryInv('cloud:call', id, 'logout', [s.identity]);
  await refreshCloud(id);
}

async function chooseScope(id) {
  const c = cloudMeta(id);
  if (!cloudSignedIn(id)) return cloudLogin(id);
  const filter = h('input', { placeholder: `Filter ${c.scopeLabel.toLowerCase()}s…` });
  const list = h('div', { class: 'picklist' }, h('div', { class: 'empty', text: 'Loading…' }));
  const close = modal(`Select ${c.scopeLabel}`, h('div', {}, filter, list), [h('button', { text: 'Cancel', onclick: () => close() })]);
  const r = await tryInv('cloud:call', id, 'scopes', []);
  if (!r.ok) return list.replaceChildren(h('div', { class: 'empty t-err', text: r.error }));
  const current = (state.cloudStatus[id] || {}).scope;
  const draw = () => {
    const q = filter.value.toLowerCase();
    const shown = r.data.filter((p) => `${p.id} ${p.name} ${p.detail || ''}`.toLowerCase().includes(q));
    list.replaceChildren(...(shown.length ? shown : [null]).map((p) => p
      ? h('div', { class: 'pick' + (p.id === current ? ' cur' : ''), onclick: async () => {
          close();
          const s = await tryInv('cloud:call', id, 'setScope', [p.id]);
          if (!s.ok) return status(s.error, true);
          if (s.data && s.data.note) status(s.data.note);
          if (s.data && s.data.region && cnOn() && state.proj.cloud === id && !state.proj.region) saveProject({ region: s.data.region }).catch(() => {});
          if (state.workspace && state.proj && (state.proj.cloud === id || !state.proj.enabled)) { try { await saveProject({ cloud: id, scope: p.id }); } catch { /* shown */ } }
          await refreshCloud(id);
          loadInventory(id);
          status(`${c.scopeLabel}: ${p.name || p.id}`);
        } }, h('b', { text: p.name || p.id }), h('small', { text: p.detail || p.id }))
      : h('div', { class: 'empty', text: `No matching ${c.scopeLabel.toLowerCase()}s.` })));
  };
  filter.oninput = draw;
  draw();
  filter.focus();
}

/* ------------------------------ cloud sidebar view ------------------------------ */

const inventoryCache = {};
let focusedCloud = null;

function focusCloud(id) {
  focusedCloud = id;
  renderCloudView();
  loadInventory(id);
  const el = document.querySelector(`[data-cloud="${id}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

async function loadInventory(id) {
  const s = state.cloudStatus[id];
  if (!s || !s.signedIn) return;
  const bound = state.proj && state.proj.cloud === id && state.proj.scope;
  const scope = bound || s.scope;
  if (!scope) { inventoryCache[id] = { items: [], note: `Select a ${cloudMeta(id).scopeLabel.toLowerCase()} to list resources.` }; return renderCloudView(); }
  inventoryCache[id] = { loading: true, scope };
  renderCloudView();
  const opts = { impersonate: bound ? state.proj.impersonate : '', region: bound ? state.proj.region : '' };
  const r = await tryInv('cloud:call', id, 'inventory', [scope, opts]);
  inventoryCache[id] = r.ok ? { items: r.data, scope } : { error: r.error, scope };
  renderCloudView();
}

function inventoryNode(id) {
  const inv_ = inventoryCache[id];
  if (!inv_) return h('div', { class: 'hint', text: 'Click Refresh to list what you can use.' });
  if (inv_.loading) return h('div', { class: 'empty', text: 'Loading…' });
  if (inv_.error) return h('div', { class: 'empty t-err', text: `Unable to list: ${inv_.error}` });
  if (inv_.note) return h('div', { class: 'empty', text: inv_.note });
  if (!inv_.items.length) return h('div', { class: 'empty', text: 'Nothing accessible found for this identity.' });
  const by = new Map();
  for (const it of inv_.items) by.set(it.category, [...(by.get(it.category) || []), it]);
  return h('div', {}, ...[...by.entries()].flatMap(([cat, list]) => [
    h('div', { class: 'cat', text: cat }),
    ...list.map((it) => h('div', { class: 'svc', title: it.error || 'Open in console', onclick: () => it.url && inv('shell:openExternal', it.url).catch(() => {}) },
      h('span', { text: it.title }), h('small', { class: it.error ? 't-err' : '', text: it.detail || '' }))),
  ]));
}

function cloudCard(c) {
  const s = state.cloudStatus[c.id] || {};
  const open = focusedCloud === c.id;
  const dot = s.loading ? 'pending' : s.signedIn ? 'ok' : 'off';
  const head = h('div', { class: 'cardh clickable', onclick: () => { focusedCloud = open ? null : c.id; renderCloudView(); if (!open) loadInventory(c.id); } },
    h('span', { class: `dot ${dot}` }), h('b', { text: c.name }), h('span', { class: 'chip', text: c.kind === 'private' ? 'private' : 'public' }), h('span', { class: 'spacer' }), h('span', { class: 'caret', text: open ? '▾' : '▸' }));
  const card = h('div', { class: 'card ccard', 'data-cloud': c.id, style: `border-left: 3px solid ${c.color}` }, head,
    h('div', { class: 'hint', text: s.loading ? 'Checking…' : s.signedIn ? `${s.identity || 'Signed in'}${s.detail ? ` · ${s.detail}` : ''}` : s.installed === false ? `${c.short} CLI not installed` : s.detail || 'Not signed in' }));
  if (open) {
    card.append(
      h('div', { class: 'row' },
        s.signedIn ? h('button', { text: `${s.scope ? 'Change' : 'Select'} ${c.scopeLabel.toLowerCase()}${s.scope ? ` (${scopeShort(s.scope)})` : ''}…`, onclick: () => chooseScope(c.id) }) : null,
        s.signedIn ? h('button', { text: 'Refresh', onclick: () => { refreshCloud(c.id).then(() => loadInventory(c.id)); } }) : null,
        s.signedIn && c.kind !== 'private' ? h('button', { class: 'subtle', text: 'Sign out', onclick: () => cloudLogout(c.id) }) : null,
        !s.signedIn ? h('button', { class: 'primary', text: c.kind === 'private' ? 'Connect…' : 'Sign in', onclick: () => cloudLogin(c.id) }) : null),
      s.signedIn ? h('div', { class: 'inv' }, inventoryNode(c.id)) : null);
  } else if (!s.signedIn && !s.loading) {
    card.append(h('div', { class: 'row' }, h('button', { class: 'primary', text: c.kind === 'private' ? 'Connect…' : 'Sign in', onclick: () => cloudLogin(c.id) })));
  }
  return card;
}

function bindingPanel() {
  if (!state.workspace) return h('div', { class: 'card' }, h('b', { text: 'Cloud Native Development' }), h('div', { class: 'hint', text: 'Open a project to connect it to a cloud, run CI/CD, create resources and deploy.' }));
  const p = state.proj || PROJ_DEFAULT;
  if (!p.enabled) {
    return h('div', { class: 'card' }, h('b', { text: 'Cloud Native Development' }),
      h('div', { class: 'hint', text: `${baseName(state.workspace)} is not connected to a cloud. Enable it to run CI/CD, create cloud resources and deploy from the IDE.` }),
      h('div', { class: 'row' }, h('button', { class: 'primary', text: 'Enable Cloud Native Development', onclick: enableMode })));
  }
  const c = boundCloud();
  const cloudSel = h('select', { onchange: (e) => saveProject({ cloud: e.target.value }).then(() => { const id = e.target.value; if (cloudSignedIn(id) && !state.proj.scope && (state.cloudStatus[id] || {}).scope) saveProject({ scope: state.cloudStatus[id].scope }).catch(() => {}); }).catch(() => {}) },
    state.clouds.map((x) => h('option', { value: x.id, text: x.name, selected: x.id === p.cloud })));
  const envSel = h('select', { onchange: (e) => switchEnv(e.target.value) }, ENVS.map((e) => h('option', { value: e, text: e, selected: e === p.env })));
  const regionSel = c.regions && c.regions.length > 1
    ? h('select', { onchange: (e) => saveProject({ region: e.target.value }).catch(() => {}) }, c.regions.map((r) => h('option', { value: r, text: r, selected: r === p.region })))
    : null;
  const group = c.id === 'azure' ? h('input', { value: p.group, placeholder: 'resource group', onchange: (e) => saveProject({ group: e.target.value.trim() }).catch(() => {}) }) : null;
  const sa = c.id === 'gcp' ? h('select', { id: 'impersonate-select', onchange: (e) => setImpersonation(e.target.value) }, h('option', { value: '', text: 'My user credentials' }),
    p.scope ? ['env', 'dev', 'cicd', 'obs'].map((k) => { const v = `cnd-${k === 'env' ? p.env : k}-sa@${p.scope}.iam.gserviceaccount.com`; return h('option', { value: v, text: v.split('@')[0], selected: v === p.impersonate }); }) : []) : null;

  const act = (label, fn, cn = true) => h('button', { class: cn ? 'cn-action' : '', text: label, onclick: fn, disabled: cn ? !cnReady() : false });
  return h('div', { class: 'card cn' },
    h('div', { class: 'cardh' }, h('b', { text: 'Cloud Native Development' }), h('span', { class: 'chip ok', text: 'on' })),
    h('label', { text: 'Cloud' }), cloudSel,
    h('label', { text: c.scopeLabel }),
    h('button', { class: 'wide', text: p.scope ? `Change ${c.scopeLabel.toLowerCase()} (${scopeShort(p.scope)})…` : `Select ${c.scopeLabel.toLowerCase()}…`, onclick: () => chooseScope(p.cloud) }),
    h('label', { text: 'Environment' }), envSel,
    regionSel ? h('label', { text: 'Region' }) : null, regionSel,
    group ? h('label', { text: 'Resource group' }) : null, group,
    sa ? h('label', { text: 'Run as (least privilege)' }) : null, sa,
    h('label', { text: 'Actions' }),
    h('div', { class: 'actgrid' },
      act('Run CI/CD', runPipeline), act('Deploy', deployNow), act('Create resource…', createResource),
      act('Generate pipeline', generatePipeline, false), act('Bootstrap (Terraform)', bootstrapDialog, false), act('Open console', openConsole)),
    h('button', { class: 'wide subtle', text: 'Disable Cloud Native Development', onclick: disableMode }));
}

function renderCloudView() {
  const box = $('cloud-list');
  if (!box) return;
  box.replaceChildren(bindingPanel(), h('div', { class: 'cat bar', text: 'Cloud accounts' }), ...state.clouds.map(cloudCard));
  applyModeButtonsOnly();
}

function applyModeButtonsOnly() {
  document.querySelectorAll('.cn-action').forEach((b) => (b.disabled = !cnReady()));
}

/* ------------------------------ enable / disable / environment ------------------------------ */

async function enableMode() {
  if (!state.workspace) return status('Open a folder first.', true);
  // Prefer a cloud you are signed in to.
  const cur = (state.proj || PROJ_DEFAULT).cloud;
  const signed = state.clouds.filter((c) => cloudSignedIn(c.id));
  const cloud = cloudSignedIn(cur) || !signed.length ? cur : signed[0].id;
  const patch = { enabled: true, cloud };
  const st = state.cloudStatus[cloud];
  if (st && st.signedIn && st.scope && !(state.proj && state.proj.scope)) patch.scope = st.scope;
  try { await saveProject(patch); } catch { return; }
  showView('clouds');
  status('Cloud Native Development enabled for this project.');
  if (!cloudSignedIn(state.proj.cloud)) cloudLogin(state.proj.cloud);
  else if (!state.proj.scope) chooseScope(state.proj.cloud);
  renderHome();
}

async function disableMode() {
  if (!(await confirmBox('Turn off Cloud Native Development for this project?', 'Nothing in the cloud is changed. Your .cnd/project.json is kept.'))) return;
  try { await saveProject({ enabled: false }); } catch { return; }
  status('Cloud Native Development disabled.');
  renderHome();
}

async function switchEnv(env) {
  if (!cnOn() || env === state.proj.env) return;
  try { await saveProject({ env, impersonate: '' }); } catch { return; }
  status(env === 'prod' ? 'Environment: PROD. Cloud-changing actions need extra confirmation.' : `Environment: ${env}`);
}

function switchEnvDialog() {
  if (!cnOn()) return status('Enable Cloud Native Development first.', true);
  const close = modal('Switch environment', h('div', { class: 'envpick' }, ENVS.map((e) => h('button', { class: e === state.proj.env ? 'primary' : '', text: e, onclick: () => { close(); switchEnv(e); } }))), [h('button', { text: 'Cancel', onclick: () => close() })]);
}

async function setImpersonation(sa) {
  try { await saveProject({ impersonate: sa }); status(sa ? `Running as ${sa}` : 'Using your user credentials.'); loadInventory(state.proj.cloud); } catch { /* shown */ }
}

/* ------------------------------ CI/CD, deploy, resources ------------------------------ */

function requireReady() {
  if (!cnOn()) { status('Enable Cloud Native Development first.', true); return false; }
  if (!cloudSignedIn(state.proj.cloud)) { status(`Sign in to ${boundCloud().name} first.`, true); cloudLogin(state.proj.cloud); return false; }
  if (!state.proj.scope) { status(`Select a ${boundCloud().scopeLabel.toLowerCase()} first.`, true); chooseScope(state.proj.cloud); return false; }
  return true;
}

async function generatePipeline() {
  if (!cnOn()) return status('Enable Cloud Native Development first.', true);
  let r = await tryInv('pipeline:generate', state.workspace, false);
  if (!r.ok && r.error === 'EXISTS') {
    if (!(await confirmBox('A pipeline file already exists. Overwrite it?', 'Your changes to the file will be lost.'))) return;
    r = await tryInv('pipeline:generate', state.workspace, true);
  }
  if (!r.ok) return status(r.error, true);
  await refreshTree();
  openFile(r.data);
  status(`Wrote ${baseName(r.data)}. Review it, then run the pipeline.`);
}

/** Shows the exact command; requires a click (and typing "prod" for production); then runs it. */
function confirmCommand(info, what) {
  return new Promise((resolve) => {
    const isProd = info.env === 'prod';
    const typed = h('input', { placeholder: 'Type prod to continue' });
    const run = h('button', { class: 'primary', text: 'Run', disabled: isProd });
    typed.oninput = () => (run.disabled = typed.value.trim() !== 'prod');
    const body = h('div', {}, h('p', { text: what }),
      h('div', { class: 'kv' }, `${info.cloud}: `, h('b', { text: info.scope }), '   Environment: ', h('b', { class: isProd ? 't-err' : '', text: info.env })),
      h('label', { text: 'Command' }), h('pre', { text: info.command }),
      isProd ? h('p', { class: 'msg err', text: 'This targets PRODUCTION.' }) : null, isProd ? typed : null);
    const close = modal(info.title, body, [
      h('button', { text: 'Cancel', onclick: () => { close(); resolve(false); } }),
      Object.assign(run, { onclick: () => { close(); resolve(true); } }),
    ], { wide: true });
  });
}

async function runCloud(kind, params, what) {
  if (!requireReady()) return;
  const r = await tryInv('cloud:prepare', state.workspace, kind, params);
  if (!r.ok) {
    if (kind === 'pipeline' && /no such file|ENOENT/i.test(r.error)) return generatePipeline();
    return status(r.error, true);
  }
  if (!(await confirmCommand(r.data, what))) return;
  const run = await tryInv('cloud:run', r.data.token);
  if (!run.ok) return status(run.error, true);
  showPanel('terminal');
  termPrint(`> ${r.data.command}\n`, 't-cmd');
  runningId = run.data.id;
  state.cloudRuns.set(run.data.id, run.data.title);
}

const runPipeline = async () => {
  if (!requireReady()) return;
  const ps = await tryInv('pipeline:status', state.workspace);
  if (ps.ok && ps.data.supported && !ps.data.hasPipeline && state.proj.cloud === 'gcp') {
    if (await confirmBox('No pipeline file in this project. Generate one now?', 'You can review it before running.')) await generatePipeline();
    return;
  }
  return runCloud('pipeline', {}, 'Run the cloud CI/CD pipeline for the active environment.');
};
const deployNow = () => runCloud('deploy', {}, 'Deploy this project to the active environment.');

async function createResource() {
  if (!requireReady()) return;
  const kinds = await tryInv('cloud:resourceKinds', state.workspace);
  if (!kinds.ok || !kinds.data.length) return status(kinds.ok ? 'This cloud has no resource templates.' : kinds.error, true);
  const type = h('select', {}, kinds.data.map((k) => h('option', { value: k.id, text: k.label })));
  const name = h('input', { value: kinds.data[0].defaultName });
  type.onchange = () => (name.value = kinds.data.find((k) => k.id === type.value).defaultName);
  const close = modal('Create cloud resource', h('div', {}, h('label', { text: 'Resource type' }), type, h('label', { text: 'Name' }), name,
    h('p', { class: 'hint', text: `In ${boundCloud().name} · ${state.proj.scope} (${state.proj.env}). You will review the command before it runs.` })), [
    h('button', { text: 'Cancel', onclick: () => close() }),
    h('button', { class: 'primary', text: 'Next', onclick: () => { close(); runCloud('resource', { type: type.value, name: name.value.trim() }, `Create ${kinds.data.find((k) => k.id === type.value).label} "${name.value.trim()}".`); } }),
  ]);
}

async function bootstrapDialog() {
  if (!cnOn()) return status('Enable Cloud Native Development first.', true);
  const checks = ENVS.map((e) => h('input', { type: 'checkbox', value: e, checked: true }));
  const msg = h('div', { class: 'msg' });
  const close = modal('Bootstrap environments (Terraform)', h('div', {},
    h('p', { class: 'hint', text: `Generates infrastructure-as-code for ${boundCloud().name} into your project. Nothing is applied to your cloud account.` }),
    h('div', { class: 'checks' }, checks.map((c) => h('label', {}, c, ` ${c.value}`))), msg), [
    h('button', { text: 'Cancel', onclick: () => close() }),
    h('button', { class: 'primary', text: 'Generate', onclick: async () => {
      const envs = checks.filter((c) => c.checked).map((c) => c.value);
      let r = await tryInv('cloud:bootstrap', state.workspace, envs, false);
      if (!r.ok && r.error === 'EXISTS') {
        if (!(await confirmBox('The Terraform file already exists. Overwrite it?', 'Your changes to the file will be lost.'))) return;
        r = await tryInv('cloud:bootstrap', state.workspace, envs, true);
      }
      if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error; return; }
      close();
      await refreshTree();
      openFile(r.data);
      status('Wrote Terraform. Review it, then run terraform init and terraform apply.');
    } }),
  ]);
}

async function openConsole() {
  if (!cnOn()) return;
  const r = await tryInv('cloud:call', state.proj.cloud, 'consoleUrl', [state.proj.scope, state.proj.region]);
  if (r.ok && r.data) inv('shell:openExternal', r.data).catch((e) => status(e.message, true));
}

/* ------------------------------ context menu for the project ------------------------------ */

function projectMenuItems() {
  const on = cnOn();
  const p = state.proj || PROJ_DEFAULT;
  const c = boundCloud();
  const items = [{ label: on ? 'Disable Cloud Native Development' : 'Enable Cloud Native Development', run: on ? disableMode : enableMode }];
  if (on) {
    const ready = cnReady();
    const s = state.cloudStatus[p.cloud] || {};
    items.push('-',
      { label: 'Run CI/CD Pipeline', run: runPipeline, disabled: !ready },
      { label: 'Deploy', run: deployNow, disabled: !ready },
      { label: 'Create Cloud Resource…', run: createResource, disabled: !ready },
      { label: 'Generate CI/CD Pipeline', run: generatePipeline },
      '-',
      { label: `Switch Environment (${p.env})…`, run: switchEnvDialog },
      { label: p.scope ? `Change ${c.scopeLabel} (${scopeShort(p.scope)})…` : `Select ${c.scopeLabel}…`, run: () => chooseScope(p.cloud), disabled: !s.signedIn },
      { label: s.signedIn ? `Sign Out of ${c.short}` : `Sign In to ${c.short}`, run: () => (s.signedIn ? cloudLogout(p.cloud) : cloudLogin(p.cloud)) },
      '-',
      { label: 'Bootstrap Environments (Terraform)…', run: bootstrapDialog },
      { label: 'Assess for Migration…', run: () => CNS.run('modernize.assess') },
      { label: 'Open Cloud Console', run: openConsole });
  } else {
    items.push('-', { label: 'Assess for Migration…', run: () => CNS.run('modernize.assess') });
  }
  return items;
}
