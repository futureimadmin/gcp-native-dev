/* AI across the software life cycle: fix failing builds and tests, security scan, log analysis and failure detection, recovery plans,
   release check, code review. The assistant (Claude Code) edits files; builds, tests, deployments and commands run only after the user approves. */
'use strict';

const lcBuf = { out: '', term: '' }; // the last output of the build / test panel and of the terminal, kept for failure detection
const LC = { attempts: 3, busy: false, stop: false, scan: null, logs: null, agentOk: false, box: {} };
const lcTail = (s, n) => (String(s).length > n ? '…' + String(s).slice(-n) : String(s));
const NL1 = String.fromCharCode(10);
const SEV_CLASS = { critical: 'bad', high: 'bad', medium: 'warn', low: '' };

/* ------------------------------ talking to the assistant ------------------------------ */

/** Sends a prompt to Claude Code in agent mode and waits until it has finished. Resolves true when the turn ended without an error. */
async function lcAgent(prompt) {
  await loadAi(true);
  const p = state.ai && state.ai.api.find((a) => a.id === 'claude-code');
  if (!p || !p.ready) { status('Automatic fixing needs Claude Code installed and signed in. Open the AI panel to install or sign in.', true); toggleAi(true); return false; }
  if (chat.busy) { status('The assistant is busy. Wait for it to finish.', true); return false; }
  if (!LC.agentOk) {
    if (!(await confirmBox('Let Claude fix this?', 'Claude Code will create and change files in the open project folder without asking each time. Builds, tests, deployments and commands run only when you approve each card. Use Git so you can review and undo the changes.'))) return false;
    LC.agentOk = true;
  }
  chat.provider = 'claude-code'; chat.agent = true;
  toggleAi(true);
  $('ai-input').value = prompt;
  const finished = new Promise((res) => { chat.onDone = res; });
  await sendChat();
  if (!chat.streamId) { chat.onDone = null; return false; }
  await finished;
  const last = chat.messages[chat.messages.length - 1];
  return !(last && last.error);
}

/** Asks (does not edit): the user reviews the attached text before sending. */
function lcAsk(prompt, label, text) { askAI(prompt, text ? [{ label, text }] : []); }

/* ------------------------------ running builds and tests with capture ------------------------------ */

async function lcRun(kind) {
  const proj = currentProject();
  const task = proj && taskOf(proj, kind);
  if (!task) return { skipped: `No ${kind} task was detected for this project.` };
  if (run.building) return { skipped: 'A build is already running.' };
  run.building = true;
  const h_ = await startTask(proj, task, 'output');
  if (!h_) { run.building = false; return { skipped: 'Could not start the task. Check Settings > Runtimes.' }; }
  const code = await h_.done;
  run.building = false;
  outPrint(code === 0 ? (kind === 'test' ? '✔ Tests passed\n' : '✔ Build finished\n') : `✘ ${kind === 'test' ? 'Tests failed' : 'Build failed'} (exit ${code})\n`, code === 0 ? 't-cmd' : 't-err');
  return { code, out: lcBuf.out };
}

/** After a failed build or test: a button in the OUTPUT panel that hands the failure to the assistant. */
function lcOfferFix(kind) {
  const out = $('output-out');
  out.append(h('button', { class: 'primary lc-offer', text: '✦ Fix with AI', title: 'Claude reads this output and fixes the code, then the IDE runs it again', onclick: () => { openLifecycle(); lcFixLoop(kind, lcBuf.out); } }));
  out.scrollTop = out.scrollHeight;
}

/** After a run stopped with an error: detect known failures in what it printed and say so. */
async function lcDetectRunFailure(label) {
  const r = await tryInv('lc:analyze', lcBuf.term);
  if (!r.ok || !r.data.findings.length) return;
  const top = r.data.findings[0];
  LC.lastRun = { label, findings: r.data.findings, text: lcBuf.term };
  status(`${label} failed: ${top.title}. Open AI Lifecycle > Logs for what to do.`, true);
}

