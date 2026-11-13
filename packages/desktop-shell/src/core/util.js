/**
 * Shared helpers: safe command-line building and a promise-based exec with timeout.
 * Commands run through the shell (needed for .cmd tools such as gcloud/az on Windows), so every argument is
 * validated/quoted here. Nothing user-typed is ever concatenated into a command line without passing quoteArg().
 */
const { spawn } = require('child_process');

const SAFE = /^[A-Za-z0-9_@+=:,./\\-]+$/;

function quoteArg(a) {
  const s = String(a);
  if (SAFE.test(s)) return s;
  if (/["%^&|<>`\r\n]/.test(s)) throw new Error(`Unsafe character in argument: ${s.slice(0, 40)}`);
  return `"${s}"`;
}

function commandLine(cmd, args = []) {
  return [cmd, ...args].map(quoteArg).join(' ');
}

function killTree(child) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill('SIGKILL');
  } catch { /* already gone */ }
}

function exec(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    let line;
    try {
      line = commandLine(cmd, args);
    } catch (e) {
      return resolve({ ok: false, out: '', err: e.message, code: -1 });
    }
    const child = spawn(line, { shell: true, cwd: opts.cwd, env: { ...process.env, ...(opts.env || {}) }, windowsHide: true });
    let out = '';
    let err = '';
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => { killTree(child); finish({ ok: false, out: out.trim(), err: err.trim() || 'Timed out', code: -2, timedOut: true }); }, opts.timeout || 20000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish({ ok: false, out, err: e.message, code: -1 }));
    child.on('close', (code) => finish({ ok: code === 0, out: out.trim(), err: err.trim(), code }));
  });
}

/** True when the failure means the tool itself is not installed. */
const isMissing = (r) => !r.ok && /not recognized|not found|ENOENT|cannot find the (file|path)/i.test(r.err + r.out);

function sanitizeName(n) {
  return (String(n).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'app').slice(0, 40);
}

module.exports = { quoteArg, commandLine, exec, killTree, isMissing, sanitizeName };
