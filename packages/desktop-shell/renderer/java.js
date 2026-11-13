/* Java tooling: project index, accurate completion, hover, go-to-definition, outline, formatting, rename,
   Open Class, Type Hierarchy, List Methods, code generation, Organize Imports and New Java Class. */
'use strict';

const JV = { types: [], byName: new Map(), stale: true, loading: null, timer: null, parsed: new Map() };
const NLC = String.fromCharCode(10);

/* ------------------------------ index ------------------------------ */

async function javaIndex(force) {
  if (!state.workspace) { JV.types = []; JV.byName = new Map(); return; }
  if (!force && !JV.stale && JV.types.length) return;
  if (JV.loading) return JV.loading;
  JV.loading = (async () => {
    const r = await tryInv('java:index', state.workspace);
    if (r.ok) {
      JV.types = r.data;
      JV.byName = new Map();
      for (const t of r.data) JV.byName.set(t.name, [...(JV.byName.get(t.name) || []), t]);
      JV.stale = false;
    }
    JV.loading = null;
  })();
  return JV.loading;
}

/** Called after a file is saved or the tree changes. */
function javaFileSaved(tab) {
  if (!/\.java$/i.test(tab.path)) return;
  JV.stale = true;
  clearTimeout(JV.timer);
  JV.timer = setTimeout(() => javaIndex(true), 1200);
}

function parseModel(model) {
  const hit = JV.parsed.get(model.id);
  if (hit && hit.v === model.getVersionId()) return hit.p;
  const p = JavaParse.parse(model.getValue());
  JV.parsed.set(model.id, { v: model.getVersionId(), p });
  return p;
}

const isJavaModel = (m) => !!m && m.getLanguageId() === 'java';
const typeAtLine = (parsed, line) => parsed.types.filter((t) => t.line <= line && line <= t.endLine).sort((a, b) => (a.endLine - a.line) - (b.endLine - b.line))[0] || null;

function findProjectType(name, parsed) {
  if (parsed) { const own = parsed.types.find((t) => t.name === name); if (own) return { ...own, file: null, pkg: parsed.package }; }
  const list = JV.byName.get(name);
  return list && list[0] ? list[0] : null;
}

/* ------------------------------ type model ------------------------------ */

function parseSig(sig, kind, owner, isStatic) {
  const m = /^([\w$]+)(?:\(([^)]*)\))?:(.+)$/.exec(sig);
  if (!m) return { kind, name: sig, params: '', ret: '', mods: isStatic ? ['static'] : [], owner };
  return { kind, name: m[1], params: m[2] || '', ret: m[3], type: m[3], mods: isStatic ? ['static', 'public'] : ['public'], owner };
}

/** All members visible on a type, including inherited ones. statics: true = only static ones, false = only instance. */
function collectMembers(typeName, parsed) {
  const out = [];
  const seen = new Set();
  const visit = (nm, depth) => {
    if (!nm || seen.has(nm) || depth > 8) return;
    seen.add(nm);
    const pt = findProjectType(nm, parsed);
    if (pt) {
      for (const m of pt.methods) if (!m.ctor) out.push({ kind: 'method', name: m.name, params: m.params, ret: m.ret, mods: m.mods, owner: pt.name });
      for (const f of pt.fields) out.push({ kind: 'field', name: f.name, type: f.type, mods: f.mods, owner: pt.name });
      for (const inner of (parsed ? parsed.types : []).concat(JV.types).filter((x) => x.outer === pt.name)) out.push({ kind: 'type', name: inner.name, mods: ['static'], owner: pt.name });
      [...pt.extends, ...pt.implements].forEach((s) => visit(s, depth + 1));
      if (pt.kind !== 'interface') visit('Object', depth + 1);
      return;
    }
    const jt = JDK[nm];
    if (jt) {
      jt.m.forEach((s) => out.push(parseSig(s, 'method', nm, false)));
      jt.s.forEach((s) => out.push(parseSig(s, 'method', nm, true)));
      jt.f.forEach((s) => out.push(parseSig(s, 'field', nm, /^[A-Z_]+:/.test(s) || nm === 'System')));
      jt.sup.forEach((s) => visit(s, depth + 1));
    }
  };
  visit(typeName, 0);
  return out;
}

const KW_NOT_TYPE = new Set(['return', 'new', 'else', 'throw', 'case', 'package', 'import', 'goto', 'assert', 'yield', 'instanceof']);

/** Finds the declared type of a variable visible before `offset`. */
function varType(text, offset, name, curType, parsed) {
  const before = text.slice(0, offset);
  const re = new RegExp('(?:^|[;{}(,\\s])((?:final\\s+)?[A-Za-z_][\\w.]*(?:<[^;(){}=]*>)?(?:\\[\\])*)\\s+' + name + '\\s*(?=[=;,):])', 'g');
  let best = null;
  let mm;
  while ((mm = re.exec(before))) {
    const t = mm[1].replace(/^final\s+/, '');
    if (KW_NOT_TYPE.has(t)) continue;
    best = { type: t, idx: mm.index, end: re.lastIndex };
  }
  if (best) {
    let t = best.type;
    if (t === 'var') {
      const init = new RegExp(name + '\\s*=\\s*new\\s+([A-Za-z_][\\w.]*)').exec(text.slice(best.idx, offset + 200));
      return init ? JavaParse.simple(init[1]) : null;
    }
    return JavaParse.simple(t);
  }
  if (curType) {
    const f = collectMembers(curType.name, parsed).find((m) => m.kind === 'field' && m.name === name);
    if (f) return JavaParse.simple(f.type);
  }
  return null;
}

/** Text of the expression just before a '.' (identifier chains, calls, new X(...), string literals). */
function exprBefore(line, col) {
  let i = col - 1;
  let depth = 0;
  while (i >= 0) {
    const c = line[i];
    if (c === ')' || c === ']') depth++;
    else if (c === '(' || c === '[') { if (depth === 0) break; depth--; }
    else if (depth === 0 && !/[\w$.]/.test(c) && !(c === ' ' && /\bnew\s*$/.test(line.slice(0, i)))) break;
    i--;
  }
  return line.slice(i + 1, col).trim();
}

