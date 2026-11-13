/* AI assistant panel. Providers (Claude, Gemini, Grok, OpenAI-compatible/local) and terminal agents come from plugins. */
'use strict';

const chat = { provider: '', messages: [], attachments: [], busy: false, session: '', stream: null, streamId: 0, edits: false };
let aiRaf = false;
const scheduleAiRender = () => { if (aiRaf) return; aiRaf = true; requestAnimationFrame(() => { aiRaf = false; renderAiPanel(); }); };
const MAX_ATTACH = 60000;

async function loadAi() {
  try { state.ai = await inv('ai:list'); } catch (e) { state.ai = { api: [], cli: [], secureStorage: false }; status(e.message, true); }
  if (!chat.provider || !state.ai.api.some((a) => a.id === chat.provider)) {
    const ready = state.ai.api.find((a) => a.ready);
    chat.provider = (ready || state.ai.api[0] || {}).id || '';
  }
  renderAiPanel();
}

const curProvider = () => (state.ai && state.ai.api.find((a) => a.id === chat.provider)) || null;

function toggleAi(force) {
  const panel = $('aipanel');
  const show = force != null ? force : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !show);
  $('tb-ai').classList.toggle('active', show);
  if (show) { renderAiPanel(); loadAi(); $('ai-input').focus(); } // refresh sign-in status each time the panel opens
}

function attach(label, text) {
  if (!text) return status('Nothing to attach.', true);
  const t = text.length > MAX_ATTACH ? `${text.slice(0, MAX_ATTACH)}\n… (truncated)` : text;
  chat.attachments = [...chat.attachments.filter((a) => a.label !== label), { label, text: t }];
  renderAiPanel();
}

function contextSize() {
  return chat.attachments.reduce((n, a) => n + a.text.length, 0);
}

function systemPrompt() {
  const p = state.proj;
  const bits = ['You are an AI assistant inside Nativity Studio, an IDE for building, modernizing and migrating applications across GCP, AWS, Azure and private clouds.',
    'Be concise and concrete. Prefer least-privilege IAM, infrastructure as code, and cloud-neutral designs unless asked otherwise. Never ask for or output secrets.'];
  if (state.workspace) bits.push(`Open project: ${baseName(state.workspace)}.`);
  if (p && p.enabled) bits.push(`Connected cloud: ${(cloudMeta(p.cloud) || {}).name}, environment: ${p.env}, region: ${p.region || 'n/a'}.`);
  return bits.join('\n');
}

/** Pre-fills the assistant (does not send): the user reviews what will leave the machine, then presses Send. */
function askAI(prompt, attachments) {
  toggleAi(true);
  for (const a of attachments || []) attach(a.label, a.text);
  $('ai-input').value = prompt || '';
  $('ai-input').focus();
}

