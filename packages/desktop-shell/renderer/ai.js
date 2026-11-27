/* AI assistant panel. Providers (Claude, Gemini, Grok, OpenAI-compatible/local) and terminal agents come from plugins. */
'use strict';

const chat = { provider: '', messages: [], attachments: [], busy: false, session: '', stream: null, streamId: 0, edits: false, agent: false };
let aiRaf = false;
const scheduleAiRender = () => { if (aiRaf) return; aiRaf = true; requestAnimationFrame(() => { aiRaf = false; renderAiPanel(); }); };
const MAX_ATTACH = 60000;

async function loadAi(fresh) {
  try { state.ai = await inv('ai:list', !!fresh); } catch (e) { state.ai = { api: [], cli: [], secureStorage: false }; status(e.message, true); }
  if (!chat.provider || !state.ai.api.some((a) => a.id === chat.provider)) {
    // Claude Code first: it uses the customer's own Claude plan, no API key. Then any other ready assistant, then the first one.
    const cc = state.ai.api.find((a) => a.id === 'claude-code');
    const ready = (cc && cc.ready && cc) || state.ai.api.find((a) => a.ready);
    chat.provider = (ready || cc || state.ai.api[0] || {}).id || '';
  }
  renderAiPanel();
  if (!fresh || !loadAi.refreshing) refreshModelLists();
}

/** Once per provider: ask which models the account can use, and add the ones the built-in list does not have. */
async function refreshModelLists() {
  if (loadAi.refreshing || !state.ai) return;
  const todo = state.ai.api.filter((p) => p.canListModels && p.ready && !p.modelsLoaded);
  if (!todo.length) return;
  loadAi.refreshing = true;
  try {
    for (const p of todo) await tryInv('ai:refreshModels', p.id);
    state.ai = await inv('ai:list', false);
    renderAiPanel();
  } catch { /* the built-in list stays */ } finally { loadAi.refreshing = false; }
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

const AGENT_PROMPT = [
  'AGENT MODE. You can create and change files inside the open project folder yourself. You cannot run builds, tests, deployments or shell commands yourself: the IDE does that after the user approves.',
  'Make the file edits first. Then, when you want something run, end your reply with one block per action, exactly like this:',
  '```ide-action',
  '{"action":"build"}',
  '```',
  'Actions: build, test, run, deploy (deploys the current environment through the IDE, which asks again), pipeline (generate the CI/CD pipeline), provision (opens the environment wizard for AWS / Azure / GCP), new-project (opens the New Project dialog),',
  '{"action":"open-file","path":"relative/path"} and {"action":"terminal","title":"what it does","command":"one shell command"} (runs in the project folder; one line, never destructive, never with secrets).',
  'The user sees each action as a card and decides. Never ask for or write secrets or keys. Stay inside the project folder.',
].join(String.fromCharCode(10));

const IDE_ACTIONS = {
  build: ['Build the project', () => CNS.run('run.build')],
  test: ['Run the tests', () => CNS.run('run.test')],
  run: ['Run the application', () => CNS.run('run.run')],
  deploy: ['Deploy to the current environment', () => CNS.run('cloud.deploy')],
  pipeline: ['Generate the CI/CD pipeline', () => CNS.run('cloud.pipeline.generate')],
  provision: ['Open the environment wizard', () => openLanding()],
  'new-project': ['Open the New Project dialog', () => CNS.run('project.new')],
};

/** A card for one action Claude proposed. Nothing runs until the user clicks Run; the command or path is shown exactly as it will be used. */
function actionCard(json) {
  let a;
  try { a = JSON.parse(json); } catch { return h('div', { class: 'mcode' }, h('pre', { text: json })); }
  const name = String((a && a.action) || '');
  let title = ''; let detail = ''; let run = null;
  if (IDE_ACTIONS[name]) { title = IDE_ACTIONS[name][0]; run = IDE_ACTIONS[name][1]; }
  else if (name === 'open-file' && typeof a.path === 'string' && state.workspace) {
    const rel = a.path.replace(/^[\\/]+/, '');
    if (!/\.\.[\\/]|^\.\.$|^[A-Za-z]:/.test(rel) && rel.length < 300) { title = 'Open a file'; detail = rel; run = () => openFile(joinPath(state.workspace, rel.split('/').join(BS))); }
  } else if (name === 'terminal' && typeof a.command === 'string' && state.workspace) {
    const cmd = a.command.trim();
    if (cmd && cmd.length < 500 && !/[\r\n]/.test(cmd)) {
      title = String(a.title || 'Run a command').slice(0, 100); detail = cmd;
      run = async () => {
        showPanel('terminal'); termPrint('> ' + cmd + String.fromCharCode(10), 't-cmd');
        const t = await tryInv('term:run', cmd, state.workspace);
        if (!t.ok) return status(t.error, true);
        termStdin = t.data; termWaiters.set(t.data, () => { termStdin = 0; });
      };
    }
  }
  if (!run) return h('div', { class: 'actioncard bad' }, h('b', { text: 'Claude proposed an action the IDE does not know.' }), h('code', { text: json.slice(0, 200) }));
  const card = h('div', { class: 'actioncard' }, h('div', { class: 'ach' }, h('b', { text: title }), detail ? h('code', { text: detail }) : null));
  const row = h('div', { class: 'mact' },
    h('button', { class: 'primary', text: 'Run', onclick: async () => { row.replaceChildren(h('span', { class: 'hint', text: 'Started.' })); try { await run(); } catch (e) { status(e.message, true); } } }),
    h('button', { text: 'Dismiss', onclick: () => card.remove() }));
  card.append(row);
  return card;
}

function systemPrompt() {
  const p = state.proj;
  const bits = ['You are an AI assistant inside Nativity Studio, an IDE for building, modernizing and migrating applications across GCP, AWS, Azure and private clouds.',
    'Be concise and concrete. Prefer least-privilege IAM, infrastructure as code, and cloud-neutral designs unless asked otherwise. Never ask for or output secrets.'];
  if (state.workspace) bits.push(`Open project: ${baseName(state.workspace)}.`);
  if (p && p.enabled) bits.push(`Connected cloud: ${(cloudMeta(p.cloud) || {}).name}, environment: ${p.env}, region: ${p.region || 'n/a'}.`);
  if (chat.agent) bits.push(AGENT_PROMPT);
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
    if (/^ide-action\s/.test(part) && m.role === 'assistant' && !m.streaming) { body.append(actionCard(code.trim())); return; }
    body.append(h('div', { class: 'mcode' }, h('pre', { text: code.replace(/\n$/, '') }),
      h('div', { class: 'mact' },
        h('button', { text: 'Copy', onclick: () => navigator.clipboard.writeText(code).then(() => status('Copied.')).catch(() => status('Copy failed.', true)) }),
        h('button', { text: 'Insert at cursor', onclick: () => (insertAtCursor(code) ? status('Inserted.') : status('Open a file in the editor first.', true)) }))));
  });
  return h('div', { class: `msg ${m.role}${m.error ? ' error' : ''}` }, h('div', { class: 'who', text: m.role === 'user' ? 'You' : m.who || 'Assistant' }), body,
    m.chips && m.chips.length ? h('div', { class: 'chips' }, m.chips.map((c) => h('span', { class: 'chip', text: c }))) : null);
}

