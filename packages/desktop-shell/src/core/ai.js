/** AI assistant plumbing. Providers/agents are contributed by plugins. API keys live only in the OS keystore. */
const { exec, commandLine } = require('./util');

const MAX_MESSAGES = 60;
const MAX_CHARS = 600000;

function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) throw new Error('Invalid conversation.');
  let total = 0;
  return messages.map((m) => {
    if (!m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') throw new Error('Invalid message.');
    total += m.content.length;
    if (total > MAX_CHARS) throw new Error('Conversation is too large to send. Remove attachments or start a new chat.');
    return { role: m.role, content: m.content };
  });
}

const URL_OK = /^(https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[A-Za-z0-9._~/-]*)?)$/;

function register({ ipcMain, wrap, host, store, secrets, terminal }) {
  const installed = new Map();
  async function isInstalled(cmd) {
    if (installed.has(cmd)) return installed.get(cmd);
    const r = await exec(process.platform === 'win32' ? 'where' : 'which', [cmd], { timeout: 8000 });
    installed.set(cmd, r.ok);
    return r.ok;
  }

  ipcMain.handle('ai:list', wrap(async () => {
    const api = [...host.ai.values()].map((p) => ({
      id: p.id,
      name: p.name,
      kind: 'api',
      models: p.models || [],
      model: store.get(`ai.${p.id}.model`, p.defaultModel || ''),
      needsKey: p.needsKey !== false,
      keySet: secrets.has(`ai.${p.id}.key`),
      baseUrl: p.configurableBaseUrl ? store.get(`ai.${p.id}.baseUrl`, p.defaultBaseUrl || '') : '',
      configurableBaseUrl: !!p.configurableBaseUrl,
      help: p.help || '',
    }));
    const cli = await Promise.all([...host.cli.values()].map(async (a) => ({
      id: a.id, name: a.name, kind: 'cli', cmd: a.cmd, installHint: a.installHint || '', installed: await isInstalled(a.cmd),
    })));
    return { api, cli, secureStorage: secrets.available() };
  }));

  ipcMain.handle('ai:setKey', wrap(async (id, key) => {
    if (!host.ai.has(id)) throw new Error('Unknown provider.');
    const k = String(key || '').trim();
    if (k.length < 8 || k.length > 600 || /\s/.test(k)) throw new Error('That does not look like an API key.');
    secrets.set(`ai.${id}.key`, k);
  }));
  ipcMain.handle('ai:clearKey', wrap(async (id) => { secrets.delete(`ai.${id}.key`); }));

  ipcMain.handle('ai:setConfig', wrap(async (id, cfg) => {
    const p = host.ai.get(id);
    if (!p) throw new Error('Unknown provider.');
    if (cfg.model != null) {
      if (!/^[A-Za-z0-9._:/-]{1,100}$/.test(cfg.model)) throw new Error('Invalid model name.');
      store.set(`ai.${id}.model`, cfg.model);
    }
    if (cfg.baseUrl != null && p.configurableBaseUrl) {
      if (cfg.baseUrl && !URL_OK.test(cfg.baseUrl)) throw new Error('Base URL must be https:// (or http://localhost for local models).');
      store.set(`ai.${id}.baseUrl`, cfg.baseUrl);
    }
  }));

  ipcMain.handle('ai:chat', wrap(async (id, req) => {
    const p = host.ai.get(id);
    if (!p) throw new Error('Unknown provider.');
    const key = secrets.get(`ai.${id}.key`);
    if (p.needsKey !== false && !key) throw new Error(`No API key set for ${p.name}. Add it in Settings > AI.`);
    const messages = validateMessages(req.messages);
    const model = String(req.model || store.get(`ai.${id}.model`, p.defaultModel || ''));
    const baseUrl = p.configurableBaseUrl ? store.get(`ai.${id}.baseUrl`, p.defaultBaseUrl || '') : '';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 180000);
    try {
      const text = await p.chat({ model, system: String(req.system || '').slice(0, 20000), messages, key, baseUrl, signal: ctl.signal });
      return { text, model };
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('The request timed out after 3 minutes.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }));

  ipcMain.handle('ai:launchCli', wrap(async (id, ws) => {
    const a = host.cli.get(id);
    if (!a) throw new Error('Unknown agent.');
    if (!(await isInstalled(a.cmd))) throw new Error(`${a.name} is not installed. ${a.installHint || ''}`);
    terminal.openWindow(a.name, commandLine(a.cmd, a.args || []), ws || undefined);
  }));
}

module.exports = { register };