function renderMessage(m) {
  if (m.tool) return h('div', { class: 'msg toolline', text: m.content });
  const body = h('div', { class: 'mbody' });
  const parts = String(m.content).split(/```/);
  parts.forEach((part, i) => {
    if (i % 2 === 0) { if (part.trim()) body.append(h('div', { class: 'mtext', text: part.trim() })); return; }
    const code = part.replace(/^[^\n]*\n/, '');
    body.append(h('div', { class: 'mcode' }, h('pre', { text: code.replace(/\n$/, '') }),
      h('div', { class: 'mact' },
        h('button', { text: 'Copy', onclick: () => navigator.clipboard.writeText(code).then(() => status('Copied.')).catch(() => status('Copy failed.', true)) }),
        h('button', { text: 'Insert at cursor', onclick: () => (insertAtCursor(code) ? status('Inserted.') : status('Open a file in the editor first.', true)) }))));
  });
  return h('div', { class: `msg ${m.role}${m.error ? ' error' : ''}` }, h('div', { class: 'who', text: m.role === 'user' ? 'You' : m.who || 'Assistant' }), body,
    m.chips && m.chips.length ? h('div', { class: 'chips' }, m.chips.map((c) => h('span', { class: 'chip', text: c }))) : null);
}

function renderAiPanel() {
  const ai = state.ai;
  const sel = $('ai-provider');
  if (!ai) return;
  sel.replaceChildren(...ai.api.map((a) => h('option', { value: a.id, text: `${a.name}${a.ready ? '' : a.auth === 'signin' ? ' (sign in)' : ' (no key)'}`, selected: a.id === chat.provider })));
  const p = curProvider();
  $('ai-model').value = p ? p.model : '';
  $('ai-models').replaceChildren(...(p ? p.models : []).map((m) => h('option', { value: m })));
  $('ai-cli').replaceChildren(...ai.cli.map((a) => h('button', { class: 'subtle', text: a.name, title: a.installed ? (a.id === 'claude-code' ? 'Chat with Claude Code in this panel' : `Open ${a.name} in a console window`) : a.installHint, disabled: !a.installed, onclick: () => launchCli(a.id) })));

  const log_ = $('ai-log');
  log_.replaceChildren(...(chat.messages.filter((m) => !(m.streaming && !m.content)).length ? chat.messages.filter((m) => !(m.streaming && !m.content)).map(renderMessage) : [h('div', { class: 'empty', text: p && !(p.keySet || !p.needsKey) ? (p && p.auth === 'signin' ? (p.statusText || 'Sign in to use this provider.') : 'Add your API key in Settings > AI to start chatting.') : 'Ask about your code, a deployment, a migration…' })]));
  if (chat.busy && !(chat.stream && chat.stream.content)) log_.append(h('div', { class: 'msg assistant' }, h('div', { class: 'who', text: p ? p.name : 'Assistant' }), h('div', { class: 'mtext', text: 'Thinking…' })));
  log_.scrollTop = log_.scrollHeight;

  $('ai-chips').replaceChildren(...chat.attachments.map((a) => h('span', { class: 'chip', title: 'Click to remove', onclick: () => { chat.attachments = chat.attachments.filter((x) => x !== a); renderAiPanel(); } }, `${a.label} ✕`)));
  const size = contextSize();
  $('ai-hint').textContent = p ? (size ? `Will send ${(size / 1024).toFixed(1)} KB of attached context to ${p.name}.` : `Messages go to ${p.name}. Attach files only when needed.`) : '';
  $('ai-send').disabled = !p || (chat.busy && !chat.streamId);
  $('ai-send').textContent = chat.busy && chat.streamId ? 'Stop' : 'Send';
  $('ai-edits-row').classList.toggle('hidden', !(p && p.canEdit));
  $('ai-edits').checked = chat.edits;
  $('ai-signin').classList.toggle('hidden', !(p && p.canLogin && !p.ready));
  if (p && p.auth === 'signin' && p.ready) $('ai-hint').textContent = p.statusText;
}

async function sendChat() {
  const p = curProvider();
  const input = $('ai-input');
  const text = input.value.trim();
  if (!p || !text || chat.busy) return;
  if (p.auth === 'signin' && !p.ready) { chat.messages.push({ role: 'assistant', error: true, who: p.name, content: (p.statusText || 'Not signed in.') + ' Use the Sign in button above; nothing is sent until you do.' }); renderAiPanel(); return; }
  if (p.needsKey && !p.keySet) return openSettings('ai');
  const ctxText = chat.attachments.map((a) => `### ${a.label}\n\`\`\`\n${a.text}\n\`\`\``).join('\n\n');
  const content = ctxText ? `${text}\n\n---\nContext attached by the user:\n\n${ctxText}` : text;
  chat.messages.push({ role: 'user', content: text, chips: chat.attachments.map((a) => a.label) });
  const wire = [...chat.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.wire || m.content })), { role: 'user', content }];
  chat.messages[chat.messages.length - 1].wire = content;
  chat.attachments = [];
  input.value = '';
  chat.busy = true;
  renderAiPanel();
  const model = $('ai-model').value.trim() || p.model;
  if (p.streaming) {
    const msg = { role: 'assistant', content: '', who: p.name, streaming: true };
    chat.messages.push(msg);
    chat.stream = msg;
    const r0 = await tryInv('ai:chatStream', p.id, { model, system: systemPrompt(), messages: wire, session: chat.session || '', edits: chat.edits });
    if (!r0.ok) { msg.streaming = false; msg.error = true; msg.content = r0.error; chat.busy = false; chat.stream = null; return renderAiPanel(); }
    chat.streamId = r0.data;
    return renderAiPanel();
  }
  const r = await tryInv('ai:chat', p.id, { model, system: systemPrompt(), messages: wire });
  chat.busy = false;
  if (r.ok) chat.messages.push({ role: 'assistant', content: r.data.text || '(empty response)', who: `${p.name} · ${r.data.model}` });
  else chat.messages.push({ role: 'assistant', content: r.error, error: true, who: p.name });
  renderAiPanel();
}

