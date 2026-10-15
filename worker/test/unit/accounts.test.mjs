import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AccountsCore, RATE, KDF_ITERATIONS } from '../../src/accounts-core.js';
import { memorySql } from '../helpers/sql.js';
import { makeGoogle } from '../helpers/jwt.js';
import { resetGoogleKeyCache } from '../../src/google.js';
import { b64urlEncode, randomBytes } from '../../src/util.js';

let clock, core, env, fetchLog, turnstile;
const IP = '203.0.113.9';
const cred = () => ({ salt: b64urlEncode(randomBytes(16)), k: b64urlEncode(randomBytes(32)), iter: KDF_ITERATIONS });

function make(extraEnv = {}) {
  env = { ...extraEnv };
  fetchLog = [];
  turnstile = true;
  core = new AccountsCore({
    sql: memorySql(), env, now: () => clock,
    fetchImpl: async (url, init) => {
      fetchLog.push(url);
      if (String(url).includes('turnstile')) return new Response(JSON.stringify({ success: turnstile }));
      throw new Error('unexpected fetch ' + url);
    },
  });
}
beforeEach(() => { clock = 1_800_000_000_000; resetGoogleKeyCache(); make(); });

test('guest: instant account with an auto name, a usable token, and no credentials', async () => {
  const r = await core.guest({ ip: IP });
  assert.equal(r.status, 201);
  assert.match(r.body.user.name, /^Guest\d{4,5}$/);
  assert.equal(r.body.user.guest, true);
  const v = await core.verify({ token: r.body.token });
  assert.equal(v.name, r.body.user.name);
  assert.equal(v.guest, true);
  assert.match(v.uid, /^[0-9a-f]{32}$/);
  const again = await core.refresh({ token: r.body.token });
  assert.equal(again.ok, true);
  assert.equal((await core.me({ token: r.body.token })).body.user.name, r.body.user.name);
});

test('guest: names never collide even when the 4-digit space gets crowded', async () => {
  const names = new Set();
  for (let i = 0; i < 60; i++) {
    clock += 4_000_000;   // new rate-limit window each time
    const r = await core.guest({ ip: IP });
    assert.equal(r.ok, true);
    names.add(r.body.user.name.toLowerCase());
  }
  assert.equal(names.size, 60);
});

test('guest: rate limited per IP, other IPs unaffected, window resets', async () => {
  for (let i = 0; i < RATE.guestPerIp[0]; i++) assert.equal((await core.guest({ ip: IP })).ok, true);
  const blocked = await core.guest({ ip: IP });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.body.retryAfter > 0);
  assert.equal((await core.guest({ ip: '198.51.100.7' })).ok, true);
  clock += (RATE.guestPerIp[1] + 1) * 1000;
  assert.equal((await core.guest({ ip: IP })).ok, true);
});

test('signup + login: password never reaches the server, wrong key rejected, recovery code issued once', async () => {
  const c = cred();
  const s = await core.signup({ username: 'Tunde_99', ...c, ip: IP });
  assert.equal(s.status, 201);
  assert.match(s.body.recovery, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  assert.equal(s.body.user.guest, false);
  assert.equal(s.body.user.hasPassword, true);
  // The stored verifier is not the key itself.
  const row = core.sql.exec("SELECT verifier, salt FROM accounts WHERE username = 'Tunde_99'").toArray()[0];
  assert.notEqual(row.verifier, c.k);
  assert.equal(row.salt, c.salt);

  const pre = await core.prelogin({ username: 'tunde_99', ip: IP });
  assert.deepEqual(pre.body, { salt: c.salt, iter: KDF_ITERATIONS }, 'case-insensitive prelogin returns the account salt');
  const good = await core.login({ username: 'TUNDE_99', k: c.k, ip: IP });
  assert.equal(good.ok, true);
  assert.equal(good.body.user.name, 'Tunde_99');
  const bad = await core.login({ username: 'Tunde_99', k: b64urlEncode(randomBytes(32)), ip: IP });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, 'bad_login');
  assert.equal((await core.login({ username: 'Nobody', k: c.k, ip: IP })).body.error, 'bad_login', 'same error for unknown users');
  assert.equal((await core.login({ username: 'Tunde_99', k: 'not-a-key', ip: IP })).status, 401);
});