/* ------------------------------ the page ------------------------------ */

function lcSection(title, intro, ...kids) {
  return h('section', { class: 'card lc-sec' }, h('h3', { text: title }), h('p', { class: 'hint', text: intro }), ...kids);
}

function lcFindingRow(f, onFix) {
  return h('div', { class: 'lc-find ' + (SEV_CLASS[f.severity] || '') },
    h('span', { class: 'badge ' + (SEV_CLASS[f.severity] || ''), text: f.severity }),
    h('div', { class: 'lc-ftext' }, h('b', { text: f.title }), h('small', { text: f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : '' }), h('code', { text: f.text || f.sample || '' })),
    h('div', { class: 'lc-fact' },
      f.file && state.workspace && f.file !== 'package.json' ? h('button', { class: 'subtle', text: 'Open', onclick: () => openFile(joinPath(state.workspace, f.file.split('/').join(BS))) }) : null,
      onFix ? h('button', { class: 'subtle', text: 'Fix', onclick: () => onFix(f) }) : null));
}

function openLifecycle() {
  openPage({ id: 'lifecycle', title: 'AI Lifecycle', icon: '✦', pad: true, build: (el) => {
    const fixLog = h('div', { class: 'lc-log' });
    const scanBox = h('div', {}); const logBox = h('div', {}); const relBox = h('div', {});
    const stageBox = h('div', { class: 'lc-steps' }); const planLog = h('div', { class: 'lc-log' });
    LC.box = { fixLog, scanBox, logBox, relBox, stageBox, planLog };
    const idea = h('textarea', { class: 'lc-idea', rows: 4, placeholder: 'What should the application do? Who uses it? Any limits (users, data, deadlines, compliance)? A few lines are enough; the assistant lists open questions for you.' });
    idea.value = LC.idea || ''; idea.oninput = () => { LC.idea = idea.value; };
    const noProj = () => { if (!state.workspace) { status('Open a project first.', true); return true; } return false; };

    const attempts = h('select', {}, [1, 2, 3, 4, 5].map((n) => h('option', { value: n, text: n + (n === 1 ? ' fix attempt' : ' fix attempts'), selected: n === LC.attempts })));
    attempts.onchange = () => { LC.attempts = +attempts.value; };
    const envSel = h('select', {}, (() => {
      const p = state.proj; const names = p && p.envs && p.envs.length ? p.envs.map((e) => e.name) : ['dev', 'sit', 'uat', 'prod'];
      return names.map((n) => h('option', { value: n, text: n, selected: p && n === p.env }));
    })());

    setTimeout(lcRenderStages, 0);
    el.append(
      h('div', { class: 'hero' }, h('h1', { text: 'AI Lifecycle' }), h('p', { text: 'Requirements, architecture, design, code, security, operations and release with the assistant. It edits files; builds, tests, deployments and commands run only when you approve them.' })),

      lcSection('Plan and build', 'From an idea to working code, one stage at a time. Each stage writes a document into the docs folder of your project. Read it and edit it before you go on, so you stay in control. Then the tasks are built one by one, and each one is built and tested before the next.',
        idea, stageBox, planLog),

      lcSection('Fix failing builds and tests', 'Runs the build or the tests. If they fail, Claude reads the output and fixes the code, then the IDE runs them again, until they pass or the attempts are used up.',
        h('div', { class: 'row' }, h('button', { class: 'primary', text: '🔨 Build and fix', onclick: () => !noProj() && lcFixLoop('build') }), h('button', { class: 'primary', text: '🧪 Test and fix', onclick: () => !noProj() && lcFixLoop('test') }), attempts,
          h('button', { class: 'subtle', text: 'Stop', onclick: () => { LC.stop = true; if (chat.streamId) tryInv('ai:cancel', chat.streamId); } })),
        fixLog),

      lcSection('Security', 'Looks for secrets in the code, risky code (injection, weak hashes, switched-off certificate checks), risky infrastructure files (open to the internet, permission *, public storage) and vulnerable Node.js dependencies. Secret values are never shown in full.',
        h('div', { class: 'row' }, h('button', { class: 'primary', text: '🛡 Scan project', onclick: () => !noProj() && lcScan() }),
          h('button', { text: 'Ask AI to review security', onclick: () => !noProj() && lcAgentReview() })),
        scanBox),

      lcSection('Logs, failure detection and recovery', 'Reads the recent warnings and errors of an environment (Google Cloud and AWS) or the last build and run output, recognises known failures (out of memory, crash loops, permissions, timeouts, database errors) and suggests what to do.',
        h('div', { class: 'row' }, envSel, h('button', { class: 'primary', text: '📜 Fetch logs and detect failures', onclick: () => !noProj() && lcLogs(envSel.value) }),
          h('button', { text: 'Analyze build / run output', onclick: () => lcLocalOutput() })),
        logBox),

      lcSection('Release check', 'Before you deploy: uncommitted changes, build, tests and security. If everything passes you can deploy; if not, Claude can fix what failed.',
        h('div', { class: 'row' }, h('button', { class: 'primary', text: '🚀 Run release check', onclick: () => !noProj() && lcRelease() })), relBox),

      lcSection('Review and tests', 'Ask for a review of what you changed, tests for the open file, or an explanation. The text is shown to you before anything is sent.',
        h('div', { class: 'row' },
          h('button', { text: 'Review my changes', onclick: async () => { if (noProj()) return; const g = await tryInv('lc:git', state.workspace); if (!g.ok || !g.data.git) return status('This folder is not a Git repository.', true); if (!g.data.changed) return status('There are no changes to review.'); lcAsk('Review these changes for bugs, security problems and missing tests. Be specific and short.', 'git diff', g.data.stat + NL1 + NL1 + g.data.diff); } }),
          h('button', { text: 'Write tests for the open file', onclick: () => { const t = state.active; if (!t || t.kind !== 'file') return status('Open a file first.', true); lcAsk('Write unit tests for this file using the test framework already used in this project.', baseName(t.path), t.model.getValue()); } }),
          h('button', { text: 'Explain the open file', onclick: () => { const t = state.active; if (!t || t.kind !== 'file') return status('Open a file first.', true); lcAsk('Explain what this file does, its risks and how to improve it.', baseName(t.path), t.model.getValue()); } }))),
    );
  } });
}

