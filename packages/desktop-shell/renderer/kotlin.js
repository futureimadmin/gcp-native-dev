/* Kotlin code completion. It uses the same dependency scan as Java (the jars on the project's Maven or Gradle classpath), so Spring, Quarkus,
   Micronaut, Ktor, Jakarta and every other library complete in .kt files too:
     @Prefix          annotations (with the import added)
     import a.b.Pre   classes of the dependencies
     Type.<cursor>    members of an imported class, and of a variable declared with val/var in the file
     Prefix           classes of the dependencies, with the import added, plus Kotlin keywords and snippets
   It is a light helper, not a Kotlin compiler: types from your own .kt files are only known from the file you are editing. */
'use strict';

const KT_KEYWORDS = ['fun', 'val', 'var', 'class', 'object', 'interface', 'data class', 'sealed class', 'enum class', 'when', 'if', 'else', 'for', 'while', 'return', 'import', 'package', 'override', 'private', 'protected', 'internal', 'public', 'open', 'abstract', 'companion object', 'suspend', 'lateinit', 'by lazy', 'try', 'catch', 'finally', 'throw', 'null', 'true', 'false', 'this', 'super', 'is', 'in', 'typealias', 'inline', 'constructor', 'init'];
const KT_SNIPPETS = [
  ['main', 'fun main() {\n\t$0\n}', 'main function'],
  ['fun', 'fun ${1:name}(${2}): ${3:Unit} {\n\t$0\n}', 'function'],
  ['dataclass', 'data class ${1:Name}(val ${2:id}: ${3:String})', 'data class'],
  ['class', 'class ${1:Name} {\n\t$0\n}', 'class'],
  ['when', 'when (${1:x}) {\n\t${2:1} -> $0\n\telse -> {}\n}', 'when'],
  ['for', 'for (${1:item} in ${2:items}) {\n\t$0\n}', 'for loop'],
  ['println', 'println(${1})', 'println'],
];
const KT_STD = [['Deprecated', 'kotlin.Deprecated'], ['Suppress', 'kotlin.Suppress'], ['JvmStatic', 'kotlin.jvm.JvmStatic'], ['JvmField', 'kotlin.jvm.JvmField'], ['JvmOverloads', 'kotlin.jvm.JvmOverloads'], ['Throws', 'kotlin.Throws'], ['Volatile', 'kotlin.jvm.Volatile']];
const KTM = new Map(); // fully qualified class name -> members (or null when unknown)

function ktParse(text) {
  const lines = text.split(String.fromCharCode(10));
  let packageLine = 0;
  let lastImportLine = 0;
  const imports = [];
  for (let i = 0; i < lines.length && i < 300; i++) {
    let m = /^\s*package\s+([\w.]+)/.exec(lines[i]);
    if (m) { packageLine = i + 1; continue; }
    m = /^\s*import\s+([\w.]+(?:\.\*)?)(?:\s+as\s+(\w+))?/.exec(lines[i]);
    if (m) { imports.push({ name: m[1], alias: m[2] || '' }); lastImportLine = i + 1; }
  }
  return { packageLine, lastImportLine, imports };
}

function ktImportEdit(parsed, fqn) {
  const NL = String.fromCharCode(10);
  const simple = fqn.split('.').pop();
  const pkg = fqn.slice(0, fqn.lastIndexOf('.'));
  if (!pkg || pkg === 'kotlin' || pkg === 'java.lang') return [];
  if (parsed.imports.some((i) => i.name === fqn || i.name === `${pkg}.*` || i.name.endsWith(`.${simple}`))) return [];
  const line = parsed.lastImportLine ? parsed.lastImportLine + 1 : (parsed.packageLine ? parsed.packageLine + 1 : 1);
  const lead = !parsed.lastImportLine && parsed.packageLine ? NL : '';
  return [{ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, text: `${lead}import ${fqn}${NL}` }];
}

const ktFile = (model) => { const tab = state.tabs.find((t) => t.model === model); return (tab && tab.path) || (model.uri && model.uri.fsPath) || ''; };