test('signup: validates names and credentials, duplicates are case-insensitive', async () => {
  assert.equal((await core.signup({ username: 'ab', ...cred(), ip: IP })).body.error, 'bad_username');
  assert.equal((await core.signup({ username: 'Admin', ...cred(), ip: IP })).body.error, 'bad_username');
  assert.equal((await core.signup({ username: 'Valid_Name', salt: 'x', k: 'y', iter: 1, ip: IP })).body.error, 'bad_credentials');
  assert.equal((await core.signup({ username: 'Valid_Name', ...cred(), iter: 5, ip: IP })).body.error, 'bad_credentials', 'iteration floor');
  assert.equal((await core.signup({ username: 'Chidi', ...cred(), ip: IP })).status, 201);
  const dup = await core.signup({ username: 'cHIDI', ...cred(), ip: IP });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'username_taken');
});

test('login: brute force is throttled per name and per IP, and a success clears the name counter', async () => {
  const c = cred();
  await core.signup({ username: 'Ngozi', ...c, ip: IP });
  const wrong = () => core.login({ username: 'Ngozi', k: b64urlEncode(randomBytes(32)), ip: IP });
  for (let i = 0; i < RATE.loginFailPerName[0]; i++) assert.equal((await wrong()).status, 401);
  const locked = await wrong();
  assert.equal(locked.status, 429);
  assert.equal((await core.login({ username: 'Ngozi', k: c.k, ip: IP })).status, 429, 'even the right key waits out the lockout');
  clock += (RATE.loginFailPerName[1] + 1) * 1000;
  assert.equal((await core.login({ username: 'Ngozi', k: c.k, ip: IP })).ok, true);
  // a different IP guessing at one name is still held back by the per-name limit
  for (let i = 0; i < RATE.loginFailPerName[0]; i++) await core.login({ username: 'Ngozi', k: b64urlEncode(randomBytes(32)), ip: '192.0.2.' + i });
  assert.equal((await core.login({ username: 'Ngozi', k: c.k, ip: '192.0.2.200' })).status, 429);
});

test('prelogin never reveals whether a username exists', async () => {
  await core.signup({ username: 'Real_Person', ...cred(), ip: IP });
  const real = (await core.prelogin({ username: 'Real_Person', ip: IP })).body;
  const fake1 = (await core.prelogin({ username: 'Nobody_Here', ip: IP })).body;
  const fake2 = (await core.prelogin({ username: 'nobody_here', ip: IP })).body;
  assert.deepEqual(fake1, fake2, 'stable fake salt');
  assert.equal(real.salt.length, fake1.salt.length);
  assert.equal(real.iter, fake1.iter);
});

test('tokens stop working after sign-out-everywhere, password change, ban, and deletion', async () => {
  const c = cred();
  const s = await core.signup({ username: 'Bisi', ...c, ip: IP });
  const t1 = s.body.token;
  assert.ok(await core.verify({ token: t1 }));
  assert.equal((await core.logoutAll({ token: t1 })).ok, true);
  assert.equal(await core.verify({ token: t1 }), null);

  const t2 = (await core.login({ username: 'Bisi', k: c.k, ip: IP })).body.token;
  const next = cred();
  const ch = await core.changePassword({ token: t2, k: c.k, newSalt: next.salt, newK: next.k, iter: next.iter });
  assert.equal(ch.ok, true);
  assert.equal(await core.verify({ token: t2 }), null, 'old token dies');
  assert.ok(await core.verify({ token: ch.body.token }), 'the fresh token works');
  assert.equal((await core.login({ username: 'Bisi', k: c.k, ip: IP })).status, 401, 'old password dead');
  assert.equal((await core.login({ username: 'Bisi', k: next.k, ip: IP })).ok, true);
  assert.equal((await core.changePassword({ token: ch.body.token, k: b64urlEncode(randomBytes(32)), newSalt: next.salt, newK: next.k, iter: next.iter })).status, 401, 'needs the current password');

  assert.equal(core.adminBan({ name: 'bisi' }).banned, true);
  assert.equal(await core.verify({ token: ch.body.token }), null);
  assert.equal((await core.login({ username: 'Bisi', k: next.k, ip: IP })).status, 403);
  core.adminBan({ name: 'Bisi', banned: false });
  const back = await core.login({ username: 'Bisi', k: next.k, ip: IP });
  assert.equal(back.ok, true);

  assert.equal((await core.deleteAccount({ token: back.body.token, k: b64urlEncode(randomBytes(32)) })).status, 401, 'deleting needs the password');
  const del = await core.deleteAccount({ token: back.body.token, k: next.k });
  assert.equal(del.ok, true);
  assert.match(del.body.uid, /^[0-9a-f]{32}$/);
  assert.equal(await core.verify({ token: back.body.token }), null);
  assert.equal((await core.check({ name: 'Bisi', ip: IP })).body.available, true, 'the name is free again');
});

