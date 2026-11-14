/* Code advisor: runs the rules from advisor-java.js / advisor-web.js on the open file and shows the results in the editor.
   - Orange: SOLID problems, marked on the class (tinted line, wavy name, orange margin triangle, hover text).
   - Blue dotted underline + lightbulb: "there is a more modern way" (old-style code). Hover shows OLD and MODERN sample code.
   - Purple dotted underline: Lombok can generate this boilerplate.
   - A small pop-up appears when you just typed old-style code. Lightbulb (Ctrl+.) offers "Show modern way" and, for safe cases, "Apply".
   - SUGGESTIONS tab lists everything for the open file, or for the whole project after "Analyze project".  */
'use strict';

const ADV = { byModel: new Map(), prevKeys: new Map(), timer: null, toastTimer: null, toasted: new Set(), lombok: null, modules: null, project: null, running: false, cmds: false };
const advCfg = () => state.settings.advisor || {};
const advOn = () => advCfg().enabled !== false;
const advToastsOn = () => advCfg().toasts !== false;
const ADV_LANGS = { java: 'java', javascript: 'javascript', typescript: 'typescript', python: 'python' };
const ADV_KIND = { solid: { icon: '🟧', label: 'SOLID' }, tip: { icon: '💡', label: 'Modern way' }, lombok: { icon: '🧩', label: 'Lombok' } };
const NLA = String.fromCharCode(10);

/* ------------------------------ analysis ------------------------------ */

/** Blanks comments and string contents (same length, same line breaks) so regular expressions only see code. */
function blankCode(text, lang) {
  if (lang === 'java') return JavaParse.blank(text);
  const out = text.split('');
  const n = text.length;
  const py = lang === 'python';
  const wipe = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== NLA && out[k] !== String.fromCharCode(13)) out[k] = ' '; };
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (!py && c === '/' && d === '/') { let j = i; while (j < n && text[j] !== NLA) j++; wipe(i, j); i = j; }
    else if (!py && c === '/' && d === '*') { let j = text.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; wipe(i, j); i = j; }
    else if (py && c === '#') { let j = i; while (j < n && text[j] !== NLA) j++; wipe(i, j); i = j; }
    else if (c === '"' || c === "'" || (!py && c === '`')) {
      if (py && text.startsWith(c.repeat(3), i)) { let j = text.indexOf(c.repeat(3), i + 3); j = j < 0 ? n : j + 3; wipe(i + 3, Math.max(i + 3, j - 3)); i = j; continue; }
      let j = i + 1;
      while (j < n && text[j] !== c && (c === '`' || text[j] !== NLA)) { if (text[j] === BS) j++; j++; }
      wipe(i + 1, j);
      i = j + 1;
    } else i++;
  }
  return out.join('');
}

function javaLevelFor(file) {
  const mods = ADV.modules;
  if (!mods || !file) return 17;
  const f = normPath(file);
  let best = null;
  for (const m of mods) { const r = normPath(m.root); if ((f === r || f.startsWith(r + BS)) && (!best || r.length > normPath(best.root).length)) best = m; }
  return (best && best.release) || 17;
}

function makeCtx(text, lang, file) {
  const clean = blankCode(text, lang);
  const lines = text.split(NLA);
  const cleanLines = clean.split(NLA);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === NLA) lineStarts.push(i + 1);
  const ctx = {
    text, clean, lines, cleanLines, lineStarts, lang, file, level: lang === 'java' ? javaLevelFor(file) : 99,
    lineOf(off) { let lo = 0; let hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; } return lo + 1; },
    lineText(off) { return cleanLines[ctx.lineOf(off) - 1] || ''; },
    matchBrace(open) { let d = 0; for (let i = open; i < clean.length; i++) { if (clean[i] === '{') d++; else if (clean[i] === '}') { d--; if (d === 0) return i; } } return clean.length - 1; },
  };
  if (lang === 'java') { ctx.parsed = JavaParse.parse(text); ctx.lombok = ADV.lombok === true || /\bimport\s+lombok\./.test(text); }
  return ctx;
}

const resolveSample = (v, ctx, hit) => (typeof v === 'function' ? v(ctx, hit) : v || '');