/** A model drop-down. Models with a known price tier are coloured: green = free tier, orange = paid. "Other…" lets you type any model id. */
const TIER_UI = { free: ['#4caf50', 'free tier'], paid: ['#ff9800', 'paid'] };
function modelPicker(p, current, onChange) {
  const info = p.modelInfo || {};
  const sel = h('select', { class: 'modelpick' });
  const ids = [...p.models];
  if (current && !ids.includes(current)) ids.unshift(current);
  const addOpt = (id) => {
    const t = info[id] && info[id].tier;
    const o = h('option', { value: id, text: t ? `● ${id}  ·  ${TIER_UI[t][1]}` : id, title: (info[id] && info[id].note) || '' });
    o.dataset.tier = t || '';
    if (t) o.style.color = TIER_UI[t][0];
    return o;
  };
  const paint = () => { const o = sel.selectedOptions[0]; const t = o && o.dataset.tier; sel.style.color = t ? TIER_UI[t][0] : ''; sel.title = (o && o.title) || ''; };
  sel.append(...ids.map(addOpt), h('option', { value: '__other', text: 'Other model…' }));
  sel.value = current || p.model || ids[0] || '';
  paint();
  let last = sel.value;
  sel.onchange = async () => {
    if (sel.value === '__other') {
      const v = await promptText('Model name', 'for example gemini-2.5-flash or llama3.1');
      if (!v) { sel.value = last; paint(); return; }
      if (![...sel.options].some((o) => o.value === v)) sel.insertBefore(addOpt(v), sel.lastChild);
      sel.value = v;
    }
    last = sel.value; paint();
    if (onChange) await onChange(sel.value);
  };
  return sel;
}

/** Small legend under a provider's model list when its models have tiers. */
const tierLegend = (p) => (p && p.modelInfo && Object.keys(p.modelInfo).length ? h('span', { class: 'tierlegend', title: p.tierNote || '' }, h('span', { style: 'color:#4caf50', text: '● free tier' }), '  ', h('span', { style: 'color:#ff9800', text: '● paid' })) : null);

