/* Markdown renderer for the preview. Builds DOM nodes directly (never innerHTML), so nothing in a document can run script, and raw HTML in the
   Markdown is shown as text. Supports: headings, paragraphs, emphasis, strong, strikethrough, inline code, fenced code (syntax coloured),
   block quotes, ordered / unordered / nested / task lists, tables with alignment, horizontal rules, links (web, in-page and project files),
   reference links, autolinks, hard line breaks, escapes and images (pictures next to the file are shown; web pictures are not loaded).
   renderMarkdown(text, { dir, onOpen }) -> DocumentFragment */
'use strict';

const MD_LANG = { js: 'javascript', jsx: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', shell: 'shell', ps1: 'powershell', powershell: 'powershell', yml: 'yaml', yaml: 'yaml', cs: 'csharp', csharp: 'csharp', html: 'html', xml: 'xml', json: 'json', jsonc: 'json', java: 'java', kt: 'kotlin', kotlin: 'kotlin', go: 'go', rs: 'rust', rust: 'rust', sql: 'sql', css: 'css', scss: 'scss', md: 'markdown', markdown: 'markdown', dockerfile: 'dockerfile', docker: 'dockerfile', c: 'c', cpp: 'cpp', 'c++': 'cpp', rb: 'ruby', ruby: 'ruby', php: 'php', swift: 'swift', toml: 'ini', ini: 'ini', hcl: 'hcl', tf: 'hcl', diff: 'diff' };
const mdSlug = (s) => String(s).toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');

function renderMarkdown(text, opts = {}) {
  const refs = new Map();
  const slugs = new Map();
  const frag = document.createDocumentFragment();
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  // reference definitions:  [id]: url "title"
  const body = [];
  for (const l of lines) { const m = /^ {0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+["'(](.*)["')])?\s*$/.exec(l); if (m) refs.set(m[1].toLowerCase(), { url: m[2], title: m[3] || '' }); else body.push(l); }

  const A = (tag, props, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(props || {})) { if (k === 'class') el.className = v; else if (v != null && v !== false) el.setAttribute(k, v); } for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); return el; };

  /* ---- inline ---- */
  function inline(src) {
    const out = [];
    let buf = '';
    const flush = () => { if (buf) { out.push(document.createTextNode(buf)); buf = ''; } };
    let i = 0;
    const n = src.length;
    const find = (re, from) => { re.lastIndex = from; return re.exec(src); };
    while (i < n) {
      const c = src[i];
      if (c === '\\' && i + 1 < n && /[\\`*_{}[\]()#+\-.!|~<>]/.test(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
      if (c === '`') {
        const m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(src.slice(i));
        if (m) { flush(); out.push(A('code', { class: 'md-ic' }, m[2].replace(/^ (.*) $/, '$1'))); i += m[0].length; continue; }
      }
      if (c === '!' && src[i + 1] === '[') {
        const m = /^!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/.exec(src.slice(i));
        if (m) { flush(); out.push(image(m[1], m[2], m[3])); i += m[0].length; continue; }
      }
      if (c === '[') {
        const m = /^\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)")?\s*\)/.exec(src.slice(i));
        if (m) { flush(); out.push(link(m[1], m[2], m[3])); i += m[0].length; continue; }
        const r = /^\[((?:[^\[\]]|\[[^\]]*\])*)\](?:\[([^\]]*)\])?/.exec(src.slice(i));
        if (r) { const ref = refs.get((r[2] || r[1]).toLowerCase()); if (ref) { flush(); out.push(link(r[1], ref.url, ref.title)); i += r[0].length; continue; } }
      }
      if (c === '<') {
        const m = /^<(https?:\/\/[^>\s]+)>/.exec(src.slice(i));
        if (m) { flush(); out.push(link(m[1], m[1], undefined, true)); i += m[0].length; continue; }
      }
      if (c === 'h' && /^https?:\/\//.test(src.slice(i, i + 8)) && (i === 0 || /[\s(]/.test(src[i - 1]))) {
        const m = /^https?:\/\/[^\s<>)\]]+[^\s<>)\].,;:!?'"]/.exec(src.slice(i));
        if (m) { flush(); out.push(link(m[0], m[0], undefined, true)); i += m[0].length; continue; }
      }
      if ((c === '*' || c === '_') && src[i + 1] === c) {
        const m = find(new RegExp(`\\${c}\\${c}(?=\\S)([\\s\\S]*?\\S)\\${c}\\${c}`, 'y'), i);
        if (m) { flush(); out.push(A('strong', {}, inline(m[1]))); i += m[0].length; continue; }
      }
      if (c === '*' || (c === '_' && (i === 0 || /\W/.test(src[i - 1])))) {
        const m = find(new RegExp(`\\${c}(?=\\S)([\\s\\S]*?\\S)\\${c}${c === '_' ? '(?=\\W|$)' : ''}`, 'y'), i);
        if (m && !/^\s/.test(m[1])) { flush(); out.push(A('em', {}, inline(m[1]))); i += m[0].length; continue; }
      }
      if (c === '~' && src[i + 1] === '~') {
        const m = find(/~~(?=\S)([\s\S]*?\S)~~/y, i);
        if (m) { flush(); out.push(A('del', {}, inline(m[1]))); i += m[0].length; continue; }
      }
      if (c === '\n') { flush(); out.push(A('br')); i++; continue; }
      buf += c; i++;
    }
    flush();
    return out;
  }

  function link(label, url, title, plain) {
    const kids = plain ? [document.createTextNode(label)] : inline(label); // an autolink shows its own text (rendering it again would find the same URL, forever)
    const a = A('a', { class: 'md-a', title: title || url });
    a.append(...(kids.length ? kids : [document.createTextNode(url)]));
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (/^https:\/\//i.test(url)) return inv('shell:openExternal', url).catch((er) => status(er.message, true));
      if (/^http:\/\//i.test(url)) return status('Only https links open from here.', true);
      if (url.startsWith('#')) { const host = a.closest('.md-body'); const target = host && host.querySelector(`[id="${CSS.escape(decodeURIComponent(url.slice(1)).toLowerCase())}"]`); if (target) target.scrollIntoView({ block: 'start' }); return; }
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return status(`${url.split(':')[0]}: links are not opened from the preview.`);
      if (opts.dir && opts.onOpen) opts.onOpen(url.split('#')[0]);
    });
    return a;
  }

  function image(alt, url, title) {
    const holder = A('span', { class: 'md-img', title: title || alt });
    if (/^data:image\//i.test(url)) { holder.append(A('img', { src: url, alt })); return holder; }
    if (/^https?:\/\//i.test(url) || !opts.dir) { // web pictures are not fetched (privacy); show what they are
      const a = link(`🖼 ${alt || 'image'}`, url.startsWith('http') ? url : '#', title);
      a.title = `${url}\n(web pictures are not loaded in the preview)`;
      holder.append(a); return holder;
    }
    holder.append(document.createTextNode(`🖼 ${alt || url}`));
    const file = joinPath(opts.dir, decodeURIComponent(url.split('#')[0].split('?')[0]).split('/').join(BS));
    tryInv('fs:readDataUrl', file).then((r) => { if (r.ok) holder.replaceChildren(A('img', { src: r.data, alt })); else holder.title = r.error; });
    return holder;
  }

  /* ---- blocks ---- */
  const isBlank = (l) => !l.trim();
  const indentOf = (l) => /^ */.exec(l)[0].length;
  const LIST = /^( *)([-*+]|\d{1,9}[.)])( +|$)/;

  function blocks(ls) {
    const out = [];
    let i = 0;
    while (i < ls.length) {
      const line = ls[i];
      if (isBlank(line)) { i++; continue; }
      let m;
      // fenced code
      if ((m = /^( {0,3})(`{3,}|~{3,})\s*([\w+#.-]*)[^\n]*$/.exec(line))) {
        const fence = m[2]; const lang = m[3].toLowerCase(); const code = [];
        i++;
        while (i < ls.length && !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(ls[i])) { code.push(ls[i].slice(Math.min(indentOf(ls[i]), m[1].length))); i++; }
        i++;
        out.push(codeBlock(code.join('\n'), lang));
        continue;
      }
      // heading
      if ((m = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line))) { out.push(heading(m[1].length, m[2])); i++; continue; }
      // hr
      if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) { out.push(A('hr')); i++; continue; }
      // blockquote
      if (/^ {0,3}>/.test(line)) {
        const q = [];
        while (i < ls.length && (/^ {0,3}>/.test(ls[i]) || (!isBlank(ls[i]) && q.length && !/^ {0,3}(#|```|~~~)/.test(ls[i])))) { q.push(ls[i].replace(/^ {0,3}> ?/, '')); i++; }
        const bq = A('blockquote'); bq.append(...blocks(q)); out.push(bq);
        continue;
      }
      // table
      if (line.includes('|') && i + 1 < ls.length && /^ *\|? *:?-{1,}:? *(\| *:?-{1,}:? *)*\|? *$/.test(ls[i + 1]) && ls[i + 1].includes('-')) {
        const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
        const head = cells(line);
        const align = cells(ls[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : ''));
        i += 2;
        const rows = [];
        while (i < ls.length && !isBlank(ls[i]) && ls[i].includes('|')) { rows.push(cells(ls[i])); i++; }
        const t = A('table', { class: 'md-table' }, A('thead', {}, A('tr', {}, ...head.map((c, k) => A('th', { style: align[k] ? `text-align:${align[k]}` : null }, inline(c))))),
          A('tbody', {}, ...rows.map((r) => A('tr', {}, ...head.map((_h, k) => A('td', { style: align[k] ? `text-align:${align[k]}` : null }, inline(r[k] || '')))))));
        out.push(A('div', { class: 'md-tablewrap' }, t));
        continue;
      }
      // list
      if ((m = LIST.exec(line))) { const r = list(ls, i); out.push(r.el); i = r.next; continue; }
      // indented code
      if (/^ {4}\S/.test(line)) { const code = []; while (i < ls.length && (/^ {4}/.test(ls[i]) || isBlank(ls[i]))) { code.push(ls[i].slice(4)); i++; } out.push(codeBlock(code.join('\n').replace(/\n+$/, ''), '')); continue; }
      // paragraph (with setext headings)
      const para = [line];
      i++;
      while (i < ls.length && !isBlank(ls[i]) && !/^ {0,3}(#{1,6}\s|>|`{3,}|~{3,}|([-*_])( *\2){2,} *$)/.test(ls[i]) && !LIST.test(ls[i]) && !(ls[i].includes('|') && i + 1 < ls.length && /^ *\|? *:?-+:? *\|/.test(ls[i + 1] || ''))) {
        if (/^ {0,3}(=+|-+) *$/.test(ls[i])) { const lvl = ls[i].trim()[0] === '=' ? 1 : 2; i++; out.push(heading(lvl, para.join(' '))); para.length = 0; break; }
        para.push(ls[i]); i++;
      }
      if (para.length) {
        const hard = para.map((l, k) => (k < para.length - 1 ? (/( {2,}|\\)$/.test(l) ? `${l.replace(/( {2,}|\\)$/, '')}\n` : `${l.trim()} `) : l.trim())).join('');
        out.push(A('p', {}, inline(hard)));
      }
    }
    return out;
  }

  function heading(level, text) {
    const base = mdSlug(text.replace(/[`*_~[\]]/g, '')) || 'section';
    const k = slugs.get(base) || 0;
    slugs.set(base, k + 1);
    const h_ = A(`h${level}`, { id: k ? `${base}-${k}` : base, class: 'md-h' }, inline(text));
    return h_;
  }

  function codeBlock(code, lang) {
    const lg = MD_LANG[lang] || '';
    const pre = A('pre', { class: 'md-pre' });
    const c = A('code', {}, code);
    pre.append(c);
    if (lang) pre.append(A('span', { class: 'md-lang', text: lang }));
    pre.append(A('button', { class: 'md-copy', title: 'Copy', text: '⧉', onclick: () => navigator.clipboard.writeText(code).then(() => status('Code copied.')).catch(() => {}) }));
    if (lg && typeof monaco !== 'undefined' && monaco) setTimeout(() => { try { monaco.editor.colorizeElement(c, { theme: 'cns-dark', mimeType: lg, tabSize: 4 }); } catch { /* plain text stays */ } }, 0);
    return pre;
  }

  function list(ls, start) {
    const first = LIST.exec(ls[start]);
    const ordered = /\d/.test(first[2]);
    const baseIndent = first[1].length;
    const items = [];
    let i = start;
    while (i < ls.length) {
      const line = ls[i];
      const m = LIST.exec(line);
      if (isBlank(line)) { // a blank line stays inside the list only when the next line still belongs to it
        const nx = ls[i + 1];
        const nm = nx === undefined ? null : LIST.exec(nx);
        const belongs = nx !== undefined && !isBlank(nx) && (nm ? (nm[1].length > baseIndent || (nm[1].length === baseIndent && /\d/.test(nm[2]) === ordered)) : indentOf(nx) > baseIndent);
        if (!belongs) break;
        if (items.length) items[items.length - 1].push('');
        i++; continue;
      }
      if (m) {
        if (m[1].length > baseIndent && items.length) { items[items.length - 1].push(line); i++; continue; } // nested list
        if (m[1].length < baseIndent || (m[1].length === baseIndent && /\d/.test(m[2]) !== ordered)) break;
        items.push([line]); i++; continue;
      }
      if (items.length && indentOf(line) > baseIndent) { items[items.length - 1].push(line); i++; continue; } // wrapped / indented text
      if (items.length && !/^ {0,3}(#{1,6}\s|>|`{3,}|~{3,}|([-*_])( *){2,} *$)/.test(line) && !isBlank(ls[i - 1])) { items[items.length - 1].push(line); i++; continue; } // lazy continuation
      break;
    }
    const el = A(ordered ? 'ol' : 'ul', { class: 'md-list' });
    if (ordered && Number(/\d+/.exec(first[2])[0]) !== 1) el.setAttribute('start', /\d+/.exec(first[2])[0]);
    for (const item of items) {
      const mm = LIST.exec(item[0]);
      const contentIndent = mm[0].length;
      const inner = [item[0].slice(contentIndent), ...item.slice(1).map((l) => l.slice(Math.min(indentOf(l), contentIndent)))];
      const task = /^\[([ xX])\]\s+/.exec(inner[0]);
      if (task) inner[0] = inner[0].slice(task[0].length);
      const li = A('li', task ? { class: 'md-task' } : {});
      if (task) li.append(A('input', { type: 'checkbox', disabled: true, checked: task[1] !== ' ' ? '' : null }));
      const kids = blocks(inner);
      if (kids.length === 1 && kids[0].tagName === 'P') li.append(...kids[0].childNodes); else li.append(...kids);
      el.append(li);
    }
    return { el, next: i };
  }

  const root = A('div', { class: 'md-body' });
  root.append(...blocks(body));
  frag.append(root);
  return frag;
}