/** Runs every rule of the language over `text`. Returns findings sorted by line. */
function analyzeText(text, lang, file) {
  if (!ADV_LANGS[lang] || text.length > 400000) return [];
  const ctx = makeCtx(text, lang, file);
  const ignore = new Set(advCfg().ignore || []);
  const out = [];
  const seen = new Set();
  for (const r of ADV_RULES) {
    if (r.langs ? !r.langs.includes(lang) : lang !== 'java') continue;
    if (ignore.has(r.id)) continue;
    if (r.kind === 'solid' && advCfg().solid === false) continue;
    if (r.since && lang === 'java' && r.since > ctx.level) continue;
    let hits = [];
    try {
      if (r.detect) hits = r.detect(ctx) || [];
      else {
        const re = new RegExp(r.rx.source, r.rx.flags.includes('g') ? r.rx.flags : `${r.rx.flags}g`);
        const src = r.raw ? text : ctx.clean;
        let m;
        let guard = 0;
        while ((m = re.exec(src)) && guard++ < 400) {
          if (!m[0].length) { re.lastIndex++; continue; }
          if (r.when && !r.when(ctx, m)) continue;
          let groups = m;
          if (r.fix && !r.raw) { // the fix must be built from the real text, not the comment-free copy (string contents are blanked there)
            const o = new RegExp(r.rx.source, r.rx.flags.replace('g', '')).exec(text.slice(m.index, m.index + m[0].length));
            if (o && o[0].length === m[0].length) groups = o;
          }
          hits.push({ index: m.index, length: m[0].length, m: groups });
        }
      }
    } catch (e) { console.warn(`advisor rule ${r.id}:`, e); continue; }
    for (const hit of hits.slice(0, 40)) {
      const line = hit.line || ctx.lineOf(hit.index || 0);
      const key = `${r.id}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const startIdx = hit.index != null ? hit.index : ctx.lineStarts[line - 1];
      const lineStart = ctx.lineStarts[line - 1];
      let col = startIdx - lineStart + 1;
      let endCol = Math.min((ctx.lines[line - 1] || '').replace(/\r$/, '').length + 1, col + Math.max(1, hit.length || 1));
      if (r.kind === 'solid' && hit.extra && hit.extra.t) { // mark the class name
        const nm = (ctx.lines[line - 1] || '').indexOf(hit.extra.t.name);
        if (nm >= 0) { col = nm + 1; endCol = nm + 1 + hit.extra.t.name.length; }
      } else if (hit.index == null) { col = ((/^\s*/.exec(ctx.lines[line - 1] || '') || [''])[0].length) + 1; endCol = (ctx.lines[line - 1] || '').replace(/\r$/, '').length + 1; }
      let fix = null;
      try { fix = r.fix ? r.fix(ctx, hit) : null; } catch { fix = null; }
      if (fix) fix.old = text.slice(fix.start, fix.end); // so a stale fix is never applied to text that has changed
      out.push({
        id: r.id, kind: r.kind, cat: r.cat, title: r.title, why: r.why, since: r.since || 0, file, lang,
        line, col, endCol: Math.max(endCol, col + 1), snippet: (ctx.lines[line - 1] || '').trim().slice(0, 70),
        detail: r.message ? r.message(hit, ctx) : '', before: resolveSample(r.before, ctx, hit), after: resolveSample(r.after, ctx, hit),
        fix, lombokFix: r.lombokFix || '', typeName: hit.extra && hit.extra.t ? hit.extra.t.name : '',
      });
      if (out.length > 300) break;
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/* ------------------------------ showing it in the editor ------------------------------ */

const mdEsc = (s) => String(s).replace(/[\\`*_{}[\]<>#|]/g, (c) => BS + c);

function hoverFor(f) {
  const arg = encodeURIComponent(JSON.stringify([f.id, f.line]));
  const k = ADV_KIND[f.kind] || ADV_KIND.tip;
  const links = [`[Show side by side](command:cns.advisor.show?${arg})`];
  if (f.fix || f.lombokFix) links.push(`[Apply](command:cns.advisor.apply?${arg})`);
  links.push(`[Don't suggest this](command:cns.advisor.ignore?${arg})`);
  const lang = f.lang === 'python' ? 'python' : f.lang === 'java' ? 'java' : 'javascript';
  const fence = (c) => '```' + lang + NLA + c + NLA + '```';
  const head = f.kind === 'solid' ? `**${k.icon} ${mdEsc(f.cat)}** — ${mdEsc(f.title)}` : `**${k.icon} ${mdEsc(f.title)}**  ·  ${mdEsc(f.cat)}${f.since ? `  ·  Java ${f.since}+` : ''}`;
  const text = [head, f.detail ? `*${mdEsc(f.detail)}*` : '', mdEsc(f.why), f.before ? `**Old way**${NLA}${fence(f.before)}` : '', f.after ? `**Modern way**${NLA}${fence(f.after)}` : '', links.join('  ·  ')].filter(Boolean).join(NLA + NLA);
  return { value: text, isTrusted: true, supportHtml: false };
}

function advDecorations(model, finds) {
  const out = [];
  for (const f of finds) {
    const line = Math.min(f.line, model.getLineCount());
    const maxc = model.getLineMaxColumn(line);
    const range = new monaco.Range(line, Math.min(f.col, maxc), line, Math.min(Math.max(f.endCol, f.col + 1), maxc));
    const hover = hoverFor(f);
    if (f.kind === 'solid') {
      out.push({ range: new monaco.Range(line, 1, line, maxc), options: { isWholeLine: true, className: 'cns-solid-line', glyphMarginClassName: 'cns-glyph-solid', glyphMarginHoverMessage: hover, overviewRuler: { color: '#ff9800', position: monaco.editor.OverviewRulerLane.Right } } });
      out.push({ range, options: { inlineClassName: 'cns-solid-name', hoverMessage: hover } });
    } else {
      out.push({ range, options: { inlineClassName: f.kind === 'lombok' ? 'cns-lombok-ul' : 'cns-tip-ul', glyphMarginClassName: f.kind === 'lombok' ? 'cns-glyph-lombok' : 'cns-glyph-tip', glyphMarginHoverMessage: hover, hoverMessage: hover, overviewRuler: { color: f.kind === 'lombok' ? '#b39ddb' : '#4fc3f7', position: monaco.editor.OverviewRulerLane.Left } } });
    }
  }
  return out;
}

function advLangOf(model) { return ADV_LANGS[model.getLanguageId()] || null; }

function advRunOn(tab, { quiet } = {}) {
  if (!advOn() || !tab || tab.kind !== 'file' || !monaco || tab.model.isDisposed()) return;
  const lang = advLangOf(tab.model);
  if (!lang) { tab.advDecos = tab.model.deltaDecorations(tab.advDecos || [], []); ADV.byModel.delete(tab.model.id); renderAdvice(); return; }
  const finds = analyzeText(tab.model.getValue(), lang, tab.path);
  ADV.byModel.set(tab.model.id, finds);
  tab.advDecos = tab.model.deltaDecorations(tab.advDecos || [], advDecorations(tab.model, finds));
  // pop-up for code that was just typed in the old style (not for what was already there when the file was opened)
  const keys = new Set(finds.map((f) => `${f.id}|${f.snippet}`));
  const prev = ADV.prevKeys.get(tab.model.id);
  ADV.prevKeys.set(tab.model.id, keys);
  if (prev && !quiet && advToastsOn() && state.active === tab) {
    const fresh = finds.filter((f) => !prev.has(`${f.id}|${f.snippet}`) && !ADV.toasted.has(`${tab.model.id}|${f.id}`));
    const pick = fresh.find((f) => f.kind === 'solid') || fresh.find((f) => f.kind === 'tip') || fresh[0];
    if (pick) { ADV.toasted.add(`${tab.model.id}|${pick.id}`); advToast(pick); }
  }
  renderAdvice();
}

function advSchedule(ms) {
  clearTimeout(ADV.timer);
  ADV.timer = setTimeout(() => { if (state.active && state.active.kind === 'file') advRunOn(state.active); }, ms);
}

function currentFindings() {
  const t = state.active;
  return t && t.kind === 'file' && !t.model.isDisposed() ? ADV.byModel.get(t.model.id) || [] : [];
}

function findingAt(id, line) { return currentFindings().find((f) => f.id === id && f.line === line) || currentFindings().find((f) => f.id === id); }

/* ------------------------------ pop-up toast ------------------------------ */

function advToast(f) {
  let el = $('adv-toast');
  if (!el) { el = h('div', { id: 'adv-toast' }); document.body.append(el); }
  const k = ADV_KIND[f.kind] || ADV_KIND.tip;
  el.className = `adv-toast ${f.kind}`;
  el.replaceChildren(
    h('div', { class: 'at-head' }, h('span', { text: `${k.icon} ${f.kind === 'solid' ? `${f.cat} warning` : 'A more modern way exists'}` }), h('button', { class: 'subtle', text: '✕', title: 'Dismiss', onclick: () => el.classList.add('hidden') })),
    h('div', { class: 'at-title', text: f.title }),
    h('div', { class: 'at-actions' }, h('button', { class: 'primary', text: 'Show me', onclick: () => { el.classList.add('hidden'); advShow(f); } }),
      f.fix || f.lombokFix ? h('button', { text: 'Apply', onclick: () => { el.classList.add('hidden'); advApply(f); } }) : null,
      h('button', { text: 'Not now', onclick: () => el.classList.add('hidden') })));
  el.classList.remove('hidden');
  clearTimeout(ADV.toastTimer);
  ADV.toastTimer = setTimeout(() => el.classList.add('hidden'), 14000);
}

/* ------------------------------ side-by-side pop-up ------------------------------ */

async function colorBlock(code, lang) {
  const pre = h('pre', { class: 'adv-code', text: code });
  try { await monaco.editor.colorizeElement(pre, { theme: 'cns-dark', mimeType: lang, tabSize: 4 }); } catch { pre.textContent = code; } // Monaco colours the text it was given
  return pre;
}

async function advShow(f) {
  const k = ADV_KIND[f.kind] || ADV_KIND.tip;
  const lang = f.lang;
  const body = h('div', { class: 'adv' },
    h('div', { class: 'adv-cat', text: `${k.icon} ${f.cat}${f.since ? `  ·  needs Java ${f.since}+` : ''}` }),
    f.detail ? h('p', { class: 'adv-detail', text: f.detail }) : null,
    h('p', { text: f.why }),
    h('div', { class: 'adv-cols' },
      h('div', {}, h('div', { class: 'adv-lbl old', text: 'Old way' }), await colorBlock(f.before, lang)),
      h('div', {}, h('div', { class: 'adv-lbl new', text: 'Modern way' }), await colorBlock(f.after, lang))));
  const close = modal(f.title, body, [
    f.fix || f.lombokFix ? h('button', { class: 'primary', text: f.lombokFix ? 'Apply (Lombok)' : 'Apply to my code', onclick: () => { close(); advApply(f); } }) : null,
    h('button', { text: 'Go to code', onclick: () => { close(); if (editor) { editor.revealLineInCenter(f.line); editor.setPosition({ lineNumber: f.line, column: f.col }); editor.focus(); } } }),
    h('button', { text: 'Don’t suggest this again', onclick: () => { close(); advIgnore(f); } }),
    h('button', { text: 'Close', onclick: () => close() }),
  ], { wide: true });
}

async function advIgnore(f) {
  const list = [...new Set([...(advCfg().ignore || []), f.id])];
  state.settings.advisor = { ...advCfg(), ignore: list };
  await tryInv('settings:set', 'advisor.ignore', list);
  status('That suggestion is switched off. Re-enable all of them in Settings > General.');
  advSchedule(50);
}

/* ------------------------------ applying fixes ------------------------------ */

function advApply(f) {
  const t = state.active;
  if (!t || t.kind !== 'file' || !editor) return;
  if (f.lombokFix) return lombokRefactor(f);
  if (!f.fix) return status('This one has no automatic fix: copy the modern sample from the pop-up.');
  const m = t.model;
  const s = m.getPositionAt(f.fix.start);
  const e = m.getPositionAt(f.fix.end);
  const range = new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column);
  if (m.getValueInRange(range) !== f.fix.old) { advRunOn(t, { quiet: true }); return status('The code changed since this suggestion was made; it has been refreshed. Try again.'); }
  editor.executeEdits('advisor', [{ range, text: f.fix.text }]);
  editor.focus();
  status('Applied. Press Ctrl+Z to undo.');
  advRunOn(t, { quiet: true }); // refresh the suggestions straight away
}

/* ------------------------------ Lombok ------------------------------ */

async function detectLombok() {
  ADV.lombok = false;
  if (!state.workspace) return false;
  const dirs = new Set([state.workspace, ...run.projects.map((p) => p.dir)]);
  for (const d of dirs) {
    for (const f of ['pom.xml', 'build.gradle', 'build.gradle.kts']) {
      const txt = await tryInv('fs:readFile', joinPath(d, f));
      if (txt.ok && /lombok/i.test(txt.data)) { ADV.lombok = true; return true; }
    }
  }
  return false;
}

const LOMBOK_VERSION = '1.18.38';

/** Pure text edit: adds Lombok to a pom.xml ('maven'), build.gradle ('gradle') or build.gradle.kts ('kts'). */
function lombokDepEdit(src, kind) {
  let text = src;
  if (kind === 'maven') {
    const boot = /spring-boot-starter-parent|spring-boot-dependencies/.test(text);
    const dep = `${NLA}    <dependency>${NLA}      <groupId>org.projectlombok</groupId>${NLA}      <artifactId>lombok</artifactId>${boot ? '' : `${NLA}      <version>${LOMBOK_VERSION}</version>`}${NLA}      <scope>provided</scope>${NLA}    </dependency>${NLA}  `;
    const mgmtEnd = text.indexOf('</dependencyManagement>');
    const close = text.indexOf('</dependencies>', mgmtEnd >= 0 ? mgmtEnd : 0);
    if (close >= 0) text = text.slice(0, close).replace(/\s*$/, '') + dep.replace(/\s*$/, '') + `${NLA}  ` + text.slice(close);
    else text = text.replace('</project>', `  <dependencies>${dep}</dependencies>${NLA}</project>`);
  } else {
    const q = kind === 'kts' ? (s) => `("${s}")` : (s) => ` '${s}'`;
    const lines = `    compileOnly${q(`org.projectlombok:lombok:${LOMBOK_VERSION}`)}${NLA}    annotationProcessor${q(`org.projectlombok:lombok:${LOMBOK_VERSION}`)}${NLA}`;
    const m = /dependencies\s*\{\s*\n/.exec(text);
    text = m ? text.slice(0, m.index + m[0].length) + lines + text.slice(m.index + m[0].length) : `${text}${NLA}dependencies {${NLA}${lines}}${NLA}`;
  }
  return text;
}

/** Adds Lombok to the nearest pom.xml / build.gradle above the open file. */
async function addLombokDependency() {
  const t = state.active;
  let dir = t && t.kind === 'file' ? dirName(t.path) : state.workspace;
  let file = '';
  let kind = '';
  for (let i = 0; i < 12 && dir; i++) {
    for (const [n, k] of [['pom.xml', 'maven'], ['build.gradle', 'gradle'], ['build.gradle.kts', 'kts']]) if (await inv('fs:exists', joinPath(dir, n)).catch(() => false)) { file = joinPath(dir, n); kind = k; break; }
    if (file || !state.workspace || normPath(dir) === normPath(state.workspace)) break;
    dir = dirName(dir);
  }
  if (!file) return status('No pom.xml or build.gradle found above this file.', true);
  if (!(await confirmBox(`Add Lombok to ${baseName(file)}?`, `Adds org.projectlombok:lombok ${LOMBOK_VERSION} (compile-time only) to ${file}. Lombok generates getters, builders and loggers while compiling; nothing ships at run time.`))) return;
  const text = await inv('fs:readFile', file);
  if (/lombok/i.test(text)) return status('Lombok is already in that file.');
  const next = lombokDepEdit(text, kind);
  await inv('fs:writeFile', file, next);
  ADV.lombok = true;
  status(`Lombok added to ${baseName(file)}. The IDE resolves the dependency on the next check.`);
  advSchedule(100);
  scheduleJavaCheck(1500);
}

/** Replaces hand-written boilerplate by Lombok annotations (whole-file rewrite, one undo step). */
async function lombokRefactor(f) {
  const t = state.active;
  if (!t || !editor) return;
  if (!ADV.lombok && !/\bimport\s+lombok\./.test(t.model.getValue())) {
    if (!(await confirmBox('Lombok is not in this project yet', 'Add the Lombok dependency first? Then the annotation can be applied.'))) return;
    await addLombokDependency();
    if (!ADV.lombok) return;
  }
  const text = t.model.getValue();
  const ctx = makeCtx(text, 'java', t.path);
  const type = ctx.parsed.types.find((x) => x.name === f.typeName) || ctx.parsed.types.find((x) => x.line === f.line) || ctx.parsed.types[0];
  if (!type) return;
  const lines = text.split(NLA);
  const del = []; // [fromLine, toLine] 1-based inclusive
  const annos = [];
  const imports = [];
  const removeMethod = (b) => {
    let from = b.m.line;
    while (from > 1 && /^\s*(@\w+(\([^)]*\))?\s*)$/.test(lines[from - 2])) from--; // annotations above
    let to = ctx.lineOf(b.end);
    if (/^\s*$/.test(lines[to] || 'x')) to++; // one blank line after
    del.push([from, Math.min(to, lines.length)]);
  };
  if (f.lombokFix === 'accessors') {
    const { getters, setters } = accessorsOf(ctx, type);
    const every = type.fields.filter((x) => !(x.mods || []).includes('static'));
    const allGet = every.length && every.every((x) => getters.some((g) => g.f === x));
    const allSet = every.filter((x) => !(x.mods || []).includes('final')).every((x) => setters.some((g) => g.f === x));
    if (allGet && allSet && setters.length) { annos.push('@Data'); imports.push('lombok.Data'); }
    else { if (getters.length) { annos.push('@Getter'); imports.push('lombok.Getter'); } if (setters.length) { annos.push('@Setter'); imports.push('lombok.Setter'); } }
    for (const g of [...getters, ...setters]) removeMethod(g.b);
    if (annos[0] === '@Data') { // toString / equals / hashCode written by hand are generated by @Data too
      for (const b of methodBodies(ctx).filter((x) => x.t === type && ['toString', 'equals', 'hashCode'].includes(x.m.name))) removeMethod(b);
    }
  } else if (f.lombokFix === 'slf4j') {
    const fl = type.fields.find((x) => /^(Logger|Log)$/.test(x.type) && /LoggerFactory|Logger\.get|LogManager|LogFactory/.test(lines[x.line - 1]));
    if (!fl) return status('Could not find the logger field.', true);
    del.push([fl.line, fl.line + (/^\s*$/.test(lines[fl.line] || 'x') ? 1 : 0)]);
    annos.push('@Slf4j'); imports.push('lombok.extern.slf4j.Slf4j');
    if (fl.name !== 'log') { const re = new RegExp(`\\b${fl.name}\\b`, 'g'); for (let i = 0; i < lines.length; i++) if (i + 1 !== fl.line) lines[i] = lines[i].replace(re, 'log'); }
  }
  if (!annos.length) return status('Nothing to replace.');
  // build the new text
  const kill = new Set();
  for (const [a, b] of del) for (let i = a; i <= b; i++) kill.add(i);
  const indent = (/^\s*/.exec(lines[type.line - 1]) || [''])[0];
  const out = [];
  lines.forEach((ln, i) => {
    const n = i + 1;
    if (n === type.line) annos.forEach((a) => out.push(`${indent}${a}`));
    if (!kill.has(n)) out.push(ln);
  });
  let next = out.join(NLA);
  const p2 = JavaParse.parse(next);
  const add = imports.filter((imp) => !p2.imports.some((x) => x.name === imp));
  if (add.length) {
    const at = p2.lastImportLine ? p2.lastImportLine : p2.packageLine;
    const ls = next.split(NLA);
    ls.splice(at, 0, ...(p2.lastImportLine ? [] : ['']), ...add.map((i) => `import ${i};`));
    next = ls.join(NLA);
  }
  editor.executeEdits('lombok', [{ range: t.model.getFullModelRange(), text: next }]);
  status(`Replaced boilerplate with ${annos.join(' ')}. Ctrl+Z undoes it.`);
  advSchedule(200);
  scheduleJavaCheck(800, t.path);
}

/** Members Lombok generates for a class, so completion and navigation know them. */
function lombokMembers(t) {
  const a = new Set(t.annots || []);
  const out = [];
  const classGet = a.has('Data') || a.has('Getter') || a.has('Value');
  const classSet = a.has('Data') || a.has('Setter');
  for (const f of t.fields || []) {
    if ((f.mods || []).includes('static')) continue;
    const fa = new Set(f.annots || []);
    const C = cap1(f.name);
    if (classGet || fa.has('Getter')) out.push({ kind: 'method', name: (f.type === 'boolean' ? 'is' : 'get') + C, params: '', ret: f.fullType || f.type, mods: ['public'], owner: t.name, lombok: true });
    if ((classSet || fa.has('Setter')) && !(f.mods || []).includes('final') && !a.has('Value')) out.push({ kind: 'method', name: `set${C}`, params: `${f.fullType || f.type} ${f.name}`, ret: 'void', mods: ['public'], owner: t.name, lombok: true });
  }
  if (a.has('Builder')) out.push({ kind: 'method', name: 'builder', params: '', ret: `${t.name}Builder`, mods: ['public', 'static'], owner: t.name, lombok: true });
  if (a.has('Slf4j') || a.has('Log4j2') || a.has('Log') || a.has('CommonsLog')) out.push({ kind: 'field', name: 'log', type: 'Logger', mods: ['private', 'static', 'final'], owner: t.name, lombok: true });
  if (a.has('Data') || a.has('ToString')) out.push({ kind: 'method', name: 'toString', params: '', ret: 'String', mods: ['public'], owner: t.name, lombok: true });
  return out;
}

const LOMBOK_ANNOTATIONS = [
  ['Getter', 'lombok.Getter', 'generates getters'], ['Setter', 'lombok.Setter', 'generates setters'], ['Data', 'lombok.Data', 'getters, setters, equals, hashCode, toString, required-args constructor'],
  ['Value', 'lombok.Value', 'immutable class: final fields, getters, all-args constructor'], ['Builder', 'lombok.Builder', 'fluent builder'], ['NoArgsConstructor', 'lombok.NoArgsConstructor', 'empty constructor'],
  ['AllArgsConstructor', 'lombok.AllArgsConstructor', 'constructor with every field'], ['RequiredArgsConstructor', 'lombok.RequiredArgsConstructor', 'constructor for final / @NonNull fields'],
  ['Slf4j', 'lombok.extern.slf4j.Slf4j', 'adds a "log" field (SLF4J)'], ['ToString', 'lombok.ToString', 'generates toString()'], ['EqualsAndHashCode', 'lombok.EqualsAndHashCode', 'generates equals() and hashCode()'],
  ['NonNull', 'lombok.NonNull', 'null check on a parameter or field'], ['With', 'lombok.With', 'copy with one field changed'], ['SneakyThrows', 'lombok.SneakyThrows', 'throw checked exceptions without declaring them'],
  ['Cleanup', 'lombok.Cleanup', 'closes a resource automatically'], ['Singular', 'lombok.Singular', 'adds to a collection in a @Builder'], ['UtilityClass', 'lombok.experimental.UtilityClass', 'static-only helper class'],
  ['Accessors', 'lombok.experimental.Accessors', 'fluent / chained setters'],
];

function registerLombokCompletion() {
  monaco.languages.registerCompletionItemProvider('java', {
    triggerCharacters: ['@'],
    provideCompletionItems(model, pos) {
      const before = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1);
      const m = /@(\w*)$/.exec(before);
      if (!m || !(ADV.lombok || /\bimport\s+lombok\./.test(model.getValue()))) return { suggestions: [] };
      const parsed = parseModel(model);
      const range = new monaco.Range(pos.lineNumber, pos.column - m[1].length, pos.lineNumber, pos.column);
      return {
        suggestions: LOMBOK_ANNOTATIONS.map(([name, fqn, doc], i) => ({
          label: { label: name, description: 'Lombok' }, kind: monaco.languages.CompletionItemKind.Interface, insertText: name, range, detail: `${fqn} — ${doc}`, documentation: { value: `Lombok **@${name}**: ${doc}.` }, sortText: `0${String(i).padStart(2, '0')}`,
          additionalTextEdits: importEdit(model, fqn, parsed).map((e) => ({ range: new monaco.Range(e.range.startLineNumber, 1, e.range.startLineNumber, 1), text: e.text })),
        })),
      };
    },
  });
}

/* ------------------------------ lightbulb (Ctrl+.) ------------------------------ */

function registerAdvisorActions() {
  monaco.editor.registerCommand('cns.advisor.show', (_a, id, line) => { const f = findingAt(id, line); if (f) advShow(f); });
  monaco.editor.registerCommand('cns.advisor.apply', (_a, id, line) => { const f = findingAt(id, line); if (f) advApply(f); });
  monaco.editor.registerCommand('cns.advisor.ignore', (_a, id, line) => { const f = findingAt(id, line); if (f) advIgnore(f); });
  monaco.editor.registerCommand('cns.advisor.addLombok', () => addLombokDependency());
  monaco.languages.registerCodeActionProvider(['java', 'javascript', 'typescript', 'python'], {
    provideCodeActions(model, range) {
      const t = state.active;
      if (!advOn() || !t || t.kind !== 'file' || t.model !== model) return { actions: [], dispose() {} };
      const actions = [];
      for (const f of currentFindings().filter((x) => x.line >= range.startLineNumber && x.line <= range.endLineNumber)) {
        const k = ADV_KIND[f.kind] || ADV_KIND.tip;
        if (f.fix) {
          const s = model.getPositionAt(f.fix.start);
          const e = model.getPositionAt(f.fix.end);
          if (model.getValueInRange(new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column)) === f.fix.old) actions.push({ title: `${k.icon} Modernize: ${f.title}`, kind: 'quickfix', isPreferred: true, edit: { edits: [{ resource: model.uri, textEdit: { range: new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column), text: f.fix.text }, versionId: undefined }] } });
        }
        if (f.lombokFix) actions.push({ title: `${k.icon} Use Lombok: ${f.title}`, kind: 'refactor', command: { id: 'cns.advisor.apply', title: 'Apply', arguments: [f.id, f.line] } });
        actions.push({ title: `${k.icon} Show modern way: ${f.title}`, kind: 'refactor', command: { id: 'cns.advisor.show', title: 'Show', arguments: [f.id, f.line] } });
        if (f.kind === 'lombok' && !ADV.lombok) actions.push({ title: '🧩 Add Lombok dependency to this project', kind: 'refactor', command: { id: 'cns.advisor.addLombok', title: 'Add Lombok' } });
      }
      return { actions, dispose() {} };
    },
  });
}

