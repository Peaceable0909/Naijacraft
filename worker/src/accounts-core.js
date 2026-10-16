// Account logic, independent of the Durable Object runtime so it can be unit-tested in Node.
//
// Sign-in methods
//   guest     instant, no credentials; the signed token is the only key to the account
//   password  username + a password that the BROWSER stretches (PBKDF2-SHA256) into a 32-byte key K.
//             The server never sees the password; it stores HMAC(pepper, K). This keeps the Worker well inside the
//             10 ms CPU limit of the free plan and still makes a leaked database hard to crack offline.
//   google    Google Identity Services ID token (RS256), identity = the stable `sub`
//
// Every public method returns { ok, status, body } so the HTTP layer can map it straight to a Response.
import { validateUsername } from '../../shared/moderation.js';
import { signToken, verifyToken } from './tokens.js';
import { verifyGoogleIdToken } from './google.js';
import { b64urlEncode, b64urlDecode, hmacSha256, randomBytes, randomHex, randomInt, randomCode, normalizeCode, timingSafeEqual, enc } from './util.js';

export const KDF_ITERATIONS = 300_000;
const K_RE = /^[A-Za-z0-9_-]{43}$/;          // 32 bytes, base64url
const SALT_RE = /^[A-Za-z0-9_-]{22}$/;       // 16 bytes, base64url
const AUTO_NAME = /^(Guest|Player)\d+$/;

export const RATE = {
  guestPerIp: [20, 3600],        // [count, window seconds]
  signupPerIp: [6, 3600],
  googlePerIp: [40, 3600],
  checkPerIp: [90, 60],
  preloginPerIp: [90, 60],
  loginFailPerName: [8, 900],
  loginFailPerIp: [40, 900],
  recoverFailPerName: [6, 3600],
};

const ok = (body = {}, status = 200) => ({ ok: true, status, body });
const fail = (status, error, message, extra = {}) => ({ ok: false, status, body: { error, message, ...extra } });

export class AccountsCore {
  constructor({ sql, env = {}, now = () => Date.now(), fetchImpl = (...a) => fetch(...a) }) {
    this.sql = sql; this.env = env; this.now = now; this.fetchImpl = fetchImpl;
    this.secretBytes = null;
    this.hits = 0;
    for (const q of [
      'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)',
      `CREATE TABLE IF NOT EXISTS accounts (
         uid TEXT PRIMARY KEY,
         username TEXT NOT NULL UNIQUE COLLATE NOCASE,
         verifier TEXT, salt TEXT, kdf_iter INTEGER, recovery TEXT,
         google_sub TEXT UNIQUE,
         epoch INTEGER NOT NULL DEFAULT 0,
         renames INTEGER NOT NULL DEFAULT 0,
         banned INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL,
         last_login INTEGER NOT NULL)`,
      'CREATE TABLE IF NOT EXISTS limits (k TEXT PRIMARY KEY, win INTEGER NOT NULL, n INTEGER NOT NULL)',
    ]) this.sql.exec(q);
  }

  // ------------------------------------------------------------------ secrets

  async secret() {
    if (this.secretBytes) return this.secretBytes;
    const row = this.sql.exec("SELECT v FROM meta WHERE k = 'secret'").toArray()[0];
    if (row) this.secretBytes = b64urlDecode(row.v);
    else {
      this.secretBytes = randomBytes(32);
      this.sql.exec("INSERT INTO meta (k, v) VALUES ('secret', ?)", b64urlEncode(this.secretBytes));
    }
    return this.secretBytes;
  }

  // A pepper kept outside the database (Worker secret AUTH_PEPPER) makes a stolen database much harder to attack.
  async pepper() {
    if (this.env.AUTH_PEPPER) return hmacSha256(enc.encode('naijacraft-pepper'), String(this.env.AUTH_PEPPER));
    return this.secret();
  }

  async ipKey(ip) {
    return b64urlEncode((await hmacSha256(await this.secret(), 'ip:' + (ip || 'unknown'))).subarray(0, 12));
  }

  async verifierOf(kB64) {
    return b64urlEncode(await hmacSha256(await this.pepper(), b64urlDecode(kB64)));
  }

  // ------------------------------------------------------------------ rate limiting (persistent fixed windows)

  limited(key, [limit, windowSec]) {
    const t = Math.floor(this.now() / 1000);
    const row = this.sql.exec('SELECT win, n FROM limits WHERE k = ?', key).toArray()[0];
    if (row && t - row.win < windowSec && row.n >= limit) return row.win + windowSec - t;
    return 0;
  }