function splitChain(expr) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const c of expr) {
    if ('([<'.includes(c)) depth++;
    else if (')]>'.includes(c)) depth--;
    if (c === '.' && depth === 0) { parts.push(cur); cur = ''; } else cur += c;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Resolves an expression to {type, isStatic} or null when we cannot tell (then we show nothing instead of noise). */
function resolveExpr(expr, ctx) {
  const { text, offset, curType, parsed } = ctx;
  const parts = splitChain(expr);
  if (!parts.length) return null;
  let cur = null;
  const first = parts[0];
  const callName = (s) => /^([A-Za-z_$][\w$]*)\s*\(/.exec(s);
  if (first === 'this') cur = { type: curType ? curType.name : null, isStatic: false };
  else if (first === 'super') cur = { type: curType && (curType.extends[0] || 'Object'), isStatic: false };
  else if (first.startsWith('"')) cur = { type: 'String', isStatic: false };
  else if (/^new\s+/.test(first)) { const n = /^new\s+([A-Za-z_][\w.]*)/.exec(first); cur = n ? { type: JavaParse.simple(n[1]), isStatic: false } : null; }
  else if (callName(first)) {
    const nm = callName(first)[1];
    const meth = curType && collectMembers(curType.name, parsed).find((m) => m.kind === 'method' && m.name === nm);
    cur = meth ? { type: JavaParse.simple(meth.ret), isStatic: false } : null;
  } else if (/^[A-Za-z_$][\w$]*$/.test(first)) {
    const vt = varType(text, offset, first, curType, parsed);
    if (vt) cur = { type: vt, isStatic: false };
    else if (/^[A-Z]/.test(first) && (findProjectType(first, parsed) || JDK[first])) cur = { type: first, isStatic: true };
  }
  if (!cur || !cur.type) return null;
  for (const seg of parts.slice(1)) {
    const nm = (callName(seg) || /^([A-Za-z_$][\w$]*)/.exec(seg) || [])[1];
    if (!nm) return null;
    const mem = collectMembers(cur.type, parsed).find((m) => m.name === nm && (callName(seg) ? m.kind === 'method' : m.kind !== 'method'));
    if (!mem) {
      const inner = collectMembers(cur.type, parsed).find((m) => m.kind === 'type' && m.name === nm);
      if (inner) { cur = { type: nm, isStatic: true }; continue; }
      return null;
    }
    const t = mem.kind === 'method' ? mem.ret : mem.type;
    if (!t || t === 'void' || /^[A-Z]$/.test(t)) return null; // unknown generic parameter
    if (/\[\]$/.test(t)) return { type: '__array__', isStatic: false };
    cur = { type: JavaParse.simple(t), isStatic: false };
  }
  return cur;
}

/* ------------------------------ completion ------------------------------ */

function importEdit(model, fqn, parsed) {
  const simple = fqn.split('.').pop();
  const pkg = fqn.slice(0, fqn.lastIndexOf('.'));
  if (!pkg || pkg === 'java.lang' || pkg === parsed.package) return [];
  if (parsed.imports.some((i) => !i.static && (i.name === fqn || i.name === `${pkg}.*`))) return [];
  if (parsed.imports.some((i) => !i.static && i.name.endsWith(`.${simple}`))) return [];
  const line = parsed.lastImportLine ? parsed.lastImportLine + 1 : (parsed.packageLine ? parsed.packageLine + 1 : 1);
  const lead = !parsed.lastImportLine && parsed.packageLine ? NLC : '';
  return [{ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, text: `${lead}import ${fqn};${NLC}` }];
}

function camelMatch(name, q) {
  if (!q) return true;
  const lq = q.toLowerCase();
  if (name.toLowerCase().startsWith(lq)) return true;
  const caps = name.replace(/[^A-Z0-9]/g, '');
  return caps.length > 0 && caps.toLowerCase().startsWith(lq) && q === q.toUpperCase();
}

function snippetFor(m) {
  const names = JavaParse.splitTop(m.params || '', ',').map((p, i) => (p.trim().split(/\s+/).pop() || `arg${i + 1}`).replace(/[^\w]/g, '') || `arg${i + 1}`);
  return names.length ? `${m.name}(${names.map((n, i) => `\${${i + 1}:${n}}`).join(', ')})` : `${m.name}()`;
}

function registerJavaCompletion() {
  const K = monaco.languages.CompletionItemKind;
  const R = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  monaco.languages.registerCompletionItemProvider('java', {
    triggerCharacters: ['.'],
    provideCompletionItems: (model, position) => javaProvide(model, position, K, R),
  });
}

async function javaProvide(model, position, K, R) {
  {
    {
      await javaIndex(false);
      const parsed = parseModel(model);
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      const curType = typeAtLine(parsed, position.lineNumber);
      const lineText = model.getLineContent(position.lineNumber);
      const suggestions = [];
      const memItem = (m, rank) => {
        const isM = m.kind === 'method';
        return {
          label: { label: m.name, detail: isM ? `(${m.params || ''})` : '', description: (isM ? m.ret : m.type) || '' },
          kind: isM ? K.Method : m.kind === 'type' ? K.Class : K.Field,
          insertText: isM ? snippetFor(m) : m.name, insertTextRules: R, range, filterText: m.name,
          detail: `${(isM ? m.ret : m.type) || ''} — ${m.owner}`.trim(), sortText: `${m.owner === 'Object' ? 9 : rank}${m.name}`,
          documentation: isM ? `${m.ret} ${m.name}(${m.params || ''})` : undefined,
        };
      };

      // member access:  expr.<cursor>
      if (word.startColumn > 1 && lineText[word.startColumn - 2] === '.') {
        const expr = exprBefore(lineText, word.startColumn - 2);
        const res = expr ? resolveExpr(expr, { text, offset, curType, parsed }) : null;
        if (!res || !res.type) return { suggestions: [] };
        if (res.type === '__array__') return { suggestions: [{ label: 'length', kind: K.Field, insertText: 'length', range, detail: 'int' }, { label: 'clone()', kind: K.Method, insertText: 'clone()', range }] };
        const seen = new Set();
        for (const m of collectMembers(res.type, parsed)) {
          const isStatic = (m.mods || []).includes('static');
          if (res.isStatic ? !(isStatic || m.kind === 'type') : false) continue;
          if (!res.isStatic && isStatic && m.kind !== 'field') continue;
          if ((m.mods || []).includes('private') && m.owner !== (curType && curType.name)) continue;
          const key = `${m.kind}:${m.name}(${m.params})`;
          if (seen.has(key)) continue;
          seen.add(key);
          suggestions.push(memItem(m, m.owner === res.type ? 0 : 1));
        }
        return { suggestions };
      }

      // plain identifier position
      const prefix = word.word;
      const inCode = !/^\s*(\/\/|\*|\/\*)/.test(lineText);
      if (!inCode) return { suggestions: [] };
      if (curType) {
        const seen = new Set();
        for (const m of collectMembers(curType.name, parsed)) {
          if ((m.mods || []).includes('private') && m.owner !== curType.name) continue;
          const key = `${m.kind}:${m.name}`;
          if (seen.has(key) || m.owner === 'Object') continue;
          seen.add(key);
          suggestions.push(memItem(m, 1));
        }
        // locals and parameters declared above the cursor, inside the current type
        const startOff = model.getOffsetAt({ lineNumber: curType.line, column: 1 });
        const region = text.slice(startOff, offset);
        const re = /(?:^|[;{}(,\s])((?:final\s+)?[A-Za-z_][\w.]*(?:<[^;(){}=]*>)?(?:\[\])*)\s+([a-z_$][\w$]*)\s*(?=[=;,):])/g;
        const locals = new Map();
        let mm;
        while ((mm = re.exec(region))) { if (!KW_NOT_TYPE.has(mm[1]) && !JAVA_KEYWORDS.includes(mm[2])) locals.set(mm[2], mm[1].replace(/^final\s+/, '')); }
        for (const [n, t] of locals) suggestions.push({ label: { label: n, description: t }, kind: K.Variable, insertText: n, range, detail: t, sortText: `0${n}` });
      }
      if (prefix.length >= 1) {
        const added = new Set();
        const add = (name, fqn, kind, owner) => {
          if (added.has(name) || !camelMatch(name, prefix)) return;
          added.add(name);
          suggestions.push({ label: { label: name, description: fqn }, kind, insertText: name, range, detail: fqn, sortText: `2${name.length.toString().padStart(3, '0')}${name}`, additionalTextEdits: importEdit(model, fqn, parsed), filterText: name, documentation: owner });
        };
        for (const t of parsed.types) add(t.name, t.name, t.kind === 'interface' ? K.Interface : t.kind === 'enum' ? K.Enum : K.Class);
        if (suggestions.length < 120) {
          for (const t of JV.types) { if (!t.outer) add(t.name, t.fqn, t.kind === 'interface' ? K.Interface : t.kind === 'enum' ? K.Enum : K.Class, t.file); if (added.size > 60) break; }
          for (const [n, fqn] of Object.entries(JDK_IMPORT)) { add(n, fqn, JDK[n] && JDK[n].kind === 'interface' ? K.Interface : K.Class); if (added.size > 90) break; }
          for (const n of JAVA_LANG) add(n, `java.lang.${n}`, K.Class);
        }
        for (const [k, body, desc] of JAVA_SNIPPETS) if (k.startsWith(prefix.toLowerCase())) suggestions.push({ label: k, kind: K.Snippet, insertText: body, insertTextRules: R, range, detail: desc, sortText: `3${k}` });
        for (const k of JAVA_KEYWORDS) if (k.startsWith(prefix)) suggestions.push({ label: k, kind: K.Keyword, insertText: k, range, sortText: `4${k}` });
      } else {
        for (const [k, body, desc] of JAVA_SNIPPETS.slice(0, 8)) suggestions.push({ label: k, kind: K.Snippet, insertText: body, insertTextRules: R, range, detail: desc, sortText: `3${k}` });
      }
      return { suggestions };
    }
  }
}

/** Test/diagnostic hook: the labels completion would offer at a position. */
async function javaCompletionLabels(model, position) {
  const r = await javaProvide(model, position, monaco.languages.CompletionItemKind, monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet);
  return r.suggestions.map((s) => (typeof s.label === 'string' ? s.label : s.label.label));
}

/* ------------------------------ hover, definition, symbols, formatting, rename ------------------------------ */

function locationOf(file, line, model) {
  const uri = file ? monaco.Uri.file(file) : model.uri;
  return { uri, range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 } };
}

function memberLocation(typeName, memberName, parsed, model) {
  const pt = findProjectType(typeName, parsed);
  if (!pt) return null;
  const file = pt.file || null;
  const m = pt.methods.find((x) => x.name === memberName);
  if (m) return locationOf(file, m.line, model);
  const f = pt.fields.find((x) => x.name === memberName);
  if (f) return locationOf(file, f.line, model);
  for (const s of [...pt.extends, ...pt.implements]) { const l = memberLocation(s, memberName, parsed, model); if (l) return l; }
  return null;
}

function registerJavaProviders() {
  const SK = monaco.languages.SymbolKind;

  monaco.languages.registerHoverProvider('java', {
    async provideHover(model, position) {
      await javaIndex(false);
      const w = model.getWordAtPosition(position);
      if (!w) return null;
      const parsed = parseModel(model);
      const t = findProjectType(w.word, parsed);
      const line = model.getLineContent(position.lineNumber);
      const lines = [];
      if (t) lines.push(`**${t.kind} ${t.name}**  \n${t.pkg || '(default package)'}${t.extends.length ? `  \nextends ${t.extends.join(', ')}` : ''}${t.implements.length ? `  \nimplements ${t.implements.join(', ')}` : ''}`);
      else if (JDK[w.word]) lines.push(`**${JDK[w.word].kind} ${w.word}**  \n${JDK[w.word].pkg}`);
      else {
        const curType = typeAtLine(parsed, position.lineNumber);
        const dot = w.startColumn > 1 && line[w.startColumn - 2] === '.';
        let mem = null;
        if (dot) { const res = resolveExpr(exprBefore(line, w.startColumn - 2), { text: model.getValue(), offset: model.getOffsetAt(position), curType, parsed }); if (res && res.type) mem = collectMembers(res.type, parsed).find((m) => m.name === w.word); }
        else if (curType) mem = collectMembers(curType.name, parsed).find((m) => m.name === w.word);
        if (mem) lines.push(mem.kind === 'method' ? `\`${mem.ret} ${mem.name}(${mem.params || ''})\`  \nin ${mem.owner}` : `\`${mem.type} ${mem.name}\`  \nin ${mem.owner}`);
        else { const vt = curType && varType(model.getValue(), model.getOffsetAt(position), w.word, curType, parsed); if (vt) lines.push(`\`${vt} ${w.word}\``); }
      }
      return lines.length ? { range: new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn), contents: lines.map((value) => ({ value })) } : null;
    },
  });

  monaco.languages.registerDefinitionProvider('java', {
    async provideDefinition(model, position) {
      await javaIndex(false);
      const w = model.getWordAtPosition(position);
      if (!w) return null;
      const parsed = parseModel(model);
      const curType = typeAtLine(parsed, position.lineNumber);
      const line = model.getLineContent(position.lineNumber);
      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      if (w.startColumn > 1 && line[w.startColumn - 2] === '.') {
        const res = resolveExpr(exprBefore(line, w.startColumn - 2), { text, offset, curType, parsed });
        if (res && res.type) { const loc = memberLocation(res.type, w.word, parsed, model); if (loc) return [loc]; }
        return null;
      }
      const t = findProjectType(w.word, parsed);
      if (t && /^[A-Z]/.test(w.word)) return [locationOf(t.file, t.line, model)];
      // local variable / parameter declaration above the cursor
      const re = new RegExp('(?:^|[;{}(,\\s])(?:final\\s+)?[A-Za-z_][\\w.]*(?:<[^;(){}=]*>)?(?:\\[\\])*\\s+(' + w.word + ')\\s*(?=[=;,):])', 'g');
      let hit = null;
      let mm;
      const before = text.slice(0, offset);
      while ((mm = re.exec(before))) hit = mm;
      if (hit) {
        const p = model.getPositionAt(hit.index + hit[0].lastIndexOf(w.word));
        return [{ uri: model.uri, range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column + w.word.length) }];
      }
      if (curType) { const loc = memberLocation(curType.name, w.word, parsed, model); if (loc) return [loc]; }
      return null;
    },
  });

  const symFor = (t, parsed) => {
    const kindOf = { class: SK.Class, interface: SK.Interface, enum: SK.Enum, record: SK.Struct, annotation: SK.Interface };
    const rng = (a, b) => new monaco.Range(a, 1, b, 1000);
    const kids = [];
    for (const f of t.fields) kids.push({ name: f.name, detail: f.type, kind: f.constant ? SK.EnumMember : SK.Field, range: rng(f.line, f.line), selectionRange: rng(f.line, f.line), tags: [] });
    for (const m of t.methods) kids.push({ name: `${m.ctor ? t.name : m.name}(${m.params})`, detail: m.ret, kind: m.ctor ? SK.Constructor : SK.Method, range: rng(m.line, m.line), selectionRange: rng(m.line, m.line), tags: [] });
    for (const inner of parsed.types.filter((x) => x.outer === t.name)) kids.push(symFor(inner, parsed));
    kids.sort((a, b) => a.range.startLineNumber - b.range.startLineNumber);
    return { name: t.name, detail: t.kind, kind: kindOf[t.kind] || SK.Class, range: rng(t.line, t.endLine), selectionRange: rng(t.line, t.line), children: kids, tags: [] };
  };
  monaco.languages.registerDocumentSymbolProvider('java', { provideDocumentSymbols(model) { const p = parseModel(model); return p.types.filter((t) => !t.outer).map((t) => symFor(t, p)); } });

  monaco.languages.registerDocumentFormattingEditProvider('java', {
    provideDocumentFormattingEdits(model, options) {
      const unit = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';
      const text = model.getValue();
      const out = formatJava(text, unit);
      return out === text ? [] : [{ range: model.getFullModelRange(), text: out }];
    },
  });

  monaco.languages.registerRenameProvider('java', {
    resolveRenameLocation(model, position) {
      const w = model.getWordAtPosition(position);
      return w ? { range: new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn), text: w.word } : { range: new monaco.Range(1, 1, 1, 1), text: '', rejectReason: 'Place the cursor on a name.' };
    },
    provideRenameEdits(model, position, newName) {
      const w = model.getWordAtPosition(position);
      if (!w || !/^[A-Za-z_$][\w$]*$/.test(newName)) return { edits: [], rejectReason: 'Not a valid Java name.' };
      const clean = JavaParse.blank(model.getValue());
      const re = new RegExp('\\b' + w.word.replace(/\$/g, '\\$') + '\\b', 'g');
      const edits = [];
      let mm;
      while ((mm = re.exec(clean))) { const p = model.getPositionAt(mm.index); edits.push({ resource: model.uri, versionId: undefined, textEdit: { range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column + w.word.length), text: newName } }); }
      return { edits };
    },
  });
}

