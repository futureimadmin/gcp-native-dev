/**
 * Editions of Nativity Studio.
 *   Community Edition  - a free trial of 30 days, counted from the first launch. No key.
 *   Enterprise Edition - licensed: a key issued by the FutureIM license server (products/futureim-license-server).
 *
 * The key is checked with the server's public endpoint  GET /api/v1/licenses/validate?product=...&licenseKey=...
 * (it returns { valid, reason, license }). A good answer is remembered, so the IDE keeps working offline for a grace period
 * (never past the license's own expiry). A revoked or expired key stops being an Enterprise license at the next check.
 *
 * The trial start is kept in two places and signed, so removing one file does not restart the trial. This keeps honest people
 * honest; it is not copy protection.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PRODUCT = 'nativity-studio';
const DEFAULT_SERVER = 'https://futureim-license-server-399770874194.us-central1.run.app';
const PORTAL = 'https://www.futureim.com';
const TRIAL_DAYS = 30;
const GRACE_DAYS = 14;
const DAY = 86400000;
const SALT = 'nativity-studio/trial/v1';
const KEY_RE = /^[A-Za-z0-9._-]{8,128}$/;

const REASONS = {
  not_found: 'That license key was not found. Check it and try again.',
  revoked: 'This license was revoked. Contact FutureIM.',
  expired: 'This license has expired. Renew it to keep using Enterprise Edition.',
  inactive: 'This license is not active.',
  product_mismatch: 'This key is for a different FutureIM product.',
};

function create({ userData, secrets, now = () => Date.now(), fetchImpl, server }) {
  const base = String(server || process.env.FUTUREIM_LICENSE_URL || DEFAULT_SERVER).replace(/\/+$/, '');
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const files = [path.join(userData, 'license.json'), path.join(process.env.NATIVITY_LICENSE_HOME || os.homedir(), '.futureim', 'nativity-studio.lic')];
  let state = null;
  let tampered = false;

  const sign = (install) => crypto.createHmac('sha256', `${SALT}|${install.id}`).update(`${install.first}|${install.id}`).digest('hex');
  const readOne = (f) => {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!j || !j.install || !Number.isFinite(j.install.first) || typeof j.install.id !== 'string') return { bad: true };
      return j.sig === sign(j.install) ? { j } : { bad: true };
    } catch (e) { return e.code === 'ENOENT' ? {} : { bad: true }; }
  };
  const persist = () => {
    state.install.last = Math.max(state.install.last || 0, now());
    state.sig = sign(state.install);
    const text = JSON.stringify(state, null, 2);
    for (const f of files) { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); } catch { /* the other copy remains */ } }
  };

  function load() {
    if (state) return state;
    const found = files.map(readOne);
    const good = found.filter((x) => x.j).map((x) => x.j);
    if (good.length) {
      // the earliest start wins: deleting or editing one copy cannot move the start later
      good.sort((a, b) => a.install.first - b.install.first);
      state = { ...good[0], install: { ...good[0].install, last: Math.max(...good.map((g) => g.install.last || 0)) } };
      if (!state.enterprise) state.enterprise = (good.find((g) => g.enterprise) || {}).enterprise || null;
    } else if (found.some((x) => x.bad)) {
      tampered = true; // the license data was changed by hand: the trial counts as used up
      state = { v: 1, install: { id: crypto.randomUUID(), first: now() - (TRIAL_DAYS + 1) * DAY, last: now() }, enterprise: null };
    } else {
      state = { v: 1, install: { id: crypto.randomUUID(), first: now(), last: now() }, enterprise: null };
    }
    persist();
    return state;
  }

  const mask = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');
  const clean = (l) => (l ? { name: l.userName || '', email: l.userEmail || '', tenant: l.tenantName || '', expires: l.expiryDate || null, issued: l.issuedDate || null, status: l.status || '' } : null);

  /** What the IDE shows and acts on. */
  function status() {
    const s = load();
    const t = now();
    const effective = Math.max(t, s.install.last || 0);
    const clockBack = t < (s.install.last || 0) - 2 * DAY;
    const key = secrets ? secrets.get('license.key') : '';
    const e = s.enterprise;
    const out = { product: PRODUCT, portal: PORTAL, server: base, trialDays: TRIAL_DAYS, clockWarning: clockBack, tampered };
    if (key && e && e.valid) {
      const expMs = e.licensee && e.licensee.expires ? Date.parse(e.licensee.expires) : null;
      const expired = expMs != null && expMs <= effective;
      const stale = e.checkedAt && effective - e.checkedAt > GRACE_DAYS * DAY;
      if (!expired && !stale) {
        const offline = e.checkedAt && effective - e.checkedAt > 2 * DAY;
        return { ...out, edition: 'enterprise', state: offline ? 'grace' : 'active', canUse: true, keyMasked: mask(key), licensee: e.licensee, daysLeft: expMs != null ? Math.max(0, Math.ceil((expMs - effective) / DAY)) : null, expires: e.licensee ? e.licensee.expires : null, checkedAt: e.checkedAt || null,
          message: offline ? `Last checked with FutureIM on ${new Date(e.checkedAt).toLocaleDateString()}. Connect to the internet within ${Math.max(0, GRACE_DAYS - Math.floor((effective - e.checkedAt) / DAY))} days.` : '' };
      }
      out.enterpriseProblem = expired ? REASONS.expired : 'The license could not be checked for more than 14 days. Connect to the internet to keep using Enterprise Edition.';
    } else if (key && e && !e.valid) out.enterpriseProblem = REASONS[e.reason] || 'This license is no longer valid.';
    const left = Math.ceil((s.install.first + TRIAL_DAYS * DAY - effective) / DAY);
    out.edition = 'community';
    out.keyMasked = mask(key);
    if (left > 0 && !tampered && !clockBack) return { ...out, state: 'trial', canUse: true, daysLeft: left, expires: new Date(s.install.first + TRIAL_DAYS * DAY).toISOString(), message: '' };
    return { ...out, state: 'trial-expired', canUse: false, daysLeft: 0, expires: new Date(s.install.first + TRIAL_DAYS * DAY).toISOString(), message: tampered ? 'The license data of this installation was changed. Enter an Enterprise license key to continue.' : clockBack ? 'The computer clock was set back. Correct it, or enter an Enterprise license key.' : 'The 30-day Community trial has ended. Enter an Enterprise license key to continue.' };
  }

  /** Asks the license server. { ok:false } means it could not be reached (not that the key is bad). */
  async function check(key) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await doFetch(`${base}/api/v1/licenses/validate?product=${encodeURIComponent(PRODUCT)}&licenseKey=${encodeURIComponent(key)}`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) return { ok: false, error: `The license server answered ${r.status}.` };
      const j = await r.json();
      return { ok: true, valid: !!j.valid, reason: j.reason || '', license: j.license || null };
    } catch (e) {
      return { ok: false, error: e.name === 'AbortError' ? 'The license server did not answer in time.' : 'The license server could not be reached.' };
    } finally { clearTimeout(timer); }
  }

  const accept = (r) => {
    const l = r.license || {};
    if (l.product && l.product !== PRODUCT) return { valid: false, reason: 'product_mismatch' };
    if (l.status && l.status !== 'active') return { valid: false, reason: l.status === 'revoked' ? 'revoked' : l.status === 'expired' ? 'expired' : 'inactive' };
    return { valid: true };
  };

  async function activate(key) {
    const k = String(key || '').trim();
    if (!KEY_RE.test(k)) throw new Error('A license key looks like FIM-XXXX-XXXX-XXXX-XXXX.');
    const r = await check(k);
    if (!r.ok) throw new Error(`${r.error} Activation needs an internet connection once.`);
    if (!r.valid) throw new Error(REASONS[r.reason] || 'That license key is not valid.');
    const a = accept(r);
    if (!a.valid) throw new Error(REASONS[a.reason]);
    const s = load();
    secrets.set('license.key', k);
    s.enterprise = { valid: true, reason: '', checkedAt: now(), licensee: clean(r.license) };
    persist();
    return status();
  }

  /** Re-checks the stored key (at start-up and from time to time). Offline is fine: the last good answer keeps working for a while. */
  async function refresh() {
    const key = secrets ? secrets.get('license.key') : '';
    if (!key) return status();
    const s = load();
    const r = await check(key);
    if (r.ok) {
      const a = r.valid ? accept(r) : { valid: false, reason: r.reason };
      s.enterprise = a.valid ? { valid: true, reason: '', checkedAt: now(), licensee: clean(r.license) } : { valid: false, reason: a.reason || 'invalid', checkedAt: now(), licensee: s.enterprise ? s.enterprise.licensee : null };
      persist();
    }
    return status();
  }

  function remove() {
    const s = load();
    if (secrets) secrets.delete('license.key');
    s.enterprise = null;
    persist();
    return status();
  }

  return { status, activate, refresh, remove, PRODUCT, TRIAL_DAYS, GRACE_DAYS };
}

module.exports = { create, PRODUCT, PORTAL, TRIAL_DAYS, GRACE_DAYS };
