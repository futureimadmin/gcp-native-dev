/**
 * AI lifecycle support: the read-only facts the AI assistant needs across the software life cycle.
 *  - lc:scan     security scan of the open project (secrets, risky code, risky infrastructure, dependency audit)
 *  - lc:logs     recent logs of an environment (Google Cloud, AWS) with failure detection
 *  - lc:analyze  failure detection on any text (build output, run output, pasted logs)
 *  - lc:git      what changed (status, diff summary) for reviews and release checks
 * Nothing here changes a project or a cloud. Fixes and recovery are made by the assistant in the IDE, and every command it proposes
 * is shown as a card that the user approves.
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('./util');

/* ------------------------------ failure detection ------------------------------ */

/** Known failure signatures. advice = what usually helps; recover = a safe first recovery idea the assistant can turn into commands. */
const FAILURES = [
  { id: 'oom', sev: 'high', re: /OutOfMemoryError|java\.lang\.OutOfMemory|Out of memory|Killed process|OOMKilled|Container exceeded memory|JavaScript heap out of memory|MemoryError/i, title: 'Out of memory', advice: 'The process ran out of memory. Look for large in-memory collections or leaks, then raise the memory limit or fix the allocation.', recover: 'Restart the service and raise its memory limit.' },
  { id: 'crashloop', sev: 'high', re: /CrashLoopBackOff|Back-off restarting failed container|container (failed|exited) with (status|code)|Container called exit\(|exited with code [1-9]|Application failed to start|Failed to start|startup probe failed|Container failed to start/i, title: 'The service keeps crashing or cannot start', advice: 'The application stops right after starting. The first error above this line in the log is usually the cause (configuration, missing secret, port or database).', recover: 'Roll back to the last working revision, then fix the start-up error.' },
  { id: 'port', sev: 'medium', re: /EADDRINUSE|Address already in use|Port \d+ (is )?(already )?in use|BindException/i, title: 'Port already in use', advice: 'Another process holds the port. Stop it or change the port.', recover: 'Stop the other process, or run on another port.' },
  { id: 'conn', sev: 'high', re: /ECONNREFUSED|Connection refused|Connection reset|connect: connection refused|Could not connect|UnknownHostException|getaddrinfo ENOTFOUND|no route to host/i, title: 'Cannot reach a dependency', advice: 'A database, API or queue is unreachable: check its address, network rules (VPC, security group, firewall) and that it is running.', recover: 'Check the dependency address and network rules.' },
  { id: 'timeout', sev: 'medium', re: /timed? ?out|DEADLINE_EXCEEDED|504 Gateway|Read timed out|SocketTimeout|context deadline exceeded/i, title: 'Timeouts', advice: 'Calls are too slow. Check the slow dependency, connection pool size and timeouts.', recover: 'Scale up or out, then find the slow call.' },
  { id: 'auth', sev: 'high', re: /AccessDenied|PERMISSION_DENIED|403 Forbidden|Forbidden|Unauthorized|401 Unauthorized|is not authorized to perform|insufficient permissions|AuthorizationFailed|invalid_grant|ExpiredToken/i, title: 'Permission or sign-in problem', advice: 'A role or credential is missing a permission, or has expired. The message names the action: grant exactly that, no more.', recover: 'Grant the one missing permission or refresh the credentials.' },
  { id: 'db', sev: 'high', re: /SQLException|deadlock detected|too many connections|FATAL:\s+(password|database|role)|relation ".*" does not exist|duplicate key value|Lock wait timeout|SQLSTATE/i, title: 'Database error', advice: 'The database rejected or failed a query: check credentials, schema migration, connection limits and locks.', recover: 'Check the database connection and the last migration.' },
  { id: 'http5xx', sev: 'high', re: /\b(HTTP\/[\d.]+"?\s+|status[=: ]+|" )5\d\d\b|Internal Server Error|502 Bad Gateway|503 Service Unavailable/i, title: 'Server errors (HTTP 5xx)', advice: 'Requests are failing on the server side. Find the exception logged at the same time.', recover: 'Roll back if this started after a deployment.' },
  { id: 'exception', sev: 'medium', re: /Exception in thread|Caused by: |Unhandled(Promise)?Rejection|Traceback \(most recent call last\)|panic: |Uncaught (Type|Reference|Range)?Error|NullPointerException|TypeError:|ReferenceError:|segmentation fault/i, title: 'Unhandled exceptions', advice: 'The code threw an exception that is not handled. The stack trace names the file and line.', recover: '' },
  { id: 'disk', sev: 'medium', re: /ENOSPC|No space left on device|disk quota exceeded/i, title: 'Disk full', advice: 'The disk is full: clear temporary files or increase the volume.', recover: 'Free disk space or enlarge the volume.' },
  { id: 'quota', sev: 'medium', re: /RESOURCE_EXHAUSTED|Quota exceeded|rate limit|429 Too Many Requests|Throttl(ing|ed)|LimitExceeded/i, title: 'Quota or rate limit', advice: 'A limit was reached. Back off and retry, or raise the quota.', recover: 'Slow the caller or request a higher quota.' },
  { id: 'build', sev: 'medium', re: /COMPILATION ERROR|BUILD FAILURE|error TS\d+|cannot find symbol|error: cannot|SyntaxError|ModuleNotFoundError|Cannot find module|Could not resolve dependenc|FAILURE: Build failed|error CS\d+|undefined: |could not import/i, title: 'Build or compile error', advice: 'The code does not compile: fix the first error shown, later ones are often consequences.', recover: '' },
  { id: 'test', sev: 'medium', re: /Tests? run:.*Failures: [1-9]|FAILED|AssertionError|Tests failed|\d+ failing|expected .* (to equal|but was)/i, title: 'Failing tests', advice: 'A test fails. Decide whether the code or the test is wrong, then fix that one.', recover: '' },
];

const SEV = { high: 3, medium: 2, low: 1 };

/** Finds known failures in log text. Returns findings with a count and the first matching line as a sample. */
function analyzeLogs(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const f of FAILURES) {
    let count = 0; let sample = ''; let at = -1;
    for (let i = 0; i < lines.length; i++) if (f.re.test(lines[i])) { count++; if (!sample) { sample = lines[i].trim().slice(0, 240); at = i; } }
    if (count) out.push({ id: f.id, severity: f.sev, title: f.title, count, sample, line: at + 1, advice: f.advice, recover: f.recover });
  }
  return out.sort((a, b) => SEV[b.severity] - SEV[a.severity] || b.count - a.count);
}