/** Simple brace-based re-indenter (keeps your line breaks; fixes indentation). */
function formatJava(text, unit) {
  const lines = text.split(NLC);
  const clean = JavaParse.blank(text).split(NLC);
  const out = [];
  let depth = 0;
  let prev = '';
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\s+$/, '');
    const trimmed = raw.trim();
    const c = (clean[i] || '').trim();
    if (!trimmed) { out.push(''); continue; }
    if (trimmed !== c && !c) { // inside a comment or text block: keep relative alignment
      out.push(trimmed.startsWith('*') ? unit.repeat(Math.max(0, depth)) + ' ' + trimmed : (trimmed.startsWith('/*') || trimmed.startsWith('//') ? unit.repeat(Math.max(0, depth)) + trimmed : raw));
      continue;
    }
    let lead = 0;
    while (c[lead] === '}') lead++;
    const cont = prev && !/[;{}:,(]$/.test(prev) && !/^@/.test(prev) && !/^[{}]/.test(c) && !/^(else|catch|finally)/.test(c) && !/->$/.test(prev) ? 1 : 0;
    const level = Math.max(0, depth - lead) + cont;
    out.push(unit.repeat(level) + trimmed);
    depth += (c.match(/\{/g) || []).length - (c.match(/\}/g) || []).length;
    if (depth < 0) depth = 0;
    if (c) prev = c;
  }
  return out.join(NLC);
}

