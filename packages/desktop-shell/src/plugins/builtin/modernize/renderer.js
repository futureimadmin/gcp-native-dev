/* Modernize & Migrate: sidebar view. Demonstrates the renderer plugin API (views, commands, invoke, ui, ai, shared). */
CNS.plugin('cns.modernize', (api) => {
  const { h } = api.ui;
  let analysis = null;
  let target = 'gcp';
  let planText = '';
  let box = null;
  let busy = '';

  const targets = [['gcp', 'Google Cloud'], ['aws', 'AWS'], ['azure', 'Microsoft Azure'], ['k8s', 'Private cloud (Kubernetes)']];

  async function assess() {
    const ws = api.workspace();
    if (!ws) return api.ui.status('Open a project first (File > Open Folder).', true);
    api.ui.showView('modernize');
    busy = 'Scanning project…';
    redraw();
    try {
      analysis = await api.invoke('assess', ws);
      api.shared.set('analysis', analysis);
      planText = '';
      api.ui.status(`Assessed ${analysis.name}: ${analysis.findings.length} finding(s).`);
    } catch (e) { api.ui.status(e.message, true); }
    busy = '';
    redraw();
  }

  async function makePlan() {
    if (!analysis) await assess();
    if (!analysis) return;
    api.ui.showView('modernize');
    try {
      planText = (await api.invoke('plan', analysis, target)).markdown;
      redraw();
    } catch (e) { api.ui.status(e.message, true); }
  }

  async function savePlan() {
    try {
      const file = await api.invoke('save', api.workspace(), target, planText);
      api.ui.refreshTree();
      api.ui.openFile(file);
      api.ui.status('Saved migration plan.');
    } catch (e) { api.ui.status(e.message, true); }
  }

  function askAi() {
    if (!analysis) return api.ui.status('Assess the project first.', true);
    const t = targets.find((x) => x[0] === target)[1];
    api.ai.ask(`Review this migration assessment and refine the plan for moving to ${t}. List the top risks, a realistic phase order, and anything the static scan could have missed.`,
      [{ label: 'migration analysis (JSON)', text: JSON.stringify(analysis, null, 2) }, ...(planText ? [{ label: `draft plan (${t})`, text: planText }] : [])]);
  }

  const chips = (arr) => (arr.length ? arr.map((x) => h('span', { class: 'chip', text: x })) : [h('span', { class: 'hint', text: 'none detected' })]);

  function redraw() {
    if (!box) return;
    const targetSel = h('select', { onchange: (e) => { target = e.target.value; planText = ''; redraw(); } },
      targets.map(([id, name]) => h('option', { value: id, text: name, selected: id === target })));
    const kids = [
      h('header', {}, h('span', { text: 'MODERNIZE & MIGRATE' })),
      h('div', { class: 'pad' },
        h('p', { class: 'hint', text: 'Scans the open project (nothing leaves your machine), maps it to services on the cloud you pick and drafts a phased plan.' }),
        h('button', { class: 'primary wide', text: busy || (analysis ? 'Re-assess project' : 'Assess project'), disabled: !!busy, onclick: assess }),
        h('label', { text: 'Migration target' }), targetSel,
        h('div', { class: 'actgrid' },
          h('button', { text: 'Generate plan', disabled: !api.workspace(), onclick: makePlan }),
          h('button', { text: 'Ask AI to refine', disabled: !analysis, onclick: askAi }))),
    ];
    if (analysis) {
      const a = analysis;
      kids.push(h('div', { class: 'pad' },
        h('div', { class: 'cat bar', text: `Assessment · ${a.name} · ${a.fileCount} files${a.truncated ? '+' : ''}` }),
        h('label', { text: 'Languages' }), h('div', {}, chips(a.languages.slice(0, 6).map((l) => `${l.name} ${l.files}`))),
        h('label', { text: 'Frameworks' }), h('div', {}, chips(a.frameworks)),
        h('label', { text: 'Data stores' }), h('div', {}, chips(a.datastores)),
        h('label', { text: 'Messaging' }), h('div', {}, chips(a.messaging)),
        h('label', { text: 'Packaging / IaC' }), h('div', {}, chips(Object.entries(a.infra).filter(([, v]) => v).map(([k]) => k))),
        h('label', { text: 'CI/CD' }), h('div', {}, chips(a.cicd)),
        h('label', { text: 'Current cloud footprint' }), h('div', {}, chips(a.sourceClouds)),
        h('div', { class: 'cat bar', text: `Findings (${a.findings.length})` }),
        ...(a.findings.length ? a.findings.map((f) => h('div', { class: `finding ${f.severity}`, title: f.detail }, h('b', { text: f.title }), h('small', { text: f.detail }))) : [h('div', { class: 'hint', text: 'No blocking findings.' })]),
        h('div', { class: 'cat bar', text: 'Strategy (6 Rs)' }),
        ...a.strategies.map((s) => h('div', { class: 'finding low', title: s.why }, h('b', { text: `${s.component}: ${s.strategy}` }), h('small', { text: s.why })))));
    }
    if (planText) {
      kids.push(h('div', { class: 'pad' },
        h('div', { class: 'cat bar', text: `Plan → ${targets.find((x) => x[0] === target)[1]}` }),
        h('pre', { class: 'plan', text: planText }),
        h('div', { class: 'row' }, h('button', { class: 'primary', text: 'Save to docs/migration/', onclick: savePlan }), h('button', { text: 'Copy', onclick: () => navigator.clipboard.writeText(planText).then(() => api.ui.status('Copied.')) }))));
    }
    box.replaceChildren(...kids);
  }

  api.views.register({ id: 'modernize', title: 'Modernize & Migrate', icon: '⇄', render: (container) => { box = container; redraw(); } });
  api.commands.register('modernize.assess', assess, 'Modernize: Assess project for migration');
  api.commands.register('modernize.plan', makePlan, 'Modernize: Generate migration plan');
  api.toolbar.add({ command: 'modernize.assess', label: 'Modernize', icon: '⇄', title: 'Assess this project for migration' });
});
