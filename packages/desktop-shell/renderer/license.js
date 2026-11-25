/* Edition and license: the status-bar chip and the license screen.
   Community Edition = 30-day trial. Enterprise Edition = a key from the FutureIM license server. The screen opens by itself,
   and cannot be closed, only when neither is valid. */
'use strict';

const LS = { st: null, el: null, busy: false, msg: null, blocking: false };

const licDate = (iso) => { try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return ''; } };

async function licenseInit() {
  const r = await tryInv('license:status');
  if (r.ok) LS.st = r.data;
  licenseChip();
  cns.on('license:changed', (st) => {
    LS.st = st;
    licenseChip();
    if (!st.canUse) openLicenseScreen({ blocking: true });
    else if (LS.el) licenseDraw();
  });
  if (LS.st && !LS.st.canUse) openLicenseScreen({ blocking: true });
}

function licenseChip() {
  const bar = document.getElementById('st-pos') && document.getElementById('st-pos').parentElement;
  if (!bar) return;
  let el = document.getElementById('st-license');
  if (!el) { el = h('span', { id: 'st-license', class: 'st-license', title: 'Edition and license (click)', onclick: () => openLicenseScreen({}) }); bar.insertBefore(el, document.getElementById('st-pos')); }
  const st = LS.st;
  if (!st) { el.textContent = ''; return; }
  const soon = st.edition === 'community' && st.daysLeft != null && st.daysLeft <= 7;
  el.className = `st-license${!st.canUse || soon || st.state === 'grace' ? ' warn' : ''}`;
  el.textContent = st.edition === 'enterprise' ? (st.state === 'grace' ? 'Enterprise · connect to verify' : 'Enterprise Edition') : st.canUse ? `Community Edition · ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'} left` : 'Community trial ended';
}

function openLicenseScreen(opts = {}) {
  LS.blocking = !!opts.blocking || (LS.st && !LS.st.canUse);
  if (LS.el) { licenseDraw(); return; }
  LS.el = h('div', { id: 'lic-screen', class: 'lic' });
  document.body.append(LS.el);
  LS.msg = null;
  document.addEventListener('keydown', licenseEsc);
  licenseDraw();
  tryInv('license:refresh').then((r) => { if (r.ok) { LS.st = r.data; licenseChip(); if (LS.el) licenseDraw(); } });
}

function licenseClose() {
  if (LS.blocking && LS.st && !LS.st.canUse) return;
  if (LS.el) LS.el.remove();
  LS.el = null;
  document.removeEventListener('keydown', licenseEsc);
}
function licenseEsc(e) { if (e.key === 'Escape') licenseClose(); }

