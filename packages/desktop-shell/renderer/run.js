/* Build environment detection, Run / Debug / Build / Test, auto-save, auto-build, and local servers (Tomcat, listening ports). */
'use strict';

const run = {
  projects: [], // detected build environments
  sel: 0, // selected project index
  proc: null, // {id, label, kind, port, debugPort}
  building: false,
  runtimes: [],
  autoTimer: null,
  buildTimer: null,
  saveTimers: new Map(),
};

const editorCfg = () => state.settings.editor || {};
const autoSaveMode = () => editorCfg().autoSave || 'afterDelay';
const autoBuildOn = () => editorCfg().autoBuild !== false;

/* ------------------------------ detection ------------------------------ */

async function detectBuildEnv() {
  run.projects = [];
  if (state.workspace) {
    const r = await tryInv('build:detect', state.workspace);
    if (r.ok) run.projects = r.data;
  }
  run.runtimes = (await tryInv('runtime:list')).data || run.runtimes;
  if (run.sel >= run.projects.length) run.sel = 0;
  renderRunConfig();
  if (!$('view-run').classList.contains('hidden')) renderRunView($('view-run'));
}

function renderRunConfig() {
  const sel = $('run-config');
  sel.replaceChildren(...(run.projects.length
    ? run.projects.map((p, i) => h('option', { value: i, text: `${p.type} · ${p.rel}`, selected: i === run.sel }))
    : [h('option', { value: '', text: state.workspace ? 'No build detected' : 'No project open' })]));
  const has = (k) => !!(currentProject() && currentProject().tasks.some((t) => t.kind === k));
  $('tb-build').disabled = !has('build');
  $('tb-run').disabled = !has('run') || !!run.proc;
  $('tb-debug').disabled = !has('debug') || !!run.proc;
  $('tb-stop').disabled = !run.proc;
  const st = $('st-lang');
  if (currentProject() && !state.active) st.textContent = currentProject().type;
}

const currentProject = () => run.projects[run.sel] || null;
const taskOf = (proj, kind) => proj && proj.tasks.find((t) => t.kind === kind && (kind !== 'build' || t.auto || t.id === 'build')) || (proj && proj.tasks.find((t) => t.kind === kind));

function runtimeMissing(task) {
  const r = run.runtimes.find((x) => x.id === task.needs);
  return r && !r.found ? r : null;
}

/* ------------------------------ output helpers ------------------------------ */

function outPrint(text, cls) {
  const out = $('output-out');
  out.append(h('span', { class: cls || '', text }));
  out.scrollTop = out.scrollHeight;
}

function setRunStatus(text, port) {
  const el = $('st-run');
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
  el.style.cursor = port ? 'pointer' : '';
  el.dataset.port = port || '';
  el.title = port ? 'Open in the IDE browser' : '';
}

/* ------------------------------ running tasks ------------------------------ */

/** Runs a detected task. where: 'output' for builds, 'terminal' for long-running servers. */
async function startTask(proj, task, where) {
  const miss = runtimeMissing(task);
  if (miss) {
    status(`${miss.name} was not found on this computer. Install it, or point the IDE at it in Settings > Runtimes.`, true);
    openSettings('runtimes');
    return null;
  }
  const out = where === 'output';
  showPanel(out ? 'output' : 'terminal');
  const print = out ? outPrint : termPrint;
  print(`\n> ${task.cmd}   [${proj.dir}]\n`, 't-cmd');
  const r = await tryInv('term:run', task.cmd, proj.dir);
  if (!r.ok) { print(`${r.error}\n`, 't-err'); return null; }
  const id = r.data;
  if (out) termRoutes.set(id, (t, s) => outPrint(t, s === 'err' ? 't-err' : ''));
  return new Promise((resolve) => {
    resolve({ id, done: new Promise((fin) => termWaiters.set(id, fin)) });
  });
}

async function doBuild(auto) {
  const proj = currentProject();
  if (!proj) return status('Open a project first.', true);
  const task = taskOf(proj, 'build');
  if (!task) return status('Nothing to build for this project.', true);
  if (run.building) return;
  run.building = true;
  setRunStatus(`🔨 ${auto ? 'Auto-building' : 'Building'} ${proj.rel}…`);
  const h_ = await startTask(proj, task, 'output');
  if (!h_) { run.building = false; setRunStatus(''); return; }
  const code = await h_.done;
  run.building = false;
  outPrint(code === 0 ? '✔ Build finished\n' : `✘ Build failed (exit ${code})\n`, code === 0 ? 't-cmd' : 't-err');
  setRunStatus(run.proc ? $('st-run').textContent : (code === 0 ? '✔ Build OK' : '✘ Build failed — see OUTPUT'));
  if (!run.proc) setTimeout(() => { if (!run.proc && !run.building) setRunStatus(''); }, 6000);
}

