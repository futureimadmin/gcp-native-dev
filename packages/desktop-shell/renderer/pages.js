/* Pages that live in editor tabs: the in-IDE browser (local servers, your deployed apps) and the cloud resource explorer. */
'use strict';

/** Opens (or focuses) a page tab. build(el) fills the page element. */
function openPage({ id, title, icon, build, onClose, pad }) {
  const existing = state.tabs.find((t) => t.kind === 'page' && t.id === id);
  if (existing) { activate(existing); return existing; }
  const el = h('div', { class: `page hidden${pad ? ' pad' : ''}` });
  $('pages').append(el);
  const tab = { kind: 'page', id, title, icon, el, onClose };
  state.tabs.push(tab);
  try { build(el, tab); } catch (e) { el.append(h('div', { class: 't-err', text: e.message })); }
  activate(tab);
  return tab;
}

const LOCAL_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i;

/** In-IDE browser. Only https pages and localhost; cloud consoles are not opened here (their sign-in blocks embedded browsers). */
function openBrowser(url, title) {
  if (!/^https:\/\//i.test(url) && !LOCAL_URL.test(url)) return status('Only https:// and http://localhost addresses can open in the IDE browser.', true);
  return openPage({
    id: `web:${url}`, title: title || url.replace(/^https?:\/\//, '').slice(0, 28), icon: '🌐',
    build(el) {
      const wv = document.createElement('webview');
      wv.setAttribute('src', url);
      wv.setAttribute('partition', 'persist:cns-browser');
      const addr = h('input', { value: url, spellcheck: 'false' });
      const go = (u) => {
        if (/^https:\/\//i.test(u) || LOCAL_URL.test(u)) wv.loadURL(u).catch(() => {});
        else status('Only https:// and http://localhost addresses are allowed.', true);
      };
      addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(addr.value.trim()); });
      wv.addEventListener('did-navigate', (e) => { addr.value = e.url; });
      wv.addEventListener('did-navigate-in-page', (e) => { addr.value = e.url; });
      wv.addEventListener('did-fail-load', (e) => {
        if (e.errorCode !== -3 && e.isMainFrame) status(`Could not load ${e.validatedURL}: ${e.errorDescription}`, true);
      });
      el.append(h('div', { class: 'browser-bar' },
        h('button', { text: '◀', title: 'Back', onclick: () => wv.canGoBack() && wv.goBack() }),
        h('button', { text: '▶', title: 'Forward', onclick: () => wv.canGoForward() && wv.goForward() }),
        h('button', { text: '⟳', title: 'Reload', onclick: () => wv.reload() }),
        addr,
        h('button', { text: '↗ External', title: 'Open in your default browser', onclick: () => /^https:\/\//i.test(addr.value) ? inv('shell:openExternal', addr.value).catch((e) => status(e.message, true)) : status('Only https links open externally.', true) })), wv);
    },
  });
}

/* ------------------------------ cloud resource explorer ------------------------------ */

function openExplorer(cloudId, svc) {
  const cloud = cloudMeta(cloudId) || { name: cloudId };
  const scope = (state.cloudStatus[cloudId] || {}).scope || '';
  const key = svc.detail || svc.title;
  return openPage({
    id: `explorer:${cloudId}:${scope}:${key}`, title: svc.title, icon: '☁', pad: true,
    build(el) { buildExplorer(el, cloudId, cloud, scope, key, svc); },
  });
}

async function buildExplorer(el, cloudId, cloud, scope, key, svc) {
  const left = h('div', {});
  const right = h('div', { class: 'card' }, h('div', { class: 'hint', text: 'Select a resource to see its details.' }));
  const head = h('div', { class: 'cardh' }, h('h2', { text: svc.title, style: 'margin:0' }), h('span', { class: 'chip', text: `${cloud.short || cloud.name}${scope ? ` · ${scope}` : ''}` }), h('span', { class: 'spacer' }),
    h('button', { text: 'Refresh', onclick: () => load() }),
    svc.url ? h('button', { class: 'subtle', text: 'Open in cloud console ↗', title: 'Opens your browser; cloud consoles cannot sign in inside embedded windows', onclick: () => inv('shell:openExternal', svc.url).catch((e) => status(e.message, true)) }) : null);
  el.append(head, h('div', { class: 'split' }, left, right));

  const showItem = async (it, canLogs, row) => {
    el.querySelectorAll('tr.sel').forEach((r) => r.classList.remove('sel'));
    if (row) row.classList.add('sel');
    const body = h('pre', { class: 'plan', text: 'Loading…' });
    const logs = h('pre', { class: 'plan hidden', text: '' });
    right.replaceChildren(
      h('div', { class: 'cardh' }, h('b', { text: it.name }), it.status ? h('span', { class: `badge ${/ready|running|active|true|succe/i.test(it.status) ? 'ok' : /fail|error|not/i.test(it.status) ? 'bad' : ''}`, text: it.status }) : null),
      h('div', { class: 'row' },
        it.url && /^https:\/\//.test(it.url) ? h('button', { class: 'primary', text: 'Open app in IDE', onclick: () => openBrowser(it.url, it.name) }) : null,
        canLogs ? h('button', { text: 'Logs', onclick: async () => {
          logs.classList.remove('hidden'); logs.textContent = 'Loading logs…';
          const r = await tryInv('cloud:call', cloudId, 'resourceLogs', [scope, key, it]);
          logs.textContent = r.ok ? (r.data || '(no log entries)') : r.error;
        } }) : null,
        h('button', { text: 'Ask AI about this', onclick: () => askAI(`Explain the configuration of ${it.name} and suggest improvements (security, cost, reliability).`, [{ label: it.name, text: body.textContent }]) }),
        h('button', { class: 'subtle', text: 'Copy name', onclick: () => navigator.clipboard.writeText(it.name).then(() => status('Copied.')).catch(() => {}) })),
      key === 'storage' && cloudId === 'gcp' ? buildStoragePane(cloudId, scope, it.name) : null,
      key === 'storage' ? h('details', {}, h('summary', { text: 'Bucket configuration (YAML)' }), body) : body, logs);
    const r = await tryInv('cloud:call', cloudId, 'resourceInfo', [scope, key, it]);
    body.textContent = r.ok ? r.data : r.error;
    if (!r.ok) body.classList.add('t-err');
  };

  async function load() {
    left.replaceChildren(h('div', { class: 'empty', text: 'Loading…' }));
    const r = await tryInv('cloud:call', cloudId, 'resources', [scope, key]);
    if (!r.ok) return left.replaceChildren(h('div', { class: 'empty t-err', text: r.error }));
    if (!r.data || !r.data.supported) {
      return left.replaceChildren(h('div', { class: 'card' },
        h('p', { class: 'hint', text: `The IDE cannot list ${svc.title} resources yet. You can still work with them from the terminal (${cloud.short || cloud.name} CLI) or the AI assistant.` }),
        svc.url ? h('button', { text: 'Open in cloud console (browser)', onclick: () => inv('shell:openExternal', svc.url).catch((e) => status(e.message, true)) }) : null));
    }
    const items = r.data.items;
    if (!items.length) return left.replaceChildren(h('div', { class: 'empty', text: `No ${r.data.title.toLowerCase()} in this project.` }));
    const rows = items.map((it) => {
      const tr = h('tr', { class: 'row-hover', onclick: () => showItem(it, r.data.canLogs, tr) },
        h('td', {}, h('b', { text: it.name })), h('td', { text: it.region || '' }), h('td', {}, it.status ? h('span', { class: `badge ${/ready|running|active|true|succe/i.test(it.status) ? 'ok' : /fail|error|not/i.test(it.status) ? 'bad' : ''}`, text: it.status }) : ''));
      return tr;
    });
    left.replaceChildren(h('div', { class: 'hint', text: `${items.length} ${r.data.title.toLowerCase()}` }),
      h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', { text: 'Name' }), h('th', { text: 'Location' }), h('th', { text: 'Status' }))), h('tbody', {}, rows)));
  }
  load();
}

/* ------------------------------ Cloud Storage: browse a bucket (folders, files, text preview) ------------------------------ */

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

function buildStoragePane(cloudId, scope, bucket) {
  const crumbs = h('div', { class: 'row' });
  const list = h('div', { class: 'inv' });
  const detail = h('div', {});
  const box = h('div', { class: 'card' }, h('div', { class: 'cat', text: 'Contents' }), crumbs, list, detail);

  const drawCrumbs = (prefix) => {
    const parts = prefix.split('/').filter(Boolean);
    const kids = [h('button', { class: 'subtle', text: `gs://${bucket}`, onclick: () => go('') })];
    let acc = '';
    for (const p of parts) { acc += `${p}/`; const target = acc; kids.push(h('span', { class: 't-dim', text: '/' }), h('button', { class: 'subtle', text: p, onclick: () => go(target) })); }
    crumbs.replaceChildren(...kids);
  };

  const showFile = (f) => {
    const url = `gs://${bucket}/${f.object}`;
    const out = h('pre', { class: 'plan hidden', text: '' });
    detail.replaceChildren(h('div', { class: 'cat bar', text: f.name }),
      h('div', { class: 'kv' }, h('b', { text: fmtBytes(f.size) }), `  ·  ${f.contentType || 'unknown type'}${f.updated ? `  ·  updated ${f.updated.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '')}` : ''}${f.storageClass ? `  ·  ${f.storageClass}` : ''}`),
      h('div', { class: 'row' },
        h('button', { class: 'primary', text: 'Preview text (first 64 KB)', onclick: async () => {
          out.classList.remove('hidden'); out.textContent = 'Loading…';
          const r = await tryInv('cloud:call', cloudId, 'objectPreview', [scope, bucket, f.object, f.contentType, f.size]);
          out.textContent = r.ok ? (r.data || '(empty file)') : r.error;
          out.classList.toggle('t-err', !r.ok);
        } }),
        h('button', { text: 'Copy gs:// URL', onclick: () => navigator.clipboard.writeText(url).then(() => status('Copied.')).catch(() => {}) }),
        h('button', { class: 'subtle', text: 'Ask AI', onclick: () => askAI(`What is ${f.name} and how is it used?`, out.textContent && !out.classList.contains('t-err') ? [{ label: f.name, text: out.textContent }] : []) })),
      out);
  };

  async function go(prefix) {
    drawCrumbs(prefix);
    detail.replaceChildren();
    list.replaceChildren(h('div', { class: 'empty', text: 'Loading…' }));
    const r = await tryInv('cloud:call', cloudId, 'objects', [scope, bucket, prefix]);
    if (!r.ok) return list.replaceChildren(h('div', { class: 'empty t-err', text: r.error }));
    const d = r.data;
    if (!d.folders.length && !d.files.length) return list.replaceChildren(h('div', { class: 'empty', text: prefix ? 'This folder is empty.' : 'This bucket has no files.' }));
    list.replaceChildren(
      ...(prefix ? [h('div', { class: 'svc', onclick: () => go(prefix.replace(/[^/]+\/$/, '')) }, h('span', { text: '⬑ ..' }), h('small', { text: 'up' }))] : []),
      ...d.folders.map((f) => h('div', { class: 'svc', onclick: () => go(f.prefix) }, h('span', { text: `📁 ${f.name}/` }), h('small', { text: 'folder' }))),
      ...d.files.map((f) => h('div', { class: 'svc', title: f.contentType, onclick: () => showFile(f) }, h('span', { text: `📄 ${f.name}` }), h('small', { text: `${fmtBytes(f.size)}${f.updated ? `  ·  ${f.updated.slice(0, 10)}` : ''}` }))),
      ...(d.truncated ? [h('div', { class: 'hint', text: 'Showing the first 1500 entries.' })] : []));
  }
  go('');
  return box;
}