function licenseDraw() {
  const st = LS.st;
  if (!st || !LS.el) return;
  const blocked = !st.canUse;
  const key = h('input', { placeholder: 'FIM-XXXX-XXXX-XXXX-XXXX', spellcheck: 'false', autocomplete: 'off', disabled: LS.busy, onkeydown: (e) => { if (e.key === 'Enter') activate(); } });
  async function activate() {
    const v = key.value.trim();
    if (!v) { LS.msg = { err: true, text: 'Enter the license key you received from FutureIM.' }; return licenseDraw(); }
    LS.busy = true; LS.msg = { text: 'Checking the key with FutureIM…' }; licenseDraw();
    const r = await tryInv('license:activate', v);
    LS.busy = false;
    if (r.ok) { LS.st = r.data; LS.msg = { ok: true, text: 'Enterprise Edition is active. Thank you.' }; licenseChip(); licenseDraw(); setTimeout(() => { if (LS.st && LS.st.canUse) licenseClose(); }, 1400); } else { LS.msg = { err: true, text: r.error }; licenseDraw(); }
  }
  const ent = st.edition === 'enterprise';
  const lic = st.licensee || {};
  const community = h('div', { class: `lic-card${!ent ? ' on' : ''}` },
    h('div', { class: 'lic-edition', text: 'Community Edition' }),
    h('div', { class: 'lic-sub', text: 'Free trial for 30 days' }),
    h('ul', {}, h('li', { text: 'Everything in the IDE, for one month' }), h('li', { text: 'No key and no sign-up' })),
    ent ? h('div', { class: 'lic-note', text: 'You are using Enterprise Edition.' }) : st.canUse ? h('div', { class: 'lic-left' }, h('b', { text: `${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'} left` }), h('span', { text: ` · ends ${licDate(st.expires)}` })) : h('div', { class: 'lic-left bad' }, h('b', { text: 'The trial has ended' }), h('span', { text: ` on ${licDate(st.expires)}` })),
    h('button', { class: 'lic-btn', text: 'Continue with Community Edition', disabled: !st.canUse || ent, onclick: licenseClose }));
  const enterprise = h('div', { class: `lic-card${ent ? ' on' : ''}` },
    h('div', { class: 'lic-edition', text: 'Enterprise Edition' }),
    h('div', { class: 'lic-sub', text: 'Licensed, for teams and organisations' }),
    ent ? h('div', { class: 'lic-who' },
      h('div', {}, h('b', { text: lic.tenant || lic.name || 'Licensed' })), lic.email ? h('div', { class: 'lic-dim', text: lic.email }) : null,
      h('div', { class: 'lic-dim', text: `Key ${st.keyMasked}${st.expires ? ` · valid until ${licDate(st.expires)}${st.daysLeft != null ? ` (${st.daysLeft} days)` : ''}` : ''}` }),
      st.message ? h('div', { class: 'lic-note', text: st.message }) : null,
      h('div', { class: 'lic-row' }, h('button', { class: 'lic-btn ghost', text: 'Check now', disabled: LS.busy, onclick: async () => { LS.busy = true; licenseDraw(); const r = await tryInv('license:refresh'); LS.busy = false; if (r.ok) { LS.st = r.data; licenseChip(); } licenseDraw(); } }),
        h('button', { class: 'lic-btn ghost', text: 'Remove this license', onclick: async () => { const r = await tryInv('license:remove'); if (r.ok) { LS.st = r.data; LS.msg = null; licenseChip(); licenseDraw(); if (!r.data.canUse) openLicenseScreen({ blocking: true }); } } })))
      : h('div', {},
        st.enterpriseProblem ? h('div', { class: 'lic-note bad', text: st.enterpriseProblem }) : null,
        h('label', { text: 'License key' }), key,
        h('div', { class: 'lic-row' }, h('button', { class: 'lic-btn primary', text: LS.busy ? 'Checking…' : 'Activate', disabled: LS.busy, onclick: activate }), h('a', { href: '#', class: 'lic-link', text: 'Get a license →', onclick: (e) => { e.preventDefault(); tryInv('license:open'); } }))));
  LS.el.replaceChildren(
    h('div', { class: 'lic-rays' }),
    h('div', { class: 'lic-box' },
      !blocked || !LS.blocking ? h('button', { class: 'lic-x', title: 'Close', text: '✕', onclick: licenseClose }) : null,
      h('img', { class: 'lic-logo', src: 'assets/futureim-logo.jpg', alt: 'FutureIM' }),
      h('h2', { text: 'Nativity Studio' }),
      blocked ? h('div', { class: 'lic-alert', text: st.message || 'A license is needed to continue.' }) : h('div', { class: 'lic-lead', text: 'Your edition' }),
      h('div', { class: 'lic-cards' }, community, enterprise),
      LS.msg ? h('div', { class: `lic-msg${LS.msg.err ? ' bad' : LS.msg.ok ? ' ok' : ''}`, text: LS.msg.text }) : null,
      st.clockWarning ? h('div', { class: 'lic-note bad', text: 'The computer clock looks wrong. Correct it so the license can be checked.' }) : null,
      h('div', { class: 'lic-foot', text: 'Powered by Future Intelligent Machines' })));
}
