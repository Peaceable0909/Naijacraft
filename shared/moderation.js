// Names and chat text rules, shared by the client (instant feedback) and the Worker (the real check).

export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const RESERVED_NAMES = /^(admin|administrator|moderator|mod|support|staff|system|server|naijacraft|owner|root|null|undefined|anonymous|everyone|you|me)$/i;

// A deliberately short starter list of common profanity. Server operators extend it with the
// BLOCKED_WORDS environment variable (comma separated). It is only a first line of defence: chat is also
// rate limited, players can mute and report others, and admins can ban.
// Matching is by whole word (plus simple endings) so real names such as "Shittu" or "Dickson" are not flagged.
const BASE_BLOCKED = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'pussy', 'cunt', 'whore', 'slut', 'porn', 'rape', 'nazi',
];
const ENDINGS = ['', 's', 'es', 'ed', 'er', 'ers', 'ing', 'y'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

const collapse = (w) => w.replace(/(.)\1+/g, '$1');

// Undo common letter swaps ("sh1t"), drop separators ("f.u.c.k") and collapse repeats ("fuuuck").
export function normalizeForFilter(token) {
  const core = String(token).replace(/^[^A-Za-z0-9@$]+|[^A-Za-z0-9@$]+$/g, '').toLowerCase();
  return collapse(core.replace(/[013457@$!]/g, (c) => LEET[c] || c).replace(/[^a-z]/g, ''));
}

export function blockedList(extra = '') {
  const more = String(extra || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  return [...BASE_BLOCKED, ...more].map(collapse);
}

function isBlockedWord(normalized, words) {
  return normalized.length > 0 && words.some((w) => ENDINGS.some((e) => normalized === collapse(w + e)));
}

// For short names: true when any underscore-separated piece (ignoring trailing digits) is a blocked word.
export function containsBlocked(text, extra = '') {
  const words = blockedList(extra);
  return String(text).split(/[_\s]+/).some((piece) => isBlockedWord(normalizeForFilter(piece.replace(/\d+$/, '')), words));
}

// For chat: replace blocked words with asterisks, leave everything else untouched.
export function maskBlocked(text, extra = '') {
  const words = blockedList(extra);
  return String(text).split(/(\s+)/).map((token) => (isBlockedWord(normalizeForFilter(token), words) ? '*'.repeat(Math.min(token.length, 8)) : token)).join('');
}

// Printable text only, no control or bidi override characters, single spaces.
export function cleanText(text, max) {
  return String(text)
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function validateUsername(name, extraBlocked = '') {
  if (typeof name !== 'string' || !USERNAME_RE.test(name)) return 'Use 3-16 letters, numbers or underscores.';
  if (RESERVED_NAMES.test(name)) return 'That name is reserved.';
  if (/^guest\d+$/i.test(name)) return 'Pick a name of your own.';
  if (containsBlocked(name, extraBlocked)) return 'Please choose a friendlier name.';
  return null;
}