test('forged and expired tokens are rejected', async () => {
  const s = await core.guest({ ip: IP });
  assert.equal(await core.verify({ token: s.body.token + 'x' }), null);
  assert.equal(await core.verify({ token: 'n1.e30.e30' }), null);
  clock += 61 * 24 * 3600 * 1000;
  assert.equal(await core.verify({ token: s.body.token }), null, 'expired after 60 days');
});

test('upgrade: a guest keeps its identity but gains a password, a name, and a recovery code', async () => {
  const g = (await core.guest({ ip: IP })).body;
  const uidBefore = (await core.verify({ token: g.token })).uid;
  const c = cred();
  const u = await core.upgrade({ token: g.token, username: 'Adaeze', ...c });
  assert.equal(u.ok, true);
  assert.equal(u.body.user.name, 'Adaeze');
  assert.equal(u.body.user.guest, false);
  assert.match(u.body.recovery, /^[0-9A-Z-]+$/);
  assert.equal((await core.verify({ token: u.body.token })).uid, uidBefore, 'same uid so the plot follows');
  assert.equal((await core.login({ username: 'Adaeze', k: c.k, ip: IP })).ok, true);
  assert.equal((await core.upgrade({ token: u.body.token, username: 'Other', ...cred() })).body.error, 'has_password');
  const g2 = (await core.guest({ ip: '198.51.100.1' })).body;
  assert.equal((await core.upgrade({ token: g2.token, username: 'adaeze', ...cred() })).body.error, 'username_taken');
  assert.equal((await core.upgrade({ token: g2.token, username: 'x', ...cred() })).body.error, 'bad_username');
});

test('rename: automatic names are free to change, real names are limited, capitalisation edits are free', async () => {
  const g = (await core.guest({ ip: IP })).body;
  let t = g.token;
  const r1 = await core.rename({ token: t, username: 'Emeka' });
  assert.equal(r1.ok, true); t = r1.body.token;
  assert.equal(core.byName('Emeka').renames, 0);
  for (let i = 0; i < 5; i++) { const r = await core.rename({ token: t, username: 'Name_' + i }); assert.equal(r.ok, true, 'rename ' + i); t = r.body.token; }
  assert.equal((await core.rename({ token: t, username: 'OneTooMany' })).body.error, 'rename_limit');
  const caps = await core.rename({ token: t, username: 'NAME_4' });
  assert.equal(caps.ok, true);
  assert.equal(caps.body.user.name, 'NAME_4');
  assert.equal((await core.rename({ token: t, username: 'Name_3' })).body.error, 'rename_limit');
});

test('recover: a recovery code resets the password once, then rotates; wrong codes are throttled', async () => {
  const c = cred();
  const s = (await core.signup({ username: 'Funmi', ...c, ip: IP })).body;
  const n = cred();
  const wrongTry = () => core.recover({ username: 'Funmi', code: 'AAAA-BBBB-CCCC-DDDD', newSalt: n.salt, newK: n.k, iter: n.iter, ip: IP });
  assert.equal((await wrongTry()).status, 401);
  const r = await core.recover({ username: 'funmi', code: s.recovery.toLowerCase().replace(/-/g, ' '), newSalt: n.salt, newK: n.k, iter: n.iter, ip: IP });
  assert.equal(r.ok, true, 'codes are forgiving about case and separators');
  assert.notEqual(r.body.recovery, s.recovery, 'a new code is issued');
  assert.equal((await core.login({ username: 'Funmi', k: c.k, ip: IP })).status, 401);
  assert.equal((await core.login({ username: 'Funmi', k: n.k, ip: IP })).ok, true);
  assert.equal(await core.verify({ token: s.token }), null, 'earlier sessions are signed out');
  const reuse = await core.recover({ username: 'Funmi', code: s.recovery, newSalt: n.salt, newK: n.k, iter: n.iter, ip: IP });
  assert.equal(reuse.status, 401, 'the old code is dead');
  for (let i = 0; i < RATE.recoverFailPerName[0]; i++) await wrongTry();
  assert.equal((await wrongTry()).status, 429);
});

