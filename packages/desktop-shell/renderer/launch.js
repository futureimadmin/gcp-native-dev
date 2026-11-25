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

/** Start-up work, silently: the cloud checks run in the background and nothing about them is shown. */
async function runLaunch() {
  $('launch').classList.add('hidden');
  const checks = state.clouds.map((c) => refreshCloud(c.id).catch(() => null));
  // Google Cloud gets a few seconds; the others fill the toolbar pills whenever they finish
  const gcpIdx = state.clouds.findIndex((c) => c.id === 'gcp');
  const gcp = gcpIdx >= 0 ? await Promise.race([checks[gcpIdx], new Promise((r) => setTimeout(() => r(null), 4000))]) : null;
  await loadAi();
  // not signed in to Google Cloud: ask once the IDE is on screen (never during the splash)
  const askLogin = !state.settings.startup || state.settings.startup.promptLogin !== false;
  if (gcpIdx >= 0 && askLogin) checks[gcpIdx].then((g) => { if (g && !g.signedIn && g.installed !== false) setTimeout(() => offerGcpLogin(), 2500); });
}

function offerGcpLogin() {
  if (document.getElementById('lic-screen')) return setTimeout(offerGcpLogin, 4000); // never on top of the license screen
  const close = modal('Sign in to Google Cloud?', h('p', { class: 'hint', text: 'Sign in to use Google Cloud projects, billing and provisioning from the IDE. You can also do this later from the Clouds view.' }),
    [h('button', { text: 'Not now', onclick: () => close() }), h('button', { class: 'primary', text: 'Sign in', onclick: () => { close(); cloudLogin('gcp'); } })]);
}