/** Opens the provider's own sign-in (a console window) and re-checks status when you return to the IDE. */
async function aiSignIn(id) {
  const r = await tryInv('ai:login', id);
  if (!r.ok) return status(r.error, true);
  if (r.data.url) return openBrowser(r.data.url, 'Sign in');
  showPanel('terminal');
  termPrint('> ' + r.data.command + String.fromCharCode(10), 't-cmd');
  termPrint('A browser tab may open for you to approve the login. If the terminal asks for a code, type it here and press Enter.' + String.fromCharCode(10), 't-dim');
  const t = await tryInv('term:run', r.data.command, state.workspace || undefined);
  if (!t.ok) return status(t.error, true);
  termStdin = t.data;
  termWaiters.set(t.data, async (code) => {
    termStdin = 0;
    await loadAi();
    status(code === 0 ? 'Sign-in finished.' : 'Sign-in did not complete. See the terminal.', code !== 0);
  });
}

/** Claude Code runs inside this IDE (the AI panel). No console window. */
function openClaude() {
  chat.provider = 'claude-code';
  toggleAi(true);
  renderAiPanel();
}

async function launchCli(id) {
  if (id === 'claude-code') return openClaude();
  const r = await tryInv('ai:launchCli', id, state.workspace);
  if (!r.ok) return status(r.error, true);
  status('Opened the agent in a terminal window.');
}

function wireAi() {
  $('ai-provider').onchange = (e) => { chat.provider = e.target.value; chat.messages = []; chat.session = ''; renderAiPanel(); };
  $('ai-model').onchange = async (e) => { const p = curProvider(); if (!p) return; const r = await tryInv('ai:setConfig', p.id, { model: e.target.value.trim() }); if (!r.ok) status(r.error, true); else p.model = e.target.value.trim(); };
  $('ai-send').onclick = () => (chat.busy && chat.streamId ? tryInv('ai:cancel', chat.streamId) : sendChat());
  $('ai-edits').onchange = async (e) => {
    if (e.target.checked && !(await confirmBox('Let Claude edit files in this project?', 'Claude Code can create and change files in the open project folder without asking each time. Use Git so you can review and undo changes.'))) { e.target.checked = false; return; }
    chat.edits = e.target.checked;
  };
  cns.on('ai:stream', onAiStream);
  $('ai-signin').onclick = () => curProvider() && aiSignIn(curProvider().id);
  $('ai-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendChat(); } });
  $('ai-new').onclick = () => { if (chat.streamId) tryInv('ai:cancel', chat.streamId); chat.messages = []; chat.attachments = []; chat.session = ''; chat.busy = false; chat.stream = null; chat.streamId = 0; renderAiPanel(); };
  $('ai-close').onclick = () => toggleAi(false);
  $('ai-att-file').onclick = () => { const t = state.active; if (t && t.kind === 'file') attach(baseName(t.path), t.model.getValue()); else status('Open a file first.', true); };
  $('ai-att-sel').onclick = () => { const s = activeSelection(); if (s) attach('selection', s); else status('Select some code in the editor first.', true); };
  $('ai-att-mig').onclick = () => { if (state.analysis) attach('migration analysis (JSON)', JSON.stringify(state.analysis, null, 2)); else status('Run Modernize > Assess first.', true); };
}

/* ---- streaming events (Claude Code runs in-process: text, tool use and results arrive live) ---- */

function onAiStream(e) {
  if (e.streamId !== chat.streamId) return;
  let m = chat.stream;
  if (e.type === 'session') chat.session = e.session;
  else if (e.type === 'delta' && m) m.content += e.text;
  else if (e.type === 'tool') {
    const toolMsg = { role: 'assistant', tool: true, content: '🔧 ' + e.name + (e.detail ? ' — ' + e.detail : '') };
    if (m && m.content) { m.streaming = false; m = { role: 'assistant', content: '', who: m.who, streaming: true }; chat.messages.push(toolMsg, m); }
    else if (m) chat.messages.splice(chat.messages.indexOf(m), 0, toolMsg);
    else chat.messages.push(toolMsg);
    chat.stream = m;
  } else if (e.type === 'error' && m) { m.error = true; m.content = (m.content ? m.content + String.fromCharCode(10, 10) : '') + e.message; }
  else if (e.type === 'done') {
    chat.busy = false;
    chat.streamId = 0;
    chat.stream = null;
    chat.messages.forEach((x) => { x.streaming = false; });
    chat.messages = chat.messages.filter((x) => x.tool || x.content);
    afterAiTurn();
  }
  scheduleAiRender();
}

/** Claude may have changed files: refresh the Explorer and reload open files that have no unsaved edits. */
async function afterAiTurn() {
  if (!state.workspace) return;
  await refreshTree().catch(() => {});
  for (const t of state.tabs) {
    if (t.kind !== 'file' || t.model.getValue() !== t.saved) continue;
    try { const txt = await inv('fs:readFile', t.path); if (txt !== t.saved) { t.model.setValue(txt); t.saved = txt; } } catch { /* file removed */ }
  }
  renderTabs();
}
