// Verifies a Google Identity Services ID token ("Sign in with Google") without any client secret:
// RS256 signature against Google's published keys, plus issuer, audience and expiry checks.
// Only the stable `sub` is used as identity; email is never used to match accounts.
import { b64urlDecode, dec, enc, nowSec } from './util.js';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const CLOCK_SKEW_SEC = 60;

// Key cache shared by all requests in this isolate.
const cache = { keys: new Map(), fetchedAt: 0, expiresAt: 0 };

export function resetGoogleKeyCache() {
  cache.keys.clear(); cache.fetchedAt = 0; cache.expiresAt = 0;
}

async function loadKeys(fetchImpl, now, force) {
  if (!force && cache.keys.size && now < cache.expiresAt) return;
  if (force && now - cache.fetchedAt < 60_000 && cache.keys.size) return;  // at most one forced refresh a minute
  const res = await fetchImpl(CERTS_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`google certs ${res.status}`);
  const body = await res.json();
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  cache.keys.clear();
  for (const jwk of body.keys || []) {
    if (jwk.kty === 'RSA' && jwk.kid && (!jwk.alg || jwk.alg === 'RS256')) cache.keys.set(jwk.kid, jwk);
  }
  cache.fetchedAt = now;
  cache.expiresAt = now + (maxAge ? Number(maxAge[1]) * 1000 : 3600_000);
}

async function importKey(jwk) {
  return crypto.subtle.importKey(
    'jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
  );
}

// Returns { sub } or throws an Error whose message says why the token was rejected.
export async function verifyGoogleIdToken(credential, { clientId, fetchImpl = fetch, now = Date.now() }) {
  if (!clientId) throw new Error('google sign-in is not configured');
  if (typeof credential !== 'string' || credential.length > 4096) throw new Error('malformed token');
  const parts = credential.split('.');
  if (parts.length !== 3) throw new Error('malformed token');

  let header, payload;
  try {
    header = JSON.parse(dec.decode(b64urlDecode(parts[0])));
    payload = JSON.parse(dec.decode(b64urlDecode(parts[1])));
  } catch { throw new Error('malformed token'); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('unsupported algorithm');

  await loadKeys(fetchImpl, now, false);
  let jwk = cache.keys.get(header.kid);
  if (!jwk) { await loadKeys(fetchImpl, now, true); jwk = cache.keys.get(header.kid); }  // keys rotate
  if (!jwk) throw new Error('unknown signing key');

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', await importKey(jwk), b64urlDecode(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error('bad signature');

  const t = nowSec(now);
  if (!ISSUERS.has(payload.iss)) throw new Error('wrong issuer');
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId)) throw new Error('wrong audience');
  if (!Number.isFinite(payload.exp) || payload.exp + CLOCK_SKEW_SEC < t) throw new Error('token expired');
  if (Number.isFinite(payload.iat) && payload.iat - CLOCK_SKEW_SEC > t) throw new Error('token issued in the future');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 64) throw new Error('missing subject');
  return { sub: payload.sub };
}
