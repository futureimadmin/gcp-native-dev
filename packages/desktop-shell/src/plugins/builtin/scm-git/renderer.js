/* Source Control (Git) - the section under the Explorer, diff and history pages, clone / branch / tag / remote dialogs.
   Works with every Git host. Extension point for other hosts: CNS.scmHosts.register({ id, name, test: (url) => bool, logo: 'logo-id', newRepoUrl }). */
'use strict';

CNS.scmHosts = CNS.scmHosts || {
  list: [
    { id: 'github', name: 'GitHub', example: 'https://github.com/owner/repo.git', newRepoUrl: 'https://github.com/new' },
    { id: 'gitlab', name: 'GitLab', example: 'https://gitlab.com/group/repo.git', newRepoUrl: 'https://gitlab.com/projects/new' },
    { id: 'bitbucket', name: 'Bitbucket', example: 'https://bitbucket.org/workspace/repo.git', newRepoUrl: 'https://bitbucket.org/repo/create' },
    { id: 'azuredevops', name: 'Azure DevOps', example: 'https://dev.azure.com/org/project/_git/repo', newRepoUrl: 'https://dev.azure.com/' },
    { id: 'gitea', name: 'Gitea / Forgejo / Codeberg', example: 'https://codeberg.org/user/repo.git', newRepoUrl: 'https://codeberg.org/repo/create' },
    { id: 'generic', name: 'Other Git server', example: 'ssh://git@your-server/team/repo.git', newRepoUrl: '' },
  ],
  register(h) { this.list.splice(this.list.length - 1, 0, h); },
};