/* ------------------------------ fix loop ------------------------------ */

function lcLog(text, cls) {
  const b = LC.box[LC.logTo || 'fixLog']; if (!b || !b.isConnected) return;
  b.append(h('div', { class: 'lc-line ' + (cls || ''), text }));
  b.scrollTop = b.scrollHeight;
}

async function lcFixLoop(kind, firstOutput) {
  if (LC.busy) return status('A fix is already running.', true);
  if (!state.workspace) return status('Open a project first.', true);
  LC.busy = true; LC.stop = false; LC.logTo = 'fixLog';
  if (LC.box.fixLog) LC.box.fixLog.replaceChildren();
  try { await lcFixCore(kind, firstOutput); } finally { LC.busy = false; }
}

/** Runs the build or tests and asks Claude to fix failures, up to LC.attempts times. Resolves true when it passes (or there is nothing to run). */
async function lcFixCore(kind, firstOutput) {
  const name = kind === 'test' ? 'tests' : 'build';
  let out = firstOutput || '';
  let first = !!firstOutput;
  for (let fix = 0; ; fix++) {
    if (!first) {
      lcLog(`Running the ${name}…`);
      const r = await lcRun(kind);
      if (r.skipped) { lcLog(r.skipped, 'bad'); return kind === 'test'; } // no test task is not a failure; no build task is
      if (r.code === 0) { lcLog(fix ? `✔ The ${name} pass after ${fix} fix${fix > 1 ? 'es' : ''}. Review the changes in Source Control before committing.` : `✔ The ${name} already pass. Nothing to fix.`, 'ok'); return true; }
      out = r.out;
    }
    first = false;
    if (fix >= LC.attempts) { lcLog(`✘ The ${name} still fail after ${LC.attempts} fix attempt${LC.attempts > 1 ? 's' : ''}. Look at the output and the assistant's last message.`, 'bad'); return false; }
    if (LC.stop) { lcLog('Stopped.', 'bad'); return false; }
    lcLog(`✘ The ${name} failed. Asking Claude for fix ${fix + 1} of ${LC.attempts}…`);
    const ok = await lcAgent(`The ${name} of this project failed. Fix the cause in the source code so they pass. Change as little as possible. Do not delete or weaken tests, and do not touch files outside the project. Do not run commands: the IDE runs the ${name} again after you finish. Output (the last part):${NL1}${'```'}${NL1}${lcTail(out, 7000)}${NL1}${'```'}`);
    if (!ok) { lcLog(LC.stop ? 'Stopped.' : 'The assistant did not finish. See the AI panel.', 'bad'); return false; }
    if (LC.stop) { lcLog('Stopped.', 'bad'); return false; }
  }
}

