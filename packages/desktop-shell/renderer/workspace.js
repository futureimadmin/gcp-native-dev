/* Workspace: opening/closing projects, File > New Project, Import from GitHub / Git, and the Workspace home screen. */
'use strict';

async function openFolderDialog() {
  const dir = await inv('dialog:selectFolder', 'Open project folder').catch(() => null);
  if (dir) await openFolder(dir);
}

async function openFolder(dir) {
  if (!dir) return;
  if (!(await inv('fs:exists', dir).catch(() => false))) return status(`Folder not found: ${dir}`, true);
  if (state.tabs.some((t) => t.kind === 'file' && t.model.getValue() !== t.saved) && !(await confirmBox('Open another folder?', 'Unsaved changes in open files will be lost.'))) return;
  closeAllFileTabs();
  state.workspace = dir;
  state.cwd = dir;
  $('workspace-name').textContent = baseName(dir);
  $('term-prompt').textContent = promptStr();
  await tryInv('app:setWorkspace', dir);
  await tryInv('app:addRecent', dir);
  // every project gets a .nativity folder (cloud binding, personal session, logs): see src/core/nativity.js
  const ns = await tryInv('nativity:ensure', dir);
  state.wsState = ns.ok && ns.data ? ns.data.state : { tabs: [], active: '', build: {}, advisor: {} };
  state.wsNew = !!(ns.ok && ns.data && ns.data.created);
  await loadProject();
  await refreshTree();
  tryInv('app:refreshMenu');
  detectBuildEnv();
  showView('explorer');
  showHome();
  status(`Opened ${baseName(dir)}${state.wsNew ? ' (created the .nativity folder)' : ''}`);
  restoreSession();
}

/** Reopens the files that were open last time (from .nativity/workspace.json). */
async function restoreSession() {
  const s = state.wsState;
  if (!s || !Array.isArray(s.tabs) || !s.tabs.length) return;
  state.restoring = true;
  try {
    for (const rel of s.tabs) { const f = joinPath(state.workspace, String(rel).split('/').join(BS)); if (await inv('fs:exists', f).catch(() => false)) await openFile(f); }
    const act = state.tabs.find((t) => t.kind === 'file' && normPath(t.path) === normPath(joinPath(state.workspace, String(s.active || '').split('/').join(BS))));
    if (act) activate(act);
  } finally { state.restoring = false; }
}

let sessionTimer = null;
function saveSession() {
  if (!state.workspace || state.restoring) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    const rel = (p) => relOf(p).split(BS).join('/');
    const files = state.tabs.filter((t) => t.kind === 'file' && normPath(t.path).startsWith(normPath(state.workspace) + BS));
    const patch = { tabs: files.map((t) => rel(t.path)), active: state.active && state.active.kind === 'file' ? rel(state.active.path) : '' };
    state.wsState = { ...(state.wsState || {}), ...patch };
    tryInv('nativity:set', state.workspace, patch);
  }, 900);
}
CNS.on('tab-activated', saveSession);

async function closeFolder() {
  if (!state.workspace) return;
  if (state.tabs.some((t) => t.kind === 'file' && t.model.getValue() !== t.saved) && !(await confirmBox('Close folder?', 'Unsaved changes will be lost.'))) return;
  closeAllFileTabs();
  state.workspace = null;
  state.wsState = null;
  state.cwd = null;
  state.proj = null;
  $('workspace-name').textContent = '';
  await tryInv('app:setWorkspace', null);
  applyMode();
  await refreshTree();
  detectBuildEnv();
  showHome();
}

/* ------------------------------ New Project ------------------------------ */