/* ------------------------------ security scan ------------------------------ */

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'build', 'dist', '.gradle', '.idea', '.vscode', 'bin', 'obj', 'venv', '.venv', '__pycache__', '.nativity', '.cnd', 'vendor', 'coverage', '.next', '.terraform']);
const TEXT_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|java|kt|kts|py|go|cs|rb|php|rs|scala|sh|ps1|bat|cmd|json|ya?ml|toml|properties|xml|env|ini|cfg|conf|tf|tfvars|bicep|gradle|sql|html|md|txt|dockerfile)$/i;

const SECRET_RULES = [
  { id: 'aws-key', sev: 'critical', title: 'AWS access key id', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'private-key', sev: 'critical', title: 'Private key in the code', re: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'gcp-key', sev: 'critical', title: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'gh-token', sev: 'critical', title: 'GitHub token', re: /\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{30,}\b/ },
  { id: 'slack-token', sev: 'critical', title: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'anthropic-key', sev: 'critical', title: 'AI provider key', re: /\bsk-(ant-)?[A-Za-z0-9_-]{32,}\b/ },
  { id: 'password', sev: 'high', title: 'Password written in a file', re: /\b(password|passwd|pwd|secret|api[_-]?key|token)\b\s*[:=]\s*["'][^"'\s${}<>]{6,}["']/i },
  { id: 'conn-pass', sev: 'high', title: 'Password inside a connection string', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/${}]{3,}@[^\s/]+/i },
];