async function doStart(kind) {
  const proj = currentProject();
  if (!proj) return status('Open a project first.', true);
  if (run.proc) return status('Something is already running. Stop it first.', true);
  const task = taskOf(proj, kind);
  if (!task) return status(`This project has no ${kind} configuration.`, true);
  if (kind === 'run' && state.active && state.active.kind === 'file') await saveAll();
  const h_ = await startTask(proj, task, 'terminal');
  if (!h_) return;
  run.proc = { id: h_.id, label: `${proj.type}`, kind, port: task.port || 0, debugPort: task.debugPort || 0 };
  runningId = h_.id; // Ctrl+C in the terminal also stops it
  renderRunConfig();
  if (kind === 'debug') {
    termPrint(`Debugging: the process is waiting for / exposing a ${task.debugKind} debugger on port ${task.debugPort}.\nAttach with your debug client (Remote JVM Debug in IntelliJ/Eclipse/VS Code, Node inspector, debugpy, dlv). A step debugger inside this IDE is not available yet.\n`, 't-dim');
  }
  setRunStatus(`${kind === 'debug' ? '🐞' : '▶'} ${run.proc.label}${task.debugPort && kind === 'debug' ? ` · debug :${task.debugPort}` : ''}`);
  if (task.port) watchPort(task.port, run.proc.label, kind);
  h_.done.then((code) => {
    if (run.proc && run.proc.id === h_.id) { run.proc = null; runningId = null; }
    setRunStatus(code === 0 || code === null ? '' : `■ ${proj.type} stopped (exit ${code})`);
    renderRunConfig();
    setTimeout(() => { if (!run.proc && !run.building) setRunStatus(''); }, 8000);
  });
}

function watchPort(port, label, kind) {
  let n = 0;
  const t = setInterval(async () => {
    if (!run.proc || run.proc.port !== port) return clearInterval(t);
    if (++n > 80) return clearInterval(t);
    const r = await tryInv('server:listening');
    if (r.ok && r.data.some((x) => x.port === port)) {
      clearInterval(t);
      setRunStatus(`${kind === 'debug' ? '🐞' : '▶'} ${label} · http://localhost:${port}  (click to open)`, port);
    }
  }, 1500);
}

async function doStop() {
  if (!run.proc) return;
  await tryInv('term:kill', run.proc.id);
  termPrint('■ stopped\n', 't-dim');
}

async function doTest() {
  const proj = currentProject();
  const task = proj && taskOf(proj, 'test');
  if (!task) return status('No test task detected for this project.', true);
  if (run.building) return;
  run.building = true;
  const h_ = await startTask(proj, task, 'output');
  if (!h_) { run.building = false; return; }
  const code = await h_.done;
  run.building = false;
  outPrint(code === 0 ? '✔ Tests passed\n' : `✘ Tests failed (exit ${code})\n`, code === 0 ? 't-cmd' : 't-err');
}

/* ------------------------------ auto-save / auto-build ------------------------------ */

function onFileEdited(tab) {
  if (autoSaveMode() !== 'afterDelay' || tab.kind !== 'file') return;
  clearTimeout(run.saveTimers.get(tab));
  run.saveTimers.set(tab, setTimeout(async () => {
    if (tab.model.isDisposed() || tab.model.getValue() === tab.saved) return;
    try { await saveTab(tab); renderTabs(); } catch (e) { status(e.message, true); }
  }, 1200));
}

/** Called after any successful save: kick off a debounced background compile for source files. */
function afterSave(tab) {
  if (!autoBuildOn() || !state.workspace || run.proc || !/\.(java|kt|ts|go|cs)$/i.test(tab.path)) return;
  const idx = run.projects.findIndex((p) => tab.path.toLowerCase().startsWith(p.dir.toLowerCase()) && taskOf(p, 'build') && taskOf(p, 'build').auto);
  if (idx < 0) return;
  clearTimeout(run.buildTimer);
  run.buildTimer = setTimeout(() => { if (!run.proc && !run.building) { run.sel = idx; renderRunConfig(); doBuild(true); } }, 2500);
}