async function newProjectDialog() {
  let templates = [];
  try { templates = await inv('project:templates'); } catch (e) { return status(e.message, true); }
  if (!templates.length) return status('No project templates are installed.', true);
  const cloudName = (id) => (state.clouds.find((c) => c.id === id) || {}).short || '';

  // Cloud Native Project comes first: an application that runs the same way in every environment (a container), a cloud, the
  // environments and a pipeline that promotes one build through them. The other entries are plain templates.
  const stacks = templates.filter((t) => t.container);
  const CN = { id: '__cloud-native', name: '☁ Cloud Native Project', language: '', cloud: 'any', cn: true,
    description: 'The recommended start. You work in one environment (dev) and the others are deployment targets: the same build is promoted, never rebuilt. Pick the stack, the cloud and the environments; the IDE creates the code, a Dockerfile and a CI/CD pipeline, then opens the cloud set-up.' };
  if (stacks.length) templates = [CN, ...templates];
  let chosen = templates[0];
  const cn = {
    stack: (stacks.find((t) => t.id === 'spring-boot') || stacks[0] || {}).id,
    cloud: (state.clouds.find((c) => cloudSignedIn(c.id)) || state.clouds.find((c) => c.id === 'gcp') || state.clouds[0] || {}).id || 'gcp',
    preset: 2, pipeline: true,
  };
  const presetEnvs = () => GW_PRESETS[cn.preset][2].map(([n]) => n);
  const envInput = h('input', { value: presetEnvs().join(', '), spellcheck: 'false', placeholder: 'dev, sit, uat, prod' });
  const parseEnvs = () => envInput.value.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

  const list = h('div', { class: 'picklist tall' });
  const desc = h('p', { class: 'hint' });
  const cnBox = h('div', { class: 'cnbox' });
  const formBox = h('div', { class: 'formbox' });
  const name = h('input', { placeholder: 'my-service', value: '' });

  // Project coordinates: what the template needs to name your code (Maven group, base package, parent; Go module; Python package ...).
  // Nothing is pre-filled with a placeholder organisation: you choose your own.
  const last = (state.settings.workspace && state.settings.workspace.lastGroupId) || '';
  const F = { groupId: last, artifactId: '', aTouched: false, basePackage: '', pTouched: false, version: '1.0.0-SNAPSHOT', javaVersion: '17', parentMode: '', parent: { groupId: '', artifactId: '', version: '', relativePath: '' }, layers: true, modulePath: '', pythonPackage: '', pyTouched: false, packageName: '', nTouched: false, namespace: '' };
  const activeTpl = () => (chosen.cn ? stacks.find((t) => t.id === cn.stack) : chosen) || {};
  const slugName = () => name.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  const snakeName = () => name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const autoPkg = () => `${F.groupId}.${(F.artifactId || slugName()).replace(/[-._]/g, '')}`.toLowerCase().replace(/[^a-z0-9_.]/g, '').replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '');
  const field = (label, input, hint) => h('div', {}, h('label', { text: label }), input, hint ? h('div', { class: 'hint', text: hint }) : null);
  const bind = (key, input, touchKey) => { input.oninput = () => { F[key] = input.value.trim(); if (touchKey) F[touchKey] = true; syncAuto(); }; return input; };
  const refs = {};
  function syncAuto() {
    const k = activeTpl().form;
    if (k === 'maven') {
      if (!F.aTouched && refs.artifactId) { F.artifactId = slugName(); refs.artifactId.value = F.artifactId; }
      if (!F.pTouched && refs.basePackage) { F.basePackage = F.groupId ? autoPkg() : ''; refs.basePackage.value = F.basePackage; }
    }
    if (k === 'python' && !F.pyTouched && refs.pythonPackage) { F.pythonPackage = snakeName(); refs.pythonPackage.value = F.pythonPackage; }
    if (k === 'node' && !F.nTouched && refs.packageName) { F.packageName = slugName(); refs.packageName.value = F.packageName; }
    if (refs.warn) refs.warn.textContent = /^(com|org)\.example(\.|$)/.test(F.groupId) ? 'com.example is the placeholder from the frameworks’ tutorials. Use your own organisation’s name.' : '';
  }
  const drawForm = () => {
    const t = activeTpl();
    const k = t.form;
    for (const key of Object.keys(refs)) delete refs[key];
    if (!k) { formBox.replaceChildren(); return; }
    if (k === 'maven') {
      refs.groupId = bind('groupId', h('input', { value: F.groupId, placeholder: 'com.yourcompany', spellcheck: 'false' }));
      refs.artifactId = bind('artifactId', h('input', { value: F.artifactId || slugName(), spellcheck: 'false' }), 'aTouched');
      refs.basePackage = bind('basePackage', h('input', { value: F.basePackage || (F.groupId ? autoPkg() : ''), placeholder: 'com.yourcompany.orders', spellcheck: 'false' }), 'pTouched');
      refs.warn = h('div', { class: 'msg warn' });
      const parentSel = h('select', { onchange: (e) => { F.parentMode = e.target.value; drawForm(); } },
        ...[...(t.id === 'spring-boot' ? [['default', 'Spring Boot starter parent (recommended)']] : []), ['none', 'No parent'], ['custom', 'My own parent POM…']].map(([v, tx]) => h('option', { value: v, text: tx, selected: (F.parentMode || (t.id === 'spring-boot' ? 'default' : 'none')) === v })));
      const mode = F.parentMode || (t.id === 'spring-boot' ? 'default' : 'none');
      const pin = (key, ph) => { const i = h('input', { value: F.parent[key], placeholder: ph, spellcheck: 'false' }); i.oninput = () => { F.parent[key] = i.value.trim(); }; return i; };
      const jv = h('select', { onchange: (e) => { F.javaVersion = e.target.value; } }, ...['17', '21', '25'].map((v) => h('option', { value: v, text: `Java ${v}`, selected: v === F.javaVersion })));
      const ver = h('input', { value: F.version, spellcheck: 'false' }); ver.oninput = () => { F.version = ver.value.trim(); };
      formBox.replaceChildren(h('div', { class: 'coords' }, h('b', { text: 'Maven coordinates' }),
        field('Group ID', refs.groupId, 'Your organisation, reversed domain style. Required: there is no default.'), refs.warn,
        h('div', { class: 'row2' }, field('Artifact ID', refs.artifactId), field('Version', ver)),
        field('Base package', refs.basePackage, 'The root of your code, for example com.yourcompany.orders. Folders and classes are created inside it.'),
        h('div', { class: 'row2' }, field('Java', jv), field('Parent POM', parentSel)),
        mode === 'custom' ? h('div', { class: 'row2' }, field('Parent group ID', pin('groupId', 'com.yourcompany.platform')), field('Parent artifact ID', pin('artifactId', 'platform-parent')), field('Parent version', pin('version', '1.0.0')), field('Relative path (optional)', pin('relativePath', '../pom.xml'))) : null,
        mode === 'custom' ? h('div', { class: 'hint', text: 'Your pom.xml inherits from it. If it is a module of a parent that is already in a folder above, give its relative path.' }) : null,
        h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: F.layers, onchange: (e) => { F.layers = e.target.checked; } }), ' Create the package scaffolding (controller, service, model, repository, config …)')));
    } else if (k === 'go') {
      refs.modulePath = bind('modulePath', h('input', { value: F.modulePath, placeholder: `github.com/yourorg/${slugName() || 'service'}`, spellcheck: 'false' }));
      formBox.replaceChildren(h('div', { class: 'coords' }, h('b', { text: 'Go module' }), field('Module path', refs.modulePath, 'Where the code will live, for example github.com/yourorg/orders. Required.')));
    } else if (k === 'python') {
      refs.pythonPackage = bind('pythonPackage', h('input', { value: F.pythonPackage || snakeName(), spellcheck: 'false' }), 'pyTouched');
      formBox.replaceChildren(h('div', { class: 'coords' }, h('b', { text: 'Python package' }), field('Package name', refs.pythonPackage, 'The importable folder that holds your code (lower-case, underscores).')));
    } else if (k === 'node') {
      refs.packageName = bind('packageName', h('input', { value: F.packageName || slugName(), spellcheck: 'false' }), 'nTouched');
      formBox.replaceChildren(h('div', { class: 'coords' }, h('b', { text: 'npm package' }), field('Package name', refs.packageName, 'Optionally with a scope, for example @yourorg/orders.')));
    } else if (k === 'dotnet') {
      refs.namespace = bind('namespace', h('input', { value: F.namespace, placeholder: 'Yourcompany.Orders', spellcheck: 'false' }));
      formBox.replaceChildren(h('div', { class: 'coords' }, h('b', { text: '.NET namespace' }), field('Root namespace', refs.namespace, 'For example Yourcompany.Orders. Required.')));
    } else formBox.replaceChildren();
    syncAuto();
  };
  const readForm = () => {
    const k = activeTpl().form;
    if (k === 'maven') {
      const mode = F.parentMode || (activeTpl().id === 'spring-boot' ? 'default' : 'none');
      return { groupId: F.groupId, artifactId: F.artifactId || slugName(), version: F.version, basePackage: F.basePackage || (F.groupId ? autoPkg() : ''), javaVersion: F.javaVersion, layers: F.layers, parent: { mode, ...(mode === 'custom' ? F.parent : {}) } };
    }
    if (k === 'go') return { modulePath: F.modulePath };
    if (k === 'python') return { pythonPackage: F.pythonPackage || snakeName() };
    if (k === 'node') return { packageName: F.packageName || slugName() };
    if (k === 'dotnet') return { namespace: F.namespace };
    return {};
  };
  name.oninput = () => syncAuto();
  const parent = h('input', { placeholder: 'Parent folder', readonly: true, value: state.settings.workspace && state.settings.workspace.lastParent || '' });
  const gitInit = h('input', { type: 'checkbox', checked: true });
  const msg = h('div', { class: 'msg' });

  const drawCn = () => {
    if (!chosen.cn) { cnBox.replaceChildren(); return; }
    const stackSel = h('select', { onchange: (e) => { cn.stack = e.target.value; drawForm(); } }, ...stacks.map((t) => h('option', { value: t.id, text: `${t.name}${t.language ? ` · ${t.language}` : ''}`, selected: t.id === cn.stack })));
    const presetSel = h('select', { onchange: (e) => { cn.preset = Number(e.target.value); envInput.value = presetEnvs().join(', '); } }, ...GW_PRESETS.map((p, i) => h('option', { value: i, text: `${p[0]}: ${p[1]}`, selected: i === cn.preset })));
    const clouds = h('div', { class: 'cnclouds' }, ...state.clouds.map((c) => h('label', { class: `cncloud${c.id === cn.cloud ? ' on' : ''}`, style: `--cc:${c.color || '#888'}` },
      h('input', { type: 'radio', name: 'cn-cloud', checked: c.id === cn.cloud, onchange: () => { cn.cloud = c.id; drawCn(); } }),
      h('span', { class: `dot ${cloudSignedIn(c.id) ? 'ok' : 'off'}` }), h('b', { text: c.short || c.name }), h('small', { text: cloudSignedIn(c.id) ? 'connected' : 'not connected yet' }))));
    cnBox.replaceChildren(
      h('label', { text: 'Application stack' }), stackSel,
      h('label', { text: 'Cloud' }), clouds,
      h('label', { text: 'Environments' }), presetSel, envInput,
      h('div', { class: 'hint', text: 'The first one is where you work. Names ending in uat, preprod or prod become Compliant folders in Google Cloud and are protected.' }),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: cn.pipeline, onchange: (e) => { cn.pipeline = e.target.checked; } }), ' Add a CI/CD pipeline that promotes one build through the environments (GitHub Actions)'),
      h('div', { class: 'hint', text: 'Creating the project builds nothing in the cloud. Provision (next step) prepares the environments; deployment happens from the pipeline or the IDE.' }));
  };
  const draw = () => {
    list.replaceChildren(...templates.map((t) => h('div', { class: 'pick' + (t === chosen ? ' cur' : '') + (t.cn ? ' cn' : ''), onclick: () => { chosen = t; draw(); } },
      h('b', { text: t.name }), h('small', { text: t.cn ? 'recommended · pick a stack below' : `${t.language || ''}${t.language ? ' · ' : ''}${t.cloud === 'any' ? 'any cloud' : cloudName(t.cloud) || t.cloud}` }))));
    desc.textContent = chosen.description;
    drawCn();
    drawForm();
  };
  draw();

  const body = h('div', { class: 'twocol' },
    h('div', {}, h('label', { text: 'Template' }), list),
    h('div', {}, desc,
      h('label', { text: 'Project name' }), name,
      h('label', { text: 'Location' }),
      h('div', { class: 'row' }, parent, h('button', { text: 'Browse…', onclick: async () => { const d = await inv('dialog:selectFolder', 'Choose parent folder').catch(() => null); if (d) parent.value = d; } })),
      cnBox, formBox,
      h('label', { class: 'inline' }, gitInit, ' Initialize a Git repository'), msg));

  const close = modal('New Project', body, [
    h('button', { text: 'Cancel', onclick: () => close() }),
    h('button', { class: 'primary', text: 'Create', onclick: async () => {
      msg.className = 'msg';
      msg.textContent = 'Creating…';
      try {
        let payload = { parentDir: parent.value, name: name.value.trim(), template: chosen.id, gitInit: gitInit.checked, options: readForm() };
        let envs = null;
        if (chosen.cn) {
          const names = parseEnvs();
          if (!names.length || names.length > 8 || names.some((n) => !/^[a-z][a-z0-9]{0,11}$/.test(n)) || new Set(names).size !== names.length) throw new Error('Environments: 1 to 8 different names, lower-case letters and digits (for example dev, sit, prod).');
          envs = names.map((n) => ({ name: n, tier: tierOfName(n), protected: tierOfName(n) === 'compliant' }));
          payload = { ...payload, template: cn.stack, cloudNative: { cloud: cn.cloud, envs, pipeline: cn.pipeline } };
        }
        const r = await inv('project:create', payload);
        if (F.groupId) { await tryInv('settings:set', 'workspace.lastGroupId', F.groupId); state.settings.workspace = { ...(state.settings.workspace || {}), lastGroupId: F.groupId }; }
        await tryInv('settings:set', 'workspace.lastParent', parent.value);
        state.settings.workspace = { ...(state.settings.workspace || {}), lastParent: parent.value };
        close();
        if (r.scaffold) return scaffoldProject(r);
        await openFolder(r.dir);
        if (chosen.cn) {
          // Cloud Native from the start: bind the project to its cloud and environments, then continue with the cloud set-up
          await saveProject({ enabled: true, cloud: cn.cloud, envs });
          // Google Cloud: straight into the architecture wizard (services, network, identities, Terraform)
          if (cn.cloud === 'gcp' && cloudSignedIn('gcp')) return openArchWizard();
          return enableMode();
        }
        if (r.cloud !== 'any' && state.clouds.some((c) => c.id === r.cloud) && (await confirmBox(`Enable Cloud Native Development for ${cloudName(r.cloud)}?`, 'This connects the new project to that cloud. You can change it later.'))) {
          await saveProject({ cloud: r.cloud, enabled: true });
          showView('clouds');
        }
      } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; }
    } }),
  ], { wide: true });
  name.focus();
}

