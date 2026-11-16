/* Build Tools - the BUILD section under Source Control. One panel for every build tool found in the project (Maven, Gradle, Ant, npm / Yarn /
   pnpm / Bun, pip / Poetry / uv, Go, Cargo, .NET, Make, CMake, Composer, Bundler, Flutter, sbt, Bazel). Output goes to the OUTPUT panel with
   clickable errors, a Stop button, timing and a result summary. */
'use strict';

CNS.plugin('cns.build-tools', (api) => {
  const { h } = api.ui;
  const B = { projects: [], sel: '', info: null, tools: {}, optOn: new Set(), profiles: new Set(), module: '', alsoMake: false, wrapper: true, custom: '', run: null, last: null, ui: null, scanning: false, depFilter: '', open: {}, timer: null };
  const call = (ch, ...a) => api.invoke(ch, state.workspace, ...a);
  const cfg = () => state.settings.build || {};
  const saveCfg = async (patch) => { state.settings.build = { ...cfg(), ...patch }; await tryInv('settings:set', 'build', state.settings.build); };
  const cur = () => B.projects.find((p) => p.id === B.sel) || null;
  const LOGO_OF = (tool, info) => (tool === 'npm' ? (info && info.pm) || 'npm' : tool === 'python' ? (info && info.manager) || 'pip' : tool);

  /* ------------------------------ data ------------------------------ */

  async function scan(keep) {
    if (!state.workspace) { B.projects = []; B.sel = ''; B.info = null; draw(); return; }
    B.scanning = true; drawHead();
    try { B.projects = await call('scan'); } catch (e) { B.projects = []; api.ui.status(e.message, true); }
    B.scanning = false;
    const saved = cfg().sel;
    if (!keep || !cur()) B.sel = (B.projects.find((p) => p.id === saved) || B.projects[0] || {}).id || '';
    await load();
  }

  async function load() {
    const p = cur();
    if (!p) { B.info = null; draw(); S.badge(''); return; }
    try {
      B.info = await call('describe', { dir: p.dir, tool: p.tool });
      const saved = ((cfg().opts || {})[p.id]) || null;
      B.optOn = new Set(saved || B.info.options.filter((o) => o.default).map((o) => o.id));
      B.profiles = new Set();
      if (!(B.info.modules || []).some((m) => m.name === B.module)) B.module = '';
    } catch (e) { B.info = { error: e.message, goals: [], options: [], facts: [], dependencies: [] }; }
    draw();
    S.badge(String(B.projects.length));
    call('check', B.projects.map((x) => ({ tool: x.tool, dir: x.dir }))).then((r) => { B.tools = r || {}; drawTool(); }).catch(() => {});
  }
  const S = { badge: () => {} };

  /* ------------------------------ running a build ------------------------------ */

  const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
  const RE = {
    maven: /^\[(ERROR|WARNING)\]\s+(.+?\.(?:java|kt|scala|groovy)):\[(\d+),(\d+)\]\s*(.*)$/,
    ts: /^(.+?\.[A-Za-z]{1,5})\((\d+),(\d+)\):\s*(error|warning)\s*(.*)$/,
    rust: /^\s*-->\s+(.+?):(\d+):(\d+)/,
    py: /^\s*File "(.+?)", line (\d+)/,
    kotlin: /^([ew]): (?:file:\/+)?(.+?):? \((\d+), (\d+)\):? (.*)$/,
    gen: /^(?:\[(?:ERROR|WARNING|WARN)\]\s+)?((?:[A-Za-z]:)?[^\s:"'<>|*?]+?\.(?:java|kt|scala|groovy|c|cc|cpp|h|hpp|cs|go|rs|py|js|jsx|mjs|ts|tsx|php|rb|dart|swift)):(\d+)(?::(\d+))?:?\s*(.*)$/,
  };
  const absPath = (dir, p0) => {
    const p = p0.replace(/^\/(?=[A-Za-z]:)/, ''); // Maven prints /C:/path
    return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') ? p.split('/').join(BS) : joinPath(dir, p.replace(/^\.[\\/]/, '').split('/').join(BS));
  };

  function emitLine(run, raw) {
    const line = raw.replace(ANSI, '').replace(/\s+$/, '');
    if (!line) { outPrint('\n'); return; }
    let m;
    const bad = /\b(ERROR|FAILED|FAILURE|error:|fatal:|panic)\b|BUILD FAILURE|npm ERR!/.test(line);
    const warn = !bad && /\[WARN(ING)?\]|\bwarning:|WARN /.test(line);
    const cls = bad ? 't-err' : warn ? 't-warn' : /BUILD SUCCESS|BUILD SUCCESSFUL|Finished|Compiling|Successfully/.test(line) ? 't-cmd' : '';
    const link = (file, ln, col) => { run.problems++; outLink(line, absPath(run.dir, file), Number(ln) || 1, Number(col) || 1, cls || 't-err'); };
    if ((m = RE.maven.exec(line))) return link(m[2], m[3], m[4]);
    if ((m = RE.kotlin.exec(line))) return link(m[2], m[3], m[4]);
    if ((m = RE.ts.exec(line))) return link(m[1], m[2], m[3]);
    if ((m = RE.rust.exec(line))) return link(m[1], m[2], m[3]);
    if ((m = RE.py.exec(line))) return link(m[1], m[2], 1);
    if ((m = RE.gen.exec(line)) && !/^https?:/i.test(line)) return link(m[1], m[2], m[3]);
    if (bad) run.errors++; else if (warn) run.warnings++;
    outPrint(`${line}\n`, cls);
  }

  async function runBuild(def) {
    if (B.run) return api.ui.status('A build is already running. Stop it first.', true);
    if (def.confirm && !(await confirmBox(`Run ${def.title}?`, def.confirm))) return;
    await saveAllQuiet();
    showPanel('output');
    outPrint(`\n> ${def.cmd}   [${def.cwd}]\n`, 't-cmd');
    const r = await tryInv('term:run', def.cmd, def.cwd);
    if (!r.ok) { outPrint(`${r.error}\n`, 't-err'); return api.ui.status(r.error, true); }
    const run = { id: r.data, title: def.title, cmd: def.cmd, dir: def.cwd, started: Date.now(), errors: 0, warnings: 0, problems: 0, def, buf: '' };
    B.run = run;
    termRoutes.set(run.id, (text) => { run.buf += text; const parts = run.buf.split(/\r?\n|\r(?!\n)/); run.buf = parts.pop(); parts.forEach((l) => emitLine(run, l)); });
    termWaiters.set(run.id, (code) => {
      if (run.buf) emitLine(run, run.buf);
      const secs = ((Date.now() - run.started) / 1000).toFixed(1);
      const ok = code === 0;
      const sum = ok ? `✔ ${run.title} finished in ${secs}s${run.warnings ? `, ${run.warnings} warning(s)` : ''}` : `✘ ${run.title} failed (exit ${code}) after ${secs}s${run.errors + run.problems ? `, ${run.errors + run.problems} error line(s)` : ''}`;
      outPrint(`${sum}\n`, ok ? 't-cmd' : 't-err');
      B.last = { title: run.title, ok, secs, code, def: run.def, errors: run.errors + run.problems, warnings: run.warnings };
      B.run = null; clearInterval(B.timer);
      api.ui.status(sum, !ok);
      termRoutes.delete(run.id);
      if (ok && /clean|compile|install|package|build|verify|assemble/.test(run.title)) { if (typeof JV !== 'undefined') JV.stale = true; }
      drawStatus();
      CNS.emit('build-finished', B.last);
    });
    B.timer = setInterval(drawStatus, 1000);
    drawStatus();
  }
  async function saveAllQuiet() { try { await saveAll(); } catch { /* unsaved files are the user's call */ } }

  async function runSelection(goals, extra = {}) {
    const p = cur();
    if (!p) return api.ui.status('No build file found in this project.', true);
    try {
      const def = await call('command', { dir: p.dir, tool: p.tool, goals, custom: extra.custom !== undefined ? extra.custom : '', options: [...B.optOn], profiles: [...B.profiles], module: B.module, alsoMake: B.alsoMake, useWrapper: B.wrapper });
      if (extra.custom) await remember(p.dir, extra.custom);
      await runBuild(def);
    } catch (e) { api.ui.status(e.message, true); outPrint(`${e.message}\n`, 't-err'); }
  }
  async function remember(dir, text) {
    const hist = { ...(cfg().hist || {}) };
    hist[dir] = [text, ...(hist[dir] || []).filter((x) => x !== text)].slice(0, 15);
    await saveCfg({ hist });
  }

  /* ------------------------------ drawing ------------------------------ */

  function mount(body) {
    B.ui = { body, head: h('div'), tool: h('div'), goals: h('div'), opts: h('div'), custom: h('div'), status: h('div'), favs: h('div'), details: h('div') };
    body.append(B.ui.head, B.ui.tool, B.ui.status, B.ui.goals, B.ui.opts, B.ui.custom, B.ui.favs, B.ui.details);
  }

  function draw() { if (!B.ui) return; drawHead(); drawTool(); drawStatus(); drawGoals(); drawOpts(); drawCustom(); drawFavs(); drawDetails(); }

  function drawHead() {
    if (!B.ui) return;
    if (!state.workspace) { B.ui.head.replaceChildren(h('div', { class: 'hint bld-kv', text: 'Open a folder to build it.' })); return; }
    if (!B.projects.length) { B.ui.head.replaceChildren(h('div', { class: 'hint bld-kv', text: B.scanning ? 'Looking for build files…' : 'No build file found (pom.xml, build.gradle, package.json, go.mod, Cargo.toml, *.csproj, Makefile, …).' })); return; }
    const sel = h('select', { title: 'Project to build' }, B.projects.map((p) => h('option', { value: p.id, text: `${p.toolName.split(' ')[0]} · ${p.rel}`, selected: p.id === B.sel })));
    sel.onchange = () => { B.sel = sel.value; saveCfg({ sel: B.sel }); B.module = ''; load(); };
    const p = cur();
    B.ui.head.replaceChildren(h('div', { class: 'bld-top' }, p ? logo(LOGO_OF(p.tool, B.info), 18) : null, sel));
  }

  function toolStatus() { const p = cur(); return p ? B.tools[`${p.tool}|${p.dir}`] : null; }
  function drawTool() {
    if (!B.ui) return;
    const p = cur();
    if (!p) { B.ui.tool.replaceChildren(); return; }
    const t = toolStatus();
    const info = B.info || {};
    const missing = t && !t.found;
    B.ui.tool.replaceChildren(h('div', { class: 'bld-tool' },
      h('b', { text: info.title || p.rel }),
      t ? (missing ? h('span', { class: 'chip', style: 'border-color:var(--danger);color:var(--danger)', title: 'Not found on this computer', text: `${p.toolName.split(' ')[0]} not found` }) : h('span', { class: 'chip ok', title: t.version, text: (t.version || 'ready').replace(/^Apache /, '').slice(0, 34) })) : h('span', { class: 't-dim', text: 'checking…' }),
      t && t.java ? h('span', { class: 'chip', title: 'Java used by Maven', text: `Java ${t.java}` }) : null,
      info.wrapper ? h('label', { class: 'inline', title: 'Use the project’s wrapper script (mvnw / gradlew) instead of the installed tool' }, h('input', { type: 'checkbox', checked: B.wrapper, onchange: (e) => { B.wrapper = e.target.checked; } }), ' wrapper') : null,
      missing ? h('button', { class: 'sbtn', text: 'Set up…', onclick: () => openSettings('runtimes') }) : null));
  }

  function drawStatus() {
    if (!B.ui) return;
    const r = B.run;
    const l = B.last;
    if (r) {
      const secs = Math.round((Date.now() - r.started) / 1000);
      B.ui.status.replaceChildren(h('div', { class: 'bld-status run' }, h('div', {}, `⏳ ${r.title}  ·  ${secs}s`), h('div', { class: 'row' }, h('button', { text: '■ Stop', onclick: () => { tryInv('term:kill', r.id); outPrint('^C stopped by you\n', 't-dim'); } }), h('button', { text: 'Show output', onclick: () => showPanel('output') }))));
    } else if (l) {
      B.ui.status.replaceChildren(h('div', { class: `bld-status ${l.ok ? 'ok' : 'bad'}` }, h('div', {}, `${l.ok ? '✔' : '✘'} ${l.title}  ·  ${l.secs}s${l.ok ? '' : `  ·  exit ${l.code}`}${l.errors ? `  ·  ${l.errors} error line(s)` : ''}`),
        h('div', { class: 'row' }, h('button', { text: '↻ Run again', onclick: () => runBuild(l.def) }), h('button', { text: 'Show output', onclick: () => showPanel('output') }))));
    } else B.ui.status.replaceChildren();
  }

  function goalButton(g, primary) {
    return h('button', { class: g.rec || primary ? 'rec' : '', title: g.title || `${g.label}${g.confirm ? ' (asks first)' : ''}`, onclick: () => runSelection([g.id]) }, g.label);
  }

  function drawGoals() {
    if (!B.ui) return;
    const info = B.info;
    if (!info || info.error) { B.ui.goals.replaceChildren(info && info.error ? h('div', { class: 'msg err bld-kv', text: info.error }) : null); return; }
    const goals = info.goals || [];
    const rec = goals.filter((g) => g.rec).slice(0, 10);
    const groups = new Map();
    for (const g of goals) { if (!groups.has(g.group)) groups.set(g.group, []); groups.get(g.group).push(g); }
    B.ui.goals.replaceChildren(
      h('div', { class: 'bld-goals' }, ...rec.map((g) => goalButton(g, true))),
      goals.length > rec.length ? h('details', { class: 'bld-sub', open: !!B.open.allgoals, ontoggle: (e) => { B.open.allgoals = e.target.open; } }, h('summary', { text: `ALL GOALS (${goals.length})` }), ...[...groups].map(([name, list]) => h('div', {}, h('div', { class: 'bld-kv', text: name }), h('div', { class: 'bld-goals' }, ...list.map((g) => goalButton(g)))))) : null);
  }

  function drawOpts() {
    if (!B.ui) return;
    const info = B.info;
    if (!info || !info.options) { B.ui.opts.replaceChildren(); return; }
    const items = [];
    if (info.options.length) {
      items.push(h('div', { class: 'bld-opts' }, ...info.options.map((o) => h('label', { title: o.help || o.args.join(' ') }, h('input', { type: 'checkbox', checked: B.optOn.has(o.id), onchange: async (e) => { if (e.target.checked) B.optOn.add(o.id); else B.optOn.delete(o.id); await saveCfg({ opts: { ...(cfg().opts || {}), [cur().id]: [...B.optOn] } }); } }), ` ${o.label}`))));
    }
    if (info.profiles && info.profiles.length) {
      items.push(h('div', { class: 'bld-opts' }, h('span', { class: 't-dim', text: 'Profiles:' }), ...info.profiles.map((pr) => h('label', { title: pr.active ? 'Active by default' : '' }, h('input', { type: 'checkbox', checked: B.profiles.has(pr.id), onchange: (e) => { if (e.target.checked) B.profiles.add(pr.id); else B.profiles.delete(pr.id); } }), ` ${pr.id}${pr.active ? ' *' : ''}`))));
    }
    if (info.modules && info.modules.length && ['maven', 'gradle'].includes(cur().tool)) {
      const msel = h('select', { style: 'flex:1;min-width:0;margin:0' }, h('option', { value: '', text: 'All modules' }), ...info.modules.map((m) => h('option', { value: modVal(m), text: m.name, selected: modVal(m) === B.module })));
      msel.onchange = () => { B.module = msel.value; draw(); };
      items.push(h('div', { class: 'bld-run' }, h('span', { class: 't-dim', style: 'align-self:center', text: 'Module' }), msel, cur().tool === 'maven' ? h('label', { class: 'inline', title: 'Also build the modules this one depends on (-am)' }, h('input', { type: 'checkbox', checked: B.alsoMake, onchange: (e) => { B.alsoMake = e.target.checked; } }), ' + dependencies') : null));
    }
    B.ui.opts.replaceChildren(...items);
  }
  const modVal = (m) => (cur() && cur().tool === 'gradle' ? m.name.replace(/:/g, '/') : m.name);
  const path = { rel: (p) => (state.workspace && p.toLowerCase().startsWith(state.workspace.toLowerCase()) ? p.slice(state.workspace.length).replace(/^[\\/]+/, '') : p) };

  function drawCustom() {
    if (!B.ui) return;
    const p = cur();
    if (!p) { B.ui.custom.replaceChildren(); return; }
    const hist = (cfg().hist || {})[p.dir] || [];
    const input = h('input', { placeholder: p.tool === 'maven' ? 'goals, e.g. clean verify -Dtest=MyTest' : p.tool === 'npm' ? 'e.g. run build -- --watch' : 'arguments', list: 'bld-hist', value: B.custom, spellcheck: 'false' });
    input.oninput = () => { B.custom = input.value; };
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    const go = () => { if (!input.value.trim()) return api.ui.status('Type the goals or arguments to run.', true); runSelection([], { custom: input.value.trim() }); };
    B.ui.custom.replaceChildren(h('div', { class: 'bld-run' }, input, h('datalist', { id: 'bld-hist' }, ...hist.map((x) => h('option', { value: x }))),
      h('button', { class: 'primary', title: 'Run (uses the ticked options)', text: '▶', onclick: go }),
      h('button', { title: 'Save as a favourite', text: '★', onclick: async () => { const v = input.value.trim(); if (!v) return api.ui.status('Type something to save.', true); const name = await promptText('Favourite name', 'e.g. Fast build', v.slice(0, 30)); if (!name) return; await saveCfg({ favs: [...(cfg().favs || []), { name, dir: p.dir, tool: p.tool, custom: v, options: [...B.optOn], profiles: [...B.profiles], module: B.module }].slice(-30) }); drawFavs(); } })));
  }

  function drawFavs() {
    if (!B.ui) return;
    const p = cur();
    const favs = (cfg().favs || []).filter((f) => p && f.dir === p.dir);
    B.ui.favs.replaceChildren(...(favs.length ? [h('div', { class: 'bld-kv', text: 'FAVOURITES' }), ...favs.map((f) => h('div', { class: 'bld-row' }, h('span', { text: '★' }), h('span', { class: 'nm', title: f.custom, text: f.name }),
      h('button', { text: '▶', title: f.custom, onclick: async () => { try { const def = await call('command', { dir: f.dir, tool: f.tool, goals: [], custom: f.custom, options: f.options, profiles: f.profiles, module: f.module, useWrapper: B.wrapper }); runBuild(def); } catch (e) { api.ui.status(e.message, true); } } }),
      h('button', { text: '✕', title: 'Remove', onclick: async () => { await saveCfg({ favs: (cfg().favs || []).filter((x) => x !== f) }); drawFavs(); } })))] : []));
  }

  /* ---- details: project, dependencies, modules, plugins ---- */

  function sub(key, title, ...kids) { return h('details', { class: 'bld-sub', open: !!B.open[key], ontoggle: (e) => { B.open[key] = e.target.open; } }, h('summary', { text: title }), ...kids); }

  function depGoal(ids) { return ((B.info || {}).goals || []).find((g) => ids.includes(g.id)); }

  function drawDetails() {
    if (!B.ui) return;
    const info = B.info;
    const p = cur();
    if (!info || !p || info.error) { B.ui.details.replaceChildren(); return; }
    const parts = [];
    parts.push(sub('facts', 'PROJECT', ...(info.facts || []).map(([k, v]) => h('div', { class: 'bld-kv' }, `${k}: `, h('b', { text: v }))),
      h('div', { class: 'row', style: 'padding:0 18px' },
        h('button', { text: 'Open build file', onclick: () => { const f = { maven: 'pom.xml', gradle: ['build.gradle.kts', 'build.gradle'], npm: 'package.json', go: 'go.mod', cargo: 'Cargo.toml', ant: 'build.xml', make: 'Makefile', cmake: 'CMakeLists.txt', composer: 'composer.json', bundler: 'Gemfile', flutter: 'pubspec.yaml', sbt: 'build.sbt', python: ['pyproject.toml', 'requirements.txt', 'setup.py'] }[p.tool]; openBuildFile(p.dir, f); } }),
        h('button', { text: 'Reveal folder', onclick: () => explorerReveal(p.dir, { focus: true }) }))));
    const deps = info.dependencies || [];
    const filter = h('input', { placeholder: `Filter ${deps.length} dependencies`, value: B.depFilter, style: 'margin:2px 10px;width:calc(100% - 20px);box-sizing:border-box' });
    const list = h('div');
    const paint = () => { const q = B.depFilter.toLowerCase(); list.replaceChildren(...deps.filter((d) => !q || d.name.toLowerCase().includes(q)).slice(0, 200).map((d) => h('div', { class: 'bld-row' }, h('span', { class: 'nm', title: `${d.name} ${d.version || ''}`, text: d.name }), d.version ? h('span', { class: 'vv', text: d.version }) : null, d.scope && d.scope !== 'compile' ? h('span', { class: 'sc', text: d.scope }) : null,
      h('button', { text: '✕', title: 'Remove this dependency', onclick: () => removeDep(d) })))); };
    filter.oninput = () => { B.depFilter = filter.value; paint(); };
    paint();
    const tree = depGoal(['tree', 'deps', 'ls', 'tree', 'freeze']); const outd = depGoal(['upd', 'outdated', 'outd']); const aud = depGoal(['analyze', 'audit', 'vet']);
    parts.push(sub('deps', `DEPENDENCIES (${deps.length})`, h('div', { class: 'row', style: 'padding:0 10px' },
      h('button', { class: 'primary', text: '+ Add…', onclick: () => addDepDialog() }), tree ? h('button', { text: 'Tree', title: tree.label, onclick: () => runSelection([tree.id]) }) : null, outd ? h('button', { text: 'Outdated', title: outd.label, onclick: () => runSelection([outd.id]) }) : null, aud ? h('button', { text: aud.id === 'audit' ? 'Audit' : 'Analyze', onclick: () => runSelection([aud.id]) }) : null), deps.length > 8 ? filter : null, list));
    if (info.modules && info.modules.length) parts.push(sub('mods', `MODULES (${info.modules.length})`, ...info.modules.map((m) => h('div', { class: 'bld-row' }, h('span', { class: 'nm', text: m.name }), h('button', { text: '▶', title: 'Build only this module', onclick: () => { B.module = modVal(m); draw(); const g = (info.goals.find((x) => x.rec) || info.goals[0]); if (g) runSelection([g.id]); } }), h('button', { text: '📂', title: 'Reveal', onclick: () => explorerReveal(m.dir, { focus: true }) })))));
    if (info.plugins && info.plugins.length) parts.push(sub('plugins', `PLUGINS (${info.plugins.length})`, ...info.plugins.map((x) => h('div', { class: 'bld-row' }, h('span', { class: 'nm', title: x.name, text: x.artifact }), x.version ? h('span', { class: 'vv', text: x.version }) : null))));
    if (info.properties && Object.keys(info.properties).length) parts.push(sub('props', `PROPERTIES (${Object.keys(info.properties).length})`, ...Object.entries(info.properties).map(([k, v]) => h('div', { class: 'bld-kv', title: `${k} = ${v}` }, `${k} = `, h('b', { text: v })))));
    if (info.lombok === false && p.tool === 'maven' && (info.dependencies || []).length) { /* Lombok hint lives in the advisor */ }
    B.ui.details.replaceChildren(...parts);
  }

  async function openBuildFile(dir, names) {
    for (const n of [].concat(names)) { const f = joinPath(dir, n); if (await inv('fs:exists', f).catch(() => false)) return openAt(f, 1); }
    api.ui.status('Build file not found.', true);
  }

  /* ------------------------------ dependencies ------------------------------ */

  async function afterDepChange(res, what) {
    if (res.edited) {
      api.ui.status(`${what}: edited ${res.edited}. Review it with Git (Source Control).`);
      await refreshTree();
      await reloadOpenTabs(state.tabs.filter((t) => t.kind === 'file').map((t) => t.path));
      if (cur() && ['maven', 'gradle'].includes(cur().tool)) { tryInv('javac:modules', state.workspace, true); if (typeof scheduleJavaCheck === 'function') scheduleJavaCheck(1200); }
      await load();
    } else if (res.command) runBuild({ cmd: res.command, cwd: res.cwd, title: what, confirm: '' }).then(() => setTimeout(load, 4000));
  }

  async function removeDep(d) {
    const p = cur();
    if (!(await confirmBox(`Remove ${d.name}?`, ['maven', 'gradle'].includes(p.tool) ? 'The dependency is deleted from the build file.' : 'The package is uninstalled.'))) return;
    try { await afterDepChange(await call('removeDependency', { dir: p.dir, tool: p.tool, name: d.name }), `Remove ${d.name}`); } catch (e) { api.ui.status(e.message, true); }
  }

  function addDepDialog() {
    const p = cur();
    const q = h('input', { placeholder: p.tool === 'go' ? 'github.com/owner/module' : 'Search by name, e.g. jackson, lombok, axios, requests', spellcheck: 'false' });
    const results = h('div', { style: 'max-height:36vh;overflow:auto;margin-top:6px' });
    const ver = h('input', { placeholder: 'version', style: 'max-width:150px' });
    const scopes = p.tool === 'maven' ? ['compile', 'provided', 'runtime', 'test'] : p.tool === 'gradle' ? ['implementation', 'test', 'runtime', 'provided'] : p.tool === 'npm' ? ['dependency', 'dev'] : ['dependency'];
    const scope = h('select', { style: 'max-width:150px' }, scopes.map((s) => h('option', { value: s === 'implementation' ? '' : s === 'dependency' ? '' : s, text: s })));
    const picked = h('div', { class: 'hint', text: 'Pick a result.' });
    let chosen = null; let timer = null; let close;
    const show = (list) => results.replaceChildren(...(list.length ? list : [h('div', { class: 'hint', text: 'No results.' })]).map((r) => (r.name ? h('div', { class: 'bld-row', style: 'cursor:pointer', onclick: () => { chosen = r; ver.value = r.version && r.version !== 'latest' ? r.version : ''; picked.textContent = `Selected: ${r.name}`; } }, h('span', { class: 'nm', title: r.desc, text: r.name }), h('span', { class: 'vv', text: r.version }), h('span', { class: 't-dim', style: 'max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: r.desc })) : r)));
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(async () => { if (q.value.trim().length < 2) return; results.replaceChildren(h('div', { class: 'hint', text: 'Searching…' })); try { show(await call('search', { tool: p.tool, q: q.value.trim() })); } catch (e) { results.replaceChildren(h('div', { class: 'msg err', text: e.message })); } }, 450); };
    const add = h('button', { class: 'primary', text: 'Add', onclick: async () => {
      const name = chosen ? chosen.name : q.value.trim();
      if (!name) return;
      close();
      try { await afterDepChange(await call('addDependency', { dir: p.dir, tool: p.tool, name, version: ver.value.trim(), scope: scope.value }), `Add ${name}`); } catch (e) { api.ui.status(e.message, true); }
    } });
    close = modal(`Add a dependency (${p.toolName.split(' ')[0]})`, h('div', {}, h('p', { class: 'hint', text: ['maven', 'gradle'].includes(p.tool) ? 'Searches Maven Central. Only your search text is sent. The dependency is added to the build file.' : 'Searches the package registry (only your search text is sent), then installs it with the tool.' }), q, results, picked, h('div', { class: 'row' }, ver, scope)), [h('button', { text: 'Cancel', onclick: () => close() }), add], { wide: true });
    q.focus();
  }

  /* ------------------------------ quick pick of every goal ------------------------------ */

  function pickGoal() {
    const info = B.info;
    if (!info || !info.goals.length) return api.ui.status('No build goals here. Open a folder with a build file.', true);
    quickPick({ placeholder: `${cur().toolName.split(' ')[0]}: run a goal`, items: info.goals.map((g) => ({ label: g.label, detail: `${g.group}${g.rec ? ' · recommended' : ''}`, icon: '▶', data: g })), onPick: (it) => runSelection([it.data.id]) });
  }

  /* ------------------------------ registration ------------------------------ */

  api.sections.register({
    id: 'build', title: 'BUILD', order: 30, icon: () => logo('build', 14),
    mount({ body, actions, badge, setOnOpen }) {
      S.badge = badge;
      mount(body);
      actions.append(h('button', { text: '▶', title: 'Run a goal… (command palette: Build: Run Goal)', onclick: () => pickGoal() }), h('button', { text: '⟳', title: 'Find build files again', onclick: () => scan(true) }));
      setOnOpen(() => scan(true));
      scan(false);
    },
  });

  const C = (id, fn, title) => api.commands.register(id, fn, title);
  C('build.goal', pickGoal, 'Build: Run Goal…');
  C('build.rerun', () => { if (B.last) runBuild(B.last.def); else pickGoal(); }, 'Build: Run Again');
  C('build.stop', () => { if (B.run) tryInv('term:kill', B.run.id); }, 'Build: Stop');
  C('build.refresh', () => scan(true), 'Build: Find Build Files Again');
  C('build.addDependency', () => (cur() ? addDepDialog() : api.ui.status('No build file found.', true)), 'Build: Add Dependency…');
  C('build.custom', async () => { const v = await promptText('Run', 'goals or arguments, e.g. clean verify'); if (v) runSelection([], { custom: v }); }, 'Build: Run Custom Goals…');
  C('build.focus', () => { showView('explorer'); const m = SEC.mounted.get('build'); if (m) { m.el.classList.remove('collapsed'); m.el.scrollIntoView(); } }, 'View: Build');

  CNS.on('workspace-opened', () => { if (!B.projects.length || !cur() || !cur().dir.toLowerCase().startsWith((state.workspace || '').toLowerCase())) scan(false); });
  CNS.on('file-saved', (t) => { if (/(^|[\\/])(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|package\.json|go\.mod|Cargo\.toml|requirements\.txt|pyproject\.toml|Makefile|build\.xml|[^\\/]+\.csproj)$/i.test(t.path)) { clearTimeout(B.rescan); B.rescan = setTimeout(() => scan(true), 700); } });
});