/* ------------------------------ Run & Servers view ------------------------------ */

async function renderRunView(box) {
  box.replaceChildren(h('header', {}, h('span', { text: 'RUN & SERVERS' }), h('span', { class: 'actions' }, h('button', { title: 'Re-detect', text: '↻', onclick: () => detectBuildEnv() }))));
  const pad = h('div', { class: 'pad' });
  box.append(pad);

  pad.append(h('div', { class: 'cat', text: 'Detected build environment' }));
  if (!state.workspace) pad.append(h('div', { class: 'hint', text: 'Open or create a project to detect how it builds and runs.' }));
  else if (!run.projects.length) pad.append(h('div', { class: 'hint', text: 'No Maven, Gradle, npm, Python, Go or .NET project found in this folder.' }));
  run.projects.forEach((p, i) => {
    pad.append(h('div', { class: 'card' + (i === run.sel ? ' cn' : '') },
      h('div', { class: 'cardh clickable', onclick: () => { run.sel = i; renderRunConfig(); renderRunView(box); } }, h('b', { text: p.type }), h('small', { class: 't-dim', text: p.rel })),
      ...p.tasks.map((t) => {
        const miss = runtimeMissing(t);
        return h('div', { class: 'row' },
          h('button', { class: t.kind === 'run' ? 'primary' : '', text: t.label, title: t.cmd, disabled: !!miss || ((t.kind === 'run' || t.kind === 'debug') && !!run.proc), onclick: async () => {
            run.sel = i; renderRunConfig();
            if (t.kind === 'run' || t.kind === 'debug') doStart(t.kind);
            else if (t.deployWar) deployWarToTomcat(p, t);
            else { const h_ = await startTask(p, t, 'output'); if (h_) { run.building = true; const c = await h_.done; run.building = false; outPrint(c === 0 ? '✔ done\n' : `✘ failed (exit ${c})\n`, c === 0 ? 't-cmd' : 't-err'); } }
          } }),
          miss ? h('small', { class: 't-err', text: `${miss.name} not found` }) : null);
      })));
  });

  pad.append(h('div', { class: 'cat bar', text: 'Runtimes' }));
  pad.append(h('div', { class: 'row' }, ...run.runtimes.filter((r) => r.found).map((r) => h('span', { class: 'chip ok', title: r.path, text: `${r.name} ${r.version && r.version.length < 22 ? r.version : ''}`.trim() })),
    ...run.runtimes.filter((r) => !r.found).map((r) => h('span', { class: 'chip', text: `${r.name} ✕` }))));
  pad.append(h('button', { class: 'wide', text: 'Configure runtimes…', onclick: () => openSettings('runtimes') }));

  pad.append(h('div', { class: 'cat bar', text: 'Apache Tomcat' }));
  const tc = await tryInv('server:tomcatInfo');
  if (tc.ok && tc.data.home) {
    pad.append(h('div', { class: 'kv', text: tc.data.home }),
      h('div', { class: 'row' },
        h('button', { class: 'primary', text: 'Start', onclick: () => startTomcat('start') }),
        h('button', { text: 'Debug (8000)', onclick: () => startTomcat('debug') }),
        h('button', { text: 'Stop', onclick: () => stopTomcat() })),
      h('div', { class: 'hint', text: tc.data.apps.length ? `Deployed: ${tc.data.apps.join(', ')}` : 'No applications deployed yet. Use "Package and deploy to Tomcat" on a WAR project.' }),
      h('button', { class: 'wide', text: 'Open http://localhost:8080 in the IDE', onclick: () => openBrowser('http://localhost:8080/', 'Tomcat') }));
  } else {
    pad.append(h('div', { class: 'hint', text: 'Tomcat was not found. Point the IDE at its folder in Settings > Runtimes (it needs a bin/catalina script).' }));
  }

  pad.append(h('div', { class: 'cat bar', text: 'Servers listening on this computer' }));
  const list = h('div', {});
  pad.append(list, h('button', { class: 'wide', text: 'Refresh', onclick: () => renderRunView(box) }));
  const ls = await tryInv('server:listening');
  if (!ls.ok) list.append(h('div', { class: 'hint t-err', text: ls.error }));
  else {
    const web = ls.data.filter((x) => x.port >= 1024 && x.address !== '::1' || [80, 443, 8080].includes(x.port));
    list.append(...(web.length ? web.slice(0, 40).map((x) => h('div', { class: 'svc', title: `${x.process} (pid ${x.pid})`, onclick: () => openBrowser(`http://localhost:${x.port}/`, `localhost:${x.port}`) },
      h('span', { text: `:${x.port}` }), h('small', { text: x.process || '' }))) : [h('div', { class: 'hint', text: 'Nothing is listening.' })]));
    list.append(h('div', { class: 'hint', text: 'Click a port to open it in the IDE browser (HTTP servers only).' }));
  }
}