/* ------------------------------ commands: navigation ------------------------------ */

const KIND_ICON = { class: 'C', interface: 'I', enum: 'E', record: 'R', annotation: '@', method: 'm', field: 'f', constructor: 'c' };

async function cmdOpenClass() {
  if (!state.workspace) return status('Open a project first.', true);
  await javaIndex(false);
  if (!JV.types.length) return status('No Java classes found in this project.', true);
  quickPick({
    placeholder: 'Open Java class — type a name, or capitals such as HM for HashMap',
    items: JV.types.map((t) => ({ label: t.outer ? `${t.outer}.${t.name}` : t.name, detail: `${t.pkg || '(default package)'} · ${t.kind}`, icon: KIND_ICON[t.kind], key: t.name, data: t })),
    onPick: (it) => openAt(it.data.file, it.data.line),
  });
}

async function cmdSymbolWorkspace() {
  if (!state.workspace) return status('Open a project first.', true);
  await javaIndex(false);
  const items = [];
  for (const t of JV.types) {
    items.push({ label: t.name, detail: `${t.pkg} · ${t.kind}`, icon: KIND_ICON[t.kind], data: { file: t.file, line: t.line } });
    for (const m of t.methods) items.push({ label: `${m.ctor ? t.name : m.name}(${m.params})`, detail: `${t.name} · ${m.ret || 'constructor'}`, icon: m.ctor ? 'c' : 'm', key: m.name, data: { file: t.file, line: m.line } });
    for (const f of t.fields) items.push({ label: f.name, detail: `${t.name} · ${f.type}`, icon: 'f', data: { file: t.file, line: f.line } });
  }
  quickPick({ placeholder: 'Go to symbol in workspace — classes, methods and fields', items, onPick: (it) => openAt(it.data.file, it.data.line) });
}

