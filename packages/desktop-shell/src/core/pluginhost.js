/**
 * Plugin host.
 *
 * A plugin is a folder with plugin.json:
 *   { "id": "vendor.name", "name": "...", "version": "1.0.0",
 *     "main": "main.js",          // optional, runs in the main process: exports activate(ctx)
 *     "renderer": "renderer.js",  // optional, loaded in the UI: calls CNS.plugin(id, api => {...})
 *     "contributes": { "commands": [], "menus": {"cloud": [], "ai": [], "tools": []}, "toolbar": [], "views": [] } }
 *
 * Built-in plugins (src/plugins/builtin) are trusted. Plugins in <userData>/plugins run with full local access,
 * so they stay disabled until the user explicitly enables them in Settings > Plugins.
 *
 * Extension points available to main-process plugins through ctx:
 *   ctx.cloud.register(provider)      public or private cloud connectors (see docs/PLUGINS.md)
 *   ctx.ai.register(provider)         chat/LLM providers
 *   ctx.ai.registerCli(agent)         interactive CLI coding agents launched in a terminal window
 *   ctx.templates.register(template)  New Project templates
 *   ctx.analyzers.register(analyzer)  modernization analyzers
 *   ctx.ipc.handle(channel, fn)       callable from the UI as cns.plugin(id, channel, ...args)
 */
const fs = require('fs');
const path = require('path');
const util = require('./util');

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,60}$/;

class PluginHost {
  constructor({ store, secrets, sendToRenderer, terminal, userPluginDir, builtinDir, getWorkspace }) {
    this.store = store;
    this.secrets = secrets;
    this.send = sendToRenderer;
    this.terminal = terminal;
    this.dirs = [
      { dir: builtinDir, builtin: true },
      { dir: userPluginDir, builtin: false },
    ];
    this.getWorkspace = getWorkspace;
    this.plugins = new Map();
    this.handlers = new Map();
    this.clouds = new Map();
    this.ai = new Map();
    this.cli = new Map();
    this.templates = [];
    this.analyzers = [];
  }

  loadAll() {
    for (const { dir, builtin } of this.dirs) {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        this.load(path.join(dir, e.name), builtin);
      }
    }
  }

  load(root, builtin) {
    let m;
    try {
      m = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
    } catch {
      return;
    }
    if (!m || !ID_RE.test(String(m.id)) || this.plugins.has(m.id)) return;
    const inside = (rel) => {
      const abs = path.resolve(root, rel);
      return abs.startsWith(path.resolve(root) + path.sep) ? abs : null;
    };
    const p = {
      id: m.id,
      name: m.name || m.id,
      version: m.version || '0.0.0',
      description: m.description || '',
      builtin,
      root,
      main: m.main ? inside(m.main) : null,
      renderer: m.renderer ? inside(m.renderer) : null,
      contributes: m.contributes || {},
      enabled: builtin || this.store.get(`plugins.enabled.${m.id.replace(/\./g, '_')}`, false) === true,
      error: '',
    };
    this.plugins.set(p.id, p);
    if (p.enabled && p.main) this.activate(p);
  }

  activate(p) {
    try {
      const mod = require(p.main);
      if (typeof mod.activate === 'function') mod.activate(this.makeContext(p));
    } catch (e) {
      p.error = String((e && e.message) || e);
      console.error(`[plugin ${p.id}] activation failed:`, e);
    }
  }

  makeContext(p) {
    const ns = p.id.replace(/\./g, '_');
    const host = this;
    return {
      id: p.id,
      log: (...a) => console.log(`[${p.id}]`, ...a),
      exec: util.exec,
      commandLine: util.commandLine,
      quoteArg: util.quoteArg,
      isMissing: util.isMissing,
      sanitizeName: util.sanitizeName,
      workspace: () => host.getWorkspace(),
      settings: {
        get: (k, d) => host.store.get(`plugins.${ns}.${k}`, d),
        set: (k, v) => host.store.set(`plugins.${ns}.${k}`, v),
        // Reads core settings (read-only) so e.g. region defaults can be shared.
        core: (k, d) => host.store.get(k, d),
      },
      secrets: {
        has: (k) => host.secrets.has(`${ns}.${k}`),
        get: (k) => host.secrets.get(`${ns}.${k}`),
        set: (k, v) => host.secrets.set(`${ns}.${k}`, v),
        delete: (k) => host.secrets.delete(`${ns}.${k}`),
      },
      emit: (channel, payload) => host.send('plugin:event', { id: p.id, channel, payload }),
      openTerminal: (title, cmd, cwd) => host.terminal.openWindow(title, cmd, cwd),
      ipc: { handle: (channel, fn) => host.handlers.set(`${p.id}:${channel}`, fn) },
      cloud: { register: (prov) => host.registerCloud(p, prov) },
      ai: {
        register: (prov) => host.ai.set(prov.id, { ...prov, plugin: p.id }),
        registerCli: (agent) => host.cli.set(agent.id, { ...agent, plugin: p.id }),
        secret: (provId, k) => host.secrets.get(`ai.${provId}.${k}`),
        setting: (provId, k, d) => host.store.get(`ai.${provId}.${k}`, d),
      },
      templates: { register: (t) => host.templates.push({ ...t, plugin: p.id }) },
      analyzers: { register: (a) => host.analyzers.push({ ...a, plugin: p.id }) },
      analyzersList: () => host.analyzers,
      clouds: () => [...host.clouds.values()],
    };
  }

  registerCloud(p, prov) {
    const required = ['id', 'name', 'status', 'scopes', 'inventory'];
    for (const k of required) if (!prov[k]) throw new Error(`Cloud provider is missing "${k}"`);
    this.clouds.set(prov.id, { ...prov, plugin: p.id, actions: prov.actions || {} });
  }

  async invoke(id, channel, args) {
    const fn = this.handlers.get(`${id}:${channel}`);
    if (!fn) throw new Error(`Plugin ${id} has no handler "${channel}"`);
    return fn(...(args || []));
  }

  /** What the UI needs: manifests, renderer entry URLs, contributions. */
  describe() {
    return [...this.plugins.values()].map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      builtin: p.builtin,
      enabled: p.enabled,
      error: p.error,
      rendererPath: p.enabled && p.renderer ? p.renderer : '',
      contributes: p.contributes,
    }));
  }

  setEnabled(id, on) {
    const p = this.plugins.get(id);
    if (!p || p.builtin) return;
    this.store.set(`plugins.enabled.${id.replace(/\./g, '_')}`, !!on);
  }
}

module.exports = { PluginHost };