/* ------------------------------ plan and build: requirements, architecture, design, tasks, code ------------------------------ */

const DOC = (f) => state.workspace ? joinPath(state.workspace, f.split('/').join(BS)) : '';
const DIAGRAM_RULES = 'Mermaid rules so every diagram draws: start with the diagram type, use short plain node ids (letters and digits only) with the readable text in quotes, no parentheses or special characters inside unquoted labels, one statement per line, and keep each diagram under 25 nodes.';
const LC_STAGES = [
  { id: 'req', file: 'docs/requirements.md', title: '1. Requirements', verb: 'Write requirements', needs: [],
    prompt: (c) => `Act as a business analyst. Write docs/requirements.md for this application. The idea from the user:${NL1}"""${NL1}${c.idea || '(none given: read the existing project and describe what it should do)'}${NL1}"""${NL1}Include: purpose, users and roles, user stories each with acceptance criteria (Given / When / Then), non-functional requirements (performance, security, availability, compliance), what is out of scope, assumptions, and a short list of OPEN QUESTIONS for the user. If the project already has code, read it first and describe what exists. Write only that file. No code.` },
  { id: 'arch', file: 'docs/architecture.md', title: '2. Architecture', verb: 'Design the architecture', needs: ['docs/requirements.md'],
    prompt: (c) => `Act as a solution architect. Read docs/requirements.md (and any existing code). Write docs/architecture.md: context and main components, data stores and data flow, APIs and integrations, security (authentication, authorization, secrets, least-privilege roles), the cloud services to use (${c.cloud}), the environments (${c.envs}), availability and scaling, cost drivers, and the main decisions and risks with reasons. Draw these diagrams as Mermaid in fenced blocks marked mermaid: (1) a flowchart of the system context and main components, with subgraphs for the trust zones or cloud boundaries, (2) a flowchart of the main data flow, and (3) a flowchart of the deployment per environment on the cloud services you chose. ${DIAGRAM_RULES} Write only that file. No code.` },
  { id: 'design', file: 'docs/design.md', title: '3. Detailed design', verb: 'Write the design', needs: ['docs/requirements.md', 'docs/architecture.md'],
    prompt: () => `Act as a senior engineer. Read docs/requirements.md and docs/architecture.md. Write docs/design.md: the language and framework to use (match the existing project if there is one), project structure and modules, the main classes or functions and what each does, API contracts (endpoints, request, response, errors), the data model, validation and error handling, logging and configuration, and the test strategy (unit, integration, what to mock). Draw these diagrams as Mermaid in fenced blocks marked mermaid: a classDiagram of the main classes and their relations, a sequenceDiagram for each of the two or three most important flows, an erDiagram of the data model, and a stateDiagram-v2 for any object with a life cycle (for example an order). ${DIAGRAM_RULES} Write only that file. No code.` },
  { id: 'plan', file: 'docs/tasks.md', title: '4. Task plan', verb: 'Plan the tasks', needs: ['docs/requirements.md', 'docs/design.md'],
    prompt: () => `Act as a tech lead. Read the files in docs/. Write docs/tasks.md: an ordered checklist of small tasks, each one buildable and testable in one sitting, in the format "- [ ] T1: title — acceptance: how to check it". Start with the project skeleton and a working build, then the riskiest parts, then the rest, and finish with deployment and monitoring. Write only that file. No code.` },
];
const DEV_PROMPT = () => `Act as the developer. Read docs/requirements.md, docs/architecture.md, docs/design.md and docs/tasks.md. Take the FIRST unchecked task in docs/tasks.md, build it following the design, add or update unit tests for it, and change its line to "- [x]". Keep the change small and inside the project folder. Do not run commands: the IDE builds and tests afterwards. Finish by saying what you built and what to check.`;

