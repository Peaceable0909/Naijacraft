import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../../src/tokens.js';
import { verifyGoogleIdToken, resetGoogleKeyCache } from '../../src/google.js';
import { b64urlEncode, b64urlDecode, timingSafeEqual, normalizeCode, randomCode, enc } from '../../src/util.js';
import { makeGoogle } from '../helpers/jwt.js';

const secret = new Uint8Array(32).fill(7);

test('base64url round trips arbitrary bytes and rejects junk', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(b64urlDecode(b64urlEncode(bytes)), bytes);
  assert.ok(!/[+/=]/.test(b64urlEncode(bytes)));
  assert.throws(() => b64urlDecode('a b'));
  assert.throws(() => b64urlDecode('abc+/'));
});

test('timingSafeEqual and recovery-code helpers', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('', ''), true);
  assert.match(randomCode(), /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  assert.equal(normalizeCode('ab12-o1il-9z'), 'AB1201119Z');
});

test('tokens: sign, verify, tamper, expiry, wrong key, garbage', async () => {
  const now = 1_700_000_000_000;
  const t = await signToken(secret, { u: 'uid1', n: 'Tunde', e: 3 }, now, 3600);
  const c = await verifyToken(secret, t, now + 1000);
  assert.equal(c.u, 'uid1'); assert.equal(c.n, 'Tunde'); assert.equal(c.e, 3);
  assert.equal(await verifyToken(secret, t, now + 3601_000), null, 'expired');
  assert.equal(await verifyToken(new Uint8Array(32).fill(8), t, now), null, 'wrong key');
  const [a, b, s] = t.split('.');
  const forged = b64urlEncode(enc.encode(JSON.stringify({ u: 'admin', n: 'x', e: 0, iat: 1, exp: 9e9 })));
  assert.equal(await verifyToken(secret, `${a}.${forged}.${s}`, now), null, 'payload swapped');
  assert.equal(await verifyToken(secret, `${a}.${b}.${s.slice(0, -2)}AA`, now), null, 'signature altered');
  for (const junk of ['', 'a.b', 'n1..', 'n2.x.y', null, undefined, 42, 'n1.' + 'x'.repeat(2000) + '.y']) {
    assert.equal(await verifyToken(secret, junk, now), null);
  }
});

let g;
beforeEach(async () => { resetGoogleKeyCache(); g = await makeGoogle(); });

test('google: accepts a valid ID token and returns the stable subject', async () => {
  const r = await verifyGoogleIdToken(await g.mint({ sub: 'abc123' }), { clientId: g.clientId, fetchImpl: g.fetchImpl });
  assert.deepEqual(r, { sub: 'abc123' });
});

test('google: caches keys between verifications', async () => {
  const opts = { clientId: g.clientId, fetchImpl: g.fetchImpl };
  await verifyGoogleIdToken(await g.mint(), opts);
  await verifyGoogleIdToken(await g.mint(), opts);
  assert.equal(g.fetchCount, 1);
});

test('google: rejects wrong audience, issuer, expiry, future iat, missing sub', async () => {
  const opts = { clientId: g.clientId, fetchImpl: g.fetchImpl };
  const now = Math.floor(Date.now() / 1000);
  await assert.rejects(async () => verifyGoogleIdToken(await g.mint({ aud: 'someone-else' }), opts), /audience/);
  await assert.rejects(async () => verifyGoogleIdToken(await g.mint({ iss: 'https://evil.example' }), opts), /issuer/);
  await assert.rejects(async () => verifyGoogleIdToken(await g.mint({ exp: now - 600 }), opts), /expired/);
  await assert.rejects(async () => verifyGoogleIdToken(await g.mint({ iat: now + 3600 }), opts), /future/);
  await assert.rejects(async () => verifyGoogleIdToken(await g.mint({ sub: '' }), opts), /subject/);
  await assert.doesNotReject(async () => verifyGoogleIdToken(await g.mint({ aud: ['other', g.clientId] }), opts));
});

test('google: rejects bad signature, alg none, alg HS256 confusion, unknown kid, unconfigured', async () => {
  const opts = { clientId: g.clientId, fetchImpl: g.fetchImpl };
  const other = await makeGoogle(g.clientId);   // different key pair, same kid is not used
  const forged = await g.mint({}, {}, other.pair.privateKey);
  await assert.rejects(() => verifyGoogleIdToken(forged, opts), /bad signature/);
  await assert.rejects(async () => verifyGoogleIdToken(await g.mint({}, { alg: 'none' }), opts), /algorithm/);
  await assert.rejects(async () => verifyGoogleIdToken(await g.mint({}, { alg: 'HS256' }), opts), /algorithm/);
  await assert.rejects(async () => verifyGoogleIdToken(await g.mint({}, { kid: 'nope' }), opts), /unknown signing key/);
  await assert.rejects(() => verifyGoogleIdToken('not.a.jwt', opts), /malformed/);
  await assert.rejects(() => verifyGoogleIdToken('x', opts), /malformed/);
  await assert.rejects(() => verifyGoogleIdToken('a.b.c', { clientId: '', fetchImpl: g.fetchImpl }), /not configured/);
});

test('google: unknown kid triggers at most one key refresh per minute', async () => {
  const opts = { clientId: g.clientId, fetchImpl: g.fetchImpl };
  await verifyGoogleIdToken(await g.mint(), opts);              // warm cache (1 fetch)
  for (let i = 0; i < 3; i++) await assert.rejects(async () => verifyGoogleIdToken(await g.mint({}, { kid: 'rotated' }), opts));
  assert.ok(g.fetchCount <= 2, `expected a single forced refresh, saw ${g.fetchCount} fetches`);
});
