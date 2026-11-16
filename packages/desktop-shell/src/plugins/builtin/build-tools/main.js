/**
 * Build Tools - main process. Finds every build file in the project (monorepos included), describes it (facts, dependencies, modules,
 * profiles, scripts, targets), builds the exact command for the goals and options you tick, searches package registries and edits
 * dependency lists. The UI runs the command in the OUTPUT panel; this side never executes a build itself.
 *
 * Safety: goals come from each tool's own list (never from free text), profile / module names are validated, and every part of the
 * command goes through quoteArg. Only the "custom goals" box is passed through as typed: it is the same as typing in the terminal.
 */
const fs = require('fs');
const path = require('path');
const { TOOLS, parseXml } = require('./tools');

const SKIP = new Set(['node_modules', '.git', 'target', 'build', 'dist', 'out', 'bin', 'obj', '.gradle', '.idea', '.vscode', '.venv', 'venv', 'env', '__pycache__', '.cnd', '.nativity', '.next', 'coverage', 'vendor', 'site-packages', '.mvn', '.terraform', '.dart_tool']);
const SAFE_NAME = /^[\w.:@/\\-]{1,200}$/;
const UA = 'NativityStudio/1.0 (+dependency search)';

exports.activate = (ctx) => {
  const { exec, commandLine } = ctx;
  const byId = new Map(TOOLS.map((t) => [t.id, t]));
  const toolCache = new Map();

  const must = (c, m) => { if (!c) throw new Error(m); };
  const wsOf = (ws) => { const cur = ctx.workspace(); must(cur && ws && path.resolve(ws).toLowerCase() === path.resolve(cur).toLowerCase(), 'That folder is not the open project.'); return path.resolve(cur); };
  const dirIn = (ws, dir) => { const w = wsOf(ws); const d = path.resolve(dir); must(d.toLowerCase() === w.toLowerCase() || d.toLowerCase().startsWith(w.toLowerCase() + path.sep), 'That folder is outside the project.'); return d; };
  const matches = (tool, names) => tool.files.some((f) => (f instanceof RegExp ? names.some((n) => f.test(n)) : names.includes(f)));

  /* ------------------------------ scan ------------------------------ */

  function scan(ws) {
    const root = wsOf(ws);
    const found = [];
    let visited = 0;
    const walk = (dir, depth) => {
      if (depth > 5 || visited++ > 800) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      const names = entries.filter((e) => e.isFile()).map((e) => e.name);
      for (const t of TOOLS) {
        if (!matches(t, names)) continue;
        if (t.id === 'python' && !names.some((n) => ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'].includes(n))) continue;
        found.push({ id: `${t.id}|${dir}`, tool: t.id, toolName: t.name, dir, rel: path.relative(root, dir) || '.', depth });
      }
      for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
    };
    walk(root, 0);
    // Maven modules and nested Gradle / CMake projects belong to their parent build: show the parent once
    const under = (child, parent) => child.dir !== parent.dir && child.dir.toLowerCase().startsWith(parent.dir.toLowerCase() + path.sep);
    const mavenParents = found.filter((p) => p.tool === 'maven').map((p) => {
      let mods = [];
      try { const pr = parseXml(fs.readFileSync(path.join(p.dir, 'pom.xml'), 'utf8')).children.find((c) => c.name === 'project'); mods = ((pr && pr.children.find((c) => c.name === 'modules')) || { children: [] }).children.filter((c) => c.name === 'module').map((c) => path.resolve(p.dir, c.text.trim()).toLowerCase()); } catch { /* unreadable pom */ }
      return { p, mods };
    });
    return found.filter((p) => {
      if (p.tool === 'maven') return !mavenParents.some((m) => m.p !== p && m.mods.some((md) => p.dir.toLowerCase() === md || p.dir.toLowerCase().startsWith(md + path.sep)));
      if (p.tool === 'gradle' || p.tool === 'cmake') return !found.some((q) => q.tool === p.tool && under(p, q));
      return true;
    }).sort((a, b) => a.depth - b.depth || a.rel.localeCompare(b.rel));
  }

  function describe(ws, { dir, tool }) {
    const d = dirIn(ws, dir);
    const t = byId.get(tool);
    must(t, 'Unknown build tool.');
    const info = t.describe(d);
    const goals = t.goals(info);
    return { tool, toolName: t.name, dir: d, ...info, goals, options: t.options, wrapper: (t.wrapper || []).some((w) => fs.existsSync(path.join(d, w))) };
  }

  /* ------------------------------ command ------------------------------ */

  function command(ws, req) {
    const d = dirIn(ws, req.dir);
    const t = byId.get(req.tool);
    must(t, 'Unknown build tool.');
    const info = t.describe(d);
    const defs = t.goals(info);
    const chosen = (req.goals || []).map((id) => { const g = defs.find((x) => x.id === id); must(g, `Unknown goal "${id}".`); return g; });
    const optDefs = (req.options || []).map((id) => { const o = t.options.find((x) => x.id === id); must(o, `Unknown option "${id}".`); return o; });
    const custom = String(req.custom || '').trim();
    must(!/[\r\n\0]/.test(custom), 'Use one line for custom goals.');
    must(chosen.length || custom, 'Choose a goal or type one.');
    let exe = t.exeFor ? t.exeFor(info) : t.dynamicExe ? info.pm || 'npm' : t.exe;
    if (req.useWrapper !== false) {
      const w = (t.wrapper || []).find((x) => fs.existsSync(path.join(d, x)));
      if (w) exe = process.platform === 'win32' ? `.\\${w}` : `./${w}`;
    }
    const optArgs = optDefs.flatMap((o) => o.args);
    let args;
    if (t.id === 'maven') {
      const profiles = (req.profiles || []).map((p) => { must(SAFE_NAME.test(p), `Invalid profile "${p}".`); return p; });
      const module_ = req.module ? (must(SAFE_NAME.test(req.module), 'Invalid module name.'), req.module) : '';
      args = [...optArgs, ...(module_ ? ['-pl', module_, ...(req.alsoMake ? ['-am'] : [])] : []), ...(profiles.length ? ['-P', profiles.join(',')] : []), ...chosen.flatMap((g) => g.args)];
    } else if (t.id === 'gradle') {
      const module_ = req.module ? (must(SAFE_NAME.test(req.module), 'Invalid module name.'), req.module) : '';
      args = [...(module_ ? ['-p', module_] : []), ...chosen.flatMap((g) => g.args), ...optArgs];
    } else args = [...chosen.flatMap((g) => g.args), ...optArgs];
    const line = `${commandLine(exe, args)}${custom ? ` ${custom}` : ''}`;
    const title = `${t.name}: ${[...chosen.map((g) => g.label), custom].filter(Boolean).join(' + ')}`;
    return { cmd: line, title, cwd: d, confirm: chosen.map((g) => g.confirm).filter(Boolean)[0] || '' };
  }

  /* ------------------------------ is the tool installed? ------------------------------ */

  async function check(ws, list) {
    wsOf(ws);
    const out = {};
    await Promise.all([...new Set((list || []).map((x) => `${x.tool}|${x.dir}`))].map(async (key) => {
      const [tool, dir] = key.split('|');
      const t = byId.get(tool);
      if (!t) return;
      const d = dirIn(ws, dir);
      let exe = t.exeFor ? t.exeFor(t.describe(d)) : t.dynamicExe ? (t.describe(d).pm || 'npm') : t.exe;
      const w = (t.wrapper || []).find((x) => fs.existsSync(path.join(d, x)));
      const ck = `${exe}|${w || ''}`;
      const hit = toolCache.get(ck);
      if (hit && Date.now() - hit.at < 5 * 60 * 1000) { out[key] = hit.v; return; }
      const r = await exec(exe, t.versionArgs, { timeout: 25000, cwd: d });
      const text = `${r.out}\n${r.err}`;
      const first = text.split(/\r?\n/).map((l) => l.trim()).find((l) => /\d/.test(l)) || '';
      const java = /Java version:\s*([^,\n]+)/.exec(text);
      const v = { found: r.ok || !!w, version: r.ok ? first.slice(0, 80) : (w ? `${w} (wrapper)` : ''), wrapper: !!w, java: java ? java[1].trim() : '', error: r.ok ? '' : (w ? '' : 'not found') };
      toolCache.set(ck, { at: Date.now(), v });
      out[key] = v;
    }));
    return out;
  }

  /* ------------------------------ registries ------------------------------ */

  async function getJson(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`The registry answered ${res.status}.`);
    return res.json();
  }

  async function search(_ws, { tool, q }) {
    const query = String(q || '').trim();
    must(query.length >= 2 && query.length <= 80 && !/[\r\n]/.test(query), 'Type at least two characters.');
    const e = encodeURIComponent(query);
    if (tool === 'maven' || tool === 'gradle' || tool === 'sbt') {
      const j = await getJson(`https://search.maven.org/solrsearch/select?q=${e}&rows=20&wt=json`);
      return (j.response.docs || []).map((d) => ({ name: `${d.g}:${d.a}`, version: d.latestVersion, desc: `${d.versionCount} versions` }));
    }
    if (tool === 'npm') { const j = await getJson(`https://registry.npmjs.org/-/v1/search?text=${e}&size=20`); return (j.objects || []).map((o) => ({ name: o.package.name, version: o.package.version, desc: o.package.description || '' })); }
    if (tool === 'python') { try { const j = await getJson(`https://pypi.org/pypi/${encodeURIComponent(query)}/json`); return [{ name: j.info.name, version: j.info.version, desc: j.info.summary || '' }]; } catch { return []; } }
    if (tool === 'cargo') { const j = await getJson(`https://crates.io/api/v1/crates?q=${e}&per_page=20`); return (j.crates || []).map((c) => ({ name: c.name, version: c.max_stable_version || c.max_version, desc: c.description || '' })); }
    if (tool === 'dotnet') { const j = await getJson(`https://azuresearch-usnc.nuget.org/query?q=${e}&take=20`); return (j.data || []).map((p) => ({ name: p.id, version: p.version, desc: p.description || '' })); }
    if (tool === 'composer') { const j = await getJson(`https://packagist.org/search.json?q=${e}&per_page=20`); return (j.results || []).map((p) => ({ name: p.name, version: '', desc: p.description || '' })); }
    if (tool === 'go') { return [{ name: query, version: 'latest', desc: 'Go modules have no search API: enter the full module path, for example github.com/gin-gonic/gin' }]; }
    throw new Error('Searching is not available for this tool.');
  }

  /* ------------------------------ dependencies ------------------------------ */

  /** Position of the closing </dependencies> that belongs directly to <project>. */
  function projectDepsEnd(text) {
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)[^>]*?(\/?)>/g;
    const stack = [];
    let m;
    while ((m = re.exec(text))) {
      if (!m[2] || m[3]) continue;
      if (!m[1]) stack.push(m[2]);
      else { stack.pop(); if (m[2] === 'dependencies' && stack[stack.length - 1] === 'project') return m.index; }
    }
    return -1;
  }

  function addDependency(ws, { dir, tool, name, version, scope }) {
    const d = dirIn(ws, dir);
    must(/^[\w.:@/+-]{1,200}$/.test(String(name)) && (!version || /^[\w.+~^<>=*,-]{1,80}$/.test(String(version))), 'Invalid dependency.');
    if (tool === 'maven') {
      const [g, a] = String(name).split(':');
      must(g && a, 'Maven dependencies look like group:artifact.');
      const f = path.join(d, 'pom.xml');
      let text = fs.readFileSync(f, 'utf8');
      must(!new RegExp(`<groupId>\\s*${g.replace(/\./g, '\\.')}\\s*</groupId>\\s*<artifactId>\\s*${a.replace(/[.]/g, '\\.')}\\s*</artifactId>`).test(text), `${name} is already in this pom.xml.`);
      const nl = text.includes('\r\n') ? '\r\n' : '\n';
      const sc = scope && scope !== 'compile' ? `${nl}      <scope>${scope}</scope>` : '';
      const block = `    <dependency>${nl}      <groupId>${g}</groupId>${nl}      <artifactId>${a}</artifactId>${version ? `${nl}      <version>${version}</version>` : ''}${sc}${nl}    </dependency>${nl}  `;
      const at = projectDepsEnd(text);
      if (at >= 0) text = text.slice(0, at).replace(/[ \t]*$/, '') + block + text.slice(at);
      else text = text.replace('</project>', `  <dependencies>${nl}${block.replace(/\s+$/, '')}${nl}  </dependencies>${nl}</project>`);
      fs.writeFileSync(f, text);
      return { edited: path.relative(ctx.workspace(), f) };
    }
    if (tool === 'gradle') {
      const fn = ['build.gradle.kts', 'build.gradle'].find((x) => fs.existsSync(path.join(d, x)));
      must(fn, 'No build.gradle found.');
      const kts = fn.endsWith('.kts');
      const conf = ({ test: 'testImplementation', runtime: 'runtimeOnly', provided: 'compileOnly' })[scope] || 'implementation';
      const coord = `${name}${version ? `:${version}` : ''}`;
      const line = kts ? `    ${conf}("${coord}")` : `    ${conf} '${coord}'`;
      let text = fs.readFileSync(path.join(d, fn), 'utf8');
      must(!text.includes(`'${name}`) && !text.includes(`"${name}`), `${name} is already in ${fn}.`);
      const m = /^dependencies\s*\{[ \t]*\r?\n/m.exec(text);
      text = m ? text.slice(0, m.index + m[0].length) + line + (text.includes('\r\n') ? '\r\n' : '\n') + text.slice(m.index + m[0].length) : `${text}\ndependencies {\n${line}\n}\n`;
      fs.writeFileSync(path.join(d, fn), text);
      return { edited: fn };
    }
    const dev = scope === 'dev';
    const pkg = `${name}${version && tool === 'npm' ? `@${version}` : ''}`;
    const t = byId.get(tool);
    must(t, 'Unknown build tool.');
    const info = t.describe(d);
    const exe = t.exeFor ? t.exeFor(info) : t.dynamicExe ? info.pm || 'npm' : t.exe;
    const lines = {
      npm: () => commandLine(exe, [exe === 'npm' ? 'install' : 'add', ...(dev ? [exe === 'yarn' ? '--dev' : '-D'] : []), pkg]),
      python: () => (info.manager === 'poetry' ? commandLine('poetry', ['add', ...(dev ? ['--group', 'dev'] : []), name]) : info.manager === 'uv' ? commandLine('uv', ['add', name]) : commandLine('python', ['-m', 'pip', 'install', version ? `${name}==${version}` : name])),
      go: () => commandLine('go', ['get', `${name}${version && version !== 'latest' ? `@${version}` : ''}`]),
      cargo: () => commandLine('cargo', ['add', name]),
      dotnet: () => commandLine('dotnet', ['add', 'package', name, ...(version ? ['--version', version] : [])]),
      composer: () => commandLine('composer', ['require', name]),
      bundler: () => commandLine('bundle', ['add', name]),
      flutter: () => commandLine('flutter', ['pub', 'add', name]),
    };
    must(lines[tool], 'Adding dependencies is not supported for this tool yet.');
    return { command: lines[tool](), cwd: d };
  }

  function removeDependency(ws, { dir, tool, name }) {
    const d = dirIn(ws, dir);
    must(/^[\w.:@/+-]{1,200}$/.test(String(name)), 'Invalid dependency.');
    if (tool === 'maven') {
      const [g, a] = String(name).split(':');
      const f = path.join(d, 'pom.xml');
      const text = fs.readFileSync(f, 'utf8');
      const re = new RegExp(`[ \\t]*<dependency>(?:(?!</dependency>)[\\s\\S])*?<groupId>\\s*${g.replace(/\./g, '\\.')}\\s*</groupId>(?:(?!</dependency>)[\\s\\S])*?<artifactId>\\s*${a.replace(/\./g, '\\.')}\\s*</artifactId>[\\s\\S]*?</dependency>[ \\t]*\\r?\\n?`);
      must(re.test(text), `${name} is not a direct dependency in this pom.xml.`);
      fs.writeFileSync(f, text.replace(re, ''));
      return { edited: 'pom.xml' };
    }
    if (tool === 'gradle') {
      const fn = ['build.gradle.kts', 'build.gradle'].find((x) => fs.existsSync(path.join(d, x)));
      must(fn, 'No build.gradle found.');
      const text = fs.readFileSync(path.join(d, fn), 'utf8');
      const lines = text.split(/\r?\n/);
      const keep = lines.filter((l) => !(/^\s*\w+\s*\(?\s*['"]/.test(l) && l.includes(`${name}`)));
      must(keep.length !== lines.length, `${name} was not found in ${fn}.`);
      fs.writeFileSync(path.join(d, fn), keep.join(text.includes('\r\n') ? '\r\n' : '\n'));
      return { edited: fn };
    }
    const t = byId.get(tool);
    const info = t.describe(d);
    const exe = t.exeFor ? t.exeFor(info) : t.dynamicExe ? info.pm || 'npm' : t.exe;
    const lines = {
      npm: () => commandLine(exe, [exe === 'npm' ? 'uninstall' : 'remove', name]), python: () => (info.manager === 'poetry' ? commandLine('poetry', ['remove', name]) : info.manager === 'uv' ? commandLine('uv', ['remove', name]) : commandLine('python', ['-m', 'pip', 'uninstall', '-y', name])),
      cargo: () => commandLine('cargo', ['remove', name]), dotnet: () => commandLine('dotnet', ['remove', 'package', name]), composer: () => commandLine('composer', ['remove', name]), flutter: () => commandLine('flutter', ['pub', 'remove', name]),
    };
    must(lines[tool], 'Removing dependencies is not supported for this tool yet.');
    return { command: lines[tool](), cwd: d };
  }

  const wrap = (fn) => async (...a) => fn(...a);
  for (const [n, f] of Object.entries({ scan, describe, command, check, search, addDependency, removeDependency })) ctx.ipc.handle(n, wrap(f));
};