function lcContext() {
  const p = state.proj || {};
  const cloud = p.enabled ? `the project's cloud is ${(cloudMeta(p.cloud) || {}).name || p.cloud}` : 'no cloud is chosen yet: stay cloud-neutral and name the equivalent services on Google Cloud, AWS and Azure';
  const envs = p.envs && p.envs.length ? p.envs.map((e) => e.name).join(', ') : 'dev, sit, uat, prod';
  return { idea: LC.idea || '', cloud, envs };
}

async function lcStageStatus() {
  const st = {};
  for (const s of LC_STAGES) st[s.id] = state.workspace ? !!(await tryInv('fs:exists', DOC(s.file))).data : false;
  let open = 0; let done = 0;
  if (st.plan) { const r = await tryInv('fs:readFile', DOC('docs/tasks.md')); const t = r.ok ? String(r.data.text !== undefined ? r.data.text : r.data) : ''; open = (t.match(/^\s*- \[ \]/gm) || []).length; done = (t.match(/^\s*- \[[xX]\]/gm) || []).length; }
  return { st, open, done };
}

async function lcRenderStages() {
  const box = LC.box.stageBox; if (!box || !box.isConnected) return;
  const { st, open, done } = await lcStageStatus();
  box.replaceChildren(...LC_STAGES.map((s) => {
    const missing = s.needs.filter((f) => !LC_STAGES.some((x) => x.file === f && st[x.id]));
    return h('div', { class: 'lc-step' }, h('span', { class: 'badge ' + (st[s.id] ? 'ok' : ''), text: st[s.id] ? '✔' : '–' }), h('b', { text: s.title }), h('small', { class: 'hint', text: s.file }),
      h('span', { class: 'spacer' }),
      st[s.id] ? h('button', { class: 'subtle', text: 'Open', onclick: () => openFile(DOC(s.file)) }) : null,
      s.id === 'arch' ? h('button', { class: 'subtle', text: 'Cloud services wizard', title: 'Pick services and generate Terraform', onclick: () => CNS.run('cloud.architecture') }) : null,
      h('button', { class: st[s.id] ? '' : 'primary', text: st[s.id] ? 'Regenerate' : s.verb, disabled: !!missing.length || LC.busy, title: missing.length ? 'First: ' + missing.join(', ') : '', onclick: () => lcGenerateStage(s) }));
  }),
  h('div', { class: 'lc-step' }, h('span', { class: 'badge ' + (st.plan && !open && done ? 'ok' : ''), text: st.plan ? `${done}/${open + done}` : '–' }), h('b', { text: '5. Build the tasks' }), h('small', { class: 'hint', text: st.plan ? `${open} left` : 'needs the task plan' }),
    h('span', { class: 'spacer' }),
    h('button', { class: 'primary', text: 'Build next task', disabled: !st.plan || !open || LC.busy, onclick: () => lcDevelop(1) }),
    h('button', { class: 'primary', text: 'Build up to 5 tasks', disabled: !st.plan || !open || LC.busy, title: 'Each task is built, then the build and tests run and are fixed before the next one', onclick: () => lcDevelop(5) }),
    h('button', { class: 'subtle', text: 'Stop', onclick: () => { LC.stop = true; if (chat.streamId) tryInv('ai:cancel', chat.streamId); } })));
}