  record(key, [, windowSec]) {
    const t = Math.floor(this.now() / 1000);
    const row = this.sql.exec('SELECT win, n FROM limits WHERE k = ?', key).toArray()[0];
    if (!row || t - row.win >= windowSec) this.sql.exec('INSERT OR REPLACE INTO limits (k, win, n) VALUES (?, ?, 1)', key, t);
    else this.sql.exec('UPDATE limits SET n = n + 1 WHERE k = ?', key);
    if (++this.hits % 200 === 0) this.sql.exec('DELETE FROM limits WHERE win < ?', t - 86400);
  }

  // Counts a hit against the limit; returns seconds to wait when the caller is over it.
  hit(key, rule) {
    const wait = this.limited(key, rule);
    if (wait) return wait;
    this.record(key, rule);
    return 0;
  }

  tooMany(wait) {
    return fail(429, 'rate_limited', 'Too many attempts. Please wait a bit and try again.', { retryAfter: wait });
  }

  // ------------------------------------------------------------------ helpers

  byUid(uid) { return this.sql.exec('SELECT * FROM accounts WHERE uid = ?', uid).toArray()[0] || null; }
  byName(name) { return this.sql.exec('SELECT * FROM accounts WHERE username = ?', String(name)).toArray()[0] || null; }
  bySub(sub) { return this.sql.exec('SELECT * FROM accounts WHERE google_sub = ?', sub).toArray()[0] || null; }

  userView(a) {
    return { name: a.username, guest: !a.verifier && !a.google_sub, hasPassword: !!a.verifier, hasGoogle: !!a.google_sub };
  }

  async session(a) {
    return { token: await signToken(await this.secret(), { u: a.uid, n: a.username, e: a.epoch }, this.now()), user: this.userView(a) };
  }

  // Resolves a bearer token to its live account, or null (bad signature, expired, signed out everywhere, banned).
  async account(token) {
    const claims = await verifyToken(await this.secret(), token, this.now());
    if (!claims) return null;
    const a = this.byUid(claims.u);
    if (!a || a.epoch !== claims.e || a.banned) return null;
    return a;
  }

