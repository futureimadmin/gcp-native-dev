/* Boot, views, commands, toolbar, command palette. Loaded last. */
'use strict';

/* ------------------------------ sidebar views / activity bar ------------------------------ */

const CORE_VIEWS = [
  { id: 'explorer', title: 'Explorer', icon: '📁' },
  { id: 'search', title: 'Search (Ctrl+Shift+F)', icon: '🔍' },
  { id: 'run', title: 'Run & Servers', icon: '▶' },
  { id: 'clouds', title: 'Clouds', icon: '☁' },
];

function buildActivityBar() {
  const bar = $('activity');
  const views = [...CORE_VIEWS, ...CNS.views];
  bar.replaceChildren(
    ...views.map((v) => h('button', { 'data-view': v.id, title: v.title, text: v.icon || '•', onclick: () => clickView(v.id) })),
    h('span', { class: 'spacer' }),
    h('button', { title: 'Workspace home', text: '⌂', onclick: () => showHome() }),
    h('button', { title: 'Settings', text: '⚙', onclick: () => openSettings() })
  );
  for (const v of CNS.views) {
    if (document.getElementById(`view-${v.id}`)) continue;
    $('sidebar').append(h('section', { id: `view-${v.id}`, class: 'view hidden' }));
  }
}

function showView(id) {
  const known = [...CORE_VIEWS, ...CNS.views].some((v) => v.id === id);
  if (!known) return status(`View "${id}" is not available (is its plugin enabled?).`, true);
  document.querySelectorAll('#activity button[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === id));
  document.querySelectorAll('#sidebar .view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${id}`));
  document.body.classList.remove('side-hidden');
  if (id === 'clouds') renderCloudView();
  if (id === 'run') renderRunView($('view-run'));
  if (id === 'search') renderSearchView($('view-search'));
  const pv = CNS.views.find((v) => v.id === id);
  if (pv) {
    const box = $(`view-${id}`);
    box.replaceChildren();
    try { pv.render(box); } catch (e) { box.append(h('div', { class: 'empty t-err', text: e.message })); }
  }
}

/* ------------------------------ plugins (renderer side) ------------------------------ */

function loadScript(src) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.append(s);
  });
}

async function loadRendererPlugins() {
  for (const p of state.plugins) {
    if (!p.rendererPath) continue;
    const url = `file:///${p.rendererPath.split(BS).join('/')}`;
    if (!(await loadScript(encodeURI(url)))) status(`Plugin ${p.name}: UI failed to load.`, true);
  }
}

/* ------------------------------ commands ------------------------------ */

function registerCommands() {
  const C = (id, fn, title) => CNS.command(id, fn, title);
  C('workspace.show', () => showHome(), 'Workspace: Show home');
  C('project.new', newProjectDialog, 'File: New Project…');
  C('file.new', () => createEntry(false), 'File: New File');
  C('folder.open', openFolderDialog, 'File: Open Folder…');
  C('recent.open', (p) => openFolder(p));
  C('github.import', () => importDialog(true), 'File: Import from GitHub…');
  C('git.clone', () => importDialog(false), 'File: Clone Git Repository…');
  C('file.save', saveActive, 'File: Save');
  C('file.saveAll', saveAll, 'File: Save All');
  C('folder.close', closeFolder, 'File: Close Folder');
  C('settings.open', () => openSettings(), 'Settings: Open');
  C('view.explorer', () => showView('explorer'), 'View: Explorer');
  C('view.clouds', () => showView('clouds'), 'View: Clouds');
  C('view.modernize', () => showView('modernize'), 'View: Modernize');
  C('view.terminal', togglePanel, 'View: Toggle Terminal');
  C('ai.toggle', () => toggleAi(), 'AI: Toggle Assistant');
  C('ai.cli', (id) => launchCli(id));
  C('ai.claude', openClaude, 'AI: Claude Code (in the IDE)');
  C('palette.open', openPalette);
  C('cloud.login', (id) => cloudLogin(id));
  C('cloud.toggleMode', () => (cnOn() ? disableMode() : enableMode()), 'Cloud: Enable / Disable Cloud Native Development');
  C('cloud.pipeline.run', runPipeline, 'Cloud: Run CI/CD Pipeline');
  C('cloud.deploy', deployNow, 'Cloud: Deploy');
  C('cloud.resource', createResource, 'Cloud: Create Cloud Resource…');
  C('cloud.pipeline.generate', generatePipeline, 'Cloud: Generate CI/CD Pipeline');
  C('cloud.bootstrap', bootstrapDialog, 'Cloud: Bootstrap Environments (Terraform)…');
  C('cloud.switchEnv', switchEnvDialog, 'Cloud: Switch Environment…');
  C('cloud.console', openConsole, 'Cloud: Open Console');
  C('help.open', (topic) => openHelp(topic), 'Help: Contents');
  C('help.plugins', () => openHelp('plugins'), 'Help: Plugin development guide');
  C('help.about', () => openSettings('about'), 'Help: About');
  for (const c of state.clouds) C(`cloud.signin.${c.id}`, () => cloudLogin(c.id), `Cloud: Sign in to ${c.name}`);
  for (const a of ['gemini-cli', 'codex-cli']) C(`ai.cli.${a}`, () => launchCli(a), `AI: Open ${a} in a console window`);
}