/* ------------------------------ status bar + SUGGESTIONS tab ------------------------------ */

function renderAdvice() {
  const finds = currentFindings();
  const solid = finds.filter((f) => f.kind === 'solid').length;
  const other = finds.length - solid;
  const st = $('st-advice');
  if (st) { st.classList.toggle('hidden', !finds.length); st.replaceChildren(solid ? h('span', { class: 'ad-solid', text: `🟧 ${solid}` }) : '', other ? h('span', { text: ` 💡 ${other}` }) : ''); }
  const btn = document.querySelector('#panel-bar [data-panel="suggestions"]');
  const total = ADV.project ? [...ADV.project.values()].reduce((n, a) => n + a.length, 0) : finds.length;
  if (btn) btn.textContent = total ? `SUGGESTIONS (${total})` : 'SUGGESTIONS';
  const list = $('suggestions-list');
  if (!list) return;
  const rowsFor = (file, arr) => arr.map((f) => {
    const k = ADV_KIND[f.kind] || ADV_KIND.tip;
    return h('div', { class: `prob sug ${f.kind}`, title: f.detail || f.why, onclick: async () => { await openAt(file, f.line, f.col); advShow(f); } },
      h('span', { class: 'pico', text: k.icon }), h('span', { class: 'pfile', text: baseName(file) }), h('span', { class: 'pline', text: String(f.line) }), h('span', { class: 'pmsg', text: `${f.cat}: ${f.title}` }));
  });
  const head = h('div', { class: 'sug-bar' },
    h('button', { text: ADV.running ? 'Analyzing…' : 'Analyze whole project', disabled: ADV.running, onclick: () => advAnalyzeProject() }),
    ADV.project ? h('button', { text: 'Show open file only', onclick: () => { ADV.project = null; renderAdvice(); } }) : null,
    h('span', { class: 't-dim', text: ADV.project ? `Whole project: ${[...ADV.project.keys()].length} file(s) with suggestions.` : 'Open file. Orange = SOLID principle; 💡 = a more modern way; 🧩 = Lombok.' }));
  const cols = h('div', { class: 'prob head' }, h('span', { class: 'pico' }), h('span', { class: 'pfile', text: 'File' }), h('span', { class: 'pline', text: 'Line' }), h('span', { class: 'pmsg', text: 'Suggestion' }));
  let rows = [];
  if (ADV.project) for (const [file, arr] of [...ADV.project.entries()].sort((a, b) => b[1].filter((x) => x.kind === 'solid').length - a[1].filter((x) => x.kind === 'solid').length)) rows.push(...rowsFor(file, arr));
  else if (state.active && state.active.kind === 'file') rows = rowsFor(state.active.path, finds);
  list.replaceChildren(head, rows.length ? cols : h('div', { class: 'hint pad', text: advOn() ? 'No suggestions for this file. Nice.' : 'The code advisor is off (Settings > General).' }), ...rows);
}

