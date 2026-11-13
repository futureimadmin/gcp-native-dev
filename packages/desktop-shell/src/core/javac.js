/**
 * Built-in Java compiler: runs the JDK's javac directly on the project's sources (no Maven/Gradle needed) and returns
 * structured diagnostics for red squiggles, the OUTPUT tab and the PROBLEMS list. Runs only when asked (or when the user
 * turns on auto-build); output goes to <project>/.cnd/classes so your own build folders are untouched.
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('./util');

const SKIP = new Set(['node_modules', '.git', 'target', 'build', 'dist', 'out', '.gradle', '.idea', '.vscode', '.venv', '.cnd', 'bin', 'obj']);
const fwd = (p) => p.split(path.sep).join('/');
const q = (p) => `"${fwd(p)}"`;

function walk(root, visit, depthLimit = 12) {
  const stack = [[root, 0]];
  while (stack.length) {
    const [dir, d] = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name) && d < depthLimit) stack.push([p, d + 1]); } else if (e.isFile()) visit(p);
    }
  }
}

function parseDiagnostics(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  const head = /^((?:[A-Za-z]:)?[^:\n]*?\.java):(\d+): (error|warning): (.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const m = head.exec(lines[i]);
    if (!m) continue;
    const d = { file: path.resolve(m[1]), line: Number(m[2]), col: 1, severity: m[3], message: m[4].trim() };
    const src = lines[i + 1];
    const caret = lines[i + 2];
    let j = i + 1;
    if (src !== undefined && caret !== undefined && /^\s*\^\s*$/.test(caret)) { d.col = caret.indexOf('^') + 1; d.source = src; j = i + 3; }
    const extra = [];
    while (j < lines.length && !head.test(lines[j]) && !/^\d+ (errors?|warnings?)$/.test(lines[j].trim()) && /^\s{2,}\S/.test(lines[j])) { extra.push(lines[j].trim()); j++; }
    if (extra.length) d.message += ` (${extra.join('; ')})`;
    out.push(d);
  }
  return out;
}

function register({ ipcMain, wrap, tools, getWorkspace }) {
  let busy = false;

  async function mavenClasspath(root, notes) {
    const poms = [];
    walk(root, (f) => { if (path.basename(f) === 'pom.xml') poms.push(f); }, 3);
    const real = poms.filter((p) => { try { return !/<packaging>\s*pom\s*<\/packaging>/.test(fs.readFileSync(p, 'utf8')); } catch { return false; } });
    if (!real.length) return [];
    const cnd = path.join(root, '.cnd');
    fs.mkdirSync(cnd, { recursive: true });
    const cacheFile = path.join(cnd, 'classpath.json');
    const key = real.map((p) => `${p}:${fs.statSync(p).mtimeMs}`).join('|');
    try { const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); if (c.key === key) { if (c.failed) notes.push(`Maven could not resolve some dependencies (${c.failed}); errors about missing packages may be wrong. Run "mvn compile" once with internet access.`); return c.entries; } } catch { /* resolve */ }
    if (!tools.findInPath('mvn')) { notes.push('Maven (mvn) was not found, so project dependencies are not on the compile path; errors about missing packages may be wrong.'); return []; }
    const entries = new Set();
    const failed = [];
    let n = 0;
    for (const pom of real) {
      const outFile = path.join(cnd, `cp-${n++}.txt`);
      const args = ['-q', '-B', 'dependency:build-classpath', `-Dmdep.outputFile=${fwd(outFile)}`];
      let r = await exec('mvn', ['-o', ...args], { cwd: path.dirname(pom), timeout: 240000 });
      if (!r.ok) r = await exec('mvn', args, { cwd: path.dirname(pom), timeout: 240000 });
      if (r.ok && fs.existsSync(outFile)) fs.readFileSync(outFile, 'utf8').split(path.delimiter).map((s) => s.trim()).filter(Boolean).forEach((e) => entries.add(e));
      else failed.push(path.basename(path.dirname(pom)));
    }
    const list = [...entries];
    try { fs.writeFileSync(cacheFile, JSON.stringify({ key, entries: list, failed: failed.join(', ') })); } catch { /* cache is optional */ }
    if (failed.length) notes.push(`Maven could not resolve dependencies for: ${failed.join(', ')}. Errors about missing packages may be wrong.`);
    return list;
  }

  ipcMain.handle('javac:compile', wrap(async (given, opts = {}) => {
    const root = getWorkspace();
    if (!root) throw new Error('Open a project first.');
    if (given && path.resolve(given) !== path.resolve(root)) throw new Error('That folder is not the open project.');
    if (busy) return { busy: true };
    busy = true;
    const started = Date.now();
    try {
      const javac = tools.findInPath('javac');
      if (!javac) return { fatal: 'The JDK compiler (javac) was not found. Install a JDK, or set its folder in Settings > Runtimes.' };
      const sources = [];
      walk(root, (f) => { if (f.endsWith('.java') && sources.length < 20000) sources.push(f); });
      if (!sources.length) return { fatal: 'No .java files found in this project.' };
      const notes = [];
      let cp = [];
      if (fs.existsSync(path.join(root, 'pom.xml')) || sources.some((s) => /[\\/]src[\\/]/.test(s))) cp = await mavenClasspath(root, notes);
      if (!cp.length && (fs.existsSync(path.join(root, 'build.gradle')) || fs.existsSync(path.join(root, 'build.gradle.kts')))) notes.push('Gradle dependencies are not resolved by the built-in compiler; errors about missing packages may be wrong. Put the jars in a lib folder or use the Gradle Compile task.');
      walk(root, (f) => { if (f.endsWith('.jar') && /[\\/](lib|libs)[\\/]/.test(f)) cp.push(f); }, 4);
      const cnd = path.join(root, '.cnd');
      // Unsaved editor text is compiled from copies under .cnd/overlay so checks see what you just typed.
      const back = new Map();
      if (Array.isArray(opts.overlay)) {
        const ovRoot = path.join(cnd, 'overlay');
        fs.rmSync(ovRoot, { recursive: true, force: true });
        for (const o of opts.overlay.slice(0, 200)) {
          if (!o || typeof o.file !== 'string' || typeof o.content !== 'string' || o.content.length > 2 * 1024 * 1024) continue;
          const abs = path.resolve(o.file);
          if (!abs.toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep) || !abs.endsWith('.java')) continue;
          const copy = path.join(ovRoot, path.relative(root, abs));
          fs.mkdirSync(path.dirname(copy), { recursive: true });
          fs.writeFileSync(copy, o.content, 'utf8');
          const i = sources.findIndex((s) => path.resolve(s).toLowerCase() === abs.toLowerCase());
          if (i >= 0) sources[i] = copy;
          back.set(path.resolve(copy).toLowerCase(), abs);
        }
      }
      const classes = path.join(cnd, 'classes');
      const gen = path.join(cnd, 'generated');
      fs.mkdirSync(classes, { recursive: true });
      fs.mkdirSync(gen, { recursive: true });
      const argLines = ['-encoding UTF-8', `-d ${q(classes)}`, `-s ${q(gen)}`, '-Xmaxerrs 300'];
      if (cp.length) argLines.push(`-cp "${cp.map(fwd).join(path.delimiter)}"`);
      argLines.push(...sources.map(q));
      const argFile = path.join(cnd, 'javac.args');
      fs.writeFileSync(argFile, `${argLines.join('\n')}\n`, 'utf8');
      const r = await exec('javac', ['-J-Dfile.encoding=UTF-8', `@${fwd(argFile)}`], { cwd: root, timeout: 240000 });
      const text = `${r.err}\n${r.out}`;
      const diagnostics = parseDiagnostics(text).map((d) => ({ ...d, file: back.get(d.file.toLowerCase()) || d.file }));
      const errors = diagnostics.filter((d) => d.severity === 'error').length;
      const warnings = diagnostics.length - errors;
      const unparsed = !r.ok && !errors ? text.split(/\r?\n/).filter((l) => l.trim() && !/^Picked up JAVA_TOOL_OPTIONS/.test(l)).slice(0, 8).join('\n') : '';
      return { ok: r.ok && !errors, errors: errors || (unparsed ? 1 : 0), warnings, diagnostics, unparsed, notes, sourceCount: sources.length, ms: Date.now() - started, classpathEntries: cp.length };
    } finally {
      busy = false;
    }
  }));
}

module.exports = { register, parseDiagnostics };
