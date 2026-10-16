// Small crypto and encoding helpers used by the Worker. Web APIs only (Workers and Node 22 both have them).

export const enc = new TextEncoder();
export const dec = new TextDecoder();

export { b64urlEncode, b64urlDecode } from '../../shared/b64.js';
import { b64urlEncode } from '../../shared/b64.js';

export function randomBytes(n) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}
export const randomHex = (n) => [...randomBytes(n)].map((b) => b.toString(16).padStart(2, '0')).join('');

// Uniform integer in [0, n) without modulo bias.
export function randomInt(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}

const keyCache = new Map();
async function hmacKey(secret) {
  const id = b64urlEncode(secret);
  let k = keyCache.get(id);
  if (!k) {
    k = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    if (keyCache.size > 8) keyCache.clear();
    keyCache.set(id, k);
  }
  return k;
}

export async function hmacSha256(secret, data) {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), bytes));
}

// Verifying through SubtleCrypto compares in constant time.
export async function hmacVerify(secret, data, signature) {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return crypto.subtle.verify('HMAC', await hmacKey(secret), signature, bytes);
}

// Constant-time comparison for equal-length secrets (lengths are not secret here).
export function timingSafeEqual(a, b) {
  const x = typeof a === 'string' ? enc.encode(a) : a;
  const y = typeof b === 'string' ? enc.encode(b) : b;
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i % (x.length || 1)] ?? 0) ^ (y[i % (y.length || 1)] ?? 0);
  return diff === 0;
}

export const nowSec = (now = Date.now()) => Math.floor(now / 1000);

// Crockford base32 (no I, L, O, U) for codes people have to read or type.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function randomCode(groups = 4, size = 4) {
  const parts = [];
  for (let g = 0; g < groups; g++) {
    let s = '';
    for (let i = 0; i < size; i++) s += CROCKFORD[randomInt(32)];
    parts.push(s);
  }
  return parts.join('-');
}
export const normalizeCode = (code) => String(code).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