async function ktMembers(file, candidates) {
  const key = candidates.join('|');
  if (KTM.has(key)) return KTM.get(key);
  const r = await tryInv('java:members', state.workspace, { file, candidates });
  const list = r.ok && r.data && r.data.members && r.data.members.length ? r.data.members : null;
  KTM.set(key, list);
  if (KTM.size > 200) KTM.delete(KTM.keys().next().value);
  return list;
}

/** The class a name stands for: a capitalised name from the imports, or the type of a val/var declared in the file. */
function ktResolve(name, text, parsed, offset) {
  if (/^[A-Z]/.test(name)) {
    const c = [];
    for (const i of parsed.imports) { if (i.alias === name) c.push(i.name); else if (!i.alias && i.name.endsWith(`.${name}`)) c.push(i.name); }
    for (const i of parsed.imports) if (i.name.endsWith('.*')) c.push(`${i.name.slice(0, -1)}${name}`);
    c.push(`java.lang.${name}`, `java.util.${name}`);
    return { candidates: [...new Set(c)], isStatic: true };
  }
  const before = text.slice(0, offset);
  const re = new RegExp(`(?:val|var)\\s+${name}\\s*(?::\\s*([A-Z][\\w.]*))?(?:\\s*=\\s*([A-Z][\\w.]*)\\s*[(<])?`, 'g');
  let best = null;
  let m;
  while ((m = re.exec(before))) { if (m[1] || m[2]) best = m[1] || m[2]; }
  if (!best) { // constructor properties and function parameters:  name: Type
    const p = new RegExp(`\\b${name}\\s*:\\s*([A-Z][\\w.]*)`, 'g');
    while ((m = p.exec(text))) best = m[1];
  }
  if (!best) return null;
  const simple = best.split('.').pop();
  const r = ktResolve(simple, text, parsed, offset);
  return r ? { candidates: r.candidates, isStatic: false } : null;
}

