// Password stretching, done in the browser so the server never sees the password and never has to spend CPU on it.
// K = PBKDF2-HMAC-SHA256(password, per-account salt, 300,000 rounds). The server stores only HMAC(pepper, K).
import { b64urlEncode, b64urlDecode } from '../shared/b64.js';

export const KDF_ITERATIONS = 300_000;

export const newSalt = () => b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));

export async function deriveKey(password, salt, iterations = KDF_ITERATIONS) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64urlDecode(salt), iterations }, material, 256);
  return b64urlEncode(new Uint8Array(bits));
}

// A few very common passwords the form refuses outright (the server cannot see passwords, so this is client-side).
const COMMON = new Set(['password', 'password1', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'iloveyou', 'abcd1234', '11111111', '00000000', 'naijacraft', 'minecraft', 'letmein1', 'welcome1', 'lagos123', 'nigeria1', 'password123']);
export function passwordProblem(password, username = '') {
  const p = String(password);
  if (p.length < 8) return 'Use at least 8 characters.';
  if (p.length > 128) return 'That password is too long.';
  if (COMMON.has(p.toLowerCase())) return 'That password is too easy to guess.';
  if (username && p.toLowerCase() === String(username).toLowerCase()) return 'Your password should not be your username.';
  if (/^(.)\1+$/.test(p)) return 'Try mixing in different characters.';
  return null;
}
