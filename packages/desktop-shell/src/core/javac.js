/**
 * Java analysis built on the JDK's own compiler (javac) and our project model. Two operations:
 *   javac:check    - check ONE file in its module (fast; sees unsaved editor text); used for background error marks
 *   javac:compile  - compile a whole module (Build)
 * javac finds the rest of the module lazily through -sourcepath and the module's resolved classpath, so large folders and
 * monorepos stay fast. All working files live in the IDE's cache folder, never inside your project.
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('./util');
const { ProjectModel, inside, hash, fwd } = require('./projectmodel');

const q = (p) => `"${fwd(p)}"`;

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

function register({ ipcMain, wrap, tools, getWorkspace, cacheRoot }) {
  const model = new ProjectModel({ cacheRoot, tools });
  let jdkFeature = 0;
  let busy = false;

  async function jdkLevel() {
    if (jdkFeature) return jdkFeature;
    const r = await exec('javac', ['-version'], { timeout: 15000 });
    const m = /javac\s+(?:1\.)?(\d+)/.exec(`${r.out} ${r.err}`);
    jdkFeature = m ? Number(m[1]) : 17;
    return jdkFeature;
  }

  const workspaceOr = (given) => {
    const root = getWorkspace();
    if (!root) throw new Error('Open a project first.');
    if (given && path.resolve(given) !== path.resolve(root)) throw new Error('That folder is not the open project.');
    return root;
  };

  /** Writes unsaved editor text to copies in the cache folder; returns [copyPath...] and a map copy -> original. */
  function writeOverlay(modWork, mod, overlay, skipFile) {
    const ovRoot = path.join(modWork, 'overlay');
    fs.rmSync(ovRoot, { recursive: true, force: true });
    const back = new Map();
    const copies = [];
    for (const o of (Array.isArray(overlay) ? overlay : []).slice(0, 200)) {
      if (!o || typeof o.file !== 'string' || typeof o.content !== 'string' || o.content.length > 2 * 1024 * 1024) continue;
      const abs = path.resolve(o.file);
      if (!abs.endsWith('.java') || !inside(mod.root, abs) || (skipFile && abs.toLowerCase() === skipFile.toLowerCase())) continue;
      const copy = path.join(ovRoot, hash(abs), path.basename(abs));
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.writeFileSync(copy, o.content, 'utf8');
      back.set(path.resolve(copy).toLowerCase(), abs);
      copies.push({ copy, abs });
    }
    return { back, copies };
  }

  async function javacArgs(root, mod, classesDir, extra, notes) {
    const cp = await model.classpath(root, mod, notes);
    const sp = model.sourcePath(mod);
    const feature = await jdkLevel();
    const lines = ['-encoding UTF-8', `-d ${q(classesDir)}`, '-Xmaxerrs 200', '-XDshould-stop.ifError=FLOW', '-XDshould-stop.at=FLOW', '-implicit:none'];
    // match the module's Java level (language features and APIs); skip if newer than this JDK
    if (mod.release && mod.release >= 8 && mod.release <= feature) lines.push(`--release ${mod.release}`);
    if (cp.length) lines.push(`-cp "${cp.map(fwd).join(path.delimiter)}"`);
    if (sp.length) lines.push(`-sourcepath "${sp.map(fwd).join(path.delimiter)}"`);
    lines.push(...extra);
    return { lines, cpCount: cp.length };
  }

  /** Check one file (with unsaved text of the open files) inside its own module. */
  ipcMain.handle('javac:check', wrap(async (given, opts = {}) => {
    const root = workspaceOr(given);
    if (!tools.findInPath('javac')) return { fatal: 'The JDK compiler (javac) was not found. Install a JDK, or set its folder in Settings > Runtimes.' };
    if (typeof opts.file !== 'string' || !opts.file.endsWith('.java') || !inside(root, opts.file)) return { skipped: true };
    const started = Date.now();
    const file = path.resolve(opts.file);
    const mod = model.moduleFor(root, file);
    if (mod.aggregator) return { skipped: true, moduleName: mod.name };
    const work = path.join(model.cacheDir(root), hash(mod.root));
    const classes = path.join(work, 'classes');
    fs.mkdirSync(classes, { recursive: true });
    const notes = [];
    const mine = (Array.isArray(opts.overlay) ? opts.overlay : []).find((o) => o && o.file && path.resolve(o.file).toLowerCase() === file.toLowerCase());
    const { back, copies } = writeOverlay(work, mod, opts.overlay, file);
    // the file under check: its in-memory text when it has unsaved edits, otherwise the file on disk
    let target = file;
    if (mine && typeof mine.content === 'string') {
      target = path.join(work, 'overlay', hash(file), path.basename(file));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, mine.content, 'utf8');
      back.set(path.resolve(target).toLowerCase(), file);
    }
    const { lines, cpCount } = await javacArgs(root, mod, classes, [q(target), ...copies.map((c) => q(c.copy))], notes);
    const argFile = path.join(work, 'check.args');
    fs.writeFileSync(argFile, `${lines.join('\n')}\n`, 'utf8');
    const r = await exec('javac', ['-J-Dfile.encoding=UTF-8', `@${fwd(argFile)}`], { cwd: mod.root, timeout: 120000 });
    const text = `${r.err}\n${r.out}`;
    const diagnostics = parseDiagnostics(text).map((d) => ({ ...d, file: back.get(d.file.toLowerCase()) || d.file })).filter((d) => d.file.toLowerCase() === file.toLowerCase());
    const unparsed = !r.ok && !diagnostics.length ? text.split(/\r?\n/).filter((l) => /error:/.test(l) && !/\.java:\d+:/.test(l)).slice(0, 3).join('\n') : '';
    return { file, diagnostics, unparsed, notes, ms: Date.now() - started, moduleName: mod.name, moduleRoot: mod.root, build: mod.build, release: mod.release, classpathEntries: cpCount };
  }));

  /** Compile a whole module (Build). */
  ipcMain.handle('javac:compile', wrap(async (given, opts = {}) => {
    const root = workspaceOr(given);
    if (busy) return { busy: true };
    busy = true;
    const started = Date.now();
    try {
      if (!tools.findInPath('javac')) return { fatal: 'The JDK compiler (javac) was not found. Install a JDK, or set its folder in Settings > Runtimes.' };
      const focus = typeof opts.focus === 'string' && opts.focus && inside(root, opts.focus) ? opts.focus : path.join(root, 'x.java');
      const mod = model.moduleFor(root, focus);
      if (mod.aggregator) return { fatal: `${mod.name} is an aggregator project (it only lists modules). Open a file from one of its modules.` };
      const work = path.join(model.cacheDir(root), hash(mod.root));
      const classes = path.join(work, 'classes');
      fs.mkdirSync(classes, { recursive: true });
      const sources = [];
      const walkJava = (dir) => { let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(dir, e.name); if (e.isDirectory()) walkJava(p); else if (e.name.endsWith('.java') && sources.length < 20000) sources.push(p); } };
      for (const r of [...mod.sourceRoots, ...mod.testRoots, ...mod.generatedRoots]) walkJava(r);
      if (!sources.length && mod.build === 'plain') walkJava(mod.root);
      if (!sources.length) return { fatal: `No .java files found in ${mod.name}.` };
      const notes = [];
      const { back, copies } = writeOverlay(work, mod, opts.overlay, null);
      const replaced = new Map(copies.map((c) => [c.abs.toLowerCase(), c.copy]));
      const finalSources = sources.map((s) => replaced.get(s.toLowerCase()) || s);
      const { lines, cpCount } = await javacArgs(root, mod, classes, finalSources.map(q), notes);
      const argFile = path.join(work, 'build.args');
      fs.writeFileSync(argFile, `${lines.join('\n')}\n`, 'utf8');
      const r = await exec('javac', ['-J-Dfile.encoding=UTF-8', `@${fwd(argFile)}`], { cwd: mod.root, timeout: 240000 });
      const text = `${r.err}\n${r.out}`;
      const diagnostics = parseDiagnostics(text).map((d) => ({ ...d, file: back.get(d.file.toLowerCase()) || d.file })).filter((d) => inside(mod.root, d.file));
      const errors = diagnostics.filter((d) => d.severity === 'error').length;
      const unparsed = !r.ok && !errors ? text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 8).join('\n') : '';
      return { ok: r.ok && !errors, errors: errors || (unparsed ? 1 : 0), warnings: diagnostics.length - errors, diagnostics, unparsed, notes, sourceCount: sources.length, ms: Date.now() - started, classpathEntries: cpCount, moduleRoot: mod.root, moduleName: mod.name };
    } finally {
      busy = false;
    }
  }));

  ipcMain.handle('javac:modules', wrap(async (given, force) => {
    const root = workspaceOr(given);
    return model.discover(root, !!force).map((m) => ({ name: m.name, root: m.root, build: m.build, release: m.release, aggregator: m.aggregator, sourceRoots: m.sourceRoots, dependsOn: (m.siblings || []).map((s) => s.name) }));
  }));
}

module.exports = { register, parseDiagnostics };
