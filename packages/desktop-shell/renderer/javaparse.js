/**
 * Light-weight Java source parser (no compiler needed). Good enough for outline, navigation, hierarchy and completion.
 * Used by the renderer (the file you are editing) and by the main process (the whole-project index).
 */
(function (root) {
  'use strict';

  const NL = String.fromCharCode(10);

  /** Blanks comments and the contents of string/char literals (keeps offsets and newlines identical). */
  function blank(src) {
    const out = src.split('');
    const n = src.length;
    let i = 0;
    const wipe = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== NL && out[k] !== String.fromCharCode(13)) out[k] = ' '; };
    while (i < n) {
      const c = src[i];
      const d = src[i + 1];
      if (c === '/' && d === '/') { let j = i; while (j < n && src[j] !== NL) j++; wipe(i, j); i = j; }
      else if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; wipe(i, j); i = j; }
      else if (c === '"' && src.startsWith('"""', i)) { let j = src.indexOf('"""', i + 3); j = j < 0 ? n : j + 3; wipe(i + 3, j - 3); i = j; }
      else if (c === '"') { let j = i + 1; while (j < n && src[j] !== '"' && src[j] !== NL) { if (src[j] === String.fromCharCode(92)) j++; j++; } wipe(i + 1, j); i = j + 1; }
      else if (c === "'") { let j = i + 1; while (j < n && src[j] !== "'" && src[j] !== NL) { if (src[j] === String.fromCharCode(92)) j++; j++; } wipe(i + 1, j); i = j + 1; }
      else i++;
    }
    return out.join('');
  }

  /** Replaces everything inside nested braces with spaces (braces stay), so only member-level text remains. */
  function flatten(body) {
    const out = body.split('');
    let depth = 0;
    for (let i = 0; i < out.length; i++) {
      const c = out[i];
      if (c === '{') { depth++; }
      else if (c === '}') { depth--; }
      else if (depth > 0 && c !== NL && c !== String.fromCharCode(13)) out[i] = ' ';
    }
    return out.join('');
  }

  function matchBrace(clean, open) {
    let depth = 0;
    for (let i = open; i < clean.length; i++) {
      if (clean[i] === '{') depth++;
      else if (clean[i] === '}') { depth--; if (depth === 0) return i; }
    }
    return clean.length - 1;
  }

  const splitTop = (s, sep) => {
    const parts = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
      if ('<([{'.includes(ch)) depth++;
      else if ('>)]}'.includes(ch)) depth--;
      if (ch === sep && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map((p) => p.trim()).filter(Boolean);
  };

  const stripGenerics = (t) => { let o = ''; let d = 0; for (const ch of t) { if (ch === '<') d++; else if (ch === '>') d--; else if (d === 0) o += ch; } return o.replace(/\s+/g, ' ').trim(); };
  const simple = (t) => stripGenerics(t).replace(/\[\]/g, '').split('.').pop().trim();
  const MODS = /^(?:(?:public|protected|private|static|final|abstract|synchronized|native|default|strictfp|transient|volatile|sealed|non-sealed)\s+)*/;

  function parse(src) {
    const clean = blank(src);
    const lineStarts = [0];
    for (let i = 0; i < clean.length; i++) if (clean[i] === NL) lineStarts.push(i + 1);
    const lineOf = (off) => { let lo = 0; let hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; } return lo + 1; };

    const pm = /(^|[\s;])package\s+([\w.]+)\s*;/.exec(clean);
    const result = { package: pm ? pm[2] : '', packageLine: pm ? lineOf(pm.index + pm[1].length) : 0, imports: [], types: [], lastImportLine: 0 };
    const im = /(^|[\s;])import\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;/g;
    let x;
    while ((x = im.exec(clean))) { const line = lineOf(x.index + x[1].length); result.imports.push({ name: x[3], static: !!x[2], line }); result.lastImportLine = Math.max(result.lastImportLine, line); }

    // type declarations
    const re = /(^|[\s;{}])((?:(?:public|protected|private|static|final|abstract|sealed|non-sealed|strictfp)\s+)*)(@interface|class|interface|enum|record)\s+([A-Za-z_]\w*)/g;
    const found = [];
    while ((x = re.exec(clean))) {
      const nameStart = x.index + x[0].length - x[4].length;
      let i = x.index + x[0].length;
      let depth = 0;
      let paramText = '';
      let hdrStart = i;
      for (; i < clean.length; i++) {
        const c = clean[i];
        if (c === '(') { if (depth === 0 && x[3] === 'record' && !paramText) { let j = i; let pd = 0; for (; j < clean.length; j++) { if (clean[j] === '(') pd++; else if (clean[j] === ')') { pd--; if (pd === 0) break; } } paramText = clean.slice(i + 1, j); i = j; continue; } depth++; }
        else if (c === ')') depth--;
        else if (c === '{' && depth <= 0) break;
        else if (c === ';' && depth <= 0) break;
      }
      if (clean[i] !== '{') continue;
      let header = clean.slice(hdrStart, i);
      let typeParams = '';
      if (/^s*</.test(header)) { // strip the balanced <T extends X> so its "extends" is not read as the superclass
        let d = 0; let k = header.indexOf('<');
        for (; k < header.length; k++) { if (header[k] === '<') d++; else if (header[k] === '>') { d--; if (d === 0) break; } }
        typeParams = header.slice(header.indexOf('<') + 1, k);
        header = header.slice(k + 1);
      }
      const ext = /\bextends\s+([\s\S]+?)(?=\bimplements\b|\bpermits\b|$)/.exec(header);
      const imp = /\bimplements\s+([\s\S]+?)(?=\bpermits\b|$)/.exec(header);
      const kind = x[3] === '@interface' ? 'annotation' : x[3];
      const t = {
        name: x[4], kind, mods: x[2].trim().split(/\s+/).filter(Boolean), line: lineOf(nameStart), bodyStart: i, bodyEnd: matchBrace(clean, i),
        extends: ext ? splitTop(ext[1], ',').map(simple) : [], implements: imp ? splitTop(imp[1], ',').map(simple) : [],
        methods: [], fields: [], outer: '', typeParams,
      };
      if (kind === 'interface' && t.extends.length) { t.implements = t.extends; t.extends = []; }
      t.endLine = lineOf(t.bodyEnd);
      if (kind === 'record') for (const comp of splitTop(paramText, ',')) { const mm = /([\w.<>\[\]?,\s]+?)\s+(\w+)\s*$/.exec(comp.replace(/@\w+(\([^)]*\))?\s*/g, '')); if (mm) t.fields.push({ name: mm[2], type: stripGenerics(mm[1]).trim(), mods: ['private', 'final'], line: t.line }); }
      found.push(t);
    }

    // outer types by containment
    for (const t of found) {
      let best = null;
      for (const o of found) if (o !== t && o.bodyStart < t.bodyStart && o.bodyEnd > t.bodyEnd && (!best || o.bodyStart > best.bodyStart)) best = o;
      t.outer = best ? best.name : '';
      t._outerRef = best;
    }

    // members
    for (const t of found) {
      const body = clean.slice(t.bodyStart + 1, t.bodyEnd);
      const flat = flatten(body);
      const base = t.bodyStart + 1;
      let stmts = [];
      let cur = '';
      let curStart = 0;
      for (let i = 0; i < flat.length; i++) {
        const c = flat[i];
        if (!cur.trim()) curStart = i;
        cur += c;
        if (c === ';' || (c === '}' && !/=/.test(cur.replace(/\(.*?\)/g, '')))) { stmts.push({ text: cur, off: curStart }); cur = ''; }
      }
      if (cur.trim()) stmts.push({ text: cur, off: curStart });

      if (t.kind === 'enum') {
        const first = stmts[0];
        // constants are the text up to the first top-level ';' (they never contain a method body at depth 0)
        const semi = flat.indexOf(';');
        const constText = semi >= 0 ? flat.slice(0, semi) : flat;
        for (const c of splitTop(constText.replace(/\([^)]*\)/g, ''), ',')) {
          const nm = /([A-Za-z_]\w*)\s*(\{\s*\})?\s*$/.exec(c.replace(/@\w+/g, '').trim());
          if (nm) t.fields.push({ name: nm[1], type: t.name, mods: ['public', 'static', 'final'], line: lineOf(base + flat.indexOf(nm[1])), constant: true });
        }
        if (semi >= 0) stmts = stmts.filter((s) => s.off > semi);
        else stmts = [];
        void first;
      }

      for (const s of stmts) {
        let text = s.text.replace(/@\w+(?:\.\w+)*(\s*\([^)]*\))?/g, ' ').replace(/\s+/g, ' ').trim();
        if (!text || text === ';' || text === '}' || /^(static\s*)?\{/.test(text)) continue;
        const line = lineOf(base + s.off + (s.text.length - s.text.trimStart().length));
        const mods = (MODS.exec(text) || [''])[0];
        const rest = text.slice(mods.length);
        const modList = mods.trim().split(/\s+/).filter(Boolean);
        if (/^(class|interface|enum|record|@interface)\b/.test(rest)) continue;
        const mm = /^(<[^>]*>\s*)?(?:([\w.$<>\[\]?,\s]+?)\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:throws\s+[\w.$,\s]+?)?\s*(?:\{\s*\}|;|default\b.*)?$/.exec(rest);
        const isFieldInit = /^[^(]*=/.test(rest);
        if (mm && !isFieldInit) {
          const ret = (mm[2] || '').trim();
          const isCtor = !ret && mm[3] === t.name;
          if (!ret && !isCtor) continue; // a call or something else
          if (ret === 'new' || ret === 'return' || ret === 'throw') continue;
          t.methods.push({ name: mm[3], params: mm[4].replace(/\s+/g, ' ').trim(), ret: isCtor ? '' : stripGenerics(ret), mods: t.kind === 'interface' && !modList.includes('private') && !modList.includes('static') && !modList.includes('default') ? [...modList, 'abstract'] : modList, line, ctor: isCtor, typeParams: (mm[1] || '').trim() });
          continue;
        }
        const decl = rest.replace(/;\s*$/, '');
        const eq = decl.search(/=(?!=)/);
        const left = eq >= 0 ? decl.slice(0, eq) : decl;
        const parts = splitTop(left, ',');
        const head = /^([\w.$<>\[\]?,\s]+?)\s+([A-Za-z_]\w*)(\s*\[\s*\])*\s*$/.exec(parts[0]);
        if (!head) continue;
        const type = stripGenerics(head[1]).trim() + (head[3] ? '[]' : '');
        t.fields.push({ name: head[2], type, fullType: head[1].replace(/s+/g, ' ').trim() + (head[3] ? '[]' : ''), mods: t.kind === 'interface' ? [...modList, 'static', 'final'] : modList, line });
        for (const extra of parts.slice(1)) { const en = /^([A-Za-z_]\w*)/.exec(extra); if (en) t.fields.push({ name: en[1], type, mods: modList, line }); }
      }
    }

    for (const t of found) { delete t._outerRef; result.types.push(t); }
    return result;
  }

  const api = { parse, blank, simple, stripGenerics, splitTop };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JavaParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