function activeJavaModel() { return editor && state.active && state.active.kind === 'file' && isJavaModel(editor.getModel()) ? editor.getModel() : null; }

function cmdListMethods() {
  const model = activeJavaModel();
  if (!model) return editor && editor.getAction('editor.action.quickOutline').run();
  const p = parseModel(model);
  const items = [];
  for (const t of p.types) {
    const qual = t.outer ? `${t.outer}.${t.name}` : t.name;
    items.push({ label: qual, detail: t.kind, icon: KIND_ICON[t.kind], data: t.line });
    for (const m of t.methods) items.push({ label: `${m.ctor ? t.name : m.name}(${m.params})`, detail: `${m.ret || 'constructor'} · ${qual}`, icon: m.ctor ? 'c' : 'm', key: m.name, data: m.line });
    for (const f of t.fields) items.push({ label: f.name, detail: `${f.type} · ${qual}`, icon: 'f', data: f.line });
  }
  items.sort((a, b) => a.data - b.data);
  quickPick({ placeholder: 'Methods and fields in this file', items, onPick: (it) => { editor.revealLineInCenter(it.data); editor.setPosition({ lineNumber: it.data, column: 1 }); editor.focus(); } });
}

async function cmdMethodsOfClass() {
  await javaIndex(false);
  quickPick({
    placeholder: 'List methods of which class?', items: JV.types.map((t) => ({ label: t.name, detail: t.pkg, icon: KIND_ICON[t.kind], data: t })),
    onPick: (it) => {
      const t = it.data;
      const items = [...t.methods.map((m) => ({ label: `${m.ctor ? t.name : m.name}(${m.params})`, detail: m.ret || 'constructor', icon: m.ctor ? 'c' : 'm', key: m.name, data: m.line })), ...t.fields.map((f) => ({ label: f.name, detail: f.type, icon: 'f', data: f.line }))];
      quickPick({ placeholder: `Members of ${t.name}`, items, onPick: (x) => openAt(t.file, x.data) });
    },
  });
}

/** The project type under the cursor, else the type containing the cursor. */
async function typeUnderCursor() {
  await javaIndex(false);
  const model = activeJavaModel();
  if (!model) return null;
  const pos = editor.getPosition();
  const parsed = parseModel(model);
  const w = model.getWordAtPosition(pos);
  if (w && /^[A-Z]/.test(w.word)) { const t = findProjectType(w.word, parsed); if (t) return { ...t, file: t.file || state.active.path }; }
  const cur = typeAtLine(parsed, pos.lineNumber);
  return cur ? { ...cur, file: state.active.path, pkg: parsed.package } : null;
}

async function cmdHierarchy() {
  let t = await typeUnderCursor();
  if (!t) {
    await javaIndex(false);
    return quickPick({ placeholder: 'Show type hierarchy of…', items: JV.types.map((x) => ({ label: x.name, detail: x.pkg, icon: KIND_ICON[x.kind], data: x })), onPick: (it) => hierarchyPage(it.data) });
  }
  hierarchyPage(t);
}

function hierarchyPage(t) {
  openPage({
    id: `hier:${t.pkg}.${t.name}`, title: `Hierarchy: ${t.name}`, icon: '🌲', pad: true,
    build(el) {
      const row = (depth, name, typ, extra) => h('div', { class: `hrow${typ ? ' link' : ''}`, style: `padding-left:${depth * 18}px`, onclick: typ && typ.file ? () => openAt(typ.file, typ.line) : null },
        h('span', { class: 'ico', text: typ ? KIND_ICON[typ.kind] : '·' }), h('b', { text: name }), h('small', { class: 't-dim', text: extra || (typ ? typ.pkg : (JDK[name] ? JDK[name].pkg : 'library')) }));
      const sup = [];
      const walkUp = (name, depth, seen) => {
        if (seen.has(name) || depth > 10) return;
        seen.add(name);
        const pt = findProjectType(name);
        sup.push(row(depth, name, pt));
        const parents = pt ? [...pt.extends, ...pt.implements] : (JDK[name] ? JDK[name].sup : []);
        parents.forEach((p) => walkUp(p, depth + 1, seen));
      };
      [...t.extends, ...t.implements].forEach((p) => walkUp(p, 1, new Set([t.name])));
      const subs = [];
      const walkDown = (name, depth, seen) => {
        if (seen.has(name) || depth > 8) return;
        seen.add(name);
        for (const c of JV.types.filter((x) => x.extends.includes(name) || x.implements.includes(name))) { subs.push(row(depth, c.name, c, `${c.pkg} · ${c.implements.includes(name) ? 'implements' : 'extends'}`)); walkDown(c.name, depth + 1, seen); }
      };
      walkDown(t.name, 1, new Set());
      const members = [...t.methods.map((m) => h('div', { class: 'hrow link', onclick: () => t.file && openAt(t.file, m.line) }, h('span', { class: 'ico', text: m.ctor ? 'c' : 'm' }), h('span', { text: `${m.ctor ? t.name : m.name}(${m.params})` }), h('small', { class: 't-dim', text: m.ret }))),
        ...t.fields.map((f) => h('div', { class: 'hrow link', onclick: () => t.file && openAt(t.file, f.line) }, h('span', { class: 'ico', text: 'f' }), h('span', { text: f.name }), h('small', { class: 't-dim', text: f.type })))];
      el.append(h('h2', { text: `${t.kind} ${t.name}`, style: 'margin-top:0' }), h('div', { class: 'hint', text: `${t.pkg || '(default package)'}${t.file ? ` · ${t.file}` : ''}` }),
        h('div', { class: 'cat bar', text: 'Supertypes' }), ...(sup.length ? sup : [h('div', { class: 'hint', text: 'No explicit supertypes (extends Object).' })]),
        h('div', { class: 'cat bar', text: 'Subtypes' }), ...(subs.length ? subs : [h('div', { class: 'hint', text: 'No subtypes in this project.' })]),
        h('div', { class: 'cat bar', text: 'Members' }), ...(members.length ? members : [h('div', { class: 'hint', text: 'No members.' })]));
    },
  });
}

