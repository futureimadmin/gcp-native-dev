/**
 * Project model: understands a workspace the way an IDE does. It reads build files (Maven, Gradle, Ant, plain folders) and turns each
 * project into a MODULE with its own source roots, Java level, dependencies and neighbours. Files are analysed in their own module,
 * so a folder holding many unrelated projects (a monorepo) works. Caches live in the IDE's data folder, never in your project.
 *
 * The model is language-neutral on purpose: other languages (package.json, go.mod, pyproject.toml ...) add their own module
 * discoverers later and plug into the same analysis interface.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('./util');

const SKIP = new Set(['node_modules', '.git', 'target', 'build', 'dist', 'out', '.gradle', '.idea', '.vscode', '.venv', '.cnd', 'bin', 'obj', '__pycache__']);
const hash = (s) => crypto.createHash('sha1').update(String(s).toLowerCase()).digest('hex').slice(0, 12);
const fwd = (p) => p.split(path.sep).join('/');
const inside = (root, f) => { const r = path.resolve(root).toLowerCase(); const x = path.resolve(f).toLowerCase(); return x === r || x.startsWith(r + path.sep); };
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const exists = (f) => { try { return fs.existsSync(f); } catch { return false; } };
const tag = (xml, name) => { const m = new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(xml); return m ? m[1] : ''; };

function javaLevel(v) {
  if (!v) return 0;
  const s = String(v).trim();
  const m = /^1\.(\d+)$/.exec(s) || /^(\d+)$/.exec(s);
  return m ? Number(m[1]) : 0;
}

function parsePom(dir) {
  const xml = read(path.join(dir, 'pom.xml')).replace(/<!--[\s\S]*?-->/g, '');
  const props = {};
  const pb = /<properties>([\s\S]*?)<\/properties>/.exec(xml);
  if (pb) for (const m of pb[1].matchAll(/<([\w.\-]+)>\s*([^<]*?)\s*<\/\1>/g)) props[m[1]] = m[2];
  const sub = (v) => String(v || '').replace(/\$\{([^}]+)\}/g, (_x, k) => (k === 'project.basedir' || k === 'basedir' ? dir : props[k] !== undefined ? props[k] : `\${${k}}`));
  const parent = /<parent>([\s\S]*?)<\/parent>/.exec(xml);
  const body = xml.replace(/<parent>[\s\S]*?<\/parent>/, '').replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '').replace(/<build>[\s\S]*?<\/build>/, (b) => b); // keep build for plugin config
  const top = body.replace(/<dependencies>[\s\S]*?<\/dependencies>/g, '').replace(/<build>[\s\S]*?<\/build>/g, '').replace(/<profiles>[\s\S]*?<\/profiles>/g, '');
  const groupId = tag(top, 'groupId') || (parent ? tag(parent[1], 'groupId') : '');
  const artifactId = tag(top, 'artifactId');
  const release = javaLevel(sub(props['maven.compiler.release'])) || javaLevel(sub(tag(body, 'release'))) || javaLevel(sub(props['maven.compiler.target'])) || javaLevel(sub(props['maven.compiler.source'])) || javaLevel(sub(props['java.version'])) || javaLevel(sub(props.release)) || 0;
  const srcDir = sub(tag(body, 'sourceDirectory'));
  const testDir = sub(tag(body, 'testSourceDirectory'));
  const deps = [];
  const db = /<dependencies>([\s\S]*?)<\/dependencies>/.exec(body.replace(/<build>[\s\S]*?<\/build>/g, '').replace(/<profiles>[\s\S]*?<\/profiles>/g, ''));
  if (db) for (const m of db[1].matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) deps.push(`${sub(tag(m[1], 'groupId'))}:${sub(tag(m[1], 'artifactId'))}`);
  const modules = [...xml.matchAll(/<module>\s*([^<\s]+)\s*<\/module>/g)].map((m) => m[1]);
  return { groupId, artifactId, release, srcDir, testDir, deps, modules, packaging: tag(top, 'packaging') || 'jar' };
}

function gradleLevel(text) {
  const m = /JavaLanguageVersion\.of\(\s*(\d+)\s*\)/.exec(text) || /JavaVersion\.VERSION_(\d+)(?:_(\d+))?/.exec(text) || /(?:sourceCompatibility|targetCompatibility)\s*=?\s*['"]?(?:JavaVersion\.VERSION_)?(\d+(?:[._]\d+)?)/.exec(text);
  if (!m) return 0;
  return javaLevel(String(m[1]).replace('_', '.')) || 0;
}

function existingDirs(base, rels) { return rels.map((r) => path.join(base, r)).filter((p) => exists(p)); }

class ProjectModel {
  constructor({ cacheRoot, tools }) {
    this.cacheRoot = cacheRoot;
    this.tools = tools;
    this.byWorkspace = new Map(); // workspace -> {modules, at}
  }

  cacheDir(workspace) {
    const d = path.join(this.cacheRoot, hash(workspace));
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  /** Finds every project in the workspace. Cheap (only looks at build files), cached until refresh(). */
  discover(workspace, force) {
    const hit = this.byWorkspace.get(workspace);
    if (hit && !force && Date.now() - hit.at < 60000) return hit.modules;
    const modules = [];
    const stack = [[workspace, 0]];
    while (stack.length) {
      const [dir, depth] = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      const names = new Set(entries.map((e) => e.name));
      const m = this.describe(dir, names);
      if (m) modules.push(m);
      if (depth < 7) for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) stack.push([path.join(dir, e.name), depth + 1]);
    }
    // sibling dependencies: a module that depends on another module's groupId:artifactId sees that module's sources
    const byCoord = new Map(modules.filter((x) => x.coord).map((x) => [x.coord, x]));
    for (const m of modules) m.siblings = (m.deps || []).map((c) => byCoord.get(c)).filter((x) => x && x !== m);
    modules.sort((a, b) => b.root.length - a.root.length); // longest root first, for file lookup
    this.byWorkspace.set(workspace, { modules, at: Date.now() });
    return modules;
  }

  refresh(workspace) { this.byWorkspace.delete(workspace); }

  describe(dir, names) {
    if (names.has('pom.xml')) {
      const p = parsePom(dir);
      const main = p.srcDir ? [p.srcDir] : [path.join(dir, 'src', 'main', 'java')];
      const test = p.testDir ? [p.testDir] : [path.join(dir, 'src', 'test', 'java')];
      const gen = existingDirs(path.join(dir, 'target'), ['generated-sources/annotations', 'generated-sources/java']);
      return {
        root: dir, name: path.basename(dir), build: 'maven', coord: p.artifactId ? `${p.groupId}:${p.artifactId}` : '', deps: p.deps, release: p.release, aggregator: p.packaging === 'pom',
        sourceRoots: main.filter(exists), testRoots: test.filter(exists), generatedRoots: gen, outputDir: path.join(dir, 'target', 'classes'),
      };
    }
    const gradle = ['build.gradle', 'build.gradle.kts'].find((n) => names.has(n));
    if (gradle) {
      const text = read(path.join(dir, gradle));
      return {
        root: dir, name: path.basename(dir), build: 'gradle', coord: '', deps: [], release: gradleLevel(text), aggregator: false,
        sourceRoots: existingDirs(dir, ['src/main/java']), testRoots: existingDirs(dir, ['src/test/java']), generatedRoots: existingDirs(dir, ['build/generated/sources/annotationProcessor/java/main']), outputDir: path.join(dir, 'build', 'classes', 'java', 'main'),
      };
    }
    if (names.has('build.xml') || names.has('.classpath')) {
      return { root: dir, name: path.basename(dir), build: 'ant', coord: '', deps: [], release: 0, aggregator: false, sourceRoots: existingDirs(dir, ['src']), testRoots: existingDirs(dir, ['test']), generatedRoots: [], outputDir: path.join(dir, 'bin') };
    }
    return null;
  }

  /** The module that owns a file; for loose files (no build file) a one-file module whose source root comes from its package line. */
  moduleFor(workspace, file) {
    const mods = this.discover(workspace);
    const f = path.resolve(file);
    const m = mods.find((x) => inside(x.root, f));
    if (m) return m;
    const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(read(f));
    let root = path.dirname(f);
    if (pkg) { const depth = pkg[1].split('.').length; for (let i = 0; i < depth; i++) root = path.dirname(root); }
    return { root, name: path.basename(root), build: 'plain', coord: '', deps: [], release: 0, aggregator: false, sourceRoots: [root], testRoots: [], generatedRoots: [], siblings: [], outputDir: '' };
  }

  /** Source roots visible to a module (its own, generated, and those of modules it depends on). */
  sourcePath(m) {
    const out = new Set([...m.sourceRoots, ...m.testRoots, ...m.generatedRoots]);
    for (const s of m.siblings || []) for (const r of [...s.sourceRoots, ...s.generatedRoots]) out.add(r);
    return [...out];
  }

  /** Classpath for a module: resolved Maven dependencies (cached), lib jars, and already-compiled output of the module and its neighbours. */
  async classpath(workspace, m, notes) {
    const cp = [];
    if (m.build === 'maven') cp.push(...(await this.mavenClasspath(workspace, m, notes)));
    const libs = [];
    this.walkJars(m.root, libs);
    cp.push(...libs);
    for (const x of [m, ...(m.siblings || [])]) if (x.outputDir && exists(x.outputDir)) cp.push(x.outputDir);
    if (m.build === 'gradle' && !cp.some((e) => e.endsWith('.jar'))) notes.push('Gradle dependencies are not resolved by the IDE yet; errors about missing packages may be wrong. Put the jars in a lib folder, or build once so the classes folder exists.');
    return cp;
  }

  walkJars(root, out) {
    const stack = [[root, 0]];
    while (stack.length) {
      const [dir, d] = stack.pop();
      let es = [];
      try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of es) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP.has(e.name) && d < 4) stack.push([p, d + 1]); } else if (e.name.endsWith('.jar') && /[\\/](lib|libs)[\\/]/.test(p)) out.push(p);
      }
    }
  }

  async mavenClasspath(workspace, m, notes) {
    const pom = path.join(m.root, 'pom.xml');
    if (m.aggregator || !exists(pom)) return [];
    const dir = this.cacheDir(workspace);
    const cacheFile = path.join(dir, `classpath-${hash(m.root)}.json`);
    const key = `${pom}:${fs.statSync(pom).mtimeMs}`;
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (c.key === key) { if (c.failed) notes.push(`Maven could not resolve the dependencies of ${m.name}; errors about missing packages may be wrong. Run "mvn compile" once with internet access.`); return c.entries; }
    } catch { /* resolve below */ }
    if (!this.tools.findInPath('mvn')) { notes.push('Maven (mvn) was not found, so dependencies are not on the compile path; errors about missing packages may be wrong.'); return []; }
    const outFile = path.join(dir, `cp-${hash(m.root)}.txt`);
    try { fs.rmSync(outFile, { force: true }); } catch { /* ignore */ }
    const args = ['-q', '-B', 'dependency:build-classpath', `-Dmdep.outputFile=${fwd(outFile)}`];
    let r = await exec('mvn', ['-o', ...args], { cwd: m.root, timeout: 300000 });
    if (!r.ok) r = await exec('mvn', args, { cwd: m.root, timeout: 300000 });
    let entries = [];
    if (r.ok && exists(outFile)) entries = read(outFile).split(path.delimiter).map((s) => s.trim()).filter(Boolean);
    const failed = !r.ok;
    try { fs.writeFileSync(cacheFile, JSON.stringify({ key, entries, failed, detail: failed ? (r.err || r.out).slice(0, 400) : '' })); } catch { /* cache is optional */ }
    if (failed) notes.push(`Maven could not resolve the dependencies of ${m.name}; errors about missing packages may be wrong.`);
    return entries;
  }
}

module.exports = { ProjectModel, inside, hash, fwd };
