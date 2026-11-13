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

exports.activate = (ctx) => {
  // Anthropic Claude (Messages API)
  ctx.ai.register({
    id: 'claude', name: 'Claude (Anthropic)', needsKey: true,
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
    id: 'gemini', name: 'Gemini (Google)', needsKey: true,
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