async function startTomcat(mode) {
  if (run.proc) return status('Something is already running. Stop it first.', true);
  const c = await tryInv('server:tomcatCommand', mode);
  if (!c.ok) return status(c.error, true);
  showPanel('terminal');
  termPrint(`> ${c.data.cmd}\n`, 't-cmd');
  const r = await tryInv('term:run', c.data.cmd, state.workspace || undefined);
  if (!r.ok) return status(r.error, true);
  run.proc = { id: r.data, label: c.data.title, kind: 'server', port: c.data.port, debugPort: c.data.debugPort || 0 };
  runningId = r.data;
  termWaiters.set(r.data, () => { if (run.proc && run.proc.id === r.data) { run.proc = null; runningId = null; } setRunStatus(''); renderRunConfig(); });
  setRunStatus(`▶ ${c.data.title}`);
  watchPort(c.data.port, c.data.title, mode === 'debug' ? 'debug' : 'run');
  renderRunConfig();
}

async function stopTomcat() {
  if (run.proc && run.proc.kind === 'server') return doStop();
  const c = await tryInv('server:tomcatCommand', 'stop');
  if (!c.ok) return status(c.error, true);
  showPanel('terminal');
  termPrint(`> ${c.data.cmd}\n`, 't-cmd');
  await tryInv('term:run', c.data.cmd, state.workspace || undefined);
}

async function deployWarToTomcat(proj, task) {
  const h_ = await startTask(proj, task, 'output');
  if (!h_) return;
  run.building = true;
  const code = await h_.done;
  run.building = false;
  if (code !== 0) return outPrint(`✘ Package failed (exit ${code})\n`, 't-err');
  const d = await tryInv('server:tomcatDeploy', proj.dir);
  if (!d.ok) return outPrint(`${d.error}\n`, 't-err');
  outPrint(`✔ Deployed to ${d.data.dest}\n`, 't-cmd');
  const ls = await tryInv('server:listening');
  if (ls.ok && ls.data.some((x) => x.port === 8080)) {
    status(`Deployed. Opening ${d.data.context}`);
    setTimeout(() => openBrowser(`http://localhost:8080${d.data.context}/`, `Tomcat ${d.data.context}`), 3000);
  } else status('Deployed. Start Tomcat from the Run & Servers view.');
}

/* ------------------------------ wiring ------------------------------ */

function wireRun() {
  $('tb-build').onclick = () => doBuild(false);
  $('tb-run').onclick = () => doStart('run');
  $('tb-debug').onclick = () => doStart('debug');
  $('tb-stop').onclick = doStop;
  $('run-config').onchange = (e) => { run.sel = Number(e.target.value) || 0; renderRunConfig(); };
  $('st-run').onclick = (e) => { const p = Number(e.currentTarget.dataset.port); if (p) openBrowser(`http://localhost:${p}/`, `localhost:${p}`); };
  const C = (id, fn, title) => CNS.command(id, fn, title);
  C('run.build', () => doBuild(false), 'Run: Build');
  C('run.run', () => doStart('run'), 'Run: Run');
  C('run.debug', () => doStart('debug'), 'Run: Debug');
  C('run.test', doTest, 'Run: Test');
  C('run.stop', doStop, 'Run: Stop');
  C('view.run', () => clickView('run'), 'View: Run & Servers');
  C('view.servers', () => clickView('run'), 'View: Servers (Tomcat, local ports)');
  C('runtimes.open', () => openSettings('runtimes'), 'Settings: Runtimes');
  window.addEventListener('blur', () => { if (autoSaveMode() !== 'off') saveAll().catch(() => {}); });
  detectBuildEnv();
}