async function ktProvide(model, position) {
  const K = monaco.languages.CompletionItemKind;
  const R = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  const word = model.getWordUntilPosition(position);
  const lineText = model.getLineContent(position.lineNumber);
  const text = model.getValue();
  const parsed = ktParse(text);
  const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
  const file = ktFile(model);
  const kindOf = (k) => (k === 'interface' || k === 'annotation' ? K.Interface : k === 'enum' ? K.Enum : K.Class);

  // import a.b.Pre
  const imp = /^\s*import\s+([\w.]*)$/.exec(lineText.slice(0, position.column - 1));
  if (imp) {
    const typed = imp[1];
    const q = typed.slice(typed.lastIndexOf('.') + 1);
    const startCol = position.column - typed.length;
    const iRange = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: startCol, endColumn: position.column };
    const types = file && state.workspace && q ? await classpathTypes(model, q, false) : [];
    return { suggestions: types.filter((t) => t.fqn.startsWith(typed.slice(0, typed.lastIndexOf('.') + 1))).map((t) => ({ label: { label: t.name, description: t.fqn }, kind: kindOf(t.kind), insertText: t.fqn, range: iRange, filterText: t.fqn, detail: t.fqn, sortText: `0${t.name}` })) };
  }

  // @Annotation
  if (word.word.startsWith('@') || (word.startColumn > 1 && lineText[word.startColumn - 2] === '@')) {
    const lead = word.word.startsWith('@') ? 1 : 0;
    const q = word.word.slice(lead);
    const aRange = { ...range, startColumn: word.startColumn + lead };
    const seen = new Set();
    const out = [];
    const add = (name, fqn, sort) => { if (seen.has(fqn) || !camelMatch(name, q)) return; seen.add(fqn); out.push({ label: { label: name, description: fqn }, kind: K.Interface, insertText: name, range: aRange, detail: `@${name} — ${fqn}`, sortText: `${sort}${name}`, additionalTextEdits: ktImportEdit(parsed, fqn) }); };
    for (const [n, f] of KT_STD) add(n, f, '1');
    if (file && state.workspace) for (const t of await classpathTypes(model, q, true)) add(t.name, t.fqn, '0');
    return { suggestions: out };
  }

  // expr.<cursor>
  if (word.startColumn > 1 && lineText[word.startColumn - 2] === '.') {
    const before = lineText.slice(0, word.startColumn - 2);
    const m = /([A-Za-z_]\w*)\s*(\(\s*\))?\s*(?:\?|!!)?$/.exec(before);
    if (!m || !file || !state.workspace) return { suggestions: [] };
    const res = ktResolve(m[1], text, parsed, model.getOffsetAt(position));
    if (!res) return { suggestions: [] };
    const members = await ktMembers(file, res.candidates);
    if (!members) return { suggestions: [] };
    const seen = new Set();
    const out = [];
    const staticOnly = members.some((x) => (x.mods || []).includes('static'));
    for (const mem of members) {
      const isStatic = (mem.mods || []).includes('static');
      if (res.isStatic && staticOnly && !isStatic && mem.kind === 'method') continue; // Type.name reaches the statics of a Java class
      if ((mem.mods || []).includes('private')) continue;
      const isM = mem.kind === 'method';
      const key = `${mem.kind}:${mem.name}(${mem.params || ''})`;
      if (seen.has(key)) continue;
      seen.add(key);
      const names = (mem.params || '').split(',').map((p, i) => (p.trim().split(/\s+/).pop() || `arg${i + 1}`).replace(/[^\w]/g, '') || `arg${i + 1}`).filter(Boolean);
      out.push({ label: { label: mem.name, detail: isM ? `(${mem.params || ''})` : '', description: (isM ? mem.ret : mem.type) || '' }, kind: isM ? K.Method : K.Field, insertText: isM ? (names.length ? `${mem.name}(${names.map((n, i) => `\${${i + 1}:${n}}`).join(', ')})` : `${mem.name}()`) : mem.name, insertTextRules: R, range, filterText: mem.name, detail: `${(isM ? mem.ret : mem.type) || ''} — ${mem.owner || ''}`.trim(), sortText: `${mem.owner === 'Object' ? 9 : 0}${mem.name}` });
    }
    return { suggestions: out };
  }

  // identifiers: classes of the dependencies (with the import), keywords, snippets
  if (/^\s*(\/\/|\*|\/\*)/.test(lineText)) return { suggestions: [] };
  const prefix = word.word;
  const out = [];
  if (prefix.length >= 2 && /^[A-Z]/.test(prefix) && file && state.workspace) {
    const seen = new Set();
    for (const t of await classpathTypes(model, prefix, false)) {
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      out.push({ label: { label: t.name, description: t.fqn }, kind: kindOf(t.kind), insertText: t.name, range, detail: t.fqn, filterText: t.name, sortText: `2${String(t.name.length).padStart(3, '0')}${t.name}`, additionalTextEdits: ktImportEdit(parsed, t.fqn) });
    }
  }
  if (prefix.length >= 1) {
    for (const [k, body, desc] of KT_SNIPPETS) if (k.startsWith(prefix.toLowerCase())) out.push({ label: k, kind: K.Snippet, insertText: body, insertTextRules: R, range, detail: desc, sortText: `3${k}` });
    for (const k of KT_KEYWORDS) if (k.startsWith(prefix)) out.push({ label: k, kind: K.Keyword, insertText: k, range, sortText: `4${k}` });
  }
  return { suggestions: out };
}

function registerKotlinFeatures() {
  monaco.languages.registerCompletionItemProvider('kotlin', { triggerCharacters: ['.', '@'], provideCompletionItems: (model, position) => ktProvide(model, position) });
}

/** Test/diagnostic hook: the labels completion would offer at a position. */
async function kotlinCompletionLabels(model, position) {
  const r = await ktProvide(model, position);
  return r.suggestions.map((s) => (typeof s.label === 'string' ? s.label : s.label.label));
}