async function cmdImplementations() {
  const t = await typeUnderCursor();
  if (!t) return status('Place the cursor on a class or interface name.', true);
  const subs = [];
  const seen = new Set();
  const walk = (n) => { for (const c of JV.types.filter((x) => x.extends.includes(n) || x.implements.includes(n))) if (!seen.has(c.fqn)) { seen.add(c.fqn); subs.push(c); walk(c.name); } };
  walk(t.name);
  if (!subs.length) return status(`${t.name} has no implementations or subclasses in this project.`);
  quickPick({ placeholder: `Implementations / subclasses of ${t.name}`, items: subs.map((c) => ({ label: c.name, detail: `${c.pkg} · ${c.kind}`, icon: KIND_ICON[c.kind], data: c })), onPick: (it) => openAt(it.data.file, it.data.line) });
}

async function cmdSuperType() {
  const model = activeJavaModel();
  if (!model) return;
  await javaIndex(false);
  const parsed = parseModel(model);
  const cur = typeAtLine(parsed, editor.getPosition().lineNumber);
  if (!cur) return;
  const cands = [...cur.extends, ...cur.implements].map((n) => findProjectType(n)).filter(Boolean);
  if (!cands.length) return status('No supertypes in this project.');
  if (cands.length === 1) return openAt(cands[0].file, cands[0].line);
  quickPick({ placeholder: 'Go to supertype', items: cands.map((c) => ({ label: c.name, detail: c.pkg, icon: KIND_ICON[c.kind], data: c })), onPick: (it) => openAt(it.data.file, it.data.line) });
}

/* ------------------------------ commands: source generation ------------------------------ */

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const leadWs = (s) => (/^\s*/.exec(s) || [''])[0];

function genContext() {
  const model = activeJavaModel();
  if (!model) { status('Open a Java file first.', true); return null; }
  const parsed = parseModel(model);
  const t = typeAtLine(parsed, editor.getPosition().lineNumber);
  if (!t) { status('Place the cursor inside a class.', true); return null; }
  const unit = model.getOptions().insertSpaces ? ' '.repeat(model.getOptions().tabSize) : '\t';
  return { model, parsed, t, unit, ind: leadWs(model.getLineContent(t.line)) + unit };
}

function insertMembers(g, textBlocks, extraImports = []) {
  const closeLine = g.t.endLine;
  const closeText = g.model.getLineContent(closeLine);
  const closeIdx = closeText.lastIndexOf('}');
  const lead = closeIdx > 0 && closeText.slice(0, closeIdx).trim() ? NLC : '';
  const body = textBlocks.join(NLC + NLC);
  const edits = [{ range: new monaco.Range(closeLine, Math.max(1, closeIdx + 1), closeLine, Math.max(1, closeIdx + 1)), text: `${lead}${NLC}${body}${NLC}` }];
  for (const imp of extraImports) edits.push(...importEdit(g.model, imp, g.parsed).map((e) => ({ range: new monaco.Range(e.range.startLineNumber, 1, e.range.startLineNumber, 1), text: e.text })));
  editor.executeEdits('java-generate', edits);
  editor.focus();
}

function instanceFields(t) { return t.fields.filter((f) => !(f.mods || []).includes('static') && !f.constant); }

function genAccessors(kind) {
  const g = genContext();
  if (!g) return;
  const have = new Set(g.t.methods.map((m) => m.name));
  const blocks = [];
  for (const f of instanceFields(g.t)) {
    const C = cap(f.name);
    const getter = (f.type === 'boolean' ? 'is' : 'get') + C;
    if (kind !== 'setters' && !have.has(getter)) blocks.push(`${g.ind}public ${f.fullType || f.type} ${getter}() {${NLC}${g.ind}${g.unit}return ${f.name};${NLC}${g.ind}}`);
    if (kind !== 'getters' && !(f.mods || []).includes('final') && !have.has(`set${C}`)) blocks.push(`${g.ind}public void set${C}(${f.fullType || f.type} ${f.name}) {${NLC}${g.ind}${g.unit}this.${f.name} = ${f.name};${NLC}${g.ind}}`);
  }
  if (!blocks.length) return status('Nothing to generate: every field already has the requested accessors.');
  insertMembers(g, blocks);
  status(`Generated ${blocks.length} method(s).`);
}

function genConstructor() {
  const g = genContext();
  if (!g) return;
  const fields = instanceFields(g.t).filter((f) => !(f.mods || []).includes('final') || !/=/.test(''));
  insertMembers(g, [`${g.ind}public ${g.t.name}(${fields.map((f) => `${f.fullType || f.type} ${f.name}`).join(', ')}) {${NLC}${fields.map((f) => `${g.ind}${g.unit}this.${f.name} = ${f.name};`).join(NLC)}${fields.length ? NLC : ''}${g.ind}}`]);
}

function genToString() {
  const g = genContext();
  if (!g) return;
  const fs_ = instanceFields(g.t);
  const parts = fs_.map((f, i) => `"${i ? ', ' : ''}${f.name}=" + ${f.name}`).join(' + ');
  insertMembers(g, [`${g.ind}@Override${NLC}${g.ind}public String toString() {${NLC}${g.ind}${g.unit}return "${g.t.name}{" + ${parts || '""'} + "}";${NLC}${g.ind}}`]);
}

function genEqualsHash() {
  const g = genContext();
  if (!g) return;
  const fs_ = instanceFields(g.t);
  const n = g.t.name;
  const cmp = fs_.map((f) => (/^(int|long|short|byte|char|boolean|float|double)$/.test(f.type) ? `${f.name} == other.${f.name}` : `Objects.equals(${f.name}, other.${f.name})`)).join(' && ') || 'true';
  insertMembers(g, [
    `${g.ind}@Override${NLC}${g.ind}public boolean equals(Object o) {${NLC}${g.ind}${g.unit}if (this == o) return true;${NLC}${g.ind}${g.unit}if (o == null || getClass() != o.getClass()) return false;${NLC}${g.ind}${g.unit}${n} other = (${n}) o;${NLC}${g.ind}${g.unit}return ${cmp};${NLC}${g.ind}}`,
    `${g.ind}@Override${NLC}${g.ind}public int hashCode() {${NLC}${g.ind}${g.unit}return Objects.hash(${fs_.map((f) => f.name).join(', ')});${NLC}${g.ind}}`,
  ], ['java.util.Objects']);
}

