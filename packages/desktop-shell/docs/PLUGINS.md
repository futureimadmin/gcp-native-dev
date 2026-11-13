# Cloud Native Studio plugin guide

Almost everything in the IDE is a plugin: the Google Cloud, AWS, Azure and Kubernetes connectors, the AI assistants,
the New Project templates and the Modernize & Migrate view are all built-in plugins under `src/plugins/builtin/`.
You can add your own (for example VMware vSphere, OpenStack, Oracle Cloud, another LLM, a language analyzer).

## Anatomy

```
my-plugin/
  plugin.json      manifest
  main.js          optional, runs in the main process: exports activate(ctx)
  renderer.js      optional, runs in the UI: calls CNS.plugin(id, api => {...})
```

```json
{
  "id": "acme.vsphere",
  "name": "VMware vSphere",
  "version": "1.0.0",
  "description": "Private cloud connector for vSphere.",
  "main": "main.js",
  "renderer": "renderer.js",
  "contributes": {
    "menus": { "cloud": [{ "label": "vSphere: Open console", "command": "acme.vsphere.console" }] },
    "views": [{ "id": "vsphere", "title": "vSphere", "icon": "▣" }]
  }
}
```

`id` must match `^[a-z0-9][a-z0-9._-]{1,60}$`.

## Installing and trust

Drop the folder into `%APPDATA%\Cloud Native Studio\plugins\` (Settings > Plugins > Open plugins folder).
Built-in plugins are trusted. **Third-party plugins run with full access to your files and credentials**, so they stay
disabled until you enable them in Settings > Plugins and confirm the warning. Restart the IDE to apply.

## Main-process API (`activate(ctx)`)

| API | Purpose |
|-----|---------|
| `ctx.cloud.register(provider)` | Add a public or private cloud (see below) |
| `ctx.ai.register(provider)` | Add a chat provider: `{id, name, models, defaultModel, needsKey, configurableBaseUrl, chat({model, system, messages, key, baseUrl, signal, cwd}) -> string}`. For providers that use an existing sign-in instead of a key set `needsKey: false, auth: "signin"` and add `status() -> {signedIn, detail}` and optionally `login: {cmd, args}` (run in a console window) |
| `ctx.ai.registerCli(agent)` | Terminal agent launched in a console window: `{id, name, cmd, installHint}` |
| `ctx.templates.register(t)` | New Project template: `{id, name, description, cloud, language, files(name) -> {path: content}}` |
| `ctx.analyzers.register(a)` | Modernize analyzer: `{id, analyze(workspacePath, analysis)}` mutates the analysis (e.g. push findings) |
| `ctx.ipc.handle(channel, fn)` | Callable from the UI with `api.invoke(channel, ...args)` |
| `ctx.emit(channel, payload)` | Push an event to the UI |
| `ctx.exec(cmd, args, {timeout, cwd, env})` | Run a CLI safely (arguments are validated/quoted). Resolves `{ok, out, err, code}` |
| `ctx.commandLine(cmd, args)` | Build a quoted command line string (use for commands you hand back for confirmation) |
| `ctx.settings.get/set(key)` | Per-plugin settings |
| `ctx.secrets.get/set/has/delete(key)` | Per-plugin secrets, encrypted with the OS keystore |
| `ctx.openTerminal(title, cmd, cwd)` | Open an interactive console window |
| `ctx.workspace()` | Current project folder or `null` |

### Cloud provider contract

```js
ctx.cloud.register({
  id: 'vsphere', name: 'VMware vSphere', short: 'vSphere', kind: 'private', color: '#78be20',
  cli: { cmd: 'govc', install: 'https://github.com/vmware/govmomi' },
  scopeLabel: 'Datacenter', defaultRegion: 'default', regions: ['default'],
  validateScope: (s) => /^[\w .-]{1,80}$/.test(s),
  validateRegion: () => true,
  consoleUrl: (scope) => 'https://vcenter.example.com/',
  async status()    { return { installed, signedIn, identity, scope, detail }; },
  login(emit)       { emit('log', '...'); emit('done', 0); },       // emit('log'|'done', payload)
  async logout()    {},
  async scopes()    { return [{ id, name, detail }]; },
  async setScope(id) {},
  async inventory(scope, opts) { return [{ category, title, detail, url }]; },   // only what the identity can use
  async resources(scope, key) { return { supported, title, items: [{id, name, region, status, detail, url}], canLogs }; },  // optional: in-IDE resource explorer (read-only)
  async resourceInfo(scope, key, item) { return "yaml/text"; },                                                  // optional
  async resourceLogs(scope, key, item) { return "log text"; },                                                    // optional
  actions: {                                                                     // all optional
    generatePipeline(proj, ws) { return { path, content }; },
    pipeline(proj, ws)  { return { title, command }; },
    deploy(proj, ws)    { return { title, command }; },
    resourceKinds(proj) { return [{ id, label, defaultName }]; },
    resource(proj, params) { return { title, command }; },
    bootstrap(proj, envs) { return { path, content }; },
  },
});
```

**Safety rule for `pipeline`, `deploy` and `resource`:** a provider only *builds* a command string. The IDE shows it
verbatim, requires a click (and typing `prod` for production), and runs exactly that string through a one-time
token. The UI can never submit arbitrary command text. Validate every user-supplied value and build commands with
`ctx.commandLine`, which rejects unsafe characters.

`proj` is the project binding from `.cnd/project.json`: `{cloud, scope, env, region, service, repo, group, impersonate}`.

## Renderer API (`CNS.plugin(id, api => ...)`)

| API | Purpose |
|-----|---------|
| `api.views.register({id, title, icon, render(container)})` | Sidebar view (also appears in the activity bar) |
| `api.commands.register(id, fn, title)` | Command; a `title` makes it appear in the command palette |
| `api.toolbar.add({command, label, icon, title})` | Toolbar button |
| `api.invoke(channel, ...args)` | Call your main-process `ctx.ipc.handle` |
| `api.ui` | `h`, `modal`, `status`, `promptText`, `confirm`, `openFile`, `openExternal`, `ctxMenu`, `showView`, `refreshTree` |
| `api.ai.ask(prompt, attachments)` | Pre-fill the AI assistant (the user reviews and sends) |
| `api.shared.get/set(key)` | Share state, e.g. `analysis` |
| `api.workspace()` / `api.cloud()` | Current project and cloud status |

Build DOM with `api.ui.h(...)` and `textContent`; never assign untrusted strings to `innerHTML` (the UI has a strict
Content-Security-Policy).

## Menus

`contributes.menus` supports the groups `cloud`, `ai`, `modernize`, `tools`. Each item runs a command id that your
renderer script registered.

See `examples/vsphere-skeleton/` for a minimal private-cloud connector.