/* ------------------------------ Import from GitHub / Git ------------------------------ */

function importDialog(github) {
  const repo = h('input', { placeholder: github ? 'owner/repo or https://github.com/owner/repo' : 'https://host/path/repo.git or git@host:path/repo.git' });
  const parent = h('input', { placeholder: 'Clone into folder', readonly: true, value: (state.settings.workspace && state.settings.workspace.lastParent) || '' });
  const progress = h('pre', { class: 'hidden progress' });
  const msg = h('div', { class: 'msg' });
  const ghList = h('div', { class: 'picklist hidden' });
  let off = () => {};

  const body = h('div', {},
    h('p', { class: 'hint', text: github ? 'Clone a GitHub repository into a local folder. Private repositories use your Git Credential Manager or GitHub CLI sign-in.' : 'Clone any Git repository (HTTPS or SSH).' }),
    h('label', { text: 'Repository' }), repo,
    github ? h('button', { text: 'Browse my GitHub repositories…', onclick: async () => {
      ghList.classList.remove('hidden');
      ghList.replaceChildren(h('div', { class: 'empty', text: 'Loading…' }));
      try {
        const repos = await inv('git:ghRepos');
        ghList.replaceChildren(...(repos.length ? repos : [null]).map((r) => r
          ? h('div', { class: 'pick', onclick: () => { repo.value = r.nameWithOwner; ghList.classList.add('hidden'); } }, h('b', { text: r.nameWithOwner }), h('small', { text: r.isPrivate ? 'private' : 'public' }))
          : h('div', { class: 'empty', text: 'No repositories found.' })));
      } catch (e) { ghList.replaceChildren(h('div', { class: 'empty t-err', text: e.message })); }
    } }) : null,
    ghList,
    h('label', { text: 'Location' }),
    h('div', { class: 'row' }, parent, h('button', { text: 'Browse…', onclick: async () => { const d = await inv('dialog:selectFolder', 'Choose parent folder').catch(() => null); if (d) parent.value = d; } })),
    progress, msg);

  const close = modal(github ? 'Import from GitHub' : 'Clone Git Repository', body, [
    h('button', { text: 'Cancel', onclick: () => { off(); close(); } }),
    h('button', { class: 'primary', text: 'Clone', onclick: async (ev) => {
      ev.target.disabled = true;
      msg.className = 'msg';
      msg.textContent = 'Cloning…';
      progress.classList.remove('hidden');
      progress.textContent = '';
      off = cns.on('git:progress', (t) => { progress.textContent += t; progress.scrollTop = progress.scrollHeight; });
      try {
        const dir = await inv('git:clone', repo.value, parent.value);
        await tryInv('settings:set', 'workspace.lastParent', parent.value);
        off();
        close();
        await openFolder(dir);
      } catch (e) { off(); msg.className = 'msg err'; msg.textContent = e.message; ev.target.disabled = false; }
    } }),
  ], { wide: true });
  repo.focus();
}