test('google: creates an account on first sign-in, finds it later, links to existing accounts', async () => {
  clock = Date.now();   // Google tokens are minted against the real clock
  const g = await makeGoogle();
  make({ GOOGLE_CLIENT_ID: g.clientId });
  core.fetchImpl = g.fetchImpl;
  const first = await core.google({ credential: await g.mint({ sub: 'sub-A' }), ip: IP });
  assert.equal(first.status, 201);
  assert.equal(first.body.isNew, true);
  assert.match(first.body.user.name, /^Player\d+$/);
  assert.equal(first.body.user.guest, false);
  const second = await core.google({ credential: await g.mint({ sub: 'sub-A' }), ip: IP });
  assert.equal(second.body.isNew, false);
  assert.equal((await core.verify({ token: second.body.token })).uid, (await core.verify({ token: first.body.token })).uid);
  assert.equal((await core.google({ credential: await g.mint({ aud: 'x' }), ip: IP })).status, 401);
  assert.equal((await core.google({ credential: 'junk', ip: IP })).status, 401);

  const guest = (await core.guest({ ip: IP })).body;
  const link = await core.linkGoogle({ token: guest.token, credential: await g.mint({ sub: 'sub-B' }), ip: IP });
  assert.equal(link.ok, true);
  assert.equal(link.body.user.guest, false, 'linking graduates the guest');
  const viaGoogle = await core.google({ credential: await g.mint({ sub: 'sub-B' }), ip: IP });
  assert.equal((await core.verify({ token: viaGoogle.body.token })).uid, (await core.verify({ token: link.body.token })).uid);
  const g3 = (await core.guest({ ip: IP })).body;
  assert.equal((await core.linkGoogle({ token: g3.token, credential: await g.mint({ sub: 'sub-A' }), ip: IP })).body.error, 'google_in_use');
  assert.equal((await core.linkGoogle({ token: link.body.token, credential: await g.mint({ sub: 'sub-C' }), ip: IP })).body.error, 'has_google');
});

test('google: reports clearly when it is not configured', async () => {
  const r = await core.google({ credential: 'x.y.z', ip: IP });
  assert.equal(r.status, 501);
  assert.equal(r.body.error, 'google_disabled');
});

test('turnstile: when configured it gates guest and signup, and fails closed', async () => {
  make({ TURNSTILE_SECRET: 'secret' });
  assert.equal((await core.guest({ ip: IP })).body.error, 'captcha', 'no token');
  assert.equal((await core.guest({ ip: IP, turnstile: 'tok' })).status, 201);
  turnstile = false;
  assert.equal((await core.signup({ username: 'Human', ...cred(), ip: IP, turnstile: 'bad' })).body.error, 'captcha');
  core.fetchImpl = async () => { throw new Error('network down'); };
  assert.equal((await core.guest({ ip: '198.51.100.55', turnstile: 'tok' })).body.error, 'captcha', 'fails closed');
});

test('the pepper changes verifiers but not the flow', async () => {
  make({ AUTH_PEPPER: 'a-long-secret-pepper' });
  const c = cred();
  await core.signup({ username: 'Peppered', ...c, ip: IP });
  assert.equal((await core.login({ username: 'Peppered', k: c.k, ip: IP })).ok, true);
  const a = core.sql.exec("SELECT verifier FROM accounts WHERE username='Peppered'").toArray()[0].verifier;
  make({});   // same database content is not shared, but a different pepper must yield a different verifier for the same key
  await core.signup({ username: 'Peppered', salt: c.salt, k: c.k, iter: c.iter, ip: IP });
  const b = core.sql.exec("SELECT verifier FROM accounts WHERE username='Peppered'").toArray()[0].verifier;
  assert.notEqual(a, b);
});

test('check: reports availability and reasons, and is rate limited', async () => {
  await core.signup({ username: 'Taken_One', ...cred(), ip: IP });
  assert.deepEqual((await core.check({ name: 'Fresh_Name', ip: IP })).body, { available: true, reason: undefined });
  assert.equal((await core.check({ name: 'taken_one', ip: IP })).body.available, false);
  assert.match((await core.check({ name: 'no way!', ip: IP })).body.reason, /3-16/);
  for (let i = 0; i < RATE.checkPerIp[0]; i++) await core.check({ name: 'abc', ip: '10.0.0.1' });
  assert.equal((await core.check({ name: 'abc', ip: '10.0.0.1' })).status, 429);
});

test('stats counts account kinds', async () => {
  await core.guest({ ip: IP });
  await core.signup({ username: 'Counted', ...cred(), ip: IP });
  assert.deepEqual(core.stats(), { accounts: 2, guests: 1, google: 0, password: 1, banned: 0 });
});