function renderAiPanel() {
  const ai = state.ai;
  const sel = $('ai-provider');
  if (!ai) return;
  sel.replaceChildren(...ai.api.map((a) => h('option', { value: a.id, text: `${a.name}${a.ready ? '' : a.auth === 'signin' ? ' (sign in)' : ' (no key)'}`, selected: a.id === chat.provider })));
  const p = curProvider();
  if (p) {
    const pick = modelPicker(p, p.model, async (v) => { const r = await tryInv('ai:setConfig', p.id, { model: v }); if (!r.ok) status(r.error, true); else p.model = v; });
    pick.id = 'ai-model';
    $('ai-model').replaceWith(pick);
    const lg = $('ai-legend'); lg.replaceChildren(...(tierLegend(p) ? [tierLegend(p)] : [])); lg.title = p.tierNote || '';
  }
  // Only the terminal assistant that belongs to the selected provider: Claude -> Claude Code, Gemini -> Gemini CLI, OpenAI-compatible -> Codex CLI.
  const CLI_FOR = { 'claude-code': 'claude-code', claude: 'claude-code', 'gemini-vertex': 'gemini-cli', gemini: 'gemini-cli', 'openai-compatible': 'codex-cli' };
  $('ai-cli').replaceChildren(...ai.cli.filter((a) => p && CLI_FOR[p.id] === a.id).map((a) => h('button', { class: 'subtle', text: a.name, title: a.installed ? (a.id === 'claude-code' ? 'Chat with Claude Code in this panel' : `Open ${a.name} in a console window`) : a.installHint, disabled: !a.installed, onclick: () => launchCli(a.id) })));

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
  $('ai-agent-row').classList.toggle('hidden', !(p && p.canEdit));
  $('ai-agent').checked = chat.agent;
  $('ai-edits-row').classList.toggle('hidden', !(p && p.canEdit) || chat.agent);
  const notInstalled = !!(p && p.id === 'claude-code' && !p.ready && /not installed/i.test(p.statusText || ''));
  $('ai-install').classList.toggle('hidden', !notInstalled);
  $('ai-signin').classList.toggle('hidden', !(p && p.canLogin && !p.ready) || notInstalled);
  if (p && p.auth === 'signin' && p.statusText) $('ai-hint').textContent = p.statusText; // sign-in state of the selected provider (Claude plan, Google Cloud account)
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
    const r0 = await tryInv('ai:chatStream', p.id, { model, system: systemPrompt(), messages: wire, session: chat.session || '', edits: chat.edits || chat.agent });
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
    await loadAi(true);
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
  $('ai-send').onclick = () => (chat.busy && chat.streamId ? tryInv('ai:cancel', chat.streamId) : sendChat());
  $('ai-edits').onchange = async (e) => {
    if (e.target.checked && !(await confirmBox('Let Claude edit files in this project?', 'Claude Code can create and change files in the open project folder without asking each time. Use Git so you can review and undo changes.'))) { e.target.checked = false; return; }
    chat.edits = e.target.checked;
  };
  $('ai-agent').onchange = async (e) => {
    if (e.target.checked && !(await confirmBox('Turn on Agent mode?', 'Claude can create and change files in the open project folder without asking each time, and it proposes builds, tests, deploys and commands as cards that you approve one by one. Use Git so you can review and undo changes.'))) { e.target.checked = false; return; }
    chat.agent = e.target.checked; renderAiPanel();
  };
  $('ai-install').onclick = installClaudeCode;
  $('ai-lifecycle').onclick = () => openLifecycle();
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
    if (chat.onDone) { const f = chat.onDone; chat.onDone = null; setTimeout(f, 0); }
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

/** Installs Claude Code with npm after the user agrees; the IDE then picks it up and offers Sign in. */
async function installClaudeCode() {
  const cmd = 'npm install -g @anthropic-ai/claude-code';
  const NL2 = String.fromCharCode(10, 10);
  if (!(await confirmBox('Install Claude Code?', 'This runs in the terminal:' + NL2 + cmd + NL2 + 'It needs Node.js (npm) on this computer. Afterwards click Sign in and log in with your own Claude plan. No API key is needed.'))) return;
  showPanel('terminal');
  termPrint('> ' + cmd + String.fromCharCode(10), 't-cmd');
  const t = await tryInv('term:run', cmd, state.workspace || undefined);
  if (!t.ok) return status(t.error, true);
  termStdin = t.data;
  termWaiters.set(t.data, async (code) => {
    termStdin = 0;
    await loadAi(true);
    status(code === 0 ? 'Claude Code installed. Click Sign in next.' : 'Install did not finish. See the terminal (Node.js with npm is required).', code !== 0);
  });
}