async function lcGenerateStage(s) {
  if (LC.busy) return status('Something is already running.', true);
  if (!state.workspace) return status('Open a project first.', true);
  LC.busy = true; LC.logTo = 'planLog'; LC.stop = false;
  try {
    lcLog(`${s.verb}…`);
    const ok = await lcAgent(s.prompt(lcContext()));
    lcLog(ok ? `✔ ${s.file} written. Read it, edit it if needed, then go to the next stage.` : '✘ Not finished. See the AI panel.', ok ? 'ok' : 'bad');
    if (ok) openFile(DOC(s.file));
  } finally { LC.busy = false; lcRenderStages(); }
}

/** Builds tasks one by one: Claude implements the next task, then the build and the tests run and are fixed before the next task starts. */
async function lcDevelop(count) {
  if (LC.busy) return status('Something is already running.', true);
  LC.busy = true; LC.logTo = 'planLog'; LC.stop = false;
  try {
    for (let i = 1; i <= count; i++) {
      const { open } = await lcStageStatus();
      if (!open) { lcLog('✔ All tasks in docs/tasks.md are done.', 'ok'); break; }
      lcLog(`Task ${i} of ${count}: Claude builds the next task…`);
      if (!(await lcAgent(DEV_PROMPT()))) { lcLog(LC.stop ? 'Stopped.' : '✘ Not finished. See the AI panel.', 'bad'); break; }
      if (LC.stop) { lcLog('Stopped.', 'bad'); break; }
      await detectBuildEnv(); // the new task may have added a build file
      if (!(await lcFixCore('build')) || !(await lcFixCore('test'))) { lcLog('Stopped: the build or tests do not pass yet. Use "Build and fix" or "Test and fix" above.', 'bad'); break; }
      lcRenderStages();
    }
  } finally { LC.busy = false; lcRenderStages(); }
}

/* ------------------------------ security ------------------------------ */

async function lcScan() {
  const box = LC.box.scanBox; box.replaceChildren(h('div', { class: 'hint', text: 'Scanning…' }));
  const r = await tryInv('lc:scan', state.workspace);
  if (!r.ok) return box.replaceChildren(h('div', { class: 't-err', text: r.error }));
  LC.scan = r.data;
  lcShowScan();
  return r.data;
}

function lcShowScan() {
  const box = LC.box.scanBox; if (!box || !box.isConnected) return;
  const d = LC.scan; const c = d.counts;
  const top = d.findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  box.replaceChildren(
    h('div', { class: 'row' }, ['critical', 'high', 'medium', 'low'].map((s) => h('span', { class: 'badge ' + (c[s] && s !== 'low' ? SEV_CLASS[s] : ''), text: `${c[s]} ${s}` })), h('small', { class: 'hint', text: `${d.scanned} files scanned. ${d.audit}` })),
    d.findings.length ? h('div', { class: 'lc-finds' }, d.findings.slice(0, 40).map((f) => lcFindingRow(f, (x) => lcFixFindings([x])))) : h('div', { class: 'msg ok', text: '✔ Nothing found.' }),
    d.findings.length > 40 ? h('div', { class: 'hint', text: `Showing 40 of ${d.findings.length}.` }) : null,
    top.length ? h('div', { class: 'row' }, h('button', { class: 'primary', text: `Fix ${Math.min(top.length, 25)} critical / high with AI`, onclick: () => lcFixFindings(top.slice(0, 25)) })) : null);
}