async function advAnalyzeProject(folder) {
  if (!state.workspace || ADV.running) return;
  const under = typeof folder === 'string' && folder ? normPath(folder) : '';
  ADV.running = true;
  ADV.project = new Map();
  renderAdvice();
  try {
    const rel = await inv('search:listFiles', state.workspace);
    const files = rel.filter((r) => (!under || under === normPath(state.workspace) || normPath(joinPath(state.workspace, r.split('/').join(BS))).startsWith(under + BS)) && /\.(java|js|jsx|ts|tsx|mjs|py)$/i.test(r) && !/\.d\.ts$|\.min\.js$|(^|[\\/])(node_modules|dist|build|target|\.venv|venv)[\\/]/.test(r)).slice(0, 600);
    let n = 0;
    for (const r of files) {
      const full = joinPath(state.workspace, r.split('/').join(BS));
      const txt = await tryInv('fs:readFile', full);
      if (txt.ok) {
        const ext = (/\.(\w+)$/.exec(r) || [])[1].toLowerCase();
        const lang = ext === 'java' ? 'java' : ext === 'py' ? 'python' : /^tsx?$/.test(ext) ? 'typescript' : 'javascript';
        const finds = analyzeText(txt.data, lang, full);
        if (finds.length) ADV.project.set(full, finds);
      }
      if (++n % 25 === 0) { status(`Analyzing… ${n}/${files.length}`); renderAdvice(); await new Promise((res) => setTimeout(res, 0)); }
    }
    status(`Analysis finished: ${files.length} files.`);
  } catch (e) { status(e.message, true); } finally { ADV.running = false; renderAdvice(); showPanel('suggestions'); }
}

