/**
 * Source Control (Git) - main process.
 * Git is the engine; the HOST (GitHub, GitLab, Bitbucket, Azure DevOps, Gitea/Forgejo/Codeberg, self-hosted ...) is detected from the
 * remote URL and only changes the logo and the "open on the web" links. So any Git server works, including your own.
 *
 * Safety: git is started WITHOUT a shell, with an argument array, so no value can be read as a command. Branch / remote / tag names and URLs
 * are validated, file lists travel through a temporary pathspec file, and commit messages go in on stdin. Credentials are never handled here:
 * Git Credential Manager / SSH agent do the sign-in (HTTPS and SSH both work); prompts that cannot be shown fail fast instead of hanging.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REF_RE = /^(?!-)[A-Za-z0-9._/@{}^~+-]{1,200}$/;
const NAME_RE = /^(?!-)[A-Za-z0-9._-]{1,80}$/;
const HASH_RE = /^[0-9a-f]{4,64}$/i;
const URL_RE = /^(?:(?:https?|ssh|git|file):\/\/[^\s"'`&|<>^%]+|[\w.-]+@[\w.-]+:[\w./~+-]+|[A-Za-z]:[\\/][^"'`&|<>^%\r\n]*|\/[^"'`&|<>^%\r\n]*)$/;

/** Which Git host a remote URL belongs to, and its web address. */
function parseRemote(url) {
  let host = '';
  let repo = '';
  let m;
  if ((m = /^(?:ssh:\/\/)?(?:[^@/]+@)?ssh\.dev\.azure\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url))) return { host: 'dev.azure.com', kind: 'azuredevops', web: `https://dev.azure.com/${m[1]}/${m[2]}/_git/${m[3]}`, name: 'Azure DevOps' };
  if ((m = /^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(url))) { host = m[1]; repo = m[2]; }
  else if ((m = /^(?:ssh:\/\/)?[^@/]+@([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/.exec(url))) { host = m[1]; repo = m[2]; }
  else return { host: '', kind: 'generic', web: '', name: 'Git' };
  const h = host.toLowerCase();
  let kind = 'generic';
  if (/github/.test(h)) kind = 'github';
  else if (/gitlab/.test(h)) kind = 'gitlab';
  else if (/bitbucket/.test(h)) kind = 'bitbucket';
  else if (h === 'dev.azure.com' || /\.visualstudio\.com$/.test(h)) kind = 'azuredevops';
  else if (/gitea|forgejo|codeberg/.test(h)) kind = 'gitea';
  const names = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket', azuredevops: 'Azure DevOps', gitea: 'Gitea / Forgejo', generic: host || 'Git' };
  return { host, kind, web: `https://${host}/${repo}`, name: names[kind] };
}

function webLink(info, what, branch, base) {
  if (!info.web) return '';
  const w = info.web;
  const b = encodeURIComponent(branch || '').replace(/%2F/g, '/');
  const bq = encodeURIComponent(branch || '');
  switch (what) {
    case 'repo': return w;
    case 'commit': return { github: `${w}/commit/${bq}`, gitlab: `${w}/-/commit/${bq}`, bitbucket: `${w}/commits/${bq}`, azuredevops: `${w}/commit/${bq}`, gitea: `${w}/commit/${bq}` }[info.kind] || w;
    case 'branch': return { github: `${w}/tree/${b}`, gitlab: `${w}/-/tree/${b}`, bitbucket: `${w}/src/${b}`, azuredevops: `${w}?version=GB${bq}`, gitea: `${w}/src/branch/${b}` }[info.kind] || w;
    case 'commits': return { github: `${w}/commits/${b}`, gitlab: `${w}/-/commits/${b}`, bitbucket: `${w}/commits/branch/${b}`, azuredevops: `${w}/commits?itemVersion=GB${bq}`, gitea: `${w}/commits/branch/${b}` }[info.kind] || w;
    case 'newpr': return { github: `${w}/compare/${b}?expand=1`, gitlab: `${w}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${bq}`, bitbucket: `${w}/pull-requests/new?source=${bq}`, azuredevops: `${w}/pullrequestcreate?sourceRef=${bq}`, gitea: `${w}/compare/${base || 'main'}...${b}` }[info.kind] || w;
    case 'prs': return { github: `${w}/pulls`, gitlab: `${w}/-/merge_requests`, bitbucket: `${w}/pull-requests`, azuredevops: `${w}/pullrequests`, gitea: `${w}/pulls` }[info.kind] || w;
    case 'issues': return { github: `${w}/issues`, gitlab: `${w}/-/issues`, bitbucket: `${w}/issues`, azuredevops: w.replace(/\/_git\/.*/, '/_workitems'), gitea: `${w}/issues` }[info.kind] || w;
    case 'ci': return { github: `${w}/actions`, gitlab: `${w}/-/pipelines`, bitbucket: `${w}/pipelines`, azuredevops: w.replace(/\/_git\/.*/, '/_build'), gitea: `${w}/actions` }[info.kind] || w;
    default: return w;
  }
}

exports.activate = (ctx) => {
  const rootCache = new Map();

  const must = (cond, msg) => { if (!cond) throw new Error(msg); };
  const checkWs = (ws) => {
    const cur = ctx.workspace();
    must(cur && ws && path.resolve(ws).toLowerCase() === path.resolve(cur).toLowerCase(), 'That folder is not the open project.');
    return path.resolve(ws);
  };

  /** Runs git without a shell. Resolves { ok, out, err, code } (never throws). */
  function run(cwd, args, o = {}) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn('git', ['-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args], { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C.UTF-8', ...(o.env || {}) } });
      } catch (e) { return resolve({ ok: false, out: '', err: e.message, code: -1 }); }
      let out = '';
      let err = '';
      let done = false;
      const max = o.max || 8 * 1024 * 1024;
      const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
      const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ ok: false, out, err: err || 'Timed out', code: -2, timedOut: true }); }, o.timeout || 30000);
      child.stdout.on('data', (d) => { if (out.length < max) out += d.toString('utf8'); });
      child.stderr.on('data', (d) => { const t = d.toString('utf8'); err += t; if (o.progress) ctx.emit('progress', { id: o.progress, text: t }); });
      child.on('error', (e) => finish({ ok: false, out, err: /ENOENT/.test(e.message) ? 'Git is not installed (or not on PATH). Install Git for Windows from https://git-scm.com' : e.message, code: -1, missing: /ENOENT/.test(e.message) }));
      child.on('close', (code) => finish({ ok: code === 0, out, err: err.trim(), code }));
      if (o.input != null) { child.stdin.on('error', () => {}); child.stdin.end(o.input); } else child.stdin.end();
    });
  }
  const fail = (r, what) => { throw new Error(String(r.err || r.out || `${what} failed (exit ${r.code})`).split(/\r?\n/).filter(Boolean).slice(-8).join('\n')); };
  const okOrThrow = (r, what) => { if (!r.ok) fail(r, what); return r; };

  /** Folder of the repository that contains the project (null when there is none). */
  async function repoRoot(ws, fresh) {
    const hit = rootCache.get(ws);
    if (hit && !fresh && Date.now() - hit.at < 8000) return hit.root;
    const r = await run(ws, ['rev-parse', '--show-toplevel'], { timeout: 15000 });
    const root = r.ok ? path.normalize(r.out.trim()) : null;
    rootCache.set(ws, { at: Date.now(), root, missing: !!r.missing, err: r.err });
    return root;
  }
  async function need(ws) {
    const w = checkWs(ws);
    const root = await repoRoot(w);
    must(root, 'This folder is not a Git repository. Use "Initialize repository" or "Clone".');
    return { w, root };
  }

  /** Writes a NUL-separated pathspec file for --pathspec-from-file. */
  function pathspec(paths) {
    must(Array.isArray(paths) && paths.length && paths.length <= 5000, 'No files selected.');
    for (const p of paths) must(typeof p === 'string' && p && !p.includes('\0') && !path.isAbsolute(p) && !p.split(/[\\/]/).includes('..'), 'Invalid file path.');
    const f = path.join(os.tmpdir(), `nativity-git-${crypto.randomBytes(6).toString('hex')}`);
    fs.writeFileSync(f, paths.join('\0'));
    return { args: [`--pathspec-from-file=${f}`, '--pathspec-file-nul'], done: () => { try { fs.unlinkSync(f); } catch { /* ignore */ } } };
  }
  async function withPaths(root, paths, fn) { const ps = pathspec(paths); try { return await fn(ps.args); } finally { ps.done(); } }

  /* ------------------------------ status ------------------------------ */

  function parseStatus(text) {
    const parts = text.split('\0');
    const head = parts.shift() || '';
    const info = { branch: '', upstream: '', ahead: 0, behind: 0, detached: false, unborn: false };
    let m;
    if ((m = /^## No commits yet on (.+)$/.exec(head)) || (m = /^## Initial commit on (.+)$/.exec(head))) { info.branch = m[1]; info.unborn = true; }
    else if (/^## HEAD \(no branch\)/.test(head)) { info.detached = true; info.branch = 'HEAD'; }
    else if ((m = /^## (.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(head))) {
      info.branch = m[1]; info.upstream = m[2] || '';
      if (m[3]) { const a = /ahead (\d+)/.exec(m[3]); const b = /behind (\d+)/.exec(m[3]); info.ahead = a ? +a[1] : 0; info.behind = b ? +b[1] : 0; info.gone = /gone/.test(m[3]); }
    }
    const files = [];
    for (let i = 0; i < parts.length; i++) {
      const e = parts[i];
      if (e.length < 4) continue;
      const x = e[0]; const y = e[1]; const p = e.slice(3);
      const f = { path: p, x, y };
      if (x === 'R' || x === 'C' || y === 'R' || y === 'C') f.orig = parts[++i] || '';
      files.push(f);
    }
    return { ...info, files };
  }

  async function status(ws) {
    const w = checkWs(ws);
    const root = await repoRoot(w, true);
    if (!root) { const c = rootCache.get(w) || {}; return { repo: false, gitMissing: !!c.missing, gitError: c.missing ? c.err : '' }; }
    const [st, remotes, stash, user, last] = await Promise.all([
      run(root, ['status', '--porcelain=v1', '-b', '-z', '-uall'], { timeout: 60000 }),
      run(root, ['remote', '-v']),
      run(root, ['stash', 'list']),
      run(root, ['config', 'user.name']).then(async (n) => ({ name: n.out.trim(), email: (await run(root, ['config', 'user.email'])).out.trim() })),
      run(root, ['log', '-1', '--format=%h%x1f%s']),
    ]);
    const parsed = parseStatus(st.out);
    const rm = new Map();
    for (const line of remotes.out.split(/\r?\n/)) { const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim()); if (m && m[3] === 'fetch') rm.set(m[1], m[2]); }
    const remoteList = [...rm].map(([name, url]) => ({ name, url, ...parseRemote(url) }));
    const primary = remoteList.find((r) => r.name === 'origin') || remoteList[0] || null;
    const gd = path.join(root, '.git');
    const state = fs.existsSync(path.join(gd, 'MERGE_HEAD')) ? 'merging' : (fs.existsSync(path.join(gd, 'rebase-merge')) || fs.existsSync(path.join(gd, 'rebase-apply'))) ? 'rebasing' : fs.existsSync(path.join(gd, 'CHERRY_PICK_HEAD')) ? 'cherry-picking' : fs.existsSync(path.join(gd, 'REVERT_HEAD')) ? 'reverting' : '';
    const lastParts = last.out.trim().split('\x1f');
    return {
      repo: true, root, ...parsed, remotes: remoteList, host: primary, stashCount: stash.out.split(/\r?\n/).filter(Boolean).length, user, state,
      lastCommit: lastParts.length > 1 ? { short: lastParts[0], subject: lastParts[1] } : null,
    };
  }

  /* ------------------------------ working tree ------------------------------ */

  const handlers = {
    status,

    async init(ws) {
      const w = checkWs(ws);
      let r = await run(w, ['init', '-b', 'main']);
      if (!r.ok) r = await run(w, ['init']);
      okOrThrow(r, 'git init');
      rootCache.delete(w);
      return true;
    },

    async stage(ws, paths) { const { root } = await need(ws); await withPaths(root, paths, async (a) => okOrThrow(await run(root, ['add', '-A', ...a]), 'git add')); return true; },
    async stageAll(ws) { const { root } = await need(ws); okOrThrow(await run(root, ['add', '-A'], { timeout: 120000 }), 'git add'); return true; },
    async unstage(ws, paths) {
      const { root } = await need(ws);
      const hasHead = (await run(root, ['rev-parse', '--verify', 'HEAD'])).ok;
      await withPaths(root, paths, async (a) => okOrThrow(await run(root, hasHead ? ['restore', '--staged', ...a] : ['rm', '--cached', '-r', '-q', ...a]), 'unstage'));
      return true;
    },
    async unstageAll(ws) {
      const { root } = await need(ws);
      const hasHead = (await run(root, ['rev-parse', '--verify', 'HEAD'])).ok;
      okOrThrow(await run(root, hasHead ? ['reset', '-q'] : ['rm', '--cached', '-r', '-q', '.']), 'unstage');
      return true;
    },
    async discard(ws, paths) { const { root } = await need(ws); await withPaths(root, paths, async (a) => okOrThrow(await run(root, ['restore', ...a]), 'discard')); return true; },
    async resolved(ws, paths) { return handlers.stage(ws, paths); },
    async useSide(ws, { path: p, side }) { // conflict: take "ours" or "theirs" for one file
      const { root } = await need(ws);
      must(['ours', 'theirs'].includes(side), 'Choose ours or theirs.');
      await withPaths(root, [p], async (a) => { okOrThrow(await run(root, ['checkout', `--${side}`, '--', p]), 'checkout'); okOrThrow(await run(root, ['add', ...a]), 'add'); });
      return true;
    },

    /* ------------------------------ commit ------------------------------ */

    async lastMessage(ws) {
      const { root } = await need(ws);
      const r = await run(root, ['log', '-1', '--format=%B']);
      const st = await run(root, ['status', '-b', '--porcelain=v1']);
      const pushed = !/\[ahead/.test(st.out.split(/\r?\n/)[0] || '') && /\.\.\./.test(st.out.split(/\r?\n/)[0] || '');
      return { message: r.ok ? r.out.replace(/\s+$/, '') : '', pushed };
    },

    async commit(ws, o) {
      const { root } = await need(ws);
      const message = String((o && o.message) || '');
      const amend = !!(o && o.amend);
      must(message.trim() || amend, 'Write a commit message.');
      const user = { name: (await run(root, ['config', 'user.name'])).out.trim(), email: (await run(root, ['config', 'user.email'])).out.trim() };
      if (!user.name || !user.email) return { needIdentity: true, user };
      const args = ['commit', ...(amend ? ['--amend'] : []), ...(o && o.signoff ? ['--signoff'] : []), ...(o && o.noVerify ? ['--no-verify'] : []), ...(message.trim() ? ['-F', '-'] : ['--no-edit'])];
      const r = await run(root, args, { input: message.trim() ? message : undefined, timeout: 120000 });
      if (!r.ok) fail(r, 'git commit');
      const first = r.out.split(/\r?\n/).find((l) => /^\[/.test(l)) || r.out.split(/\r?\n/)[0] || 'Committed.';
      return { committed: true, summary: first };
    },

    async undoLastCommit(ws) { const { root } = await need(ws); okOrThrow(await run(root, ['reset', '--soft', 'HEAD~1']), 'undo commit'); return true; },
    async reset(ws, { hash, mode }) { const { root } = await need(ws); must(HASH_RE.test(hash) || REF_RE.test(hash), 'Invalid commit.'); must(['soft', 'mixed', 'hard'].includes(mode), 'Invalid mode.'); okOrThrow(await run(root, ['reset', `--${mode}`, hash]), 'git reset'); return true; },
    async revert(ws, hash) { const { root } = await need(ws); must(HASH_RE.test(hash), 'Invalid commit.'); okOrThrow(await run(root, ['revert', '--no-edit', hash], { timeout: 60000 }), 'git revert'); return true; },
    async cherryPick(ws, hash) { const { root } = await need(ws); must(HASH_RE.test(hash), 'Invalid commit.'); okOrThrow(await run(root, ['cherry-pick', hash], { timeout: 60000 }), 'git cherry-pick'); return true; },

    /* ------------------------------ remote operations ------------------------------ */

    async fetch(ws, o) { const { root } = await need(ws); const id = (o && o.id) || 0; okOrThrow(await run(root, ['fetch', '--all', '--prune', '--tags', '--progress'], { timeout: 300000, progress: id }), 'git fetch'); return true; },
    async pull(ws, o) {
      const { root } = await need(ws);
      const mode = (o && o.mode) || 'merge';
      const args = ['pull', '--progress', mode === 'rebase' ? '--rebase' : mode === 'ff-only' ? '--ff-only' : '--no-rebase'];
      const r = await run(root, args, { timeout: 300000, progress: (o && o.id) || 0 });
      if (!r.ok) { const conflict = /CONFLICT|Automatic merge failed|could not apply/i.test(r.err + r.out); if (conflict) return { conflict: true, message: 'Merge conflicts: fix the files marked U, stage them, then commit.' }; fail(r, 'git pull'); }
      return { conflict: false, message: r.out.split(/\r?\n/).filter(Boolean).pop() || 'Up to date.' };
    },
    async push(ws, o) {
      const { root } = await need(ws);
      const remote = (o && o.remote) || 'origin';
      must(NAME_RE.test(remote), 'Invalid remote name.');
      const st = parseStatus((await run(root, ['status', '--porcelain=v1', '-b', '-z'])).out);
      const branch = (o && o.branch) || st.branch;
      must(REF_RE.test(branch) && branch !== 'HEAD', 'Check out a branch before pushing.');
      const args = ['push', '--progress', ...(o && o.force ? ['--force-with-lease'] : []), ...(o && o.tags ? ['--tags'] : []), ...(st.upstream && !(o && o.setUpstream) ? [] : ['--set-upstream']), remote, ...(st.upstream && !(o && o.setUpstream) ? [] : [branch])];
      const r = await run(root, args, { timeout: 300000, progress: (o && o.id) || 0 });
      if (!r.ok) fail(r, 'git push');
      return { message: `Pushed ${branch} to ${remote}.` };
    },

    /* ------------------------------ branches ------------------------------ */

    async branches(ws) {
      const { root } = await need(ws);
      const r = await run(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%09%(refname:short)%09%(upstream:short)%09%(HEAD)%09%(objectname:short)%09%(subject)%09%(committerdate:relative)', 'refs/heads', 'refs/remotes']);
      okOrThrow(r, 'git branch');
      const list = r.out.split(/\r?\n/).filter(Boolean).map((l) => {
        const [ref, name, upstream, head, hash, subject, when] = l.split('\t');
        return { ref, name, upstream, current: head === '*', hash, subject, when, remote: ref.startsWith('refs/remotes/') };
      }).filter((b) => !/\/HEAD$/.test(b.name));
      return list;
    },
    async checkout(ws, { name, create, from }) {
      const { root } = await need(ws);
      must(REF_RE.test(name), 'Invalid branch name.');
      if (from) must(REF_RE.test(from), 'Invalid starting point.');
      okOrThrow(await run(root, ['switch', ...(create ? ['-c'] : []), name, ...(create && from ? [from] : [])], { timeout: 60000 }), 'git switch');
      return true;
    },
    async checkoutRef(ws, ref) { const { root } = await need(ws); must(HASH_RE.test(ref) || REF_RE.test(ref), 'Invalid reference.'); okOrThrow(await run(root, ['switch', '--detach', ref]), 'git switch'); return true; },
    async deleteBranch(ws, { name, force, remote }) {
      const { root } = await need(ws);
      must(REF_RE.test(name), 'Invalid branch name.');
      if (remote) { const m = /^([^/]+)\/(.+)$/.exec(name); must(m && NAME_RE.test(m[1]), 'Invalid remote branch.'); okOrThrow(await run(root, ['push', m[1], '--delete', m[2]], { timeout: 120000 }), 'delete remote branch'); }
      else okOrThrow(await run(root, ['branch', force ? '-D' : '-d', name]), 'git branch -d');
      return true;
    },
    async renameBranch(ws, { from, to }) { const { root } = await need(ws); must(REF_RE.test(from) && REF_RE.test(to), 'Invalid branch name.'); okOrThrow(await run(root, ['branch', '-m', from, to]), 'rename'); return true; },
    async merge(ws, { name, mode }) {
      const { root } = await need(ws);
      must(REF_RE.test(name), 'Invalid branch name.');
      const r = await run(root, ['merge', ...(mode === 'no-ff' ? ['--no-ff'] : mode === 'squash' ? ['--squash'] : []), name], { timeout: 120000 });
      if (!r.ok) { if (/CONFLICT|Automatic merge failed/i.test(r.err + r.out)) return { conflict: true, message: 'Merge conflicts: fix the files marked U, stage them, then commit.' }; fail(r, 'git merge'); }
      return { conflict: false, message: r.out.split(/\r?\n/).filter(Boolean).pop() || 'Merged.' };
    },
    async rebase(ws, name) { const { root } = await need(ws); must(REF_RE.test(name), 'Invalid branch name.'); const r = await run(root, ['rebase', name], { timeout: 120000 }); if (!r.ok) { if (/CONFLICT|could not apply/i.test(r.err + r.out)) return { conflict: true, message: 'Rebase stopped on a conflict: fix, stage, then Continue.' }; fail(r, 'git rebase'); } return { conflict: false, message: 'Rebased.' }; },
    async operation(ws, { op, action }) { // abort / continue a merge, rebase, cherry-pick or revert
      const { root } = await need(ws);
      must(['merge', 'rebase', 'cherry-pick', 'revert'].includes(op) && ['abort', 'continue'].includes(action), 'Invalid request.');
      const r = await run(root, [op, `--${action}`], { timeout: 60000, env: { GIT_EDITOR: 'true' } });
      if (!r.ok && !(op === 'merge' && action === 'continue')) fail(r, `git ${op} --${action}`);
      return true;
    },

    /* ------------------------------ history, diff ------------------------------ */

    async log(ws, o = {}) {
      const { root } = await need(ws);
      const args = ['log', `--max-count=${Math.min(Number(o.limit) || 40, 300)}`, `--skip=${Math.max(0, Number(o.skip) || 0)}`, '--date=iso-strict', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1e'];
      if (o.all) args.push('--all');
      if (o.branch) { must(REF_RE.test(o.branch), 'Invalid branch.'); args.push(o.branch); }
      if (o.path) { must(typeof o.path === 'string' && !o.path.startsWith('-'), 'Invalid path.'); args.push('--', o.path); }
      const r = await run(root, args, { timeout: 60000 });
      if (!r.ok) return /does not have any commits|bad default revision/i.test(r.err) ? [] : fail(r, 'git log');
      return r.out.split('\x1e').map((x) => x.trim()).filter(Boolean).map((e) => { const [hash, short, author, email, date, refs, subject] = e.split('\x1f'); return { hash, short, author, email, date, refs: (refs || '').split(', ').filter(Boolean), subject }; });
    },
    async show(ws, hash) {
      const { root } = await need(ws);
      must(HASH_RE.test(hash), 'Invalid commit.');
      const r = okOrThrow(await run(root, ['show', '--name-status', '-M', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%P%x1f%B%x1e', hash], { timeout: 60000 }), 'git show');
      const [head, rest] = r.out.split('\x1e');
      const [full, author, email, date, parents, message] = head.split('\x1f');
      const files = (rest || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const p = l.split('\t'); return { status: p[0][0], path: p[p.length - 1], orig: p.length > 2 ? p[1] : '' }; });
      return { hash: full, author, email, date, parents: (parents || '').split(' ').filter(Boolean), message: (message || '').trim(), files };
    },
    async fileAt(ws, { ref, path: p }) { // ref: '' = the index (staged), or HEAD / a hash
      const { root } = await need(ws);
      must(typeof p === 'string' && p && !p.includes('\0'), 'Invalid path.');
      must(ref === '' || ref === 'HEAD' || HASH_RE.test(ref) || /^HEAD[~^]\d*$/.test(ref) || REF_RE.test(ref), 'Invalid reference.');
      const r = await run(root, ['show', `${ref}:${p.split(/[\\/]/).join('/')}`], { timeout: 30000, max: 3 * 1024 * 1024 });
      if (!r.ok) return { exists: false, text: '' };
      if (r.out.includes('\0')) return { exists: true, binary: true, text: '' };
      return { exists: true, text: r.out };
    },
    async blame(ws, p) { const { root } = await need(ws); must(typeof p === 'string' && p, 'Invalid path.'); const r = okOrThrow(await run(root, ['blame', '--line-porcelain', '--', p], { timeout: 60000 }), 'git blame'); const lines = []; let cur = null; for (const l of r.out.split(/\r?\n/)) { const m = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l); if (m) cur = { hash: m[1].slice(0, 8), line: +m[2] }; else if (cur && l.startsWith('author ')) cur.author = l.slice(7); else if (cur && l.startsWith('summary ')) { cur.summary = l.slice(8); lines.push(cur); cur = null; } } return lines; },

    /* ------------------------------ stash, tags, remotes ------------------------------ */

    async stashList(ws) { const { root } = await need(ws); const r = await run(root, ['stash', 'list', '--format=%gd%x1f%s%x1f%cr']); return r.out.split(/\r?\n/).filter(Boolean).map((l) => { const [ref, subject, when] = l.split('\x1f'); return { ref, subject, when }; }); },
    async stashPush(ws, { message, untracked }) { const { root } = await need(ws); if (message) must(!/[\0]/.test(message), 'Invalid message.'); okOrThrow(await run(root, ['stash', 'push', ...(untracked ? ['--include-untracked'] : []), ...(message ? ['-m', message] : [])]), 'git stash'); return true; },
    async stashOp(ws, { op, ref }) { const { root } = await need(ws); must(['pop', 'apply', 'drop'].includes(op) && /^stash@\{\d+\}$/.test(ref), 'Invalid request.'); const r = await run(root, ['stash', op, ref]); if (!r.ok) { if (/CONFLICT/i.test(r.err + r.out)) return { conflict: true }; fail(r, `git stash ${op}`); } return { conflict: false }; },
    async tags(ws) { const { root } = await need(ws); const r = await run(root, ['tag', '-l', '--sort=-creatordate', '--format=%(refname:short)%09%(objectname:short)%09%(subject)%09%(creatordate:relative)']); return r.out.split(/\r?\n/).filter(Boolean).map((l) => { const [name, hash, subject, when] = l.split('\t'); return { name, hash, subject, when }; }); },
    async tagCreate(ws, { name, message, ref }) { const { root } = await need(ws); must(REF_RE.test(name), 'Invalid tag name.'); if (ref) must(HASH_RE.test(ref) || REF_RE.test(ref), 'Invalid reference.'); okOrThrow(await run(root, ['tag', ...(message ? ['-a', name, '-m', message] : [name]), ...(ref ? [ref] : [])]), 'git tag'); return true; },
    async tagDelete(ws, { name, remote }) { const { root } = await need(ws); must(REF_RE.test(name), 'Invalid tag name.'); okOrThrow(await run(root, ['tag', '-d', name]), 'git tag -d'); if (remote) okOrThrow(await run(root, ['push', 'origin', '--delete', `refs/tags/${name}`], { timeout: 120000 }), 'delete remote tag'); return true; },
    async tagPush(ws, name) { const { root } = await need(ws); must(REF_RE.test(name), 'Invalid tag name.'); okOrThrow(await run(root, ['push', 'origin', `refs/tags/${name}`], { timeout: 120000 }), 'git push tag'); return true; },
    async remoteAdd(ws, { name, url }) { const { root } = await need(ws); must(NAME_RE.test(name) && URL_RE.test(url) && !url.startsWith('-'), 'Invalid remote name or address.'); okOrThrow(await run(root, ['remote', 'add', name, url]), 'git remote add'); return true; },
    async remoteSetUrl(ws, { name, url }) { const { root } = await need(ws); must(NAME_RE.test(name) && URL_RE.test(url) && !url.startsWith('-'), 'Invalid remote name or address.'); okOrThrow(await run(root, ['remote', 'set-url', name, url]), 'git remote set-url'); return true; },
    async remoteRemove(ws, name) { const { root } = await need(ws); must(NAME_RE.test(name), 'Invalid remote name.'); okOrThrow(await run(root, ['remote', 'remove', name]), 'git remote remove'); return true; },

    /* ------------------------------ identity, ignore, clone, links ------------------------------ */

    async setIdentity(ws, { name, email, global }) {
      const w = checkWs(ws);
      must(name && email && name.length < 120 && /^[^\s@]+@[^\s@]+$/.test(email) && !/[\0\r\n]/.test(name), 'Enter a name and a valid e-mail address.');
      const cwd = (await repoRoot(w)) || w;
      okOrThrow(await run(cwd, ['config', ...(global ? ['--global'] : []), 'user.name', name]), 'git config');
      okOrThrow(await run(cwd, ['config', ...(global ? ['--global'] : []), 'user.email', email]), 'git config');
      return true;
    },
    async ignore(ws, pattern) {
      const { root } = await need(ws);
      must(typeof pattern === 'string' && pattern && !/[\0\r\n]/.test(pattern), 'Invalid pattern.');
      const f = path.join(root, '.gitignore');
      const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
      if (!cur.split(/\r?\n/).includes(pattern)) fs.writeFileSync(f, `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${pattern}\n`);
      return true;
    },
    async clone(_ws, o) {
      must(o && URL_RE.test(o.url) && !o.url.startsWith('-'), 'Enter a Git address, for example https://github.com/owner/repo.git or git@gitlab.com:group/repo.git');
      must(o.dir && !/[\0\r\n"]/.test(o.dir) && path.isAbsolute(o.dir), 'Choose a folder.');
      if (o.branch) must(REF_RE.test(o.branch), 'Invalid branch name.');
      const depth = o.depth ? Math.max(1, Math.min(1000, Number(o.depth) || 0)) : 0;
      must(!fs.existsSync(o.dir) || fs.readdirSync(o.dir).length === 0, 'That folder already exists and is not empty.');
      fs.mkdirSync(path.dirname(o.dir), { recursive: true });
      const args = ['clone', '--progress', ...(o.branch ? ['--branch', o.branch] : []), ...(depth ? ['--depth', String(depth)] : []), ...(o.recurse ? ['--recurse-submodules'] : []), '--', o.url, o.dir];
      okOrThrow(await run(path.dirname(o.dir), args, { timeout: 1800000, progress: o.id || 0 }), 'git clone');
      return { path: o.dir };
    },
    async remoteHeads(_ws, url) { // lists branches of a remote before cloning (also a quick "can I reach it" test)
      must(URL_RE.test(url) && !url.startsWith('-'), 'Invalid address.');
      const r = await run(os.tmpdir(), ['ls-remote', '--heads', '--symref', '--', url], { timeout: 45000 });
      if (!r.ok) fail(r, 'git ls-remote');
      const heads = r.out.split(/\r?\n/).map((l) => /refs\/heads\/(.+)$/.exec(l)).filter(Boolean).map((m) => m[1]);
      const def = /ref: refs\/heads\/(\S+)\s+HEAD/.exec(r.out);
      return { heads, default: def ? def[1] : heads[0] || '', host: parseRemote(url) };
    },
    detectHost(_ws, url) { return parseRemote(String(url || '')); },
    async link(ws, { what, branch, remote }) {
      const { root } = await need(ws);
      const rr = await run(root, ['remote', 'get-url', remote && NAME_RE.test(remote) ? remote : 'origin']);
      must(rr.ok, 'This project has no remote yet. Add one first.');
      const info = parseRemote(rr.out.trim());
      must(info.web, 'Could not work out the web address of this remote.');
      const b = branch && REF_RE.test(branch) ? branch : (parseStatus((await run(root, ['status', '--porcelain=v1', '-b', '-z'])).out).branch || 'main');
      return { url: webLink(info, what, b), host: info };
    },
  };

  for (const [name, fn] of Object.entries(handlers)) ctx.ipc.handle(name, fn);
};