  insert(fields) {
    const t = this.now();
    try {
      this.sql.exec(
        `INSERT INTO accounts (uid, username, verifier, salt, kdf_iter, recovery, google_sub, created_at, last_login)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        fields.uid, fields.username, fields.verifier ?? null, fields.salt ?? null, fields.kdf_iter ?? null, fields.recovery ?? null, fields.google_sub ?? null, t, t,
      );
      return true;
    } catch (e) {
      if (/UNIQUE/i.test(String(e && e.message))) return false;
      throw e;
    }
  }

  autoName(prefix) {
    for (let i = 0; i < 25; i++) {
      const name = prefix + (i < 12 ? 1000 + randomInt(9000) : 10000 + randomInt(90000));
      if (!this.byName(name)) return name;
    }
    return prefix + randomHex(4);
  }

  async createWithAutoName(prefix, extra = {}) {
    for (let i = 0; i < 5; i++) {
      const uid = randomHex(16), username = this.autoName(prefix);
      if (this.insert({ uid, username, ...extra })) return this.byUid(uid);
    }
    throw new Error('could not allocate a username');
  }

  async turnstileOk(token, ip) {
    if (!this.env.TURNSTILE_SECRET) return true;
    if (typeof token !== 'string' || !token || token.length > 2048) return false;
    try {
      const res = await this.fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: this.env.TURNSTILE_SECRET, response: token, remoteip: ip && ip !== 'unknown' ? ip : undefined }),
      });
      const json = await res.json();
      return json.success === true;
    } catch { return false; }
  }

  checkName(name) {
    const problem = validateUsername(name, this.env.BLOCKED_WORDS);
    if (problem) return problem;
    if (this.byName(name)) return 'That name is taken.';
    return null;
  }

  newCode() { return randomCode(4, 4); }
  async codeHash(code) { return b64urlEncode(await hmacSha256(await this.pepper(), 'recovery:' + normalizeCode(code))); }

  // ------------------------------------------------------------------ public API

  async guest({ ip, turnstile } = {}) {
    const wait = this.hit('guest:' + await this.ipKey(ip), RATE.guestPerIp);
    if (wait) return this.tooMany(wait);
    if (!(await this.turnstileOk(turnstile, ip))) return fail(403, 'captcha', 'Please complete the human check and try again.');
    const a = await this.createWithAutoName('Guest');
    return ok(await this.session(a), 201);
  }

  async check({ name, ip } = {}) {
    const wait = this.hit('check:' + await this.ipKey(ip), RATE.checkPerIp);
    if (wait) return this.tooMany(wait);
    const problem = this.checkName(name);
    return ok({ available: !problem, reason: problem || undefined });
  }

  // Public KDF parameters for a username. Unknown names get a stable fake salt so this can't be used to list accounts.
  async prelogin({ username, ip } = {}) {
    const wait = this.hit('pre:' + await this.ipKey(ip), RATE.preloginPerIp);
    if (wait) return this.tooMany(wait);
    const a = typeof username === 'string' ? this.byName(username) : null;
    if (a && a.verifier && a.salt) return ok({ salt: a.salt, iter: a.kdf_iter || KDF_ITERATIONS });
    const fake = await hmacSha256(await this.secret(), 'fake-salt:' + String(username).toLowerCase());
    return ok({ salt: b64urlEncode(fake.subarray(0, 16)), iter: KDF_ITERATIONS });
  }

  validCredentials({ salt, k, iter }) {
    return typeof k === 'string' && K_RE.test(k) && typeof salt === 'string' && SALT_RE.test(salt)
      && Number.isInteger(iter) && iter >= 100_000 && iter <= 2_000_000;
  }

  async signup({ username, salt, k, iter, ip, turnstile } = {}) {
    const wait = this.hit('signup:' + await this.ipKey(ip), RATE.signupPerIp);
    if (wait) return this.tooMany(wait);
    if (!(await this.turnstileOk(turnstile, ip))) return fail(403, 'captcha', 'Please complete the human check and try again.');
    const problem = validateUsername(username, this.env.BLOCKED_WORDS);
    if (problem) return fail(400, 'bad_username', problem);
    if (!this.validCredentials({ salt, k, iter })) return fail(400, 'bad_credentials', 'Something went wrong with your password. Please try again.');
    const recovery = this.newCode();
    const uid = randomHex(16);
    const created = this.insert({ uid, username, verifier: await this.verifierOf(k), salt, kdf_iter: iter, recovery: await this.codeHash(recovery) });
    if (!created) return fail(409, 'username_taken', 'That name is taken.');
    return ok({ ...(await this.session(this.byUid(uid))), recovery }, 201);
  }

  async login({ username, k, ip } = {}) {
    const ipKey = await this.ipKey(ip), nameKey = 'lfail:u:' + String(username).toLowerCase();
    const wait = this.limited(nameKey, RATE.loginFailPerName) || this.limited('lfail:ip:' + ipKey, RATE.loginFailPerIp);
    if (wait) return this.tooMany(wait);
    const a = typeof username === 'string' ? this.byName(username) : null;
    const given = typeof k === 'string' && K_RE.test(k) ? await this.verifierOf(k) : '';
    const real = a && a.verifier ? a.verifier : await this.verifierOf(b64urlEncode(randomBytes(32)));  // equalise timing
    if (!a || !a.verifier || !given || !timingSafeEqual(given, real)) {
      this.record(nameKey, RATE.loginFailPerName);
      this.record('lfail:ip:' + ipKey, RATE.loginFailPerIp);
      return fail(401, 'bad_login', 'Wrong username or password.');
    }
    if (a.banned) return fail(403, 'banned', 'This account has been suspended.');
    this.sql.exec('DELETE FROM limits WHERE k = ?', nameKey);
    this.sql.exec('UPDATE accounts SET last_login = ? WHERE uid = ?', this.now(), a.uid);
    return ok(await this.session(this.byUid(a.uid)));
  }

  async google({ credential, ip } = {}) {
    if (!this.env.GOOGLE_CLIENT_ID) return fail(501, 'google_disabled', 'Google sign-in is not set up on this server.');
    const wait = this.hit('google:' + await this.ipKey(ip), RATE.googlePerIp);
    if (wait) return this.tooMany(wait);
    let sub;
    try {
      ({ sub } = await verifyGoogleIdToken(credential, { clientId: this.env.GOOGLE_CLIENT_ID, fetchImpl: this.fetchImpl, now: this.now() }));
    } catch {
      return fail(401, 'bad_google', 'Google sign-in failed. Please try again.');
    }
    let a = this.bySub(sub), isNew = false;
    if (!a) { a = await this.createWithAutoName('Player', { google_sub: sub }); isNew = true; }
    if (a.banned) return fail(403, 'banned', 'This account has been suspended.');
    this.sql.exec('UPDATE accounts SET last_login = ? WHERE uid = ?', this.now(), a.uid);
    return ok({ ...(await this.session(this.byUid(a.uid))), isNew }, isNew ? 201 : 200);
  }

  async refresh({ token } = {}) {
    const a = await this.account(token);
    if (!a) return fail(401, 'bad_token', 'Please sign in again.');
    this.sql.exec('UPDATE accounts SET last_login = ? WHERE uid = ?', this.now(), a.uid);
    return ok(await this.session(a));
  }

  async me({ token } = {}) {
    const a = await this.account(token);
    return a ? ok({ user: this.userView(a) }) : fail(401, 'bad_token', 'Please sign in again.');
  }

  // Add a password to a guest or Google account, optionally choosing a real username at the same time.
  async upgrade({ token, username, salt, k, iter } = {}) {
    const a = await this.account(token);
    if (!a) return fail(401, 'bad_token', 'Please sign in again.');
    if (a.verifier) return fail(409, 'has_password', 'This account already has a password.');
    if (!this.validCredentials({ salt, k, iter })) return fail(400, 'bad_credentials', 'Something went wrong with your password. Please try again.');
    if (username && username.toLowerCase() !== a.username.toLowerCase()) {
      const problem = this.checkName(username);
      if (problem) return fail(problem === 'That name is taken.' ? 409 : 400, problem === 'That name is taken.' ? 'username_taken' : 'bad_username', problem);
    } else username = a.username;
    const recovery = this.newCode();
    try {
      this.sql.exec('UPDATE accounts SET username = ?, verifier = ?, salt = ?, kdf_iter = ?, recovery = ? WHERE uid = ?',
        username, await this.verifierOf(k), salt, iter, await this.codeHash(recovery), a.uid);
    } catch (e) {
      if (/UNIQUE/i.test(String(e && e.message))) return fail(409, 'username_taken', 'That name is taken.');
      throw e;
    }
    return ok({ ...(await this.session(this.byUid(a.uid))), recovery });
  }

  async linkGoogle({ token, credential, ip } = {}) {
    if (!this.env.GOOGLE_CLIENT_ID) return fail(501, 'google_disabled', 'Google sign-in is not set up on this server.');
    const a = await this.account(token);
    if (!a) return fail(401, 'bad_token', 'Please sign in again.');
    const wait = this.hit('google:' + await this.ipKey(ip), RATE.googlePerIp);
    if (wait) return this.tooMany(wait);
    let sub;
    try {
      ({ sub } = await verifyGoogleIdToken(credential, { clientId: this.env.GOOGLE_CLIENT_ID, fetchImpl: this.fetchImpl, now: this.now() }));
    } catch { return fail(401, 'bad_google', 'Google sign-in failed. Please try again.'); }
    if (a.google_sub) return fail(409, 'has_google', 'A Google account is already linked.');
    const other = this.bySub(sub);
    if (other) return fail(409, 'google_in_use', 'That Google account is already linked to another player.');
    this.sql.exec('UPDATE accounts SET google_sub = ? WHERE uid = ?', sub, a.uid);
    return ok(await this.session(this.byUid(a.uid)));
  }

  async rename({ token, username } = {}) {
    const a = await this.account(token);
    if (!a) return fail(401, 'bad_token', 'Please sign in again.');
    if (typeof username === 'string' && username.toLowerCase() === a.username.toLowerCase() && username !== a.username) {
      this.sql.exec('UPDATE accounts SET username = ? WHERE uid = ?', username, a.uid);   // only the capitalisation changes
      return ok(await this.session(this.byUid(a.uid)));
    }
    const problem = this.checkName(username);
    if (problem) return fail(problem === 'That name is taken.' ? 409 : 400, problem === 'That name is taken.' ? 'username_taken' : 'bad_username', problem);
    const free = AUTO_NAME.test(a.username);          // leaving an automatic name never counts
    if (!free && a.renames >= 5) return fail(403, 'rename_limit', 'You have used all your name changes.');
    this.sql.exec('UPDATE accounts SET username = ?, renames = renames + ? WHERE uid = ?', username, free ? 0 : 1, a.uid);
    return ok(await this.session(this.byUid(a.uid)));
  }

  async changePassword({ token, k, newSalt, newK, iter } = {}) {
    const a = await this.account(token);
    if (!a) return fail(401, 'bad_token', 'Please sign in again.');
    if (!a.verifier) return fail(409, 'no_password', 'This account has no password yet.');
    const key = 'lfail:u:' + a.username.toLowerCase();
    const wait = this.limited(key, RATE.loginFailPerName);
    if (wait) return this.tooMany(wait);
    const given = typeof k === 'string' && K_RE.test(k) ? await this.verifierOf(k) : '';
    if (!given || !timingSafeEqual(given, a.verifier)) { this.record(key, RATE.loginFailPerName); return fail(401, 'bad_login', 'Your current password is wrong.'); }
    if (!this.validCredentials({ salt: newSalt, k: newK, iter })) return fail(400, 'bad_credentials', 'Something went wrong with your password. Please try again.');
    this.sql.exec('UPDATE accounts SET verifier = ?, salt = ?, kdf_iter = ?, epoch = epoch + 1 WHERE uid = ?', await this.verifierOf(newK), newSalt, iter, a.uid);
    return ok(await this.session(this.byUid(a.uid)));
  }

  async recover({ username, code, newSalt, newK, iter, ip } = {}) {
    const ipKey = await this.ipKey(ip), nameKey = 'rec:' + String(username).toLowerCase();
    const wait = this.limited(nameKey, RATE.recoverFailPerName) || this.limited('lfail:ip:' + ipKey, RATE.loginFailPerIp);
    if (wait) return this.tooMany(wait);
    const a = typeof username === 'string' ? this.byName(username) : null;
    const given = typeof code === 'string' ? await this.codeHash(code) : '';
    const real = a && a.recovery ? a.recovery : await this.codeHash(randomCode());
    if (!a || !a.recovery || !given || !timingSafeEqual(given, real)) {
      this.record(nameKey, RATE.recoverFailPerName);
      this.record('lfail:ip:' + ipKey, RATE.loginFailPerIp);
      return fail(401, 'bad_recovery', 'That recovery code does not match.');
    }
    if (a.banned) return fail(403, 'banned', 'This account has been suspended.');
    if (!this.validCredentials({ salt: newSalt, k: newK, iter })) return fail(400, 'bad_credentials', 'Something went wrong with your password. Please try again.');
    const fresh = this.newCode();
    this.sql.exec('UPDATE accounts SET verifier = ?, salt = ?, kdf_iter = ?, recovery = ?, epoch = epoch + 1 WHERE uid = ?',
      await this.verifierOf(newK), newSalt, iter, await this.codeHash(fresh), a.uid);
    this.sql.exec('DELETE FROM limits WHERE k = ?', nameKey);
    return ok({ ...(await this.session(this.byUid(a.uid))), recovery: fresh });
  }

  async logoutAll({ token } = {}) {
    const a = await this.account(token);
    if (!a) return fail(401, 'bad_token', 'Please sign in again.');
    this.sql.exec('UPDATE accounts SET epoch = epoch + 1 WHERE uid = ?', a.uid);
    return ok({});
  }

  // Deleting returns the uid so the caller can also release the player's land in the World.
  async deleteAccount({ token, k } = {}) {
    const a = await this.account(token);
    if (!a) return fail(401, 'bad_token', 'Please sign in again.');
    if (a.verifier) {
      const given = typeof k === 'string' && K_RE.test(k) ? await this.verifierOf(k) : '';
      if (!given || !timingSafeEqual(given, a.verifier)) return fail(401, 'bad_login', 'Your password is wrong.');
    }
    this.sql.exec('DELETE FROM accounts WHERE uid = ?', a.uid);
    return ok({ uid: a.uid });
  }

  // Used by the World to authenticate WebSocket joins.
  async verify({ token } = {}) {
    const a = await this.account(token);
    return a ? { uid: a.uid, name: a.username, guest: !a.verifier && !a.google_sub } : null;
  }

  // ------------------------------------------------------------------ administration

  adminLookup({ name } = {}) {
    const a = this.byName(name);
    return a ? { uid: a.uid, name: a.username, guest: !a.verifier && !a.google_sub, banned: !!a.banned, created: a.created_at, lastLogin: a.last_login } : null;
  }

  adminBan({ name, banned = true } = {}) {
    const a = this.byName(name);
    if (!a) return null;
    this.sql.exec('UPDATE accounts SET banned = ?, epoch = epoch + 1 WHERE uid = ?', banned ? 1 : 0, a.uid);
    return { uid: a.uid, name: a.username, banned: !!banned };
  }

  stats() {
    const n = (q) => this.sql.exec(q).toArray()[0].n;
    return {
      accounts: n('SELECT COUNT(*) AS n FROM accounts'),
      guests: n('SELECT COUNT(*) AS n FROM accounts WHERE verifier IS NULL AND google_sub IS NULL'),
      google: n('SELECT COUNT(*) AS n FROM accounts WHERE google_sub IS NOT NULL'),
      password: n('SELECT COUNT(*) AS n FROM accounts WHERE verifier IS NOT NULL'),
      banned: n('SELECT COUNT(*) AS n FROM accounts WHERE banned = 1'),
    };
  }
}