/* ------------------------------ command palette ------------------------------ */

function openPalette() {
  const root = $('palette');
  const input = $('palette-input');
  const list = $('palette-list');
  const all = [...CNS.commands.entries()].filter(([, c]) => c.title).map(([id, c]) => [c.title, id]).sort((a, b) => a[0].localeCompare(b[0]));
  let items = all;
  let sel = 0;
  const pick = (id) => { root.classList.add('hidden'); CNS.run(id); };
  const draw = () => list.replaceChildren(...items.map(([label, id], i) => h('li', { class: i === sel ? 'sel' : '', text: label, onclick: () => pick(id) })));
  root.classList.remove('hidden');
  input.value = '';
  draw();
  input.focus();
  input.oninput = () => { const q = input.value.toLowerCase(); items = all.filter(([l]) => l.toLowerCase().includes(q)); sel = 0; draw(); };
  input.onkeydown = (e) => {
    if (e.key === 'Escape') root.classList.add('hidden');
    else if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); }
    else if (e.key === 'Enter' && items[sel]) pick(items[sel][1]);
  };
}

/* ------------------------------ toolbar ------------------------------ */

function wireToolbar() {
  $('tb-new').onclick = () => CNS.run('project.new');
  $('tb-open').onclick = () => CNS.run('folder.open');
  $('tb-save').onclick = () => CNS.run('file.save');
  $('tb-pipeline').onclick = () => CNS.run('cloud.pipeline.run');
  $('tb-deploy').onclick = () => CNS.run('cloud.deploy');
  $('tb-ai').onclick = () => toggleAi();
  $('tb-term').onclick = togglePanel;
  $('tb-palette').onclick = openPalette;
  $('tb-settings').onclick = () => openSettings();
  $('tb-home').onclick = () => showHome();
  $('btn-cloud-refresh').onclick = async () => { await refreshAllClouds(); if (focusedCloud) loadInventory(focusedCloud); };
  $('st-cn').onclick = switchEnvDialog;
  $('st-cloud').onclick = () => showView('clouds');
  const render = () => $('tb-plugins').replaceChildren(...CNS.toolbar.map((t) => h('button', { title: t.title || '', text: `${t.icon || ''} ${t.label || ''}`.trim(), onclick: () => CNS.run(t.command) })));
  CNS.on('toolbar-changed', render);
  render();
}

/* ------------------------------ boot ------------------------------ */

async function main() {
  try {
    state.settings = await inv('settings:get');
    state.info = await inv('app:info');
    state.plugins = await inv('host:plugins');
    await loadClouds();
    registerCommands();
    registerEditorCommands();
    wireWorkbench();
    wireLayout();
    wireRun();
    wireCompile();
    wireAi();
    wireToolbar();
    document.addEventListener('click', () => $('ctx').classList.add('hidden'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F1') { e.preventDefault(); openHelp(); }
      if (e.key === 'Escape') { $('ctx').classList.add('hidden'); $('palette').classList.add('hidden'); }
    });
    $('modal-root').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-root') $('modal-root').classList.add('hidden'); });
    cns.on('menu', ({ id, arg }) => CNS.run(id, arg));

    await loadRendererPlugins();
    buildActivityBar();
    CNS.on('views-changed', buildActivityBar);
    renderPills();
    showView('explorer');
    $('term-prompt').textContent = promptStr();

    // Editor and cloud checks run together behind the splash screen.
    await Promise.all([
      initMonaco().then(setupEditorFeatures).catch((e) => $('home').append(h('p', { class: 't-err', text: `Editor failed to load: ${e.message}` }))),
      runLaunch(),
    ]);

    showHome();
    refreshTree();
    // ADC found but no project selected: let the user pick one now.
    const g = state.cloudStatus.gcp;
    if (g && g.signedIn && !g.scope) chooseScope('gcp');
  } catch (e) {
    console.error(e);
    $('launch').classList.add('hidden');
    status(`Startup problem: ${e.message}`, true);
  }
}

main();