async function lcFixFindings(list) {
  const lines = list.map((f) => `- [${f.severity}] ${f.title} at ${f.file}${f.line ? ':' + f.line : ''}: ${f.text}`).join(NL1);
  const secrets = list.some((f) => f.kind === 'secret');
  const ok = await lcAgent(`Fix these security findings in the project. For a secret, replace it with a read from an environment variable or the cloud secret manager and add the name to an example config file; never print secret values. For code and infrastructure problems make the safest change that keeps behaviour. For a vulnerable dependency update to the fixed version. Change only what is needed.${NL1}${NL1}${lines}${secrets ? NL1 + NL1 + 'Finish by telling me which secrets must be ROTATED, because they are already in the history.' : ''}`);
  if (ok) { status('Claude finished. Scan again to confirm.'); lcScan(); }
}

async function lcAgentReview() {
  if (!LC.scan) await lcScan();
  const d = LC.scan; if (!d) return;
  const lines = d.findings.slice(0, 40).map((f) => `- [${f.severity}] ${f.title} at ${f.file}${f.line ? ':' + f.line : ''}: ${f.text}`).join(NL1);
  askAI('Review the security of this project. For each finding say if it is real or a false alarm and why. Then list what else is missing (authentication, input validation, least-privilege roles, logging). Be specific and short.', [{ label: 'security scan', text: lines || 'No automatic findings.' }]);
}

/* ------------------------------ logs, failures, recovery ------------------------------ */

async function lcLogs(env) {
  const box = LC.box.logBox; box.replaceChildren(h('div', { class: 'hint', text: `Reading the logs of ${env}…` }));
  const r = await tryInv('lc:logs', state.workspace, env);
  if (!r.ok) return box.replaceChildren(h('div', { class: 'msg err', text: r.error }));
  LC.logs = r.data;
  lcShowFindings(box, r.data.findings, r.data.text, `${r.data.source}`, env);
}

function lcLocalOutput() {
  const text = (lcBuf.out + NL1 + lcBuf.term).trim();
  if (!text) return status('There is no build or run output yet.', true);
  tryInv('lc:analyze', text).then((r) => lcShowFindings(LC.box.logBox, r.ok ? r.data.findings : [], text, 'the last build and run output', state.proj && state.proj.env));
}

function lcShowFindings(box, findings, text, source, env) {
  if (!box || !box.isConnected) return;
  const protectedEnv = state.proj && state.proj.protectedEnv;
  box.replaceChildren(
    h('div', { class: 'hint', text: `From ${source}.` }),
    findings.length ? h('div', { class: 'lc-finds' }, findings.map((f) => h('div', { class: 'lc-find ' + (SEV_CLASS[f.severity] || '') },
      h('span', { class: 'badge ' + (SEV_CLASS[f.severity] || ''), text: f.severity }),
      h('div', { class: 'lc-ftext' }, h('b', { text: `${f.title}  ×${f.count}` }), h('small', { text: f.advice }), h('code', { text: f.sample }))))) : h('div', { class: 'msg ok', text: '✔ No known failure pattern found.' }),
    h('div', { class: 'row' },
      h('button', { text: 'Explain with AI', onclick: () => lcAsk('Find the root cause of these problems in the logs and say what to do, step by step.', 'logs', lcTail(text, 30000)) }),
      findings.length ? h('button', { class: 'primary', text: '🩹 Plan recovery and fix', title: 'Claude fixes the code and proposes recovery commands as cards you approve', onclick: () => lcRecover(findings, text, env) }) : null),
    protectedEnv && env === (state.proj && state.proj.env) ? h('div', { class: 'hint', text: `${env} is a protected environment: every command Claude proposes still needs your approval.` }) : null,
    h('details', {}, h('summary', { text: 'Show the log text' }), h('pre', { class: 'plan', text: lcTail(text, 20000) })));
}

