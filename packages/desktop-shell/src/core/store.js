/** Settings (JSON) and secrets (encrypted with the OS keystore via Electron safeStorage; never plaintext). */
const fs = require('fs');
const path = require('path');

const BAD = new Set(['__proto__', 'constructor', 'prototype']);
const keysOf = (key) => {
  const ks = String(key).split('.');
  if (ks.some((k) => !k || BAD.has(k))) throw new Error('Invalid settings key');
  return ks;
};

class Store {
  constructor(file, defaults = {}) {
    this.file = file;
    this.data = JSON.parse(JSON.stringify(defaults));
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch { /* first run */ }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  get(key, def) {
    let o = this.data;
    for (const k of keysOf(key)) {
      if (o == null || typeof o !== 'object') return def;
      o = o[k];
    }
    return o === undefined ? def : o;
  }

  set(key, val) {
    const ks = keysOf(key);
    let o = this.data;
    for (const k of ks.slice(0, -1)) {
      if (typeof o[k] !== 'object' || o[k] === null) o[k] = {};
      o = o[k];
    }
    o[ks[ks.length - 1]] = val;
    this.save();
  }

  all() {
    return this.data;
  }
}

class Secrets {
  constructor(file, safeStorage) {
    this.file = file;
    this.ss = safeStorage;
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
  }

  available() {
    return this.ss.isEncryptionAvailable();
  }

  has(name) {
    return Object.prototype.hasOwnProperty.call(this.data, name);
  }

  get(name) {
    if (!this.has(name)) return '';
    return this.ss.decryptString(Buffer.from(this.data[name], 'base64'));
  }

  set(name, value) {
    if (!this.available()) throw new Error('OS encryption is not available; refusing to store the secret in plaintext.');
    this.data[name] = this.ss.encryptString(String(value)).toString('base64');
    this.persist();
  }

  delete(name) {
    delete this.data[name];
    this.persist();
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data));
  }
}

module.exports = { Store, Secrets };
