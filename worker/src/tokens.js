// Session tokens: "n1.<base64url payload>.<base64url HMAC-SHA256>". Opaque to the browser, verified by the
// Accounts Durable Object, which also checks the account epoch (so "sign out everywhere" works) and bans.
import { b64urlEncode, b64urlDecode, hmacSha256, hmacVerify, enc, dec, nowSec } from './util.js';

const PREFIX = 'n1';
export const TOKEN_TTL_SEC = 60 * 24 * 3600;      // 60 days, renewed whenever the client refreshes
export const MAX_TOKEN_LENGTH = 1024;

// claims: { u: uid, n: username, e: epoch }
export async function signToken(secret, claims, now = Date.now(), ttlSec = TOKEN_TTL_SEC) {
  const iat = nowSec(now);
  const body = b64urlEncode(enc.encode(JSON.stringify({ u: claims.u, n: claims.n, e: claims.e | 0, iat, exp: iat + ttlSec })));
  const signed = `${PREFIX}.${body}`;
  return `${signed}.${b64urlEncode(await hmacSha256(secret, signed))}`;
}

// Returns the claims or null. Never throws on malformed input.
export async function verifyToken(secret, token, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== PREFIX) return null;
    const signature = b64urlDecode(parts[2]);
    if (!(await hmacVerify(secret, `${parts[0]}.${parts[1]}`, signature))) return null;
    const claims = JSON.parse(dec.decode(b64urlDecode(parts[1])));
    if (typeof claims.u !== 'string' || typeof claims.n !== 'string' || !Number.isInteger(claims.exp)) return null;
    if (claims.exp <= nowSec(now)) return null;
    return claims;
  } catch {
    return null;
  }
}
