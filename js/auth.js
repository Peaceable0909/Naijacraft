// Accounts: talks to the server's /auth endpoints. No DOM, so it also runs in Node for tests.
//   guest      play instantly
//   password   username + password; the password is stretched in the browser (js/kdf.js) and never sent
//   google     Google Identity Services credential
import { deriveKey, newSalt, KDF_ITERATIONS } from './kdf.js';

export class AuthError extends Error {
  constructor(code, message, status = 0, extra = {}) { super(message); this.code = code; this.status = status; Object.assign(this, extra); }
}

const KEY = 'naijacraft:v2:auth';
const memory = new Map();
const defaultStorage = {
  get(k) { try { return globalThis.localStorage ? globalThis.localStorage.getItem(k) : memory.get(k) ?? null; } catch { return memory.get(k) ?? null; } },
  set(k, v) { try { if (globalThis.localStorage) globalThis.localStorage.setItem(k, v); else memory.set(k, v); } catch { memory.set(k, v); } },
  remove(k) { try { if (globalThis.localStorage) globalThis.localStorage.removeItem(k); } catch { /* ignore */ } memory.delete(k); },
};

// Reads the expiry (seconds since epoch) out of a session token without verifying it.
export function tokenExpiry(token) {
  try {
    const body = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Number(body.exp) || 0;
  } catch { return 0; }
}

export class Auth {
  constructor(server, { storage = defaultStorage, fetchImpl = (...a) => fetch(...a) } = {}) {
    this.server = server; this.storage = storage; this.fetch = fetchImpl;
    this.session = this.load();
  }

  // ---- storage
  load() {
    try {
      const s = JSON.parse(this.storage.get(KEY) || 'null');
      return s && s.server === this.server && typeof s.token === 'string' ? s : null;
    } catch { return null; }
  }
  save(token, user) {
    this.session = { server: this.server, token, user };
    this.storage.set(KEY, JSON.stringify(this.session));
    return this.session;
  }
  signOut() { this.session = null; this.storage.remove(KEY); }
  get token() { return this.session ? this.session.token : null; }
  get user() { return this.session ? this.session.user : null; }
  get signedIn() { return !!this.session; }

  // ---- transport
  async request(method, route, body, { token = null } = {}) {
    let res;
    try {
      res = await this.fetch(this.server + route, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new AuthError('network', "Can't reach the Naijacraft server. Check your internet connection.");
    }
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      throw new AuthError((data && data.error) || 'error', (data && data.message) || 'Something went wrong. Please try again.', res.status, { retryAfter: data && data.retryAfter });
    }
    return data;
  }

  adopt(data) {
    if (data.token) this.save(data.token, data.user);
    return data;
  }

  // ---- public API
  async info(timeoutMs = 6000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await this.fetch(this.server + '/health', { signal: ctl.signal });
      const data = await res.json();
      return res.ok && data && data.ok ? data : null;
    } catch { return null; } finally { clearTimeout(timer); }
  }

  async guest(turnstile) { return this.adopt(await this.request('POST', '/auth/guest', { turnstile })); }

  async checkName(name) { return this.request('GET', '/auth/check?name=' + encodeURIComponent(name)); }

  async signup(username, password, turnstile) {
    const salt = newSalt();
    const k = await deriveKey(password, salt);
    return this.adopt(await this.request('POST', '/auth/signup', { username, salt, k, iter: KDF_ITERATIONS, turnstile }));
  }

  async login(username, password) {
    const pre = await this.request('POST', '/auth/prelogin', { username });
    const k = await deriveKey(password, pre.salt, pre.iter);
    return this.adopt(await this.request('POST', '/auth/login', { username, k }));
  }

  async google(credential) { return this.adopt(await this.request('POST', '/auth/google', { credential })); }

  // Renews the token (and so the 60-day window). Throws AuthError with status 401 if it is no longer valid.
  async refresh() {
    if (!this.token) throw new AuthError('bad_token', 'Please sign in again.', 401);
    const data = await this.request('POST', '/auth/refresh', {}, { token: this.token });
    return this.adopt(data);
  }

  // Add a password (and optionally pick a proper username) to a guest or Google account.
  async upgrade(password, username) {
    const salt = newSalt();
    const k = await deriveKey(password, salt);
    return this.adopt(await this.request('POST', '/auth/upgrade', { username, salt, k, iter: KDF_ITERATIONS }, { token: this.token }));
  }

  async linkGoogle(credential) { return this.adopt(await this.request('POST', '/auth/link-google', { credential }, { token: this.token })); }

  async rename(username) { return this.adopt(await this.request('POST', '/auth/rename', { username }, { token: this.token })); }

  async changePassword(oldPassword, newPassword) {
    const pre = await this.request('POST', '/auth/prelogin', { username: this.user.name });
    const k = await deriveKey(oldPassword, pre.salt, pre.iter);
    const newSaltValue = newSalt();
    const newK = await deriveKey(newPassword, newSaltValue);
    return this.adopt(await this.request('POST', '/auth/password', { k, newSalt: newSaltValue, newK, iter: KDF_ITERATIONS }, { token: this.token }));
  }

  async recover(username, code, newPassword) {
    const salt = newSalt();
    const newK = await deriveKey(newPassword, salt);
    return this.adopt(await this.request('POST', '/auth/recover', { username, code, newSalt: salt, newK, iter: KDF_ITERATIONS }));
  }

  async signOutEverywhere() {
    await this.request('POST', '/auth/logout', {}, { token: this.token });
    this.signOut();
  }

  async deleteAccount(password) {
    let k;
    if (this.user && this.user.hasPassword) {
      const pre = await this.request('POST', '/auth/prelogin', { username: this.user.name });
      k = await deriveKey(password, pre.salt, pre.iter);
    }
    await this.request('DELETE', '/auth/account', { k }, { token: this.token });
    this.signOut();
  }
}
