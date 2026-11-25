/**
 * Java analysis built on the JDK's own compiler (javac) and our project model. Two operations:
 *   javac:check    - check ONE file in its module (fast; sees unsaved editor text); used for background error marks
 *   javac:compile  - compile a whole module (Build)
 * javac finds the rest of the module lazily through -sourcepath and the module's resolved classpath, so large folders and
 * monorepos stay fast. All working files live in the IDE's cache folder, never inside your project.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
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
    // Lombok generates getters/builders/loggers while compiling: hand its jar to javac as the annotation processor so those are not reported as errors
    const lombok = cp.find((j) => /^lombok-[\d.]+(?:-[\w.]+)?\.jar$/i.test(path.basename(j)));
    if (lombok) lines.push(`-processorpath "${fwd(lombok)}"`);
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
  /* ---- members of a class that is not in the open project (JDK, Maven/Gradle dependencies), read with javap ---- */
  let javapPath = null;
  /** javap sits next to javac in the JDK. The Windows "javapath" shortcut folder only has java and javac, so find the real JDK folder. */
  async function javapBin() {
    if (javapPath) return javapPath;
    const exe = process.platform === 'win32' ? 'javap.exe' : 'javap';
    const direct = tools.findInPath('javap');
    if (direct) return (javapPath = direct);
    const homes = [process.env.JAVA_HOME];
    const r = await exec('java', ['-XshowSettings:properties', '-version'], { timeout: 20000 });
    const m = /java\.home\s*=\s*(.+)/.exec(`${r.err}
${r.out}`);
    if (m) homes.push(m[1].trim());
    for (const h of homes.filter(Boolean)) { const f = path.join(h, 'bin', exe); if (fs.existsSync(f)) return (javapPath = f); }
    return null;
  }
  /** Runs a program without a shell and collects its output. */
  const runPlain = (bin, args, timeout) => new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve({ ok: false, out: '' }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out }); });
  });
  const memberCache = new Map(); // module + class -> { header, members, supers }
  const FQN_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
  const MODS = new Set(['public', 'protected', 'static', 'final', 'abstract', 'default', 'native', 'synchronized', 'transient', 'volatile', 'strictfp']);

  const simplify = (s) => s.replace(/\b(?:[a-z_][\w$]*\.)+([A-Z_$][\w$]*)/g, '$1').replace(/\$/g, '.');
  const splitTop = (s) => { const out = []; let d = 0; let cur = ''; for (const c of s) { if (c === '<') d++; else if (c === '>') d--; if (c === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += c; } if (cur.trim()) out.push(cur.trim()); return out; };
  const stripGen = (s) => { let d = 0; let o = ''; for (const c of s) { if (c === '<') d++; else if (c === '>') d--; else if (!d) o += c; } return o.trim(); };

  /** javap text for one class -> { kind, supers: [fqn], members: [...] } */
  function parseJavap(text, owner) {
    const lines = text.split(/\r?\n/);
    const hi = lines.findIndex((l) => /\b(class|interface|enum|record)\s+\S+/.test(l) && /\{\s*$/.test(l));
    if (hi < 0) return null;
    const head = lines[hi].replace(/\{\s*$/, '').trim();
    const kind = /\binterface\b/.test(head) ? 'interface' : 'class';
    const supers = [];
    const ex = /\bextends\s+(.+?)(?:\s+implements\s+(.+))?$/.exec(head);
    const im = /\bimplements\s+(.+)$/.exec(head);
    if (ex) splitTop(ex[1]).forEach((x) => supers.push(stripGen(x)));
    if (im) splitTop(im[1]).forEach((x) => supers.push(stripGen(x)));
    const members = [];
    for (const raw of lines.slice(hi + 1)) {
      if (!/^\s{2}\S/.test(raw)) continue;
      let l = raw.trim().replace(/;$/, '').replace(/\s+throws\s+.+$/, '');
      if (/^static\s*\{/.test(l)) continue;
      const mods = [];
      let rest = l;
      for (;;) { const w = /^(\w+)\s+/.exec(rest); if (w && MODS.has(w[1])) { mods.push(w[1]); rest = rest.slice(w[0].length); } else break; }
      if (rest.startsWith('<')) { let d = 0; let i = 0; for (; i < rest.length; i++) { if (rest[i] === '<') d++; else if (rest[i] === '>') { d--; if (!d) break; } } rest = rest.slice(i + 1).trim(); }
      const p = rest.indexOf('(');
      if (p >= 0) {
        const before = rest.slice(0, p).trim();
        const sp = before.lastIndexOf(' ');
        if (sp < 0) continue; // constructor
        const name = before.slice(sp + 1);
        const ret = simplify(before.slice(0, sp).trim());
        const used = new Set();
        const params = splitTop(rest.slice(p + 1, rest.lastIndexOf(')'))).map((t, i) => { const ty = simplify(t); let n = stripGen(ty).replace(/\.\.\.|\[\]/g, '').split('.').pop(); n = (n.charAt(0).toLowerCase() + n.slice(1)).replace(/[^\w]/g, '') || `arg${i + 1}`; if (used.has(n)) n += i + 1; used.add(n); return `${ty} ${n}`; }).join(', ');
        members.push({ kind: 'method', name, params, ret, mods, owner });
      } else {
        const sp = rest.lastIndexOf(' ');
        if (sp < 0) continue;
        members.push({ kind: 'field', name: rest.slice(sp + 1), type: simplify(rest.slice(0, sp).trim()), mods, owner });
      }
    }
    return { kind, supers, members };
  }

  /** "java.util.Map.Entry" -> ["java.util.Map.Entry", "java.util.Map$Entry"]: nested classes have a $ in their binary name */
  function binaryNames(fqn) { const out = [fqn]; const parts = fqn.split('.'); for (let i = parts.length - 1; i > 0 && /^[A-Z]/.test(parts[i - 1] || ''); i--) out.push(`${parts.slice(0, i).join('.')}.${parts.slice(i).join('$')}`); return [...new Set(out)]; }

  /* ---- every class and annotation of the module's dependencies, for completion (Spring, Quarkus, Jakarta, Lombok, JUnit ...) ---- */
  const zipCache = new Map(); // jar path + mtime -> [{ name, method, csize, off }]
  const flagCache = new Map(); // jar path|class name -> access flags
  const TYPE_FILTER = /(^|\/)(package-info|module-info)\.class$/;
  // what developers reach for first when they type "@"
  const POPULAR = new Set(['Autowired', 'Component', 'Service', 'Repository', 'RestController', 'Controller', 'GetMapping', 'PostMapping', 'PutMapping', 'DeleteMapping', 'PatchMapping', 'RequestMapping', 'RequestBody', 'RequestParam', 'PathVariable', 'ResponseStatus', 'Configuration', 'Bean', 'Value', 'Qualifier', 'Primary', 'Profile', 'Transactional', 'SpringBootApplication', 'EnableAutoConfiguration', 'ConfigurationProperties', 'Scheduled', 'Async', 'ExceptionHandler', 'ControllerAdvice', 'RestControllerAdvice', 'Entity', 'Table', 'Id', 'Column', 'GeneratedValue', 'ApplicationScoped', 'RequestScoped', 'Singleton', 'Inject', 'Path', 'GET', 'POST', 'PUT', 'DELETE', 'Produces', 'Consumes', 'QuarkusTest', 'ConfigProperty', 'Data', 'Getter', 'Setter', 'Builder', 'NoArgsConstructor', 'AllArgsConstructor', 'RequiredArgsConstructor', 'Slf4j', 'Test', 'BeforeEach', 'AfterEach', 'BeforeAll', 'AfterAll', 'ParameterizedTest', 'Mock', 'InjectMocks', 'ExtendWith', 'Valid', 'NotNull', 'NotBlank', 'Size', 'JsonProperty', 'JsonIgnore', 'Nullable']);

  function zipEntries(file) {
    let st;
    try { st = fs.statSync(file); } catch { return []; }
    const key = `${file}|${st.mtimeMs}`;
    if (zipCache.has(key)) return zipCache.get(key);
    const out = [];
    let fd = -1;
    try {
      fd = fs.openSync(file, 'r');
      const tailLen = Math.min(st.size, 65557);
      const tail = Buffer.alloc(tailLen);
      fs.readSync(fd, tail, 0, tailLen, st.size - tailLen);
      const e = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (e >= 0) {
        const cdSize = tail.readUInt32LE(e + 12);
        const cdOff = tail.readUInt32LE(e + 16);
        if (cdOff !== 0xffffffff && cdSize < 64 * 1024 * 1024) {
          const cd = Buffer.alloc(cdSize);
          fs.readSync(fd, cd, 0, cdSize, cdOff);
          let p = 0;
          while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
            const method = cd.readUInt16LE(p + 10);
            const csize = cd.readUInt32LE(p + 20);
            const nameLen = cd.readUInt16LE(p + 28);
            const extra = cd.readUInt16LE(p + 30);
            const comment = cd.readUInt16LE(p + 32);
            const off = cd.readUInt32LE(p + 42);
            const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
            if (name.endsWith('.class') && !name.includes('$') && !name.startsWith('META-INF/') && !TYPE_FILTER.test(name)) out.push({ name, method, csize, off });
            p += 46 + nameLen + extra + comment;
          }
        }
      }
    } catch { /* an unreadable jar contributes nothing */ } finally { if (fd >= 0) try { fs.closeSync(fd); } catch { /* ignore */ } }
    zipCache.set(key, out);
    return out;
  }

  /** Access flags of one class (public, interface, annotation, enum), read from the class file's header. */
  function classFlags(file, entry) {
    const ck = `${file}|${entry.name}`;
    if (flagCache.has(ck)) return flagCache.get(ck);
    let flags = null;
    let fd = -1;
    try {
      fd = fs.openSync(file, 'r');
      const lh = Buffer.alloc(30);
      fs.readSync(fd, lh, 0, 30, entry.off);
      const start = entry.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const raw = Buffer.alloc(entry.csize);
      fs.readSync(fd, raw, 0, entry.csize, start);
      const buf = entry.method === 8 ? require('zlib').inflateRawSync(raw) : raw;
      if (buf.readUInt32BE(0) === 0xcafebabe) {
        let p = 8;
        const n = buf.readUInt16BE(p); p += 2;
        for (let i = 1; i < n; i++) {
          const tag = buf[p];
          if (tag === 1) p += 3 + buf.readUInt16BE(p + 1);
          else if ([3, 4, 9, 10, 11, 12, 17, 18].includes(tag)) p += 5;
          else if (tag === 5 || tag === 6) { p += 9; i++; }
          else if ([7, 8, 16, 19, 20].includes(tag)) p += 3;
          else if (tag === 15) p += 4;
          else { p = -1; break; }
        }
        if (p > 0) flags = buf.readUInt16BE(p);
      }
    } catch { flags = null; } finally { if (fd >= 0) try { fs.closeSync(fd); } catch { /* ignore */ } }
    flagCache.set(ck, flags);
    return flags;
  }

  const camelOk = (name, q) => {
    if (!q) return true;
    const lq = q.toLowerCase();
    if (name.toLowerCase().startsWith(lq)) return true;
    const caps = name.replace(/[^A-Z0-9]/g, '');
    return caps.length > 0 && q === q.toUpperCase() && caps.toLowerCase().startsWith(lq);
  };

  ipcMain.handle('java:types', wrap(async (given, opts = {}) => {
    const root = workspaceOr(given);
    if (typeof opts.file !== 'string' || !inside(root, opts.file)) return { types: [] };
    const prefix = String(opts.prefix || '');
    if (!/^[A-Za-z0-9_$]{0,40}$/.test(prefix)) return { types: [] };
    const annotation = !!opts.annotation;
    const mod = model.moduleFor(root, path.resolve(opts.file));
    const cp = mod.aggregator ? [] : await model.classpath(root, mod, []);
    const found = [];
    for (const jar of cp.filter((x) => x.toLowerCase().endsWith('.jar'))) {
      for (const e of zipEntries(jar)) {
        const simple = e.name.slice(e.name.lastIndexOf('/') + 1, -6);
        if (prefix ? !camelOk(simple, prefix) : !(annotation && POPULAR.has(simple))) continue;
        found.push({ jar, e, simple, fqn: e.name.slice(0, -6).replace(/\//g, '.') });
        if (found.length > 1500) break;
      }
    }
    // closest first: exact, then starts with, then shorter names; frameworks developers use before internals
    const rank = (x) => (x.simple.toLowerCase() === prefix.toLowerCase() ? 0 : x.simple.toLowerCase().startsWith(prefix.toLowerCase()) ? 1 : 2) * 10 + (/\.(internal|impl|shaded)\./.test(x.fqn) ? 5 : 0) + (/^(org\.springframework|io\.quarkus|jakarta|javax|lombok|org\.junit|com\.google|com\.fasterxml)\./.test(x.fqn) ? 0 : 2) - (POPULAR.has(x.simple) ? 4 : 0) + (/^(org\.codehaus\.plexus|org\.apache\.maven|com\.oracle\.svm|org\.graalvm|org\.eclipse\.aether|org\.sonatype)\./.test(x.fqn) ? 8 : 0);
    found.sort((a, b) => rank(a) - rank(b) || a.simple.length - b.simple.length || a.simple.localeCompare(b.simple));
    const types = [];
    const perName = new Map();
    for (const x of found) {
      if (types.length >= 80) break;
      const flags = classFlags(x.jar, x.e);
      if (flags == null || !(flags & 0x0001)) continue; // public only
      const isAnn = !!(flags & 0x2000);
      if (annotation && !isAnn) continue;
      if ((perName.get(x.simple) || 0) >= 6) continue;
      perName.set(x.simple, (perName.get(x.simple) || 0) + 1);
      types.push({ name: x.simple, fqn: x.fqn, kind: isAnn ? 'annotation' : flags & 0x0200 ? 'interface' : flags & 0x4000 ? 'enum' : 'class' });
    }
    return { types };
  }));

  ipcMain.handle('java:members', wrap(async (given, opts = {}) => {
    const root = workspaceOr(given);
    const javap = await javapBin();
    if (!javap) return { members: [], note: 'The JDK tool javap was not found.' };
    const cands = (Array.isArray(opts.candidates) ? opts.candidates : []).filter((c) => typeof c === 'string' && FQN_RE.test(c)).slice(0, 12);
    if (!cands.length || typeof opts.file !== 'string' || !inside(root, opts.file)) return { members: [] };
    const mod = model.moduleFor(root, path.resolve(opts.file));
    const cp = mod.aggregator ? [] : await model.classpath(root, mod, []);
    const cpArg = cp.map(fwd).join(path.delimiter);
    const key = hash(mod.root);
    const one = async (fqn) => {
      const ck = `${key}|${fqn}`;
      if (memberCache.has(ck)) return memberCache.get(ck);
      let info = null;
      for (const b of binaryNames(fqn)) {
        // a Maven classpath is hundreds of jars: far past the Windows command-line limit, so it goes to javap in an argument file
        const argFile = path.join(model.cacheDir(root), `javap-${hash(b + key)}.args`);
        fs.mkdirSync(path.dirname(argFile), { recursive: true });
        // javap itself cannot read argument files, but the java launcher can, and javap is a module of the JDK: run it that way (no shell, no length limit)
        fs.writeFileSync(argFile, ['--module', 'jdk.jdeps/com.sun.tools.javap.Main', '-public', ...(cpArg ? ['-cp', `"${cpArg}"`] : []), b].join('\n') + '\n', 'utf8');
        const r = await runPlain(path.join(path.dirname(javap), process.platform === 'win32' ? 'java.exe' : 'java'), [`@${fwd(argFile)}`], 30000);
        try { fs.rmSync(argFile, { force: true }); } catch { /* temp file */ }
        if (r.ok) { info = parseJavap(r.out, fqn.split('.').pop()); if (info) break; }
      }
      memberCache.set(ck, info);
      return info;
    };
    let top = null;
    let fqn = '';
    for (const c of cands) { top = await one(c); if (top) { fqn = c; break; } }
    if (!top) return { members: [] };
    // inherited members: walk the supertypes (a few levels), nearest first
    const members = [...top.members];
    const seen = new Set([fqn]);
    let level = top.supers;
    for (let d = 0; d < 5 && level.length; d++) {
      const next = [];
      const infos = await Promise.all(level.filter((s) => !seen.has(s) && s !== 'java.lang.Object').map(async (s) => { seen.add(s); return [s, await one(s)]; }));
      for (const [s, info] of infos) if (info) { members.push(...info.members); next.push(...info.supers); }
      level = next;
    }
    return { fqn, kind: top.kind, members };
  }));

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