function cmdOverrideMethods() {
  const g = genContext();
  if (!g) return;
  const have = new Set(g.t.methods.map((m) => `${m.name}/${JavaParse.splitTop(m.params, ',').length}`));
  const cands = collectMembers(g.t.name, g.parsed).filter((m) => m.kind === 'method' && m.owner !== g.t.name && !(m.mods || []).some((x) => ['static', 'private', 'final'].includes(x)) && !have.has(`${m.name}/${JavaParse.splitTop(m.params, ',').length}`));
  if (!cands.length) return status('No inherited methods to override.');
  quickPick({
    placeholder: 'Override which method?', items: cands.map((m) => ({ label: `${m.name}(${m.params})`, detail: `${m.ret} · ${m.owner}`, icon: 'm', data: m })),
    onPick: (it) => {
      const m = it.data;
      const call = m.ret && m.ret !== 'void' ? `${g.ind}${g.unit}return ${/^(int|long|short|byte|float|double)$/.test(m.ret) ? '0' : m.ret === 'boolean' ? 'false' : 'null'};` : `${g.ind}${g.unit}// TODO`;
      insertMembers(g, [`${g.ind}@Override${NLC}${g.ind}public ${m.ret || 'void'} ${m.name}(${m.params || ''}) {${NLC}${call}${NLC}${g.ind}}`]);
    },
  });
}

function cmdGenerate() {
  quickPick({
    placeholder: 'Generate code…', items: [
      { label: 'Getters and Setters', detail: 'for every field', data: () => genAccessors('both') }, { label: 'Getters', detail: 'for every field', data: () => genAccessors('getters') },
      { label: 'Setters', detail: 'for non-final fields', data: () => genAccessors('setters') }, { label: 'Constructor', detail: 'using all fields', data: genConstructor },
      { label: 'toString()', detail: '', data: genToString }, { label: 'equals() and hashCode()', detail: '', data: genEqualsHash }, { label: 'Override methods…', detail: 'from supertypes', data: cmdOverrideMethods },
    ], onPick: (it) => it.data(),
  });
}

/* ------------------------------ imports ------------------------------ */

async function cmdOrganizeImports() {
  const model = activeJavaModel();
  if (!model) return status('Open a Java file first.', true);
  await javaIndex(false);
  const text = model.getValue();
  const parsed = parseModel(model);
  const clean = JavaParse.blank(text);
  const bodyOnly = text.split(NLC).filter((l, i) => !(parsed.imports.some((im) => im.line === i + 1))).join(NLC);
  const used = new Set(bodyOnly.match(/[A-Za-z_$][\w$]*/g) || []);
  const codeIds = new Set(clean.split(NLC).filter((l, i) => !(parsed.imports.some((im) => im.line === i + 1))).join(NLC).match(/\b[A-Z][\w$]*\b/g) || []);
  const keep = parsed.imports.filter((im) => im.name.endsWith('.*') || used.has(im.name.split('.').pop()));
  const names = new Set(keep.filter((k) => !k.name.endsWith('.*')).map((k) => k.name.split('.').pop()));
  const declared = new Set(parsed.types.map((t) => t.name));
  const wild = keep.filter((k) => k.name.endsWith('.*') && !k.static).map((k) => k.name.slice(0, -2));
  const add = [];
  for (const id of codeIds) {
    if (names.has(id) || declared.has(id) || JAVA_LANG.has(id) || /^[A-Z_0-9]+$/.test(id) || add.some((a) => a.endsWith(`.${id}`))) continue;
    const proj = (JV.byName.get(id) || []).filter((t) => !t.outer && t.pkg !== parsed.package);
    const samePkg = (JV.byName.get(id) || []).some((t) => t.pkg === parsed.package);
    if (samePkg) continue;
    const cand = proj.length === 1 ? proj[0].fqn : (proj.length === 0 && JDK_IMPORT[id] ? JDK_IMPORT[id] : null);
    if (cand && !wild.includes(cand.slice(0, cand.lastIndexOf('.')))) add.push(cand);
  }
  const all = [...keep.map((k) => ({ name: k.name, static: k.static })), ...add.map((n) => ({ name: n, static: false }))];
  const uniq = [];
  for (const i of all) if (!uniq.some((u) => u.name === i.name && u.static === i.static)) uniq.push(i);
  const group = (n) => (n.startsWith('java.') ? 0 : n.startsWith('javax.') ? 1 : 2);
  const normal = uniq.filter((i) => !i.static).sort((a, b) => group(a.name) - group(b.name) || a.name.localeCompare(b.name));
  const statics = uniq.filter((i) => i.static).sort((a, b) => a.name.localeCompare(b.name));
  const lines = [];
  let lastG = -1;
  for (const i of normal) { const gp = group(i.name); if (lastG !== -1 && gp !== lastG) lines.push(''); lines.push(`import ${i.name};`); lastG = gp; }
  if (statics.length) { if (lines.length) lines.push(''); statics.forEach((i) => lines.push(`import static ${i.name};`)); }
  const first = parsed.imports.length ? Math.min(...parsed.imports.map((i) => i.line)) : 0;
  const last = parsed.lastImportLine;
  let range;
  let replacement = lines.join(NLC);
  if (first) { range = new monaco.Range(first, 1, last, model.getLineMaxColumn(last)); } else if (lines.length) { const at = parsed.packageLine ? parsed.packageLine + 1 : 1; range = new monaco.Range(at, 1, at, 1); replacement = `${parsed.packageLine ? NLC : ''}${replacement}${NLC}`; } else return status('Imports are already organized.');
  editor.executeEdits('organize-imports', [{ range, text: replacement }]);
  status(`Imports organized (${normal.length + statics.length} imports${add.length ? `, ${add.length} added` : ''}).`);
}

async function cmdAddImport() {
  const model = activeJavaModel();
  if (!model) return;
  await javaIndex(false);
  const w = model.getWordAtPosition(editor.getPosition());
  if (!w) return status('Place the cursor on a class name.', true);
  const parsed = parseModel(model);
  const cands = [...(JV.byName.get(w.word) || []).filter((t) => !t.outer).map((t) => t.fqn), ...(JDK_IMPORT[w.word] ? [JDK_IMPORT[w.word]] : [])];
  if (!cands.length) return status(`No class named ${w.word} found to import.`, true);
  const apply = (fqn) => { const e = importEdit(model, fqn, parsed); if (!e.length) return status('Already imported.'); editor.executeEdits('add-import', e.map((x) => ({ range: new monaco.Range(x.range.startLineNumber, 1, x.range.startLineNumber, 1), text: x.text }))); status(`Imported ${fqn}`); };
  if (cands.length === 1) return apply(cands[0]);
  quickPick({ placeholder: `Import which ${w.word}?`, items: cands.map((c) => ({ label: c, detail: '', icon: 'C', data: c })), onPick: (it) => apply(it.data) });
}

