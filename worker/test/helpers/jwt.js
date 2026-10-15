// Test helpers: mint Google-style RS256 ID tokens and serve a matching JWKS.
import { b64urlEncode, enc } from '../../src/util.js';

export async function makeGoogle(clientId = 'test-client.apps.googleusercontent.com') {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
  );
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const kid = 'kid-' + Math.random().toString(16).slice(2);
  const jwks = { keys: [{ ...pub, kid, alg: 'RS256', use: 'sig' }] };
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount++;
    return new Response(JSON.stringify(jwks), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
  };
  async function mint(overrides = {}, headerOverrides = {}, signKey = pair.privateKey) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', kid, ...headerOverrides };
    const payload = { iss: 'https://accounts.google.com', aud: clientId, sub: '1234567890', iat: now, exp: now + 3600, email: 'x@example.com', email_verified: true, ...overrides };
    const h = b64urlEncode(enc.encode(JSON.stringify(header))), p = b64urlEncode(enc.encode(JSON.stringify(payload)));
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signKey, enc.encode(`${h}.${p}`)));
    return `${h}.${p}.${b64urlEncode(sig)}`;
  }
  return { clientId, kid, jwks, fetchImpl, mint, pair, get fetchCount() { return fetchCount; } };
}
