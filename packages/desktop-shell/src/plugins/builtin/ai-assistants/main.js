/**
 * AI providers. Each provider implements chat({model, system, messages, key, baseUrl, signal}) -> string.
 * The API key is read from the OS keystore by the core and handed in for the duration of the call only.
 * Model names are editable in Settings because vendors rename them often; the defaults are just starting points.
 */

async function postJson(url, headers, body, signal, label) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 300);
    try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || j.message || msg; } catch { /* keep raw */ }
    throw new Error(`${label} ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return JSON.parse(text);
}

/* Gemini text / chat models. tier: 'free' = the Gemini API has a free tier for it (rate limited, Google may use the content to improve its
   products), 'paid' = pay per use only. Source: Google's model and pricing pages (aistudio.google.com/docs/models and /docs/pricing).
   Google adds models often, so the app also asks the API for the models your key / sign-in can use and appends any it does not know. */
const GEMINI_MODELS = [
  ['gemini-4-carbon', 'paid', 'Gemini 4. Strongest reasoning model: complex coding, multimodal work, science. No free tier.'],
  ['gemini-4-argon', 'paid', 'Gemini 4. Efficient frontier reasoning: faster responses and fewer tokens than Carbon. No free tier.'],
  ['gemini-4-hydrogen', 'free', 'Gemini 4. Fast everyday model for coding and agents, 1M-token context. Free tier.'],
  ['gemini-3.8-flash', 'free', 'Gemini 3.8 Flash. Software engineering and autonomous agents. Free tier.'],
  ['gemini-3.6-flash', 'free', 'Gemini 3.6 Flash. Balances speed and multimodal ability for general tasks. Free tier.'],
  ['gemini-3.5-flash-lite', 'free', 'Gemini 3.5 Flash-Lite. Fastest and most cost-effective 3.5 model for high volume. Free tier.'],
  ['gemini-3.1-flash-lite', 'free', 'Gemini 3.1 Flash-Lite. Frontier-class performance at lower cost. Free tier.'],
  ['gemini-3.1-pro-preview', 'paid', 'Gemini 3.1 Pro (preview). No free tier.'],
  ['gemini-3-flash-preview', 'free', 'Gemini 3 Flash (preview). Frontier-class performance at lower cost. Free tier.'],
  ['gemini-2.5-pro', 'free', 'Deprecated: existing users only. Requests move to gemini-3.8-flash on 1 December 2026. Free tier.'],
  ['gemini-2.5-flash', 'free', 'Deprecated: existing users only. Requests move to gemini-3.5-flash-lite on 1 December 2026. Free tier.'],
  ['gemini-2.5-flash-lite', 'free', 'Fastest, most budget-friendly 2.5 model. Still served. Free tier.'],
];
const geminiIds = GEMINI_MODELS.map((m) => m[0]);
const geminiInfo = Object.fromEntries(GEMINI_MODELS.map(([id, tier, note]) => [id, { tier, note }]));

/* Claude models (platform.claude.com/docs/en/about-claude/models/overview). The API has no free tier, so every model is paid (orange);
   the price per million input / output tokens is in the hover text. Mythos models are limited-access and show up only if your key has them. */
const CLAUDE_MODELS = [
  ['claude-fable-5-2', '$8 / $40 per MTok. Demanding reasoning and long-horizon agentic work. 1M context.'],
  ['claude-opus-5-5', '$4 / $20 per MTok. Long-running agentic coding and knowledge work. 1M context.'],
  ['claude-sonnet-5-5', '$2 / $10 per MTok. Best combination of speed and intelligence. 1M context.'],
  ['claude-haiku-5-5', 'From $0.10 / $0.50 per MTok. Fastest: classification, extraction, routing. 1M context.'],
  ['claude-fable-5-1', '$10 / $50 per MTok. Earlier Fable.'],
  ['claude-fable-5', '$10 / $50 per MTok. Earlier Fable.'],
  ['claude-opus-5', '$5 / $25 per MTok. Earlier Opus.'],
  ['claude-sonnet-5', '$2 / $10 per MTok. Earlier Sonnet.'],
  ['claude-opus-4-8', '$5 / $25 per MTok. Earlier Opus.'],
  ['claude-opus-4-7', '$5 / $25 per MTok. Earlier Opus.'],
  ['claude-opus-4-6', '$5 / $25 per MTok. Earlier Opus.'],
  ['claude-sonnet-4-6', '$3 / $15 per MTok. Earlier Sonnet.'],
  ['claude-opus-4-5', '$5 / $25 per MTok. 200K context.'],
  ['claude-sonnet-4-5', '$3 / $15 per MTok. 200K context.'],
  ['claude-haiku-4-5', '$1 / $5 per MTok. 200K context.'],
];
const claudeIds = CLAUDE_MODELS.map((m) => m[0]);
const claudeInfo = Object.fromEntries(CLAUDE_MODELS.map(([id, note]) => [id, { tier: 'paid', note }]));
// Claude Code runs on your Claude plan (or Console account), so there is no per-model price colour: aliases first, then exact models
const CC_ALIASES = [['default', 'The model your plan or account chooses.'], ['sonnet', 'Latest Sonnet.'], ['opus', 'Latest Opus.'], ['haiku', 'Latest Haiku (fastest).']];
const claudeCodeIds = [...CC_ALIASES.map((a) => a[0]), ...claudeIds];
const claudeCodeInfo = Object.fromEntries([...CC_ALIASES.map(([id, note]) => [id, { note }]), ...CLAUDE_MODELS.map(([id, note]) => [id, { note }])]);

/** Models that are not for chat (speech, images, embeddings, live audio ...) are left out of the lists. */
const NOT_CHAT = /embedding|tts|image|imagen|veo|lyria|live|audio|transcribe|translate|omni|robotics|computer-use|aqa|learnlm|decision|banana|customtools|vision-only/i;
/** Old dated snapshots and experiments (gemini-1.5-pro-002, ...-preview-04-17, ...-exp-03-25) are hidden from the live list. */
const STALE = /-\d{2}-\d{2}$|-exp-|-\d{3}$|^gemini-1\./i;

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const tools = require('../../../core/tools');

/** Providers that use accounts you are already signed in to, so no API key is needed. */
function registerSignedInProviders(ctx) {
  // ---- Claude Code: uses the same claude.ai / Anthropic login as the Claude Code CLI ----
  const claudeFile = () => tools.findInPath('claude');
  let authRejected = false; // set when Claude Code answers 401: its saved login exists but is no longer valid
  const AUTH_FAIL = /401|authenticate|authentication_error|OAuth|not logged in|please run \/login/i;

  function runClaude(prompt, { model, cwd, signal } = {}) {
    const file = claudeFile();
    if (!file) return Promise.reject(new Error('Claude Code is not installed or not on PATH.'));
    const args = ['-p', '--output-format', 'text', ...(model && model !== 'default' ? ['--model', model] : [])];
    return new Promise((resolve, reject) => {
      const viaShell = /\.(cmd|bat)$/i.test(file);
      const child = viaShell ? spawn('"' + file + '" ' + args.join(' '), { cwd, shell: true, windowsHide: true }) : spawn(file, args, { cwd, windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        const text = (out + ' ' + err).trim();
        if (code === 0 && out.trim() && !AUTH_FAIL.test(out.slice(0, 120))) { authRejected = false; return resolve(out.trim()); }
        if (AUTH_FAIL.test(text)) { authRejected = true; return reject(new Error('Claude Code rejected its saved login (it has expired). Click Sign in to log in again; no API key is needed.')); }
        reject(new Error('Claude Code failed (exit ' + code + '). ' + text.split(/\r?\n/).slice(-3).join(' ')));
      });
      if (signal) signal.addEventListener('abort', () => { try { child.kill(); } catch { /* gone */ } });
      child.stdin.on('error', () => {});
      child.stdin.end(prompt);
    });
  }

  // Background check shortly after startup (never blocks the splash): detects a saved login that the CLI says exists but the service rejects.
  setTimeout(() => { if (claudeFile()) runClaude('Reply with: ok').catch(() => {}); }, 4000);

  ctx.ai.register({
    id: 'claude-code', name: 'Claude Code', needsKey: false, auth: 'signin',
    models: claudeCodeIds, modelInfo: claudeCodeInfo, defaultModel: 'default',
    login: { cmd: 'claude', args: ['auth', 'login'] },
    canEdit: true,
    /** Streams a Claude Code turn into the IDE. Follow-up turns resume the same session so Claude keeps its context. */
    chatStream({ model, system, messages, session, edits, cwd, signal }, emit) {
      const file = claudeFile();
      if (!file) return Promise.reject(new Error('Claude Code is not installed or not on PATH.'));
      const last = messages[messages.length - 1].content;
      const NN = String.fromCharCode(10, 10);
      const prompt = session ? last : (system ? system + NN : '') + (messages.length > 1 ? messages.map((m) => (m.role === 'user' ? 'User' : 'Assistant') + ': ' + m.content).join(NN) : last);
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        ...(session ? ['--resume', session] : []), ...(edits ? ['--permission-mode', 'acceptEdits'] : []),
        ...(model && model !== 'default' ? ['--model', model] : [])];
      return new Promise((resolve, reject) => {
        const viaShell = /\.(cmd|bat)$/i.test(file);
        const child = viaShell ? spawn('"' + file + '" ' + args.join(' '), { cwd, shell: true, windowsHide: true }) : spawn(file, args, { cwd, windowsHide: true });
        let buf = '';
        let err = '';
        let gotDelta = false;
        let finished = false;
        const brief = (b) => String((b.input && (b.input.file_path || b.input.path || b.input.command || b.input.pattern || b.input.url || b.input.description)) || '').slice(0, 140);
        const handle = (line) => {
          let j;
          try { j = JSON.parse(line); } catch { return; }
          if (j.type === 'system' && j.subtype === 'init') emit({ type: 'session', session: j.session_id });
          else if (j.type === 'stream_event' && j.event && j.event.type === 'content_block_delta' && j.event.delta && j.event.delta.type === 'text_delta') { gotDelta = true; emit({ type: 'delta', text: j.event.delta.text }); }
          else if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
            for (const b of j.message.content) {
              if (b.type === 'tool_use') emit({ type: 'tool', name: b.name, detail: brief(b) });
              else if (b.type === 'text' && !gotDelta && b.text) emit({ type: 'delta', text: b.text });
            }
            gotDelta = false;
          } else if (j.type === 'result') {
            finished = true;
            if (j.is_error || AUTH_FAIL.test(String(j.result || '').slice(0, 160))) {
              if (AUTH_FAIL.test(String(j.result || ''))) authRejected = true;
              emit({ type: 'error', message: AUTH_FAIL.test(String(j.result || '')) ? 'Claude Code rejected its saved login (it has expired). Click Sign in to log in again; no API key is needed.' : String(j.result || 'Claude Code failed.') });
            } else { authRejected = false; emit({ type: 'result', session: j.session_id, cost: j.total_cost_usd }); }
          }
        };
        child.stdout.on('data', (d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf(String.fromCharCode(10))) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); }
        });
        child.stderr.on('data', (d) => { err += d; });
        child.on('error', reject);
        child.on('close', (code) => {
          if (buf.trim()) handle(buf.trim());
          if (!finished && code !== 0) return reject(new Error('Claude Code stopped (exit ' + code + '). ' + err.trim().split(String.fromCharCode(10)).slice(-2).join(' ')));
          resolve();
        });
        if (signal) signal.addEventListener('abort', () => { try { child.kill(); } catch { /* gone */ } });
        child.stdin.on('error', () => {});
        child.stdin.end(prompt);
      });
    },
    help: 'Uses the Claude Code installed on this computer, signed in with a Claude subscription or Console account. No API key. Runs read-only in your project folder.',
    async status() {
      if (!claudeFile()) return { signedIn: false, detail: 'Claude Code is not installed. Install: npm install -g @anthropic-ai/claude-code' };
      const r = await ctx.exec('claude', ['auth', 'status'], { timeout: 20000 });
      try {
        const j = JSON.parse(r.out);
        if (j.loggedIn && authRejected) {
          try { await runClaude('Reply with: ok', { cwd: undefined }); } catch { return { signedIn: false, detail: 'Saved login expired (Claude Code answered 401). Click Sign in to log in again.' }; }
        }
        return j.loggedIn ? { signedIn: true, detail: `Signed in as ${j.email || 'your Claude account'}${j.subscriptionType ? ` (${j.subscriptionType})` : ''}` } : { signedIn: false, detail: 'Not signed in. Click Sign in.' };
      } catch {
        return { signedIn: false, detail: (r.err || r.out || 'Could not read Claude Code status.').split(/\r?\n/)[0] };
      }
    },
    chat({ model, system, messages, signal, cwd }) {
      const NN = '\n\n';
      const transcript = messages.map((m) => (m.role === 'user' ? 'User' : 'Assistant') + ': ' + m.content).join(NN);
      const prompt = (system ? system + NN : '') + (messages.length > 1 ? 'Conversation so far:' + NN + transcript + NN + 'Reply to the last User message.' : messages[0].content);
      return runClaude(prompt, { model, cwd, signal });
    },
  });

  // ---- Gemini through Google Cloud sign-in (Application Default Credentials) on Vertex AI ----
  let tokenCache = { token: '', at: 0 };
  async function adcToken() {
    if (tokenCache.token && Date.now() - tokenCache.at < 40 * 60 * 1000) return tokenCache.token;
    const r = await ctx.exec('gcloud', ['auth', 'application-default', 'print-access-token'], { timeout: 30000 });
    if (!r.ok || !r.out) throw new Error('Google Cloud sign-in (Application Default Credentials) was not found. Sign in to Google Cloud from the Clouds view.');
    tokenCache = { token: r.out.split(/\r?\n/)[0], at: Date.now() };
    return tokenCache.token;
  }
  async function adcProject() {
    try {
      const f = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'gcloud', 'application_default_credentials.json');
      const q = JSON.parse(fs.readFileSync(f, 'utf8')).quota_project_id;
      if (q) return q;
    } catch { /* fall through */ }
    const r = await ctx.exec('gcloud', ['config', 'get-value', 'project'], { timeout: 15000 });
    return r.ok ? r.out.split(/\r?\n/)[0] : '';
  }

  ctx.ai.register({
    id: 'gemini-vertex', name: 'Gemini (Google Cloud)', needsKey: false, auth: 'signin',
    models: geminiIds, modelInfo: geminiInfo, defaultModel: 'gemini-3.8-flash',
    async listModels() {
      const token = await adcToken();
      const project = await adcProject();
      const res = await fetch('https://aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=200&listAllVersions=false', { headers: { Authorization: `Bearer ${token}`, ...(project ? { 'x-goog-user-project': project } : {}) }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`Model list ${res.status}`);
      const j = await res.json();
      return (j.publisherModels || []).map((m) => String(m.name || '').split('/').pop()).filter((id) => /^gemini-/.test(id) && !NOT_CHAT.test(id) && !STALE.test(id));
    },
    tierNote: 'Green = the Gemini API has a free tier for this model, orange = paid only. Through Google Cloud (Vertex AI) every call is billed to your project (new Google Cloud accounts may have free credits), so the free tier applies to the Gemini (API key) option.',
    help: 'Uses the same Application Default Credentials as the Google Cloud connection (Vertex AI in your project). No API key. Your project needs the Vertex AI API enabled and the "Vertex AI User" role.',
    async status() {
      try { await adcToken(); } catch (e) { return { signedIn: false, detail: e.message }; }
      const p = await adcProject();
      return p ? { signedIn: true, detail: `Using Google Cloud project ${p} (Vertex AI)` } : { signedIn: false, detail: 'Signed in, but no Google Cloud project is selected.' };
    },
    async chat({ model, system, messages, signal }) {
      const project = await adcProject();
      if (!project) throw new Error('Select a Google Cloud project first (Clouds view).');
      const token = await adcToken();
      // the newest (Gemini 3) models are served from the global endpoint, the others from a region
      const order = /^gemini-[3-9]/.test(model) ? ['global', 'us-central1'] : ['us-central1', 'global'];
      const body = JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      });
      let res;
      let text = '';
      for (const location of order) { // a model lives either at the global endpoint or in a region: try the likely one first
        const host = location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
        res = await fetch(`https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body,
        });
        text = await res.text();
        if (res.status !== 404) break;
      }
      if (!res.ok) {
        let msg = text.slice(0, 300);
        try { msg = JSON.parse(text).error.message; } catch { /* raw */ }
        const hint = res.status === 403 ? ` Enable the API with: gcloud services enable aiplatform.googleapis.com --project ${project}, and grant yourself roles/aiplatform.user.`
          : res.status === 401 ? ' Your Google Cloud sign-in expired. Sign in again from the Clouds view.' : '';
        if (res.status === 401) tokenCache = { token: '', at: 0 };
        throw new Error(`Gemini ${res.status}: ${msg}${hint}`);
      }
      const parts = ((((JSON.parse(text).candidates || [])[0] || {}).content || {}).parts) || [];
      const out = parts.map((p) => p.text || '').join('');
      if (!out) throw new Error('Gemini returned no text (the response may have been blocked).');
      return out;
    },
  });
}