/* ------------------------------ Workspace home ------------------------------ */

function homeSection(title, ...kids) {
  return h('section', { class: 'hsec' }, h('h3', { text: title }), ...kids);
}

function tile(icon, title, sub, onclick) {
  return h('button', { class: 'tile', onclick }, h('span', { class: 'ticon', text: icon }), h('b', { text: title }), h('small', { text: sub }));
}

async function renderHome() {
  const home = $('home');
  const recents = await inv('app:recents').catch(() => []);
  const p = state.proj;

  const clouds = state.clouds.map((c) => {
    const s = state.cloudStatus[c.id] || {};
    const dot = s.loading ? 'pending' : s.signedIn ? 'ok' : 'off';
    return h('div', { class: 'card', style: `border-top: 3px solid ${c.color}` },
      h('div', { class: 'cardh' }, h('span', { class: `dot ${dot}` }), h('b', { text: c.name }), h('span', { class: 'chip', text: c.kind === 'private' ? 'private' : 'public' })),
      h('div', { class: 'hint', text: s.loading ? 'Checking…' : s.signedIn ? `${s.identity || "Signed in"}${s.scope && s.scope !== s.identity ? ` · ${s.scope}` : ""}` : s.installed === false ? `${c.short} CLI not installed` : 'Not signed in' }),
      h('div', { class: 'row' },
        h('button', { class: s.signedIn ? '' : 'primary', text: s.signedIn ? 'Manage' : c.kind === 'private' ? 'Set up' : 'Sign in', onclick: () => (s.signedIn ? (showView('clouds'), focusCloud(c.id)) : cloudLogin(c.id)) })));
  });

  const aiCards = state.ai
    ? [...state.ai.api.map((a) => h('div', { class: 'card slim' }, h('span', { class: `dot ${a.keySet || !a.needsKey ? 'ok' : 'off'}` }), h('b', { text: a.name }), h('small', { text: a.keySet ? 'key set' : a.needsKey ? 'no key' : 'local / optional key' }))),
       ...state.ai.cli.map((a) => h('div', { class: 'card slim' }, h('span', { class: `dot ${a.installed ? 'ok' : 'off'}` }), h('b', { text: a.name }), h('small', { text: a.installed ? 'installed' : 'not installed' })))]
    : [h('div', { class: 'hint', text: 'Loading…' })];

  const children = [
    h('div', { class: 'hero' }, h('h1', { text: 'Workspace' }), h('p', { text: 'Build, migrate and modernize applications across Google Cloud, AWS, Azure and private clouds.' })),
    homeSection('Start',
      h('div', { class: 'tiles' },
        tile('＋', 'New Project…', 'Cloud Native or from a template', () => CNS.run('project.new')),
        tile('📂', 'Open Folder…', 'An existing project', () => CNS.run('folder.open')),
        tile('⎇', 'Import from GitHub…', 'Clone owner/repo', () => CNS.run('github.import')),
        tile('⇣', 'Clone Git Repository…', 'Any HTTPS or SSH URL', () => CNS.run('git.clone')),
        tile('⇄', 'Assess for Migration', state.workspace ? 'Modernize the open project' : 'Open a project first', () => CNS.run('modernize.assess')))),
    state.workspace ? homeSection('Current project',
      h('div', { class: 'card wide' },
        h('div', { class: 'cardh' }, h('b', { text: baseName(state.workspace) }),
          p && p.enabled ? h('span', { class: 'chip ok', text: `${(state.clouds.find((c) => c.id === p.cloud) || {}).short || p.cloud} · ${p.env}` }) : h('span', { class: 'chip', text: 'cloud not connected' })),
        h('div', { class: 'hint', text: state.workspace }),
        h('div', { class: 'row' },
          h('button', { class: p && p.enabled ? '' : 'primary', text: p && p.enabled ? 'Cloud Native settings' : 'Enable Cloud Native Development', onclick: () => (p && p.enabled ? showView('clouds') : CNS.run('cloud.toggleMode')) }),
          h('button', { text: 'Modernize', onclick: () => CNS.run('modernize.assess') })))) : null,
    homeSection('Recent projects',
      recents.length
        ? h('div', { class: 'recents' }, recents.map((r) => h('div', { class: 'recent', onclick: () => openFolder(r.path) },
            h('b', { text: r.name }), h('small', { text: r.path }),
            h('span', { class: 'x', title: 'Remove from list', text: '✕', onclick: async (e) => { e.stopPropagation(); await tryInv('app:removeRecent', r.path); tryInv('app:refreshMenu'); renderHome(); } }))))
        : h('div', { class: 'hint', text: 'Projects you open will appear here.' })),
    homeSection('Connected clouds', h('div', { class: 'cards' }, clouds), h('div', { class: 'row' }, h('button', { text: 'Manage cloud accounts', onclick: () => { showView('clouds'); } }))),
    homeSection('AI assistants', h('div', { class: 'cards' }, aiCards), h('div', { class: 'row' }, h('button', { text: 'Configure AI', onclick: () => openSettings('ai') }), h('button', { text: 'Open assistant', onclick: () => CNS.run('ai.toggle') })))
  ];
  home.replaceChildren(...children.filter(Boolean));
}

/** Frameworks with their own generator (Angular, .NET): run the official CLI in the terminal, then open the result. */
async function scaffoldProject(r) {
  showPanel('terminal');
  termPrint(`> ${r.scaffold}   [${r.parentDir}]
`, 't-cmd');
  status('Generating the project with its official CLI… this can take a minute.');
  const t = await tryInv('term:run', r.scaffold, r.parentDir);
  if (!t.ok) return status(t.error, true);
  termWaiters.set(t.data, async (code) => {
    if (code !== 0) return status('Project generation failed. See the terminal.', true);
    status('Project generated.');
    await openFolder(r.dir);
  });
}