CNS.plugin('cns.scm-git', (api) => {
  const { h } = api.ui;
  const S = { st: null, busy: '', progress: '', err: '', amend: false, signoff: false, pushAfter: false, message: '', amendPushed: false, prefill: '', open: { conflicts: true, staged: true, changes: true, stash: false, history: true }, stashes: [], history: [], opId: 0, timer: null, ui: null, last: 0 };
  const SID = 'cns.scm-git';
  const call = (ch, ...a) => api.invoke(ch, state.workspace, ...a);
  const hostKind = () => (S.st && S.st.host ? S.st.host.kind : 'git');
  const logoFor = (k) => logo(k === 'generic' || !k ? 'git' : k, 16);

  /* ------------------------------ data ------------------------------ */

  async function refresh(opts = {}) {
    if (!state.workspace) { S.st = null; drawAll(); return; }
    const now = Date.now();
    if (!opts.force && now - S.last < 700) return;
    S.last = now;
    try {
      S.st = await call('status');
      if (S.st.repo) {
        if (S.open.stash || opts.stash) S.stashes = await call('stashList').catch(() => []);
        if (S.open.history) S.history = await call('log', { limit: 12 }).catch(() => []);
      }
    } catch (e) { S.st = { repo: false, error: e.message }; }
    drawAll();
    decorateTree();
    drawStatusBar();
    hookEditor();
    scheduleGutter(50);
  }

  async function act(label, fn, o = {}) {
    if (S.busy) return;
    S.busy = label; S.err = ''; S.progress = '';
    S.opId = ++opSeq;
    drawTools();
    try { return await fn(S.opId); }
    catch (e) { S.err = e.message; api.ui.status(`${label}: ${e.message.split('\n')[0]}`, true); }
    finally { S.busy = ''; S.progress = ''; await refresh({ force: true, stash: true }); if (o.then) o.then(); }
  }
  let opSeq = 0;

  cns.on('plugin:event', (ev) => {
    if (!ev || ev.id !== SID || ev.channel !== 'progress') return;
    const id = ev.payload.id;
    const lines = String(ev.payload.text).split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean);
    const line = lines[lines.length - 1];
    if (!line) return;
    if (id === S.opId) { S.progress = line; if (S.ui && S.ui.prog) S.ui.prog.textContent = line; }
    if (cloneProgress && id === cloneId) cloneProgress.textContent = line;
  });
  let cloneProgress = null; let cloneId = 0;

  /* ------------------------------ file model ------------------------------ */

  const UNMERGED = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
  function groups() {
    const st = S.st;
    const g = { conflicts: [], staged: [], changes: [] };
    if (!st || !st.repo) return g;
    for (const f of st.files) {
      const xy = f.x + f.y;
      if (UNMERGED.has(xy)) { g.conflicts.push(f); continue; }
      if (xy === '??') { g.changes.push({ ...f, kind: '?' }); continue; }
      if (f.x !== ' ' && f.x !== '?') g.staged.push({ ...f, kind: f.x });
      if (f.y !== ' ' && f.y !== '?') g.changes.push({ ...f, kind: f.y });
    }
    return g;
  }
  const abs = (rel) => joinPath(S.st.root, rel.split('/').join(BS));
  const nameOf = (p) => p.split('/').pop();
  const dirOf = (p) => p.split('/').slice(0, -1).join('/');
  const badge = (k) => ({ '?': ['U', 'st-Q', 'Untracked'], M: ['M', 'st-M', 'Modified'], A: ['A', 'st-A', 'Added'], D: ['D', 'st-D', 'Deleted'], R: ['R', 'st-R', 'Renamed'], C: ['C', 'st-C', 'Copied'], T: ['T', 'st-M', 'Type changed'], '!': ['!', 'st-U', 'Conflict'] }[k] || [k, 'st-M', k]);

  /* ------------------------------ rendering ------------------------------ */

  function mountUi(body) {
    S.ui = {
      body, notice: h('div'), branch: h('div'), tools: h('div'), commit: null, lists: h('div'), stash: h('div'), hist: h('div'), prog: h('div', { class: 'scm-progress' }),
    };
    body.append(S.ui.notice, S.ui.branch, S.ui.tools, S.ui.prog, S.ui.lists, S.ui.stash, S.ui.hist);
  }

  function drawAll() {
    if (!S.ui) return;
    const st = S.st;
    const empty = !state.workspace ? 'Open a folder to use source control.' : '';
    for (const k of ['notice', 'branch', 'tools', 'lists', 'stash', 'hist']) S.ui[k].replaceChildren();
    if (!typing()) { S.ui.commitWrap && S.ui.commitWrap.remove(); S.ui.commitWrap = null; } // never rebuild the message box while you are typing in it
    if (empty) { S.ui.notice.append(h('div', { class: 'hint scm-pad', text: empty })); S.badge(''); return; }
    if (!st) { S.ui.notice.append(h('div', { class: 'hint scm-pad', text: 'Checking…' })); return; }
    if (!st.repo) return drawNoRepo();
    drawNotice(); drawBranch(); drawTools(); drawCommit(); drawLists(); drawStash(); drawHistory();
    const n = st.files.length;
    S.badge(n ? String(n) : '');
  }

  function drawNoRepo() {
    const st = S.st;
    if (st.gitMissing) { S.ui.notice.append(h('div', { class: 'scm-warn scm-err', text: st.gitError || 'Git is not installed.' }), h('div', { class: 'scm-pad' }, h('button', { text: 'Get Git for Windows', onclick: () => api.ui.openExternal('https://git-scm.com/download/win') }))); S.badge(''); return; }
    S.badge('');
    S.ui.notice.append(h('div', { class: 'scm-card' }, h('h4', { text: 'This folder is not under version control' }),
      h('div', { class: 'hint', text: 'Start tracking changes with Git, or get a project from GitHub, GitLab, Bitbucket, Azure DevOps, Gitea or your own server.' }),
      h('div', { class: 'row' }, h('button', { class: 'primary', text: 'Initialize repository', onclick: () => act('Initialize', async () => { await call('init'); api.ui.status('Repository created.'); }) }), h('button', { text: 'Clone a repository…', onclick: () => cloneDialog() })),
      h('div', { class: 'row' }, ...CNS.scmHosts.list.slice(0, 5).map((x) => h('span', { title: x.name }, logo(x.id, 20))))));
  }

  function drawNotice() {
    const st = S.st;
    const n = S.ui.notice;
    if (S.err) n.append(h('div', { class: 'scm-warn scm-err' }, S.err, h('button', { class: 'sbtn', text: '✕', onclick: () => { S.err = ''; drawNotice(); } })));
    if (st.state) {
      n.append(h('div', { class: 'scm-warn' }, h('b', { text: `A ${st.state} is in progress. ` }), st.files.some((f) => UNMERGED.has(f.x + f.y)) ? 'Fix the files marked ! , stage them, then continue.' : 'No conflicts left: continue.',
        h('div', { class: 'row' }, h('button', { text: 'Continue', onclick: () => act('Continue', () => call('operation', { op: st.state === 'merging' ? 'merge' : st.state === 'rebasing' ? 'rebase' : st.state === 'cherry-picking' ? 'cherry-pick' : 'revert', action: 'continue' })) }),
          h('button', { text: 'Abort', onclick: async () => { if (await confirmBox(`Abort the ${st.state}?`, 'Everything done by it is undone.')) act('Abort', () => call('operation', { op: st.state === 'merging' ? 'merge' : st.state === 'rebasing' ? 'rebase' : st.state === 'cherry-picking' ? 'cherry-pick' : 'revert', action: 'abort' })); } }))));
    }
    if (!st.remotes.length) n.append(h('div', { class: 'scm-warn' }, 'No remote yet: your commits stay on this computer. ', h('a', { href: '#', text: 'Publish to a Git host…', onclick: (e) => { e.preventDefault(); publishDialog(); } })));
  }

  function drawBranch() {
    const st = S.st;
    const hostName = st.host ? st.host.name : '';
    const sync = [st.ahead ? `↑${st.ahead}` : '', st.behind ? `↓${st.behind}` : ''].filter(Boolean).join(' ');
    S.ui.branch.append(h('div', { class: 'scm-branch' },
      h('span', { class: 'bname', title: `Switch branch${st.upstream ? ` (tracking ${st.upstream})` : ''}`, onclick: () => branchPicker() }, logoFor(hostKind()), st.detached ? 'detached HEAD' : st.branch),
      sync ? h('span', { class: 'sync', title: `${st.ahead} to push, ${st.behind} to pull` }, sync) : (st.upstream ? h('span', { class: 'sync', text: '✔ in sync' }) : h('span', { class: 'sync', text: 'not published' })),
      hostName ? h('span', { class: 'sync', title: st.host.web, text: hostName }) : null));
  }

  function drawTools() {
    if (!S.ui || !S.st || !S.st.repo) return;
    const st = S.st;
    const b = (icon, tip, fn, cls = '') => h('button', { class: `sbtn ${cls}${S.busy ? ' busy' : ''}`, title: tip, text: icon, onclick: fn });
    S.ui.tools.replaceChildren(h('div', { class: 'scm-tools' },
      b('⟳ Fetch', 'Fetch from all remotes', () => act('Fetching', (id) => call('fetch', { id }))),
      b('⇣ Pull', 'Pull (merge). More options in the ⋯ menu', () => pull('merge')),
      b('⇡ Push', st.upstream ? 'Push to ' + st.upstream : 'Publish this branch', () => push({})),
      b('⇅ Sync', 'Pull, then push', () => sync()),
      h('span', { class: 'spacer', style: 'flex:1' }),
      b('⋯', 'More: branches, tags, stash, remotes, host links', (e) => moreMenu(e))));
    if (S.busy) S.ui.tools.append(h('div', { class: 'hint scm-pad', text: `${S.busy}…` }));
    S.ui.prog.textContent = S.progress || '';
  }

  const typing = () => !!(S.ui && S.ui.commitWrap && S.ui.commitWrap.contains(document.activeElement));
  function drawCommit(force) {
    if (!force && typing()) return;
    const st = S.st;
    const g = groups();
    const msg = h('textarea', { class: 'scm-msg', placeholder: S.amend ? 'Amend: edit the message (empty keeps the old one)' : `Message (Ctrl+Enter to commit on “${st.branch}”)`, spellcheck: 'true' });
    msg.value = S.message;
    msg.addEventListener('input', () => { S.message = msg.value; });
    msg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doCommit(false); } });
    const amend = h('input', { type: 'checkbox', checked: S.amend });
    amend.onchange = async () => {
      S.amend = amend.checked;
      if (S.amend) {
        const last = await call('lastMessage').catch(() => ({ message: '', pushed: false }));
        S.amendPushed = last.pushed;
        if (!S.message.trim()) { S.message = last.message; S.prefill = last.message; }
      } else if (S.message === S.prefill) { S.message = ''; S.prefill = ''; S.amendPushed = false; }
      drawCommit(true);
    };
    const sign = h('input', { type: 'checkbox', checked: S.signoff }); sign.onchange = () => { S.signoff = sign.checked; };
    const after = h('input', { type: 'checkbox', checked: S.pushAfter }); after.onchange = () => { S.pushAfter = after.checked; };
    const wrap = h('div', {},
      msg,
      h('div', { class: 'scm-opts' },
        h('label', { title: 'Replace the last commit instead of adding a new one (staged changes are added to it)' }, amend, ' Amend last commit'),
        h('label', { title: 'Add a Signed-off-by line' }, sign, ' Sign off'),
        h('label', { title: 'Push right after committing' }, after, ' Push after commit')),
      S.amend && S.amendPushed ? h('div', { class: 'scm-warn' }, 'The last commit is already pushed. After amending, the push needs “force with lease” (safe: it refuses if someone else pushed meanwhile).') : null,
      h('div', { class: 'scm-commit' },
        h('button', { class: 'primary', text: S.amend ? 'Amend commit' : `Commit${g.staged.length ? ` (${g.staged.length})` : ''}`, disabled: !!S.busy, onclick: () => doCommit(false) }),
        h('button', { text: S.amend ? 'Amend & Push' : 'Commit & Push', disabled: !!S.busy, onclick: () => doCommit(true) })));
    if (S.ui.commitWrap) S.ui.commitWrap.replaceWith(wrap); else S.ui.tools.after(wrap);
    S.ui.commitWrap = wrap;
  }

  function fileRow(f, kindOf, staged) {
    const [letter, cls, label] = badge(kindOf);
    const name = h('span', { class: 'fn', title: f.path }, nameOf(f.path), dirOf(f.path) ? h('span', { class: 'fd', text: dirOf(f.path) }) : null, f.orig ? h('span', { class: 'fd', text: `← ${f.orig}` }) : null);
    const conflict = UNMERGED.has(f.x + f.y);
    const btn = (t, tip, fn) => h('button', { text: t, title: tip, onclick: (e) => { e.stopPropagation(); fn(); } });
    const row = h('div', { class: 'scm-file', title: `${label}: ${f.path}`, onclick: () => (conflict ? openAt(abs(f.path), 1) : openDiff(f, staged)), ondblclick: () => openAt(abs(f.path), 1), oncontextmenu: (e) => { e.preventDefault(); ctxMenu(e.clientX, e.clientY, fileMenu(f, staged, conflict)); } },
      h('span', { class: `st-badge ${cls}`, text: conflict ? '!' : letter }), name,
      h('span', { class: 'fa' },
        btn('📄', 'Open file', () => openAt(abs(f.path), 1)),
        conflict ? btn('✔', 'Mark as resolved (stage)', () => act('Resolve', () => call('resolved', [f.path]))) : null,
        !conflict && !staged ? btn('↶', 'Discard changes', () => discard(f)) : null,
        !conflict ? btn(staged ? '−' : '+', staged ? 'Unstage' : 'Stage', () => act(staged ? 'Unstage' : 'Stage', () => call(staged ? 'unstage' : 'stage', [f.path]))) : null));
    return row;
  }

  function fileMenu(f, staged, conflict) {
    const items = [{ label: 'Open File', run: () => openAt(abs(f.path), 1) }];
    if (!conflict) items.push({ label: 'Open Changes', run: () => openDiff(f, staged) });
    items.push('-');
    if (conflict) items.push({ label: 'Accept Current (ours)', run: () => act('Resolve', () => call('useSide', { path: f.path, side: 'ours' })) }, { label: 'Accept Incoming (theirs)', run: () => act('Resolve', () => call('useSide', { path: f.path, side: 'theirs' })) }, { label: 'Mark as Resolved', run: () => act('Resolve', () => call('resolved', [f.path])) });
    else items.push({ label: staged ? 'Unstage' : 'Stage', run: () => act(staged ? 'Unstage' : 'Stage', () => call(staged ? 'unstage' : 'stage', [f.path])) });
    if (!staged && !conflict) items.push({ label: 'Discard Changes…', run: () => discard(f) });
    items.push('-', { label: 'Add to .gitignore', run: () => act('Ignore', async () => { await call('ignore', `/${f.path}`); await refreshTree(); }) }, { label: 'File History', run: () => historyPage(f.path) },
      { label: 'Copy Path', run: () => copyText(abs(f.path), 'Path') }, { label: 'Reveal in Explorer', run: () => explorerReveal(abs(f.path), { focus: true }) });
    return items;
  }

  function group(key, title, files, kindOf, staged, extra) {
    const open = S.open[key] !== false;
    const head = h('div', { class: 'scm-grp', onclick: (e) => { if (e.target.closest('button')) return; S.open[key] = !open; drawLists(); } }, h('span', { text: open ? '▾' : '▸' }), h('span', { text: title }), h('span', { class: 'cnt', text: String(files.length) }), h('span', { class: 'spacer' }), ...(extra || []));
    return [head, ...(open ? files.map((f) => fileRow(f, kindOf(f), staged)) : [])];
  }

  function drawLists() {
    const g = groups();
    const out = [];
    if (g.conflicts.length) out.push(...group('conflicts', 'MERGE CONFLICTS', g.conflicts, () => '!', false));
    if (g.staged.length) out.push(...group('staged', 'STAGED CHANGES', g.staged, (f) => f.kind, true, [h('button', { class: 'sbtn', text: '−', title: 'Unstage all', onclick: () => act('Unstage', () => call('unstageAll')) })]));
    out.push(...group('changes', 'CHANGES', g.changes, (f) => f.kind, false, [
      h('button', { class: 'sbtn', text: '↶', title: 'Discard all tracked changes', onclick: () => discardAll(g.changes) }),
      h('button', { class: 'sbtn', text: '+', title: 'Stage all', onclick: () => act('Stage', () => call('stageAll')) })]));
    if (!g.changes.length && !g.staged.length && !g.conflicts.length) out.push(h('div', { class: 'hint scm-pad', text: 'No changes. Your working folder matches the last commit.' }));
    S.ui.lists.replaceChildren(...out);
  }

  function drawStash() {
    const head = h('div', { class: 'scm-grp', onclick: (e) => { if (e.target.closest('button')) return; S.open.stash = !S.open.stash; if (S.open.stash) refresh({ force: true, stash: true }); else drawStash(); } },
      h('span', { text: S.open.stash ? '▾' : '▸' }), h('span', { text: 'STASHES' }), h('span', { class: 'cnt', text: String(S.st.stashCount) }), h('span', { class: 'spacer' }),
      h('button', { class: 'sbtn', text: '+', title: 'Stash current changes', onclick: () => stashDialog() }));
    const rows = S.open.stash ? (S.stashes.length ? S.stashes.map((s) => h('div', { class: 'scm-file', title: s.subject },
      h('span', { class: 'fn', text: s.subject }), h('span', { class: 'fd', text: s.when }),
      h('span', { class: 'fa' }, h('button', { text: '⤒', title: 'Pop (apply and remove)', onclick: () => stashOp('pop', s.ref) }), h('button', { text: '⎘', title: 'Apply (keep)', onclick: () => stashOp('apply', s.ref) }), h('button', { text: '🗑', title: 'Drop', onclick: () => stashOp('drop', s.ref) })))) : [h('div', { class: 'hint scm-pad', text: 'Nothing stashed.' })]) : [];
    S.ui.stash.replaceChildren(head, ...rows);
  }

  function drawHistory() {
    const head = h('div', { class: 'scm-grp', onclick: (e) => { if (e.target.closest('button')) return; S.open.history = !S.open.history; if (S.open.history) refresh({ force: true }); else drawHistory(); } },
      h('span', { text: S.open.history ? '▾' : '▸' }), h('span', { text: 'RECENT COMMITS' }), h('span', { class: 'spacer' }),
      h('button', { class: 'sbtn', text: '⏱', title: 'Full history', onclick: () => historyPage('') }));
    const rows = S.open.history ? S.history.map((c) => h('div', { class: 'scm-commitrow', title: `${c.short}  ${c.author}  ${c.date}`, onclick: () => commitPage(c.hash), oncontextmenu: (e) => { e.preventDefault(); ctxMenu(e.clientX, e.clientY, commitMenu(c)); } },
      h('div', { class: 'sub' }, ...c.refs.slice(0, 3).map((r) => h('span', { class: `refchip${/HEAD/.test(r) ? ' head' : ''}`, text: r.replace('HEAD -> ', '') })), h('span', { class: 'subj', text: c.subject })),
      h('div', { class: 'meta', text: `${c.short} · ${c.author} · ${relTime(c.date)}` }))) : [];
    S.ui.hist.replaceChildren(head, ...rows);
  }

  function relTime(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(s)) return '';
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
    return new Date(iso).toLocaleDateString();
  }

  function commitMenu(c) {
    return [
      { label: 'Open Commit', run: () => commitPage(c.hash) }, { label: 'Copy Hash', run: () => copyText(c.hash, 'Commit hash') }, '-',
      { label: 'Checkout (detached)', run: () => act('Checkout', () => call('checkoutRef', c.hash)) },
      { label: 'Create Branch Here…', run: async () => { const n = await promptText('New branch', 'branch-name'); if (n) act('Branch', () => call('checkout', { name: n, create: true, from: c.hash })); } },
      { label: 'Create Tag Here…', run: async () => { const n = await promptText('New tag', 'v1.0.0'); if (n) act('Tag', () => call('tagCreate', { name: n, ref: c.hash })); } },
      { label: 'Cherry-pick', run: () => act('Cherry-pick', () => call('cherryPick', c.hash)) },
      { label: 'Revert…', run: async () => { if (await confirmBox(`Revert ${c.short}?`, 'Adds a new commit that undoes it.')) act('Revert', () => call('revert', c.hash)); } },
      { label: 'Reset Branch to Here', sub: ['soft', 'mixed', 'hard'].map((m) => ({ label: `${m[0].toUpperCase()}${m.slice(1)} reset${m === 'hard' ? ' (discards changes)' : m === 'soft' ? ' (keeps everything staged)' : ' (keeps files)'}`, run: async () => { if (await confirmBox(`${m} reset to ${c.short}?`, m === 'hard' ? 'Uncommitted changes and later commits are LOST.' : 'Later commits are removed from this branch.')) act('Reset', () => call('reset', { hash: c.hash, mode: m })); } })) },
      '-', { label: 'Open on Host', run: () => openHost('commit', c.hash) },
    ];
  }

  /* ------------------------------ actions ------------------------------ */

  async function ensureIdentity() {
    const u = S.st.user;
    if (u.name && u.email) return true;
    return identityDialog();
  }

  async function doCommit(thenPush) {
    if (S.busy) return;
    const g = groups();
    const msg = S.message.trim();
    if (g.conflicts.length) return api.ui.status('Resolve the merge conflicts first (files marked !).', true);
    if (!S.amend && !msg) return api.ui.status('Write a commit message first.', true);
    if (!g.staged.length && !S.amend) {
      if (!g.changes.length) return api.ui.status('Nothing to commit.', true);
      if (!(await confirmBox('Nothing is staged.', `Stage all ${g.changes.length} changed file(s) and commit them?`))) return;
      await call('stageAll');
    }
    if (!(await ensureIdentity())) return;
    const amended = S.amend;
    const wasPushed = S.amendPushed;
    let pushed = false;
    await act(amended ? 'Amending' : 'Committing', async (id) => {
      const r = await call('commit', { message: S.message, amend: amended, signoff: S.signoff });
      if (r.needIdentity) throw new Error('Set your name and e-mail first (⋯ > Identity).');
      S.message = ''; S.prefill = ''; S.amend = false; S.amendPushed = false;
      api.ui.status(r.summary);
      if (thenPush || S.pushAfter) {
        if (amended && wasPushed && !(await confirmBox('Force-push the amended commit?', 'The old commit was already pushed. This replaces it on the server (force with lease: it refuses if someone else pushed in the meantime).'))) return;
        await call('push', { force: amended && wasPushed, id });
        pushed = true;
      }
    });
    if (pushed) api.ui.status('Committed and pushed.');
  }

  async function push(o) {
    const st = S.st;
    if (!st.remotes.length) return publishDialog();
    if (st.behind && !o.force) { if (!(await confirmBox('Your branch is behind its remote.', 'Pull first, or push may be rejected. Push anyway?'))) return; }
    await act('Pushing', async (id) => { const r = await call('push', { ...o, id }); api.ui.status(r.message); });
  }
  async function pull(mode) {
    await act('Pulling', async (id) => {
      const r = await call('pull', { mode, id });
      api.ui.status(r.message, r.conflict);
    });
  }
  async function sync() {
    if (!S.st.remotes.length) return publishDialog();
    await act('Syncing', async (id) => {
      const r = await call('pull', { mode: 'merge', id });
      if (r.conflict) { api.ui.status(r.message, true); return; }
      await call('push', { id });
      api.ui.status('Synced.');
    });
  }
  async function discard(f) {
    if (f.kind === '?') { if (await confirmBox(`Delete the new file ${nameOf(f.path)}?`, 'It moves to the Recycle Bin.')) act('Discard', async () => { await inv('fs:trash', abs(f.path)); await refreshTree(); }); return; }
    if (await confirmBox(`Discard changes in ${nameOf(f.path)}?`, 'Your edits in this file are lost.')) act('Discard', async () => { await call('discard', [f.path]); await reloadOpenTabs([abs(f.path)]); });
  }
  async function discardAll(list) {
    const tracked = list.filter((f) => f.kind !== '?');
    if (!tracked.length) return api.ui.status('Only new (untracked) files here: discard them one by one.');
    if (await confirmBox(`Discard changes in ${tracked.length} file(s)?`, 'All your edits in tracked files are lost. New files are kept.')) act('Discard', async () => { await call('discard', tracked.map((f) => f.path)); await reloadOpenTabs(tracked.map((f) => abs(f.path))); });
  }
  async function stashOp(op, ref) {
    if (op === 'drop' && !(await confirmBox('Drop this stash?', 'It is deleted for good.'))) return;
    await act(`Stash ${op}`, async () => { const r = await call('stashOp', { op, ref }); if (r.conflict) api.ui.status('Stash applied with conflicts.', true); });
  }

  async function openHost(what, branch) {
    try { const r = await call('link', { what, branch }); await api.ui.openExternal(r.url); }
    catch (e) { api.ui.status(e.message, true); }
  }

  function moreMenu(e) {
    const st = S.st;
    const r = e.target.getBoundingClientRect();
    const hostItems = ['repo', 'branch', 'commits', 'newpr', 'prs', 'issues', 'ci'].map((k) => ({ label: { repo: 'Repository', branch: 'This branch', commits: 'Commits', newpr: 'New pull / merge request…', prs: 'Pull / merge requests', issues: 'Issues', ci: 'CI / pipelines' }[k], run: () => openHost(k), disabled: !st.remotes.length }));
    ctxMenu(r.left, r.bottom, [
      { label: 'Pull (rebase)', run: () => pull('rebase') }, { label: 'Pull (fast-forward only)', run: () => pull('ff-only') },
      { label: 'Push tags', run: () => push({ tags: true }) }, { label: 'Force push (with lease)…', run: async () => { if (await confirmBox('Force push with lease?', 'Replaces the remote branch, but refuses if someone else pushed in the meantime.')) push({ force: true }); } },
      '-',
      { label: 'Branches…', run: () => branchManager() }, { label: 'New branch…', run: () => newBranch() }, { label: 'Merge branch…', run: () => mergeDialog() },
      { label: 'Tags…', run: () => tagDialog() }, { label: 'Stash changes…', run: () => stashDialog() }, { label: 'Remotes…', run: () => remoteDialog() },
      '-',
      { label: 'Open on host', dot: undefined, sub: hostItems }, { label: 'History…', run: () => historyPage('') },
      '-',
      { label: 'Undo last commit (keep changes)', run: async () => { if (await confirmBox('Undo the last commit?', 'The changes stay staged.')) act('Undo', () => call('undoLastCommit')); } },
      { label: 'Identity (name and e-mail)…', run: () => identityDialog() }, { label: 'Clone another repository…', run: () => cloneDialog() },
    ]);
  }

  /* ------------------------------ dialogs ------------------------------ */

  async function branchPicker() {
    const st = S.st;
    let list = [];
    try { list = await call('branches'); } catch (e) { return api.ui.status(e.message, true); }
    const local = new Set(list.filter((b) => !b.remote).map((b) => b.name));
    const items = [{ label: '+ Create new branch…', detail: `from ${st.branch}`, icon: '＋', data: { create: true } },
      ...list.filter((b) => !b.current).map((b) => ({ label: b.name, detail: `${b.remote ? 'remote' : 'local'} · ${b.hash} · ${b.subject} · ${b.when}`, icon: b.remote ? '☁' : '⎇', data: b }))];
    quickPick({ placeholder: 'Switch to a branch (or create one)', items, onPick: (it) => {
      if (it.data.create) return newBranch();
      const b = it.data;
      const short = b.remote ? b.name.replace(/^[^/]+\//, '') : b.name;
      act('Switching', async () => { await call('checkout', { name: short, create: b.remote && !local.has(short), from: b.remote && !local.has(short) ? b.name : undefined }); await reloadAllTabs(); });
    } });
  }
  async function newBranch() {
    const n = await promptText('New branch', 'feature/my-change');
    if (!n) return;
    act('Creating branch', () => call('checkout', { name: n, create: true }));
  }
  async function reloadAllTabs() { await reloadOpenTabs(state.tabs.filter((t) => t.kind === 'file').map((t) => t.path)); await refreshTree(); }

  async function branchManager() {
    let list = [];
    try { list = await call('branches'); } catch (e) { return api.ui.status(e.message, true); }
    const body = h('div', { class: 'brmgr' });
    let close;
    const row = (b) => h('div', { class: 'bld-row' }, h('span', { text: b.current ? '●' : b.remote ? '☁' : '⎇', style: 'width:14px' }), h('span', { class: 'nm', title: `${b.subject}`, text: b.name }), h('span', { class: 'vv', text: `${b.hash} ${b.when}` }),
      !b.current ? h('button', { text: 'Switch', onclick: () => { close(); const short = b.remote ? b.name.replace(/^[^/]+\//, '') : b.name; const hasLocal = list.some((x) => !x.remote && x.name === short); act('Switching', () => call('checkout', { name: short, create: b.remote && !hasLocal, from: b.remote && !hasLocal ? b.name : undefined })); } }) : null,
      !b.current ? h('button', { text: 'Merge', title: 'Merge into the current branch', onclick: () => { close(); mergeInto(b.name); } }) : null,
      !b.current && !b.remote ? h('button', { text: 'Rebase', title: 'Rebase the current branch onto this one', onclick: () => { close(); rebaseOnto(b.name); } }) : null,
      !b.current ? h('button', { text: '🗑', title: 'Delete', onclick: async () => { if (await confirmBox(`Delete ${b.remote ? 'remote ' : ''}branch ${b.name}?`, b.remote ? 'It is deleted on the server.' : 'Unmerged work on it is lost if you force it.')) { close(); act('Deleting', () => call('deleteBranch', { name: b.name, force: true, remote: b.remote })); } } }) : null);
    body.append(h('div', { class: 'hint', text: 'Local branches' }), ...list.filter((b) => !b.remote).map(row), h('div', { class: 'hint', text: 'Remote branches' }), ...list.filter((b) => b.remote).map(row));
    close = modal('Branches', h('div', { style: 'max-height:60vh;overflow:auto' }, body), [h('button', { text: 'New branch…', onclick: () => { close(); newBranch(); } }), h('button', { class: 'primary', text: 'Close', onclick: () => close() })], { wide: true });
  }
  function mergeInto(name) {
    const modes = [['', 'Merge (fast-forward when possible)'], ['no-ff', 'Merge commit (no fast-forward)'], ['squash', 'Squash into one change']];
    quickPick({ placeholder: `Merge ${name} into ${S.st.branch}`, items: modes.map(([m, l]) => ({ label: l, icon: '⤵', data: m })), onPick: (it) => act('Merging', async () => { const r = await call('merge', { name, mode: it.data }); api.ui.status(r.message, r.conflict); }) });
  }
  async function mergeDialog() {
    const list = (await call('branches').catch(() => [])).filter((b) => !b.current);
    quickPick({ placeholder: 'Merge which branch into the current one?', items: list.map((b) => ({ label: b.name, detail: `${b.hash} ${b.subject}`, icon: b.remote ? '☁' : '⎇', data: b })), onPick: (it) => mergeInto(it.data.name) });
  }
  async function rebaseOnto(name) { if (await confirmBox(`Rebase ${S.st.branch} onto ${name}?`, 'Rewrites this branch’s commits. Do not do this to commits others already use.')) act('Rebasing', async () => { const r = await call('rebase', name); api.ui.status(r.message, r.conflict); }); }

  async function stashDialog() {
    const msg = h('input', { placeholder: 'Message (optional)' });
    const un = h('input', { type: 'checkbox' });
    const close = modal('Stash changes', h('div', {}, h('p', { class: 'hint', text: 'Puts your uncommitted changes aside so you can switch task. Bring them back with Pop.' }), msg, h('label', { class: 'inline' }, un, ' Include new (untracked) files')), [
      h('button', { text: 'Cancel', onclick: () => close() }), h('button', { class: 'primary', text: 'Stash', onclick: () => { close(); act('Stashing', () => call('stashPush', { message: msg.value.trim(), untracked: un.checked })); } })]);
    msg.focus();
  }

  async function tagDialog() {
    let tags = [];
    try { tags = await call('tags'); } catch (e) { return api.ui.status(e.message, true); }
    const name = h('input', { placeholder: 'v1.0.0' }); const message = h('input', { placeholder: 'Message (makes it an annotated tag)' });
    let close;
    const rows = tags.length ? tags.map((t) => h('div', { class: 'bld-row' }, h('span', { class: 'nm', text: t.name, title: t.subject }), h('span', { class: 'vv', text: `${t.hash} ${t.when}` }),
      h('button', { text: 'Push', onclick: () => { close(); act('Pushing tag', () => call('tagPush', t.name)); } }), h('button', { text: '🗑', title: 'Delete (also on origin?)', onclick: async () => { if (await confirmBox(`Delete tag ${t.name}?`, 'Deleted locally. It is not removed from the server.')) { close(); act('Deleting', () => call('tagDelete', { name: t.name })); } } }))) : [h('div', { class: 'hint', text: 'No tags yet.' })];
    close = modal('Tags', h('div', {}, h('div', { class: 'row' }, name, message), h('div', { style: 'max-height:40vh;overflow:auto' }, ...rows)), [
      h('button', { class: 'primary', text: 'Create tag here', onclick: () => { if (!name.value.trim()) return; close(); act('Tagging', () => call('tagCreate', { name: name.value.trim(), message: message.value.trim() })); } }), h('button', { text: 'Close', onclick: () => close() })], { wide: true });
  }

  async function remoteDialog() {
    const st = S.st;
    let close;
    const name = h('input', { placeholder: 'name, e.g. upstream', style: 'max-width:140px' }); const url = h('input', { placeholder: 'https://… or git@host:group/repo.git' });
    const det = h('span', { class: 'hint' });
    url.oninput = async () => { const x = await call('detectHost', url.value.trim()).catch(() => null); det.replaceChildren(...(x && x.web ? [logo(x.kind === 'generic' ? 'git' : x.kind, 16), ` ${x.name}`] : [])); };
    const rows = st.remotes.length ? st.remotes.map((r) => h('div', { class: 'bld-row' }, logoFor(r.kind), h('b', { text: r.name }), h('span', { class: 'nm', title: r.url, text: r.url }),
      h('button', { text: 'Change', onclick: async () => { const u = await promptText(`Address of ${r.name}`, 'https://…', r.url); if (u) { close(); act('Remote', () => call('remoteSetUrl', { name: r.name, url: u })); } } }),
      h('button', { text: '🗑', onclick: async () => { if (await confirmBox(`Remove remote ${r.name}?`, 'Only the link is removed; the server is untouched.')) { close(); act('Remote', () => call('remoteRemove', r.name)); } } }))) : [h('div', { class: 'hint', text: 'No remotes.' })];
    close = modal('Remotes', h('div', {}, ...rows, h('div', { class: 'row' }, name, url), det), [
      h('button', { class: 'primary', text: 'Add remote', onclick: () => { if (!name.value.trim() || !url.value.trim()) return; close(); act('Remote', () => call('remoteAdd', { name: name.value.trim(), url: url.value.trim() })); } }), h('button', { text: 'Close', onclick: () => close() })], { wide: true });
  }

  async function identityDialog() {
    const u = S.st.user;
    return new Promise((resolve) => {
      const name = h('input', { placeholder: 'Your name', value: u.name || '' }); const mail = h('input', { placeholder: 'you@example.com', value: u.email || '' });
      const glob = h('input', { type: 'checkbox', checked: true });
      const msg = h('div', { class: 'msg' });
      const close = modal('Who are you?', h('div', {}, h('p', { class: 'hint', text: 'Git records a name and e-mail in every commit. Use the e-mail registered with your Git host so it can link the commit to you.' }), name, mail, h('label', { class: 'inline' }, glob, ' Use for all my projects (global)'), msg), [
        h('button', { text: 'Cancel', onclick: () => { close(); resolve(false); } }),
        h('button', { class: 'primary', text: 'Save', onclick: async () => { try { await call('setIdentity', { name: name.value.trim(), email: mail.value.trim(), global: glob.checked }); close(); await refresh({ force: true }); resolve(true); } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; } } })]);
      name.focus();
    });
  }

  async function publishDialog() {
    const st = S.st;
    let chosen = CNS.scmHosts.list[0];
    const tiles = h('div', { class: 'row' });
    const url = h('input', { placeholder: chosen.example, spellcheck: 'false' });
    const hint = h('div', { class: 'hint' });
    const paint = () => { tiles.replaceChildren(...CNS.scmHosts.list.map((x) => h('button', { class: x === chosen ? 'primary' : '', title: x.name, onclick: () => { chosen = x; url.placeholder = x.example; paint(); } }, logo(x.id, 18), ` ${x.name.split(' ')[0]}`))); hint.replaceChildren(chosen.newRepoUrl ? h('a', { href: '#', text: `Create an empty repository on ${chosen.name} first`, onclick: (e) => { e.preventDefault(); api.ui.openExternal(chosen.newRepoUrl); } }) : 'Use the address your server shows for the repository.'); };
    paint();
    const msg = h('div', { class: 'msg' });
    const close = modal('Publish to a Git host', h('div', {}, h('p', { class: 'hint', text: 'Pick where the project should live, create an empty repository there, and paste its address. Your branch is then pushed and linked. Sign-in is handled by Git (Credential Manager or your SSH key).' }), tiles, hint, url, msg), [
      h('button', { text: 'Cancel', onclick: () => close() }),
      h('button', { class: 'primary', text: 'Add remote and push', onclick: async () => { const u = url.value.trim(); if (!u) { msg.className = 'msg err'; msg.textContent = 'Paste the repository address.'; return; } close(); await act('Publishing', async (id) => { await call('remoteAdd', { name: 'origin', url: u }); if (st.unborn) { api.ui.status('Remote added. Commit something, then push.'); return; } const r = await call('push', { setUpstream: true, id }); api.ui.status(r.message); }); } })], { wide: true });
    url.focus();
  }

  /* ---- clone (any host) ---- */

  async function cloneDialog(prefillUrl) {
    const url = h('input', { placeholder: 'https://github.com/owner/repo.git   or   git@gitlab.com:group/repo.git', spellcheck: 'false', value: prefillUrl || '' });
    const hostLine = h('div', { class: 'hint', style: 'min-height:20px;display:flex;align-items:center;gap:6px' });
    const parent = h('input', { placeholder: 'Parent folder', spellcheck: 'false', value: (state.settings.git && state.settings.git.cloneRoot) || '' });
    const nameIn = h('input', { placeholder: 'Folder name', spellcheck: 'false', style: 'max-width:200px' });
    const branch = h('input', { placeholder: 'default branch', list: 'clone-branches', style: 'max-width:200px' });
    const dl = h('datalist', { id: 'clone-branches' });
    const depth = h('input', { type: 'number', min: 1, placeholder: 'full history', style: 'max-width:110px' });
    const recurse = h('input', { type: 'checkbox' }); const open = h('input', { type: 'checkbox', checked: true });
    const prog = h('pre', { class: 'scm-progress', style: 'max-height:90px' }); cloneProgress = prog;
    const msg = h('div', { class: 'msg' });
    const tiles = h('div', { class: 'row' }, ...CNS.scmHosts.list.slice(0, 5).map((x) => h('button', { title: `Example: ${x.example}`, onclick: () => { url.value = ''; url.placeholder = x.example; url.focus(); } }, logo(x.id, 18), ` ${x.name.split(' ')[0]}`)));
    let timer = null;
    const derive = () => { const m = /([^/:\\]+?)(?:\.git)?\/?$/.exec(url.value.trim()); if (m && !nameIn.dataset.touched) nameIn.value = m[1]; };
    nameIn.oninput = () => { nameIn.dataset.touched = '1'; };
    url.oninput = () => {
      derive(); clearTimeout(timer);
      timer = setTimeout(async () => { const x = await call('detectHost', url.value.trim()).catch(() => null); hostLine.replaceChildren(...(x && x.web ? [logo(x.kind === 'generic' ? 'git' : x.kind, 18), h('b', { text: x.name }), `  ${x.host}`] : [])); }, 250);
    };
    let close;
    const check = h('button', { text: 'Check address', onclick: async () => { msg.className = 'msg'; msg.textContent = 'Contacting the server…'; try { const r = await call('remoteHeads', url.value.trim()); dl.replaceChildren(...r.heads.map((b) => h('option', { value: b }))); msg.className = 'msg ok'; msg.textContent = `Reachable. ${r.heads.length} branch(es), default “${r.default}”.`; } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; } } });
    const go = h('button', { class: 'primary', text: 'Clone', onclick: async () => {
      const u = url.value.trim();
      if (!u || !parent.value.trim() || !nameIn.value.trim()) { msg.className = 'msg err'; msg.textContent = 'Fill in the address, the parent folder and the folder name.'; return; }
      go.disabled = true; check.disabled = true; msg.className = 'msg'; msg.textContent = 'Cloning…';
      cloneId = ++opSeq;
      try {
        const target = joinPath(parent.value.trim(), nameIn.value.trim());
        const r = await call('clone', { url: u, dir: target, branch: branch.value.trim(), depth: depth.value, recurse: recurse.checked, id: cloneId });
        await tryInv('settings:set', 'git.cloneRoot', parent.value.trim()); state.settings.git = { ...(state.settings.git || {}), cloneRoot: parent.value.trim() };
        close(); cloneProgress = null;
        api.ui.status(`Cloned into ${r.path}`);
        if (open.checked) await openFolder(r.path);
      } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; go.disabled = false; check.disabled = false; }
    } });
    const browse = h('button', { text: 'Browse…', onclick: async () => { const d = await inv('dialog:selectFolder', 'Choose the parent folder').catch(() => null); if (d) parent.value = d; } });
    close = modal('Clone a repository', h('div', {},
      h('p', { class: 'hint', text: 'Works with GitHub, GitLab, Bitbucket, Azure DevOps, Gitea / Forgejo / Codeberg and any Git server. Private repositories ask you to sign in through Git Credential Manager (a sign-in window may appear) or use your SSH key.' }),
      tiles, url, hostLine, h('div', { class: 'row' }, parent, browse), h('div', { class: 'row' }, nameIn, branch, depth, dl),
      h('div', { class: 'row' }, h('label', { class: 'inline' }, recurse, ' Include submodules'), h('label', { class: 'inline' }, open, ' Open the project after cloning')), prog, msg),
    [check, h('button', { text: 'Cancel', onclick: () => { close(); cloneProgress = null; } }), go], { wide: true });
    if (prefillUrl) url.oninput();
    url.focus();
  }

  /* ------------------------------ pages: diff, commit, history ------------------------------ */

  const langOf = (p) => (typeof langFor === 'function' ? langFor(p) : 'plaintext');

  async function openDiff(f, staged) {
    const rel = f.path;
    const title = `⇄ ${nameOf(rel)}`;
    const left = staged ? await call('fileAt', { ref: 'HEAD', path: f.orig || rel }) : await call('fileAt', { ref: '', path: rel });
    let rightText = '';
    let rightLabel = 'Working tree';
    if (staged) { const r = await call('fileAt', { ref: '', path: rel }); rightText = r.text; rightLabel = 'Staged'; }
    else { const r = await tryInv('fs:readFile', abs(rel)); rightText = r.ok ? r.data : ''; }
    const leftLabel = staged ? 'HEAD (last commit)' : (left.exists ? 'Staged / last commit' : 'New file');
    if (left.binary) return api.ui.status('Binary file: no text diff.');
    diffPage(`diff:${staged ? 's' : 'w'}:${rel}`, title, rel, left.text, rightText, leftLabel, rightLabel, [
      h('button', { text: staged ? 'Unstage' : 'Stage', onclick: () => act(staged ? 'Unstage' : 'Stage', () => call(staged ? 'unstage' : 'stage', [rel])) }),
      h('button', { text: 'Open file', onclick: () => openAt(abs(rel), 1) })]);
  }

  function diffPage(id, title, rel, leftText, rightText, leftLabel, rightLabel, buttons) {
    let editorInst; let models = [];
    openPage({ id, title, icon: '⇄', build(el) {
      const box = h('div', { class: 'dbody' });
      let inline = false;
      const toggle = h('button', { text: 'Inline view', onclick: () => { inline = !inline; editorInst.updateOptions({ renderSideBySide: !inline }); toggle.textContent = inline ? 'Side by side' : 'Inline view'; } });
      el.append(h('div', { class: 'diffpage' }, h('div', { class: 'dh' }, h('b', { text: rel }), h('span', { class: 't-dim', text: `${leftLabel}  ↔  ${rightLabel}` }), h('span', { class: 'spacer', style: 'flex:1' }), ...(buttons || []), toggle), box));
      el.classList.remove('pad');
      editorInst = monaco.editor.createDiffEditor(box, { theme: 'cns-dark', automaticLayout: true, readOnly: true, renderSideBySide: true, originalEditable: false, fontSize: 13, fontFamily: 'Monospaced, "Courier New", monospace', glyphMargin: false, scrollBeyondLastLine: false });
      const lang = langOf(rel);
      const a = monaco.editor.createModel(leftText, lang); const b = monaco.editor.createModel(rightText, lang);
      models = [a, b];
      editorInst.setModel({ original: a, modified: b });
    }, onClose() { try { if (editorInst) editorInst.dispose(); models.forEach((m) => m.dispose()); } catch { /* closing */ } } });
  }

  async function commitPage(hash) {
    let c;
    try { c = await call('show', hash); } catch (e) { return api.ui.status(e.message, true); }
    openPage({ id: `commit:${hash}`, title: `⎇ ${hash.slice(0, 7)}`, icon: '⎇', pad: true, build(el) {
      el.append(h('div', { class: 'commitpage' },
        h('h2', { text: c.message.split('\n')[0] }),
        h('div', { class: 'kv' }, h('b', { text: c.author }), `  <${c.email}>  ·  ${new Date(c.date).toLocaleString()}  ·  `, h('code', { text: c.hash.slice(0, 12) }), c.parents.length ? `  ·  parent ${c.parents.map((x) => x.slice(0, 7)).join(', ')}` : '  ·  root commit'),
        h('pre', { class: 'cm', text: c.message.split('\n').slice(1).join('\n').trim() }),
        h('div', { class: 'row' }, h('button', { text: 'Copy hash', onclick: () => copyText(c.hash, 'Commit hash') }), h('button', { text: 'Open on host', onclick: () => openHost('commit', c.hash) }),
          h('button', { text: 'More…', onclick: (e) => { const r = e.target.getBoundingClientRect(); ctxMenu(r.left, r.bottom, commitMenu({ hash: c.hash, short: c.hash.slice(0, 7) })); } })),
        h('h4', { text: `${c.files.length} file(s) changed` }),
        ...c.files.map((f) => { const [letter, cls, label] = badge(f.status); return h('div', { class: 'cfile', title: label, onclick: () => commitDiff(c, f) }, h('span', { class: `st-badge ${cls}`, text: letter }), h('span', { text: f.path }), f.orig ? h('span', { class: 't-dim', text: `← ${f.orig}` }) : null); })));
    } });
  }
  async function commitDiff(c, f) {
    const parent = c.parents[0] || '';
    const left = parent ? await call('fileAt', { ref: parent, path: f.orig || f.path }) : { text: '' };
    const right = f.status === 'D' ? { text: '' } : await call('fileAt', { ref: c.hash, path: f.path });
    if (left.binary || right.binary) return api.ui.status('Binary file: no text diff.');
    diffPage(`cdiff:${c.hash}:${f.path}`, `⇄ ${nameOf(f.path)} @ ${c.hash.slice(0, 7)}`, f.path, left.text, right.text, parent ? parent.slice(0, 7) : 'nothing', c.hash.slice(0, 7), []);
  }

  async function historyPage(rel) {
    const items = [];
    const list = h('div', { class: 'scm-hist' });
    const filter = h('input', { placeholder: 'Filter by message, author or hash', style: 'max-width:340px' });
    const more = h('button', { text: 'Load more' });
    const draw = () => { const q = filter.value.trim().toLowerCase(); list.replaceChildren(...items.filter((c) => !q || `${c.subject} ${c.author} ${c.hash}`.toLowerCase().includes(q)).map((c) => h('div', { class: 'scm-commitrow', onclick: () => commitPage(c.hash), oncontextmenu: (e) => { e.preventDefault(); ctxMenu(e.clientX, e.clientY, commitMenu(c)); } },
      h('div', { class: 'sub' }, ...c.refs.slice(0, 4).map((r) => h('span', { class: `refchip${/HEAD/.test(r) ? ' head' : ''}`, text: r.replace('HEAD -> ', '') })), h('span', { class: 'subj', text: c.subject })), h('div', { class: 'meta', text: `${c.short} · ${c.author} · ${new Date(c.date).toLocaleString()}` })))); };
    const load = async () => { const r = await call('log', { limit: 60, skip: items.length, path: rel || undefined }).catch((e) => { api.ui.status(e.message, true); return []; }); items.push(...r); more.disabled = r.length < 60; draw(); };
    filter.oninput = draw; more.onclick = load;
    openPage({ id: `history:${rel}`, title: rel ? `⏱ ${nameOf(rel)}` : '⏱ History', icon: '⏱', pad: true, build(el) { el.append(h('div', { class: 'commitpage' }, h('h2', { text: rel ? `History of ${rel}` : `History of ${S.st.branch}` }), filter, list, more)); load(); } });
  }

  /* ------------------------------ Explorer + status bar decoration ------------------------------ */

  let decoTimer = null;
  function decorateTree() {
    clearTimeout(decoTimer);
    decoTimer = setTimeout(() => {
      const st = S.st;
      const nodes = document.querySelectorAll('#tree .node[data-path]');
      if (!st || !st.repo) { nodes.forEach((n) => { delete n.dataset.git; delete n.dataset.gitc; }); return; }
      const files = new Map();
      for (const f of st.files) files.set(normPath(abs(f.path)), UNMERGED.has(f.x + f.y) ? '!' : f.x === '?' ? '?' : (f.y !== ' ' ? f.y : f.x));
      const dirs = new Set();
      for (const p of files.keys()) { let d = p; for (let i = 0; i < 30; i++) { const up = d.lastIndexOf(BS); if (up < 0) break; d = d.slice(0, up); dirs.add(d); } }
      nodes.forEach((n) => {
        const p = normPath(n.dataset.path);
        const k = files.get(p);
        if (k) n.dataset.git = k; else delete n.dataset.git;
        if (dirs.has(p)) n.dataset.gitc = '1'; else delete n.dataset.gitc;
      });
    }, 120);
  }

  function drawStatusBar() {
    const el = $('st-branch');
    if (!el) return;
    const st = S.st;
    if (!st || !st.repo) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.replaceChildren(logoFor(hostKind()), ` ${st.detached ? 'detached' : st.branch}${st.ahead ? ` ↑${st.ahead}` : ''}${st.behind ? ` ↓${st.behind}` : ''}${st.files.length ? ` ●${st.files.length}` : ''}`);
    el.onclick = () => branchPicker();
  }

  /* ------------------------------ change marks in the editor gutter (vs the last commit) ------------------------------ */

  const baseCache = new Map(); // "rel@head" -> text | null
  function lineHunks(a, b) {
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let ea = a.length; let eb = b.length;
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    const n = ea - s; const m = eb - s;
    if (n === 0 && m === 0) return [];
    if (n * m > 4000000) return [{ a0: s, a1: ea, b0: s, b1: eb }];
    const w = m + 1;
    const L = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * w + j] = a[s + i] === b[s + j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    const out = [];
    let i = 0; let j = 0; let cur = null;
    const flush = () => { if (cur) { out.push(cur); cur = null; } };
    while (i < n || j < m) {
      if (i < n && j < m && a[s + i] === b[s + j]) { flush(); i++; j++; }
      else {
        if (!cur) cur = { a0: s + i, a1: s + i, b0: s + j, b1: s + j };
        if (j < m && (i >= n || L[i * w + j + 1] >= L[(i + 1) * w + j])) { j++; cur.b1 = s + j; } else { i++; cur.a1 = s + i; }
      }
    }
    flush();
    return out;
  }

  let gutterTimer = null;
  function scheduleGutter(ms = 500) { clearTimeout(gutterTimer); gutterTimer = setTimeout(updateGutter, ms); }
  async function updateGutter() {
    const t = state.active;
    if (!t || t.kind !== 'file' || t.model.isDisposed() || typeof monaco === 'undefined' || !monaco) return;
    const st = S.st;
    if (!st || !st.repo || !normPath(t.path).startsWith(normPath(st.root) + BS)) { t.gitDecos = t.model.deltaDecorations(t.gitDecos || [], []); return; }
    const rel = t.path.slice(st.root.length).replace(/^[\\/]+/, '').split(BS).join('/');
    const text = t.model.getValue();
    if (text.length > 400000) return;
    const key = `${rel}@${st.lastCommit ? st.lastCommit.short : 'none'}`;
    let base = baseCache.get(key);
    if (base === undefined) {
      try { const r = await call('fileAt', { ref: 'HEAD', path: rel }); base = r.exists && !r.binary ? r.text : null; } catch { base = null; }
      baseCache.set(key, base);
      if (baseCache.size > 60) baseCache.delete(baseCache.keys().next().value);
    }
    if (state.active !== t || t.model.isDisposed()) return;
    const out = [];
    const last = t.model.getLineCount();
    if (base === null) {
      for (let n = 1; n <= last; n++) out.push({ range: new monaco.Range(n, 1, n, 1), options: { isWholeLine: true, linesDecorationsClassName: 'git-gutter-add' } });
    } else {
      for (const hk of lineHunks(base.split('\n'), text.split('\n'))) {
        const cls = hk.a1 > hk.a0 && hk.b1 > hk.b0 ? 'git-gutter-mod' : hk.b1 > hk.b0 ? 'git-gutter-add' : 'git-gutter-del';
        const from = Math.min(last, hk.b0 + 1);
        const to = Math.max(from, Math.min(last, hk.b1));
        out.push({ range: new monaco.Range(from, 1, to, 1), options: { isWholeLine: true, linesDecorationsClassName: cls, overviewRuler: { color: cls === 'git-gutter-add' ? '#2ea043' : cls === 'git-gutter-mod' ? '#4a9eff' : '#d9534f', position: monaco.editor.OverviewRulerLane.Left } } });
      }
    }
    t.gitDecos = t.model.deltaDecorations(t.gitDecos || [], out);
  }

  /* ------------------------------ section + commands ------------------------------ */

  api.sections.register({
    id: 'scm', title: 'SOURCE CONTROL', order: 20, icon: () => logo('git', 14),
    mount({ body, actions, badge, setOnOpen }) {
      S.badge = badge;
      mountUi(body);
      actions.append(h('button', { text: '⟳', title: 'Refresh', onclick: () => refresh({ force: true }) }), h('button', { text: '⤓', title: 'Clone a repository…', onclick: () => cloneDialog() }));
      setOnOpen(() => refresh({ force: true }));
      refresh({ force: true });
    },
  });

  const C = (id, fn, title) => api.commands.register(id, fn, title);
  C('scm.refresh', () => refresh({ force: true }), 'Source Control: Refresh');
  C('scm.clone', () => cloneDialog(), 'Source Control: Clone Repository…');
  C('git.clone', () => cloneDialog(), 'File: Clone Git Repository…');
  C('scm.commit', () => doCommit(false), 'Source Control: Commit');
  C('scm.commitPush', () => doCommit(true), 'Source Control: Commit and Push');
  C('scm.push', () => (S.st && S.st.repo ? push({}) : api.ui.status('This folder is not a Git repository.', true)), 'Source Control: Push');
  C('scm.pull', () => (S.st && S.st.repo ? pull('merge') : null), 'Source Control: Pull');
  C('scm.fetch', () => act('Fetching', (id) => call('fetch', { id })), 'Source Control: Fetch');
  C('scm.stageAll', () => act('Stage', () => call('stageAll')), 'Source Control: Stage All Changes');
  C('scm.branches', () => branchManager(), 'Source Control: Branches…');
  C('scm.switch', () => branchPicker(), 'Source Control: Switch Branch…');
  C('scm.newBranch', () => newBranch(), 'Source Control: New Branch…');
  C('scm.tags', () => tagDialog(), 'Source Control: Tags…');
  C('scm.stash', () => stashDialog(), 'Source Control: Stash Changes…');
  C('scm.remotes', () => remoteDialog(), 'Source Control: Remotes…');
  C('scm.history', () => historyPage(''), 'Source Control: History');
  C('scm.fileHistory', () => { const t = state.active; if (t && t.kind === 'file' && S.st && S.st.repo) historyPage(relFromRoot(t.path)); else api.ui.status('Open a file in a Git repository first.', true); }, 'Source Control: History of This File');
  C('scm.identity', () => (S.st && S.st.repo ? identityDialog() : null), 'Source Control: Identity (name and e-mail)…');
  C('scm.openHost', () => openHost('repo'), 'Source Control: Open Repository on the Web');
  C('scm.newPr', () => openHost('newpr'), 'Source Control: New Pull / Merge Request…');
  C('scm.focus', () => { showView('explorer'); const m = SEC.mounted.get('scm'); if (m) { m.el.classList.remove('collapsed'); m.el.scrollIntoView(); } }, 'View: Source Control');
  const relFromRoot = (p) => (S.st && S.st.root ? p.slice(S.st.root.length).replace(/^[\\/]+/, '').split(BS).join('/') : p);

  CNS.on('workspace-opened', () => refresh({ force: true }));
  const hookEditor = () => { if (typeof editor === 'undefined' || !editor || hookEditor.done) return; hookEditor.done = true; editor.onDidChangeModel(() => scheduleGutter(80)); editor.onDidChangeModelContent(() => scheduleGutter(600)); };
  hookEditor(); setTimeout(hookEditor, 3000); setTimeout(hookEditor, 9000);
  CNS.on('file-saved', () => { clearTimeout(S.timer); S.timer = setTimeout(() => refresh({ force: true }), 700); });
  window.addEventListener('focus', () => refresh());
  setInterval(() => { if (document.visibilityState === 'visible' && state.workspace && !S.busy) refresh({ force: true }); }, 20000);
  const tree = document.getElementById('tree');
  if (tree) new MutationObserver(() => decorateTree()).observe(tree, { childList: true, subtree: true });
});
