/**
 * Tool discovery and runtimes.
 * GUI apps on Windows often start with a shorter PATH than your terminal (the installer for Claude Code puts it in
 * ~/.local/bin, npm in %APPDATA%\npm, ...). We add the usual install folders to PATH at startup so everything the
 * IDE launches finds the same tools you do, and let you point any runtime at a specific install folder in Settings.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('./util');

const WIN = process.platform === 'win32';
const SEP = WIN ? ';' : ':';
const EXTS = WIN ? ['.exe', '.cmd', '.bat', '.com', ''] : [''];

function candidateDirs() {
  const home = os.homedir();
  const list = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, 'go', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.dotnet', 'tools'),
  ];
  if (WIN) {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    list.push(path.join(appdata, 'npm'), path.join(local, 'Programs', 'Python', 'Python312'), path.join(local, 'Programs', 'Python', 'Python311'),
      path.join(local, 'Microsoft', 'WindowsApps'), 'C:\\Program Files\\nodejs', 'C:\\Program Files\\Go\\bin', 'C:\\Program Files\\dotnet',
      'C:\\Program Files\\Git\\cmd', 'C:\\Program Files\\GitHub CLI');
  } else {
    list.push('/usr/local/bin', '/opt/homebrew/bin', '/usr/local/go/bin');
  }
  if (process.env.JAVA_HOME) list.push(path.join(process.env.JAVA_HOME, 'bin'));
  for (const v of ['MAVEN_HOME', 'M2_HOME', 'GRADLE_HOME']) if (process.env[v]) list.push(path.join(process.env[v], 'bin'));
  return list.filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

/** Appends the usual install folders to PATH (never reorders what is already there). */
function augmentPath() {
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  const have = new Set((process.env[key] || '').split(SEP).map((d) => d.toLowerCase()));
  const add = candidateDirs().filter((d) => !have.has(d.toLowerCase()));
  if (add.length) process.env[key] = [process.env[key], ...add].filter(Boolean).join(SEP);
}

function findInPath(name, extraDirs = []) {
  const dirs = [...extraDirs, ...(process.env.PATH || process.env.Path || '').split(SEP)].filter(Boolean);
  for (const d of dirs) {
    for (const e of EXTS) {
      const f = path.join(d, name + e);
      try { if (fs.statSync(f).isFile()) return f; } catch { /* next */ }
    }
  }
  return null;
}

const RUNTIMES = [
  { id: 'node', name: 'Node.js', bin: 'node', ver: ['--version'], home: 'NODE_HOME' },
  { id: 'java', name: 'Java (JDK)', bin: 'javac', ver: ['-version'], home: 'JAVA_HOME', homeIsRoot: true },
  { id: 'maven', name: 'Maven', bin: 'mvn', ver: ['-version'], home: 'MAVEN_HOME', homeIsRoot: true },
  { id: 'gradle', name: 'Gradle', bin: 'gradle', ver: ['--version'], home: 'GRADLE_HOME', homeIsRoot: true },
  { id: 'python', name: 'Python', bin: 'python', ver: ['--version'] },
  { id: 'go', name: 'Go', bin: 'go', ver: ['version'] },
  { id: 'dotnet', name: '.NET SDK', bin: 'dotnet', ver: ['--version'] },
  { id: 'git', name: 'Git', bin: 'git', ver: ['--version'] },
  { id: 'docker', name: 'Docker', bin: 'docker', ver: ['--version'] },
  { id: 'tomcat', name: 'Apache Tomcat', bin: null, home: 'CATALINA_HOME', homeIsRoot: true, folder: true },
];

function tomcatGuess() {
  const roots = WIN ? ['C:\\', 'C:\\Program Files\\Apache Software Foundation', 'C:\\Program Files (x86)\\Apache Software Foundation', path.join(os.homedir(), 'Downloads')] : ['/opt', '/usr/local'];
  for (const r of roots) {
    try {
      const hit = fs.readdirSync(r).filter((n) => /^(apache-)?tomcat[- ]?[\d.]*/i.test(n)).sort().reverse().map((n) => path.join(r, n)).find((d) => fs.existsSync(path.join(d, 'bin', WIN ? 'catalina.bat' : 'catalina.sh')));
      if (hit) return hit;
    } catch { /* next */ }
  }
  return null;
}

function create(store) {
  const overrides = () => store.get('runtimes', {}) || {};
  const binDirOf = (dir) => (fs.existsSync(path.join(dir, 'bin')) ? path.join(dir, 'bin') : dir);

  /** Applies per-runtime install folders: prepends their bin dir to PATH and sets *_HOME variables. */
  function applyOverrides() {
    const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
    for (const r of RUNTIMES) {
      const dir = overrides()[r.id];
      if (!dir || !fs.existsSync(dir)) continue;
      if (r.home) process.env[r.home] = r.homeIsRoot ? dir : binDirOf(dir);
      if (!r.folder) {
        const bd = binDirOf(dir);
        const parts = (process.env[key] || '').split(SEP).filter((p) => p.toLowerCase() !== bd.toLowerCase());
        process.env[key] = [bd, ...parts].join(SEP);
      }
    }
  }

  async function version(r) {
    if (r.folder) return '';
    const o = await exec(r.bin, r.ver, { timeout: 15000 });
    const text = `${o.out}\n${o.err}`.split(/\r?\n/).map((l) => l.trim()).find((l) => /\d/.test(l)) || '';
    return o.code === -1 || (!o.ok && !text) ? '' : text.slice(0, 80);
  }

  async function list() {
    return Promise.all(RUNTIMES.map(async (r) => {
      const override = overrides()[r.id] || '';
      if (r.folder) {
        const home = override || process.env[r.home] || tomcatGuess() || '';
        const ok = !!home && fs.existsSync(path.join(home, 'bin', WIN ? 'catalina.bat' : 'catalina.sh'));
        return { id: r.id, name: r.name, found: ok, path: ok ? home : '', override, version: ok ? path.basename(home) : '', folder: true };
      }
      const file = findInPath(r.bin);
      return { id: r.id, name: r.name, found: !!file, path: file || '', override, version: file ? await version(r) : '', folder: false };
    }));
  }

  function setOverride(id, dir) {
    const r = RUNTIMES.find((x) => x.id === id);
    if (!r) throw new Error('Unknown runtime.');
    const next = { ...overrides() };
    if (!dir) delete next[id];
    else {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('Choose the install folder of the runtime.');
      if (r.folder && !fs.existsSync(path.join(dir, 'bin', WIN ? 'catalina.bat' : 'catalina.sh'))) throw new Error('That folder has no bin/catalina script. Choose the Tomcat home folder.');
      next[id] = dir;
    }
    store.set('runtimes', next);
    applyOverrides();
  }

  const tomcatHome = () => {
    const o = overrides().tomcat || process.env.CATALINA_HOME || tomcatGuess();
    return o && fs.existsSync(path.join(o, 'bin')) ? o : null;
  };

  return { applyOverrides, list, setOverride, tomcatHome, findInPath };
}

module.exports = { augmentPath, findInPath, create, RUNTIMES };