/* ------------------------------ setup ------------------------------ */

async function refreshModules() { const r = await tryInv('javac:modules', state.workspace); if (r.ok) ADV.modules = r.data; }

function setupAdvisor() {
  if (!monaco || !editor || ADV.cmds) return;
  ADV.cmds = true;
  registerAdvisorActions();
  registerLombokCompletion();
  editor.onDidChangeModelContent(() => advSchedule(1100));
  editor.onDidChangeModel(() => { renderAdvice(); advSchedule(150); });
  CNS.on('workspace-opened', () => { ADV.project = null; ADV.lombok = null; detectLombok(); refreshModules(); });
  CNS.command('advisor.show', () => { const f = currentFindings().find((x) => x.line === (editor ? editor.getPosition().lineNumber : 0)) || currentFindings()[0]; if (f) advShow(f); else status('No suggestion for this line.'); }, 'Advisor: Show Modern Alternative Here');
  CNS.command('advisor.analyzeProject', () => advAnalyzeProject(), 'Advisor: Analyze Whole Project (SOLID, modern Java, async)');
  CNS.command('advisor.panel', () => showPanel('suggestions'), 'View: Suggestions');
  CNS.command('advisor.toggle', async () => { const on = !advOn(); state.settings.advisor = { ...advCfg(), enabled: on }; await tryInv('settings:set', 'advisor.enabled', on); if (!on) { for (const t of state.tabs) if (t.kind === 'file') t.advDecos = t.model.deltaDecorations(t.advDecos || [], []); ADV.byModel.clear(); renderAdvice(); } else advSchedule(50); status(`Code advisor: ${on ? 'on' : 'off'}`); }, 'Advisor: Turn On / Off');
  CNS.command('advisor.resetIgnored', async () => { state.settings.advisor = { ...advCfg(), ignore: [] }; await tryInv('settings:set', 'advisor.ignore', []); advSchedule(50); status('All suggestions are enabled again.'); }, 'Advisor: Re-enable All Suggestions');
  CNS.command('lombok.add', addLombokDependency, 'Lombok: Add Dependency to Project');
  const A = (id, label, order, run, pre) => editor.addAction({ id, label, contextMenuGroupId: '9_cns', contextMenuOrder: order, precondition: pre, run });
  const J = "editorLangId == 'java'";
  A('cns.java.generate', 'Generate Code… (getters, setters, constructor)', 1, () => CNS.run('java.generate'), J);
  A('cns.java.override', 'Override Methods…', 2, () => CNS.run('java.override'), J);
  A('cns.java.imports', 'Organize Imports', 3, () => CNS.run('java.organizeImports'), J);
  A('cns.java.rename', 'Refactor: Rename This Class…', 4, () => renameClassOfActiveFile(), J);
  A('cns.adv.here', 'Show Modern Alternative / Advice', 5, () => CNS.run('advisor.show'), "editorLangId == 'java' || editorLangId == 'javascript' || editorLangId == 'typescript' || editorLangId == 'python'");
  $('st-advice').onclick = () => showPanel('suggestions');
  refreshModules();
  detectLombok();
}