const CODE_RULES = [
  { id: 'eval', sev: 'high', title: 'Dynamic code execution (eval)', re: /\beval\s*\(|new Function\s*\(/, ext: /\.(js|jsx|ts|tsx|mjs|py)$/i },
  { id: 'exec-concat', sev: 'high', title: 'Command built from text (injection risk)', re: /(child_process|exec|execSync|spawn)\s*\([^)]*(\+|\$\{)|Runtime\.getRuntime\(\)\.exec\([^)]*\+|os\.system\([^)]*(\+|%|f")|subprocess\.[a-z]+\([^)]*shell\s*=\s*True/i, ext: /\.(js|ts|java|kt|py)$/i },
  { id: 'sql-concat', sev: 'high', title: 'SQL built from text (injection risk)', re: /["'](SELECT|INSERT|UPDATE|DELETE)\b[^"']*["']\s*\+|executeQuery\([^)]*\+|f"(SELECT|INSERT|UPDATE|DELETE)\b[^"]*\{/i, ext: /\.(js|ts|java|kt|py|cs|php)$/i },
  { id: 'weak-hash', sev: 'medium', title: 'Weak hash (MD5 or SHA-1)', re: /createHash\(\s*["'](md5|sha1)["']|MessageDigest\.getInstance\(\s*"(MD5|SHA-?1)"|hashlib\.(md5|sha1)\(/i, ext: /\.(js|ts|java|kt|py)$/i },
  { id: 'tls-off', sev: 'high', title: 'Certificate checks switched off', re: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|TrustAllCerts|ALLOW_ALL_HOSTNAME_VERIFIER/i, ext: /\.(js|ts|java|kt|py|go|cs|env|sh)$/i },
  { id: 'cors-all', sev: 'medium', title: 'Any website may call this API (CORS *)', re: /Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*["']|origins?\s*[:=]\s*\[?["']\*["']|allowedOrigins\(\s*"\*"/i, ext: /\.(js|ts|java|kt|py|yaml|yml|properties|json)$/i },
  { id: 'debug-on', sev: 'low', title: 'Debug mode left on', re: /\bDEBUG\s*=\s*True\b|app\.run\([^)]*debug\s*=\s*True/, ext: /\.py$/i },
];

const INFRA_RULES = [
  { id: 'open-world', sev: 'high', title: 'Open to the whole internet (0.0.0.0/0)', re: /0\.0\.0\.0\/0|::\/0/, ext: /\.(tf|tfvars|ya?ml|json|bicep)$/i },
  { id: 'iam-star', sev: 'high', title: 'Permission to do everything (*)', re: /["']?(Action|actions)["']?\s*[:=]\s*\[?\s*["']\*["']|["']?(Resource)["']?\s*[:=]\s*["']\*["']\s*$|roles\/(owner|editor)\b|AdministratorAccess|Microsoft\.Authorization\/\*/i, ext: /\.(tf|ya?ml|json|bicep)$/i },
  { id: 'public-bucket', sev: 'high', title: 'Public storage', re: /acl\s*=\s*["']public-read|PublicAccessBlock[^\n]*false|allUsers|allAuthenticatedUsers|publicAccess\s*[:=]\s*["']?(Blob|Container)|BlockPublicAcls\s*:\s*false/i, ext: /\.(tf|ya?ml|json|bicep)$/i },
  { id: 'no-encryption', sev: 'medium', title: 'Storage not encrypted', re: /(storage_encrypted|encrypted|enable_https_traffic_only|supportsHttpsTrafficOnly)\s*[:=]\s*(false|"false")/i, ext: /\.(tf|ya?ml|json|bicep)$/i },
  { id: 'root-container', sev: 'medium', title: 'Container runs as root', re: /^\s*USER\s+root\b|privileged\s*:\s*true|runAsUser\s*:\s*0\b/i, ext: /(dockerfile|\.ya?ml)$/i },
];

const MAX_FILE = 400 * 1024;
const MAX_FILES = 6000;

function walk(root) {
  const files = [];
  const rec = (dir, depth) => {
    if (files.length >= MAX_FILES || depth > 8) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) rec(p, depth + 1); }
      else if (e.isFile() && (TEXT_EXT.test(e.name) || /^dockerfile$/i.test(e.name) || /^\.env/.test(e.name))) files.push(p);
    }
  };
  rec(root, 0);
  return files;
}

const maskLine = (s) => String(s).trim().replace(/(["'=:]\s*["']?)([A-Za-z0-9/+_.-]{4})[A-Za-z0-9/+_.=-]{6,}/g, '$1$2…').slice(0, 160);

/** Scans text files for leaked secrets, risky code and risky infrastructure. Secret values are masked in the result. */
function scanFiles(root) {
  const findings = [];
  const files = walk(root);
  for (const file of files) {
    let st; try { st = fs.statSync(file); } catch { continue; }
    if (st.size > MAX_FILE) continue;
    let text; try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (text.indexOf('\u0000') >= 0) continue;
    const rel = path.relative(root, file).split(path.sep).join('/');
    const base = path.basename(file);
    const isExample = /example|sample|template|\.md$|test|spec|fixture/i.test(rel);
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && i < 4000; i++) {
      const line = lines[i];
      if (line.length > 600) continue;
      for (const r of SECRET_RULES) {
        if (!r.re.test(line)) continue;
        if (isExample && r.sev !== 'critical') continue;
        if (/\b(process\.env|System\.getenv|os\.environ|getenv|\$\{|<[A-Z_]+>|changeme|example|your[_-]|xxxx|\*\*\*\*)/i.test(line)) continue;
        findings.push({ kind: 'secret', rule: r.id, severity: r.sev, title: r.title, file: rel, line: i + 1, text: maskLine(line) });
      }
      for (const r of CODE_RULES) if ((!r.ext || r.ext.test(base)) && r.re.test(line) && !isExample) findings.push({ kind: 'code', rule: r.id, severity: r.sev, title: r.title, file: rel, line: i + 1, text: line.trim().slice(0, 160) });
      for (const r of INFRA_RULES) if ((!r.ext || r.ext.test(base)) && r.re.test(line)) findings.push({ kind: 'infra', rule: r.id, severity: r.sev, title: r.title, file: rel, line: i + 1, text: line.trim().slice(0, 160) });
    }
  }
  return { findings, scanned: files.length };
}

const RANK = { critical: 4, high: 3, medium: 2, low: 1 };

/** npm audit for Node.js projects (needs npm; skipped quietly when it is missing or offline). */
async function dependencyAudit(root) {
  if (!fs.existsSync(path.join(root, 'package.json'))) return { ran: false, findings: [], note: '' };
  const r = await exec('npm', ['audit', '--json', '--omit=dev'], { cwd: root, timeout: 70000 });
  let j = null;
  try { j = JSON.parse(r.out); } catch { /* not JSON */ }
  if (!j || !j.vulnerabilities) return { ran: true, findings: [], note: j && j.error ? String(j.error.summary || 'npm audit could not run.').slice(0, 160) : 'npm audit gave no result (offline or no lock file).' };
  const findings = Object.values(j.vulnerabilities).map((v) => ({
    kind: 'dependency', rule: 'npm-audit', severity: v.severity === 'critical' ? 'critical' : v.severity === 'high' ? 'high' : v.severity === 'moderate' ? 'medium' : 'low',
    title: `Vulnerable dependency: ${v.name}`, file: 'package.json', line: 0,
    text: `${v.name} ${v.range || ''} (${v.severity})${v.fixAvailable ? (v.fixAvailable === true ? ', a fix is available' : `, fix: ${v.fixAvailable.name}@${v.fixAvailable.version}`) : ', no fix yet'}`,
  }));
  return { ran: true, findings, note: '' };
}

/* ------------------------------ logs ------------------------------ */

const OK = { gcp: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, region: /^[a-z0-9-]{3,25}$/, group: /^\/[A-Za-z0-9._/-]{1,200}$/, profile: /^[A-Za-z0-9._-]{1,60}$/ };

function register({ ipcMain, wrap, flow }) {
  ipcMain.handle('lc:scan', wrap(async (ws) => {
    const root = path.resolve(String(ws || ''));
    if (!fs.existsSync(root)) throw new Error('Open a project first.');
    const a = scanFiles(root);
    const d = await dependencyAudit(root).catch(() => ({ ran: false, findings: [], note: '' }));
    const findings = [...a.findings, ...d.findings].sort((x, y) => RANK[y.severity] - RANK[x.severity]).slice(0, 300);
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of findings) counts[f.severity]++;
    return { findings, counts, scanned: a.scanned, audit: d.ran ? (d.note || 'Dependencies checked with npm audit.') : 'Dependency audit runs for Node.js projects; for Maven, Gradle or Python use your own scanner or ask the assistant.' };
  }));

  ipcMain.handle('lc:analyze', wrap(async (text) => ({ findings: analyzeLogs(String(text || '').slice(-200000)) })));

  ipcMain.handle('lc:logs', wrap(async (ws, env) => {
    const p = await flow.loadProj(String(ws));
    const name = String(env || p.env);
    const tg = (p.app && p.apps && p.apps[p.app] ? p.apps[p.app].targets : p.targets) || {};
    const cloud = p.cloud;
    const t = (tg[cloud] || {})[name];
    if (!t) throw new Error(`Environment "${name}" has not been created on ${cloud.toUpperCase()} yet.`);
    const app = p.app || p.service || '';
    let r; let source;
    if (cloud === 'gcp') {
      if (!OK.gcp.test(t.scope || '')) throw new Error('No Google Cloud project is recorded for this environment.');
      source = `Google Cloud project ${t.scope} (warnings and errors, last 2 hours)`;
      r = await exec('gcloud', ['logging', 'read', 'severity>=WARNING', `--project=${t.scope}`, '--freshness=2h', '--limit=120', '--format=value(timestamp,severity,resource.labels.service_name,textPayload,jsonPayload.message,httpRequest.status)'], { timeout: 60000 });
    } else if (cloud === 'aws') {
      const group = `/${app}/${name}`;
      if (!OK.group.test(group) || !OK.region.test(t.region || '')) throw new Error('No log group is recorded for this environment.');
      source = `AWS log group ${group} (last 2 hours)`;
      const args = ['logs', 'tail', group, '--since', '2h', '--region', t.region];
      if (OK.profile.test(t.scope || '') && t.scope !== 'default') args.push('--profile', t.scope);
      r = await exec('aws', args, { timeout: 60000 });
    } else {
      throw new Error('Live logs are available for Google Cloud and AWS. For this cloud, paste the logs into the assistant or use its console.');
    }
    if (!r.ok) throw new Error(/ResourceNotFound|does not exist/i.test(r.err) ? 'No log group yet: the application has not logged anything here.' : `Could not read the logs (${(r.err || '').trim().split(String.fromCharCode(10))[0].slice(0, 160) || 'sign in first'}).`);
    const text = r.out.split(/\r?\n/).slice(-400).join(String.fromCharCode(10));
    return { env: name, cloud, source, text, findings: analyzeLogs(text) };
  }));

  ipcMain.handle('lc:git', wrap(async (ws) => {
    const cwd = path.resolve(String(ws || ''));
    if (!fs.existsSync(path.join(cwd, '.git'))) return { git: false };
    const g = (args) => exec('git', args, { cwd, timeout: 30000 });
    const [st, stat, diff, br] = await Promise.all([g(['status', '--porcelain=v1']), g(['diff', '--stat', 'HEAD']), g(['diff', 'HEAD', '--no-color', '-U2']), g(['rev-parse', '--abbrev-ref', 'HEAD'])]);
    const changed = st.out.split(/\r?\n/).filter(Boolean);
    return { git: true, branch: br.out.trim(), changed: changed.length, files: changed.slice(0, 60), stat: stat.out.trim().slice(-3000), diff: diff.out.slice(0, 60000), truncated: diff.out.length > 60000 };
  }));
}

module.exports = { register, analyzeLogs, scanFiles, FAILURES };
