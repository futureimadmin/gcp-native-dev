/** Project-wide code intelligence: Java type index, file list, Find in Files, Replace in Files. All paths stay inside the open project. */
const fs = require('fs');
const path = require('path');
const JavaParse = require('../../renderer/javaparse.js');

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'build', 'dist', 'out', '.gradle', '.idea', '.vscode', '.venv', '__pycache__', '.angular', '.next', 'bin', 'obj', '.cnd']);
const MAX_FILE = 2 * 1024 * 1024;

function walk(root, visit, limit = 60000) {
  let count = 0;
  const stack = [root];
  while (stack.length && count < limit) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(p); } else if (e.isFile()) { count++; visit(p); if (count >= limit) break; }
    }
  }
}

function register({ ipcMain, wrap, getWorkspace }) {
  const ws = (given) => {
    const w = getWorkspace();
    if (!w) throw new Error('Open a project first.');
    if (given && path.resolve(given) !== path.resolve(w)) throw new Error('That folder is not the open project.');
    return w;
  };
  const inside = (root, f) => { const r = path.resolve(f); return r === path.resolve(root) || r.startsWith(path.resolve(root) + path.sep); };

  /* ---- Java index (cached by file modification time) ---- */
  const cache = new Map(); // file -> {mtime, types}
  ipcMain.handle('java:index', wrap(async (given) => {
    const root = ws(given);
    const types = [];
    const seen = new Set();
    walk(root, (f) => {
      if (!f.endsWith('.java')) return;
      seen.add(f);
      let st;
      try { st = fs.statSync(f); } catch { return; }
      if (st.size > MAX_FILE) return;
      let entry = cache.get(f);
      if (!entry || entry.mtime !== st.mtimeMs) {
        let parsed;
        try { parsed = JavaParse.parse(fs.readFileSync(f, 'utf8')); } catch { parsed = { types: [], package: '' }; }
        entry = { mtime: st.mtimeMs, pkg: parsed.package, types: parsed.types.map((t) => ({ name: t.name, kind: t.kind, mods: t.mods, line: t.line, endLine: t.endLine, extends: t.extends, implements: t.implements, outer: t.outer, typeParams: t.typeParams, methods: t.methods, fields: t.fields })) };
        cache.set(f, entry);
      }
      for (const t of entry.types) types.push({ ...t, file: f, pkg: entry.pkg, fqn: (entry.pkg ? `${entry.pkg}.` : '') + (t.outer ? `${t.outer}.` : '') + t.name });
    }, 20000);
    for (const f of [...cache.keys()]) if (!seen.has(f)) cache.delete(f);
    return types;
  }));

  /* ---- file list for Go to File ---- */
  ipcMain.handle('search:listFiles', wrap(async (given) => {
    const root = ws(given);
    const files = [];
    walk(root, (f) => files.push(path.relative(root, f)), 30000);
    return files;
  }));

  /* ---- Find / Replace in Files ---- */
  function matcher(o) {
    const q = String(o.query || '');
    if (!q) throw new Error('Type something to search for.');
    if (q.length > 500) throw new Error('Search text is too long.');
    let src = o.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (o.wholeWord) src = `\\b(?:${src})\\b`;
    try { return new RegExp(src, `g${o.caseSensitive ? '' : 'i'}m`); } catch (e) { throw new Error(`Invalid regular expression: ${e.message}`); }
  }
  const includeTest = (inc) => {
    const pats = String(inc || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!pats.length) return () => true;
    const res = pats.map((p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i'));
    return (rel) => res.some((r) => r.test(path.basename(rel)) || r.test(rel.split(path.sep).join('/')));
  };
  const textOf = (f) => {
    const st = fs.statSync(f);
    if (st.size > MAX_FILE) return null;
    const buf = fs.readFileSync(f);
    if (buf.subarray(0, 4000).includes(0)) return null;
    return buf.toString('utf8');
  };

  ipcMain.handle('search:files', wrap(async (given, o) => {
    const root = ws(given);
    const re = matcher(o);
    const ok = includeTest(o.include);
    const files = [];
    let total = 0;
    let truncated = false;
    walk(root, (f) => {
      if (truncated) return;
      const rel = path.relative(root, f);
      if (!ok(rel)) return;
      let text;
      try { text = textOf(f); } catch { return; }
      if (text == null) return;
      const matches = [];
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        re.lastIndex = 0;
        const m = re.exec(lines[i]);
        if (m) { matches.push({ line: i + 1, col: m.index + 1, len: m[0].length, text: lines[i].trim().slice(0, 240) }); total++; }
        if (total >= 3000) { truncated = true; break; }
      }
      if (matches.length) files.push({ file: f, rel, matches });
    }, 40000);
    files.sort((a, b) => a.rel.localeCompare(b.rel));
    return { files, total, truncated };
  }));

  ipcMain.handle('search:replace', wrap(async (given, o, fileList, replacement) => {
    const root = ws(given);
    const re = matcher(o);
    const rep = String(replacement == null ? '' : replacement);
    let changed = 0;
    let replaced = 0;
    for (const f of fileList || []) {
      if (!inside(root, f)) continue;
      let text;
      try { text = textOf(f); } catch { continue; }
      if (text == null) continue;
      let n = 0;
      const next = text.replace(re, (...args) => {
        n++;
        if (!o.regex) return rep;
        // support $1.. and $& in regex mode
        const groups = args.slice(1, -2).filter((x) => typeof x === 'string' || x === undefined);
        return rep.replace(/\$(\d+|&)/g, (_s, g) => (g === '&' ? args[0] : (groups[Number(g) - 1] || '')));
      });
      if (n) { fs.writeFileSync(f, next, 'utf8'); changed++; replaced += n; }
    }
    return { files: changed, replacements: replaced };
  }));
}

module.exports = { register };
