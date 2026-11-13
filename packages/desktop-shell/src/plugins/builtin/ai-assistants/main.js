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
    id: 'claude-code', name: 'Claude Code (your Claude login)', needsKey: false, auth: 'signin',
    models: ['default', 'sonnet', 'opus', 'haiku'], defaultModel: 'default',
    login: { cmd: 'claude', args: ['auth', 'login'] },
    help: 'Uses the Claude Code you already installed and signed in to (your Claude subscription or Console account). No API key. Runs read-only in your project folder.',
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
    id: 'gemini-vertex', name: 'Gemini (your Google Cloud login)', needsKey: false, auth: 'signin',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'], defaultModel: 'gemini-2.5-flash',
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
      const location = 'us-central1';
      const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
      const res = await fetch(url, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        }),
      });
      const text = await res.text();
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
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
    defaultModel: 'claude-sonnet-5-5',
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
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    defaultModel: 'gemini-2.5-pro',
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
