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
  await loadProject();
  await refreshTree();
  tryInv('app:refreshMenu');
  showView('explorer');
  showHome();
  status(`Opened ${baseName(dir)}`);
}

async function closeFolder() {
  if (!state.workspace) return;
  if (state.tabs.some((t) => t.kind === 'file' && t.model.getValue() !== t.saved) && !(await confirmBox('Close folder?', 'Unsaved changes will be lost.'))) return;
  closeAllFileTabs();
  state.workspace = null;
  state.cwd = null;
  state.proj = null;
  $('workspace-name').textContent = '';
  await tryInv('app:setWorkspace', null);
  applyMode();
  await refreshTree();
  showHome();
}

/* ------------------------------ New Project ------------------------------ */

async function newProjectDialog() {
  let templates = [];
  try { templates = await inv('project:templates'); } catch (e) { return status(e.message, true); }
  if (!templates.length) return status('No project templates are installed.', true);
  let chosen = templates[0];
  const cloudName = (id) => (state.clouds.find((c) => c.id === id) || {}).short || '';

  const list = h('div', { class: 'picklist tall' });
  const desc = h('p', { class: 'hint' });
  const name = h('input', { placeholder: 'my-service', value: '' });
  const parent = h('input', { placeholder: 'Parent folder', readonly: true, value: state.settings.workspace && state.settings.workspace.lastParent || '' });
  const gitInit = h('input', { type: 'checkbox', checked: true });
  const msg = h('div', { class: 'msg' });

  const draw = () => {
    list.replaceChildren(...templates.map((t) => h('div', { class: 'pick' + (t === chosen ? ' cur' : ''), onclick: () => { chosen = t; draw(); } },
      h('b', { text: t.name }), h('small', { text: t.cloud === 'any' ? 'any cloud' : cloudName(t.cloud) || t.cloud }))));
    desc.textContent = chosen.description;
  };
  draw();

  const body = h('div', { class: 'twocol' },
    h('div', {}, h('label', { text: 'Template' }), list),
    h('div', {}, desc,
      h('label', { text: 'Project name' }), name,
      h('label', { text: 'Location' }),
      h('div', { class: 'row' }, parent, h('button', { text: 'Browse…', onclick: async () => { const d = await inv('dialog:selectFolder', 'Choose parent folder').catch(() => null); if (d) parent.value = d; } })),
      h('label', { class: 'inline' }, gitInit, ' Initialize a Git repository'), msg));

  const close = modal('New Project', body, [
    h('button', { text: 'Cancel', onclick: () => close() }),
    h('button', { class: 'primary', text: 'Create', onclick: async () => {
      msg.className = 'msg';
      msg.textContent = 'Creating…';
      try {
        const r = await inv('project:create', { parentDir: parent.value, name: name.value.trim(), template: chosen.id, gitInit: gitInit.checked });
        await tryInv('settings:set', 'workspace.lastParent', parent.value);
        state.settings.workspace = { ...(state.settings.workspace || {}), lastParent: parent.value };
        close();
        await openFolder(r.dir);
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
        tile('＋', 'New Project…', 'From a cloud-ready template', () => CNS.run('project.new')),
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
