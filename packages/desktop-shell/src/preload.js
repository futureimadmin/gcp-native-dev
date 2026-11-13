const { contextBridge, ipcRenderer } = require('electron');

// The renderer may only call these channel families and listen to these events.
const INVOKE = /^(fs|dialog|settings|secret|shell|term|host|plugin|app|cloud|proj|pipeline|project|git|ai|runtime|build|server|search|java|javac):[A-Za-z]+$/;
const EVENTS = new Set(['menu', 'term:data', 'term:exit', 'cloud:event', 'git:progress', 'plugin:event', 'ai:stream']);

contextBridge.exposeInMainWorld('cns', {
  invoke: (channel, ...args) => {
    if (!INVOKE.test(channel)) return Promise.resolve({ ok: false, error: `Blocked channel: ${channel}` });
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, cb) => {
    if (!EVENTS.has(channel)) throw new Error(`Blocked event: ${channel}`);
    const h = (_e, p) => cb(p);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
});
