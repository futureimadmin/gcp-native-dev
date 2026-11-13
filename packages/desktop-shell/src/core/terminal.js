/** Command runner (streams output to the renderer) and external terminal windows for interactive tools. */
const { spawn } = require('child_process');
const { killTree } = require('./util');

function create({ sendToRenderer, envProvider }) {
  const procs = new Map();
  let seq = 0;

  function start(command, cwd) {
    const id = ++seq;
    const child = spawn(command, { cwd: cwd || undefined, shell: true, env: envProvider(), windowsHide: true });
    procs.set(id, child);
    child.stdout.on('data', (d) => sendToRenderer('term:data', { id, stream: 'out', text: d.toString() }));
    child.stderr.on('data', (d) => sendToRenderer('term:data', { id, stream: 'err', text: d.toString() }));
    child.on('error', (e) => sendToRenderer('term:data', { id, stream: 'err', text: `${e.message}\n` }));
    child.on('close', (code) => {
      procs.delete(id);
      sendToRenderer('term:exit', { id, code });
    });
    return id;
  }

  function kill(id) {
    const c = procs.get(id);
    if (c) killTree(c);
  }

  function killAll() {
    for (const c of procs.values()) killTree(c);
  }

  /** Opens a real console window (full TTY) running an interactive command, e.g. an AI coding agent. */
  function openWindow(title, commandLine, cwd) {
    if (process.platform !== 'win32') throw new Error('External terminal windows are only implemented for Windows.');
    const child = spawn('cmd.exe', ['/d', '/c', 'start', `CNS ${title}`, 'cmd.exe', '/k', commandLine], {
      cwd: cwd || undefined,
      detached: true,
      stdio: 'ignore',
      env: envProvider(),
      windowsHide: false,
    });
    child.unref();
  }

  return { start, kill, killAll, openWindow };
}

module.exports = { create };
