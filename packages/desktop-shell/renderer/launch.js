/* Startup flow. Checks cloud credentials while the splash is showing:
 *  - Google Cloud: looks for Application Default Credentials (ADC). Missing -> asks the user to sign in. Found -> shows the project in ADC.
 *  - AWS / Azure / Kubernetes: checked in the background; they never block startup.
 */
'use strict';

function launchRow(id, text, kind = 'pending') {
  let el = document.getElementById(`lrow-${id}`);
  if (!el) {
    el = h('div', { class: 'lrow', id: `lrow-${id}` }, h('span', { class: 'lmark' }), h('span', { class: 'ltext' }));
    $('launch-steps').append(el);
  }
  el.className = `lrow ${kind}`;
  el.querySelector('.lmark').textContent = kind === 'ok' ? '✔' : kind === 'warn' ? '!' : kind === 'off' ? '○' : '…';
  el.querySelector('.ltext').textContent = text;
}

function describeStatus(c, s) {
  if (s.signedIn) return `${c.name}${c.id === 'gcp' ? ` · project ${s.scope || '(none set in ADC)'}` : s.scope && s.scope !== s.identity ? ` · ${scopeShort(s.scope)}` : ''} · ${s.identity || 'signed in'}`;
  if (s.installed === false) return `${c.name} · command-line tools not installed`;
  return `${c.name} · ${c.id === 'gcp' ? 'no Application Default Credentials found' : 'not signed in'}`;
}

async function runLaunch() {
  const overlay = $('launch');
  overlay.classList.remove('hidden');
  $('launch-steps').replaceChildren();
  $('launch-actions').replaceChildren();

  launchRow('plugins', `Plugins loaded: ${state.plugins.filter((p) => p.enabled).length}`, 'ok');
  for (const c of state.clouds) launchRow(c.id, c.id === 'gcp' ? 'Checking Google Cloud Application Default Credentials…' : `Checking ${c.name}…`);

  const checks = state.clouds.map((c) => refreshCloud(c.id).then((s) => { launchRow(c.id, describeStatus(c, s), s.signedIn ? 'ok' : 'off'); return s; }));

  // Only Google Cloud gates startup (bounded wait); the other clouds fill in the toolbar pills as they finish.
  const gcpIdx = state.clouds.findIndex((c) => c.id === 'gcp');
  if (gcpIdx >= 0) {
    const gcp = await Promise.race([checks[gcpIdx], new Promise((r) => setTimeout(() => r(null), 30000))]);
    const askLogin = !state.settings.startup || state.settings.startup.promptLogin !== false;
    if (gcp && !gcp.signedIn && askLogin) await promptGcpLogin(gcp);
  }

  launchRow('services', 'Launching services…');
  await loadAi();
  launchRow('services', 'Services ready', 'ok');
  overlay.classList.add('fade');
  setTimeout(() => { overlay.classList.add('hidden'); overlay.classList.remove('fade'); }, 250);
}

function promptGcpLogin(gcp) {
  return new Promise((resolve) => {
    const c = cloudMeta('gcp');
    const msg = h('div', { class: 'msg' });
    const logBox = h('pre', { class: 'hidden progress' });
    const actions = $('launch-actions');
    const done = () => { off(); actions.replaceChildren(); resolve(); };
    const off = cns.on('cloud:event', async ({ provider, evt, payload }) => {
      if (provider !== 'gcp') return;
      if (evt === 'log') { logBox.classList.remove('hidden'); logBox.textContent += payload; logBox.scrollTop = logBox.scrollHeight; }
      if (evt === 'done') {
        const s = await refreshCloud('gcp');
        launchRow('gcp', describeStatus(c, s), s.signedIn ? 'ok' : 'warn');
        if (s.signedIn) done();
        else { msg.className = 'msg err'; msg.textContent = 'Sign-in did not complete. You can try again or skip.'; signBtn.disabled = false; }
      }
    });
    const signBtn = h('button', { class: 'primary', text: 'Sign in with Google', onclick: async () => {
      signBtn.disabled = true;
      msg.className = 'msg';
      msg.textContent = 'Opening your browser… complete the Google sign-in, then return here.';
      const r = await tryInv('cloud:call', 'gcp', 'login', []);
      if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error; signBtn.disabled = false; }
    } });

    launchRow('gcp', 'Google Cloud · sign-in needed', 'warn');
    if (gcp.installed === false) {
      actions.replaceChildren(h('div', { class: 'lcard' },
        h('b', { text: 'Google Cloud CLI not found' }),
        h('p', { class: 'hint', text: 'No Application Default Credentials were found and the gcloud CLI is not installed. Install it to sign in, or skip and use another cloud.' }),
        h('div', { class: 'row' }, h('button', { class: 'primary', text: 'Open install page', onclick: () => inv('shell:openExternal', c.installUrl).catch(() => {}) }), h('button', { text: 'Continue without Google Cloud', onclick: done }))));
      return;
    }
    actions.replaceChildren(h('div', { class: 'lcard' },
      h('b', { text: 'Sign in to Google Cloud' }),
      h('p', { class: 'hint', text: 'Application Default Credentials were not found on this computer. Sign in so the IDE can use your Google Cloud projects.' }),
      h('div', { class: 'row' }, signBtn, h('button', { text: 'Skip for now', onclick: done }),
        h('button', { class: 'subtle', text: 'Don’t ask again', onclick: async () => { await tryInv('settings:set', 'startup.promptLogin', false); state.settings.startup = { ...(state.settings.startup || {}), promptLogin: false }; done(); } })),
      msg, logBox));
  });
}
