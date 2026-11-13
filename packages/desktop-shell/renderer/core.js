/* Core runtime: DOM helpers, IPC helpers, dialogs, command registry and the plugin API. No inline HTML: all DOM is built with textContent. */
'use strict';

const $ = (id) => document.getElementById(id);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const BS = String.fromCharCode(92);
const joinPath = (a, b) => (a.endsWith(BS) || a.endsWith('/') ? a + b : a + BS + b);
const baseName = (p) => p.split(/[\\/]/).pop();
const dirName = (p) => p.slice(0, Math.max(p.lastIndexOf(BS), p.lastIndexOf('/')));

/** Calls the main process; throws on failure. */
async function inv(channel, ...args) {
  const r = await cns.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
/** Same, but returns {ok, data|error} instead of throwing. */
const tryInv = (channel, ...args) => cns.invoke(channel, ...args);

const state = {
  workspace: null,
  settings: {},
  clouds: [], // provider metadata
  cloudStatus: {}, // id -> {installed, signedIn, identity, scope, detail, loading}
  proj: null, // .cnd/project.json of the workspace
  tabs: [],
  active: null,
  plugins: [],
  info: {},
  cloudRuns: new Map(),
};

/* ------------------------------ status / log ------------------------------ */

let statusTimer;
function status(msg, isErr) {
  const el = $('st-msg');
  el.textContent = msg;
  el.style.fontWeight = isErr ? '700' : '400';
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (el.textContent = ''), 7000);
  if (isErr) log(msg, 't-err');
}

function log(text, cls) {
  const out = $('output-out');
  if (!out) return;
  out.append(h('div', { class: cls || '', text: `[${new Date().toLocaleTimeString()}] ${text}` }));
  out.scrollTop = out.scrollHeight;
}

/* ------------------------------ dialogs ------------------------------ */

function modal(title, body, buttons, opts = {}) {
  const root = $('modal-root');
  const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') }, h('h2', { text: title }), body, h('div', { class: 'btns' }, buttons || []));
  root.replaceChildren(box);
  root.classList.remove('hidden');
  const close = () => root.classList.add('hidden');
  return close;
}

function promptText(title, placeholder, initial = '') {
  return new Promise((resolve) => {
    const input = h('input', { placeholder, value: initial });
    const close = modal(title, input, [
      h('button', { text: 'Cancel', onclick: () => { close(); resolve(null); } }),
      h('button', { class: 'primary', text: 'OK', onclick: () => { close(); resolve(input.value.trim() || null); } }),
    ]);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { close(); resolve(input.value.trim() || null); }
      if (e.key === 'Escape') { close(); resolve(null); }
    });
    input.focus();
    input.select();
  });
}

const confirmBox = (message, detail) => inv('dialog:confirm', message, detail).catch(() => false);

/* ------------------------------ context menu ------------------------------ */

function ctxMenu(x, y, items) {
  const root = $('ctx');
  const hide = () => root.classList.add('hidden');
  root.replaceChildren(...items.map((it) =>
    it === '-' ? h('div', { class: 'sep' }) : h('div', { class: 'item' + (it.disabled ? ' dis' : ''), text: it.label, onclick: () => { hide(); if (!it.disabled) it.run(); } })));
  root.classList.remove('hidden');
  const w = root.offsetWidth;
  const hh = root.offsetHeight;
  root.style.left = `${Math.max(0, Math.min(x, window.innerWidth - w - 4))}px`;
  root.style.top = `${Math.max(0, Math.min(y, window.innerHeight - hh - 4))}px`;
}

/* ------------------------------ commands, views, plugin API ------------------------------ */

const CNS = {
  commands: new Map(), // id -> {fn, title}
  views: [], // {id, title, icon, render(container), plugin}
  toolbar: [],
  hooks: new Map(), // event -> [fn]

  command(id, fn, title) {
    CNS.commands.set(id, { fn, title: title || '' });
  },
  async run(id, arg) {
    const c = CNS.commands.get(id);
    if (!c) return status(`No handler for command "${id}".`, true);
    try { await c.fn(arg); } catch (e) { status(e.message || String(e), true); }
  },
  on(evt, fn) {
    CNS.hooks.set(evt, [...(CNS.hooks.get(evt) || []), fn]);
  },
  emit(evt, payload) {
    for (const fn of CNS.hooks.get(evt) || []) { try { fn(payload); } catch (e) { console.error(e); } }
  },

  /** Entry point for renderer plugins: CNS.plugin('vendor.id', (api) => { ... }) */
  plugin(id, activate) {
    const api = {
      id,
      invoke: (channel, ...args) => inv('plugin:invoke', id, channel, args),
      commands: { register: (cid, fn, title) => CNS.command(cid, fn, title) },
      views: { register: (v) => { CNS.views.push({ ...v, plugin: id }); CNS.emit('views-changed'); } },
      toolbar: { add: (t) => { CNS.toolbar.push({ ...t, plugin: id }); CNS.emit('toolbar-changed'); } },
      on: (evt, fn) => CNS.on(evt, fn),
      workspace: () => state.workspace,
      shared: { get: (k) => state[k], set: (k, v) => { state[k] = v; } },
      ui: { h, modal, status, promptText, confirm: confirmBox, openFile: (p) => openFile(p), openExternal: (u) => inv('shell:openExternal', u), ctxMenu, showView: (v) => showView(v), refreshTree: () => refreshTree() },
      ai: { ask: (prompt, attachments) => askAI(prompt, attachments) },
      cloud: () => ({ clouds: state.clouds, status: state.cloudStatus, project: state.proj }),
    };
    try { activate(api); } catch (e) { console.error(`plugin ${id}:`, e); status(`Plugin ${id} failed: ${e.message}`, true); }
  },
};