exports.activate = (ctx) => {
  registerSignedInProviders(ctx);

  // Anthropic Claude (Messages API)
  ctx.ai.register({
    id: 'claude', name: 'Claude (API key)', needsKey: true,
    models: claudeIds, modelInfo: claudeInfo,
    defaultModel: 'claude-sonnet-5-5',
    tierNote: 'Orange = paid (the Claude API has no free tier). Hover a model for its price per million input / output tokens.',
    async listModels({ key }) {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`Model list ${res.status}`);
      return ((await res.json()).data || []).map((m) => m.id).filter(Boolean);
    },
    help: 'Create a key at console.anthropic.com. Code you attach is sent to Anthropic.',
    async chat({ model, system, messages, key, signal }) {
      const j = await postJson('https://api.anthropic.com/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: 8192, ...(system ? { system } : {}), messages }, signal, 'Claude');
      return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    },
  });

  // Google Gemini (Generative Language API)
  ctx.ai.register({
    id: 'gemini', name: 'Gemini (API key)', needsKey: true,
    models: geminiIds, modelInfo: geminiInfo,
    defaultModel: 'gemini-3.8-flash',
    async listModels({ key }) {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`Model list ${res.status}`);
      return ((await res.json()).models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name).replace(/^models\//, '')).filter((id) => /^gemini-/.test(id) && !NOT_CHAT.test(id) && !STALE.test(id));
    },
    tierNote: 'Green = free tier (no charge within Google\u2019s rate limits; on the free tier Google may use your content to improve its products). Orange = paid only, billed per use.',
    help: 'Create a key at aistudio.google.com. Code you attach is sent to Google.',
    async chat({ model, system, messages, key, signal }) {
      const j = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key },
        {
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        }, signal, 'Gemini');
      const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
      const text = parts.map((p) => p.text || '').join('');
      if (!text) throw new Error('Gemini returned no text (the response may have been blocked).');
      return text;
    },
  });

  const openaiStyle = (label, url, headersFor) => async ({ model, system, messages, key, baseUrl, signal }) => {
    const base = (baseUrl || url).replace(/\/+$/, '');
    const j = await postJson(`${base}/chat/completions`, headersFor(key),
      { model, messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages] }, signal, label);
    const c = (j.choices || [])[0];
    if (!c || !c.message) throw new Error(`${label} returned no message.`);
    return c.message.content || '';
  };

  // xAI Grok (OpenAI-compatible)
  ctx.ai.register({
    id: 'grok', name: 'Grok (xAI)', needsKey: true,
    models: ['grok-4', 'grok-3', 'grok-3-mini'],
    defaultModel: 'grok-4',
    help: 'Create a key at console.x.ai. Code you attach is sent to xAI.',
    chat: openaiStyle('Grok', 'https://api.x.ai/v1', (k) => ({ Authorization: `Bearer ${k}` })),
  });

  // Any OpenAI-compatible endpoint: OpenAI, Azure OpenAI gateways, vLLM, LM Studio, Ollama (local, no data leaves the machine).
  ctx.ai.register({
    id: 'openai-compatible', name: 'OpenAI-compatible / local', needsKey: false,
    configurableBaseUrl: true, defaultBaseUrl: 'http://localhost:11434/v1',
    models: ['gpt-4o', 'llama3.1', 'qwen2.5-coder', 'mistral'],
    defaultModel: 'llama3.1',
    help: 'Point the base URL at OpenAI (https://api.openai.com/v1) or a local/private server such as Ollama (http://localhost:11434/v1). The key is optional for local servers.',
    chat: async (req) => openaiStyle('OpenAI-compatible', req.baseUrl, (k) => (k ? { Authorization: `Bearer ${k}` } : {}))(req),
  });

  // Interactive terminal agents (full TUI, launched in a real console window in the project folder)
  ctx.ai.registerCli({ id: 'claude-code', name: 'Claude Code', cmd: 'claude', installHint: 'Install: npm install -g @anthropic-ai/claude-code' });
  ctx.ai.registerCli({ id: 'gemini-cli', name: 'Gemini CLI', cmd: 'gemini', installHint: 'Install: npm install -g @google/gemini-cli' });
  ctx.ai.registerCli({ id: 'codex-cli', name: 'Codex CLI', cmd: 'codex', installHint: 'Install: npm install -g @openai/codex' });
};