/* ------------------------------ new Java type ------------------------------ */

function sourceRootFor(dir) {
  const norm = dir.split(BS).join('/');
  const m = /^(.*\/src\/(?:main|test)\/(?:java|kotlin|scala|groovy))(?:\/(.*))?$/.exec(norm);
  if (m) return { root: m[1].split('/').join(BS), pkg: (m[2] || '').split('/').filter(Boolean).join('.') };
  return null;
}

async function defaultJavaDir() {
  const base = selected ? (selected.isDir ? selected.path : dirName(selected.path)) : (state.active && state.active.kind === 'file' ? dirName(state.active.path) : null);
  if (base && sourceRootFor(base)) return base;
  const guess = joinPath(state.workspace, ['src', 'main', 'java'].join(BS));
  if (await inv('fs:exists', guess).catch(() => false)) return guess;
  return base || state.workspace;
}

async function cmdNewJava(kind) {
  if (!state.workspace) return status('Open a project first.', true);
  const dir = await defaultJavaDir();
  const sr = sourceRootFor(dir);
  const kinds = { class: 'Class', interface: 'Interface', enum: 'Enum', record: 'Record', annotation: 'Annotation', main: 'Class with main()', test: 'JUnit 5 test' };
  const type = h('select', {}, Object.entries(kinds).map(([k, l]) => h('option', { value: k, text: l, selected: k === (kind || 'class') })));
  const name = h('input', { placeholder: 'Name, e.g. OrderService', spellcheck: 'false' });
  const pkg = h('input', { value: sr ? sr.pkg : '', placeholder: 'com.example (leave empty for the default package)', spellcheck: 'false' });
  const msg = h('div', { class: 'msg' });
  const close = modal('New Java type', h('div', {}, h('label', { text: 'Kind' }), type, h('label', { text: 'Name' }), name, h('label', { text: 'Package' }), pkg, h('div', { class: 'hint', text: sr ? `Source folder: ${sr.root}` : `Folder: ${dir}` }), msg), [
    h('button', { text: 'Cancel', onclick: () => close() }),
    h('button', { class: 'primary', text: 'Create', onclick: async () => {
      const n = name.value.trim();
      const p = pkg.value.trim();
      if (!/^[A-Za-z_][\w]*$/.test(n)) { msg.className = 'msg err'; msg.textContent = 'Enter a valid Java name (letters, digits, underscore).'; return; }
      if (p && !/^[a-z_][\w]*(\.[a-z_][\w]*)*$/.test(p)) { msg.className = 'msg err'; msg.textContent = 'Package names look like com.example.app (lower case).'; return; }
      const rootDir = sr ? sr.root : dir;
      const target = joinPath(p ? joinPath(rootDir, p.split('.').join(BS)) : rootDir, `${n}.java`);
      const k = type.value;
      const header = p ? `package ${p};${NLC}${NLC}` : '';
      const body = {
        class: `public class ${n} {${NLC}${NLC}}${NLC}`, interface: `public interface ${n} {${NLC}${NLC}}${NLC}`, enum: `public enum ${n} {${NLC}    ;${NLC}}${NLC}`, record: `public record ${n}() {}${NLC}`,
        annotation: `public @interface ${n} {${NLC}}${NLC}`, main: `public class ${n} {${NLC}${NLC}    public static void main(String[] args) {${NLC}        System.out.println("Hello");${NLC}    }${NLC}}${NLC}`,
        test: `import org.junit.jupiter.api.Test;${NLC}${NLC}import static org.junit.jupiter.api.Assertions.assertTrue;${NLC}${NLC}class ${n} {${NLC}${NLC}    @Test${NLC}    void works() {${NLC}        assertTrue(true);${NLC}    }${NLC}}${NLC}`,
      }[k];
      try {
        await inv('fs:create', target, false);
        await inv('fs:writeFile', target, header + body);
      } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; return; }
      close();
      await refreshTree();
      JV.stale = true;
      openAt(target, 1);
    } }),
  ]);
  name.focus();
}

/* ------------------------------ setup ------------------------------ */

function registerJavaFeatures() {
  registerJavaCompletion();
  registerJavaProviders();
  const C = (id, fn, title) => CNS.command(id, fn, title);
  C('nav.class', cmdOpenClass, 'Navigate: Open Java Class…');
  C('nav.symbolWorkspace', cmdSymbolWorkspace, 'Navigate: Go to Symbol in Workspace…');
  C('java.methods', cmdListMethods, 'Java: List Methods in This File');
  C('java.methodsOfClass', cmdMethodsOfClass, 'Java: List Methods of Class…');
  C('java.hierarchy', cmdHierarchy, 'Java: Type Hierarchy');
  C('nav.impl', cmdImplementations, 'Java: Show Implementations / Subclasses');
  C('java.superType', cmdSuperType, 'Java: Go to Supertype');
  C('java.generate', cmdGenerate, 'Java: Generate Code…');
  C('java.getters', () => genAccessors('getters'), 'Java: Generate Getters');
  C('java.setters', () => genAccessors('setters'), 'Java: Generate Setters');
  C('java.gettersSetters', () => genAccessors('both'), 'Java: Generate Getters and Setters');
  C('java.constructor', genConstructor, 'Java: Generate Constructor');
  C('java.toString', genToString, 'Java: Generate toString()');
  C('java.equalsHash', genEqualsHash, 'Java: Generate equals() and hashCode()');
  C('java.override', cmdOverrideMethods, 'Java: Override Methods…');
  C('java.organizeImports', cmdOrganizeImports, 'Java: Organize Imports');
  C('java.addImport', cmdAddImport, 'Java: Add Import for Symbol');
  C('java.new', (k) => cmdNewJava(k), 'File: New Java Class…');
  for (const [k, l] of [['interface', 'Interface'], ['enum', 'Enum'], ['record', 'Record'], ['annotation', 'Annotation'], ['main', 'Class with main()'], ['test', 'JUnit Test']]) C(`java.new.${k}`, () => cmdNewJava(k), `File: New Java ${l}…`);
}