async function lcRecover(findings, text, env) {
  const p = state.proj || {};
  const list = findings.slice(0, 8).map((f) => `- [${f.severity}] ${f.title} (x${f.count}): ${f.sample}. Usual first step: ${f.recover || 'find the cause in the code'}`).join(NL1);
  const ok = await lcAgent(`Recover and fix. Environment: ${env}. Cloud: ${p.cloud || 'unknown'}. Failures detected:${NL1}${list}${NL1}${NL1}Recent log (the last part):${NL1}${'```'}${NL1}${lcTail(text, 6000)}${NL1}${'```'}${NL1}${NL1}1) If the cause is in the project code, fix it in the files. 2) Then propose the safest RECOVERY steps as ide-action cards: roll back to the last working revision first if the problem started after a deployment, then restart or scale only if needed, and the fix redeploy last. One small card per command, each with a clear title. 3) Never touch a protected environment without saying so in the card title. 4) Never print secrets.`);
  if (ok) status('Recovery plan ready. Review the cards in the AI panel; nothing runs until you click Run.');
}

/* ------------------------------ release check ------------------------------ */

async function lcRelease() {
  const box = LC.box.relBox;
  const rows = [['git', 'Uncommitted changes'], ['build', 'Build'], ['test', 'Tests'], ['sec', 'Security: no critical or high findings']];
  const cells = {};
  box.replaceChildren(h('div', { class: 'lc-steps' }, rows.map(([id, t]) => { cells[id] = h('span', { class: 'badge', text: '…' }); return h('div', { class: 'lc-step' }, cells[id], h('span', { text: t })); })));
  const set = (id, st, msg) => { cells[id].className = 'badge ' + (st === 'ok' ? 'ok' : st === 'fail' ? 'bad' : st === 'warn' ? 'warn' : ''); cells[id].textContent = st === 'ok' ? '✔' : st === 'fail' ? '✘' : st === 'warn' ? '!' : '–'; cells[id].title = msg || ''; cells[id].parentElement.append(h('small', { class: 'hint', text: ' ' + (msg || '') })); };
  const fails = [];
  const g = await tryInv('lc:git', state.workspace);
  if (g.ok && g.data.git) set('git', g.data.changed ? 'warn' : 'ok', g.data.changed ? `${g.data.changed} file(s) not committed on ${g.data.branch}` : `clean on ${g.data.branch}`); else set('git', 'warn', 'not a Git repository');
  for (const kind of ['build', 'test']) {
    const r = await lcRun(kind);
    if (r.skipped) set(kind, 'warn', r.skipped);
    else if (r.code === 0) set(kind, 'ok', 'passed');
    else { set(kind, 'fail', `failed (exit ${r.code})`); fails.push({ kind, out: r.out }); }
  }
  const s = await lcScan();
  const bad = s ? s.findings.filter((f) => f.severity === 'critical' || f.severity === 'high') : [];
  set('sec', !s ? 'warn' : bad.length ? 'fail' : 'ok', !s ? 'scan failed' : bad.length ? `${bad.length} to fix` : 'clean');
  const ready = !fails.length && !bad.length;
  const p = state.proj || {};
  box.append(ready
    ? h('div', { class: 'msg ok' }, h('b', { text: '✔ Ready to deploy' }), h('div', { class: 'row' }, h('button', { class: 'primary', text: `Deploy to ${p.env || 'the current environment'}`, onclick: () => CNS.run('cloud.deploy') }), h('small', { class: 'hint', text: p.protectedEnv ? 'This environment is protected: the deploy asks you to confirm again.' : 'The deploy shows the exact command and asks you to confirm.' })))
    : h('div', { class: 'msg err' }, h('b', { text: '✘ Not ready to deploy' }), h('div', { class: 'row' },
      fails.map((f) => h('button', { class: 'primary', text: f.kind === 'test' ? 'Fix the tests' : 'Fix the build', onclick: () => lcFixLoop(f.kind, f.out) })),
      bad.length ? h('button', { class: 'primary', text: 'Fix the security findings', onclick: () => lcFixFindings(bad.slice(0, 25)) }) : null)));
}
