// HTTP helpers: CORS, JSON bodies, bearer tokens.
import { timingSafeEqual } from './util.js';

export function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const list = String(env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes('*')) return { ok: true, value: '*' };
  if (origin && list.includes(origin)) return { ok: true, value: origin };
  return { ok: !origin, value: null };                 // requests without an Origin (curl, server-side) are not browsers
}

export function withCors(response, request, env) {
  const { value } = allowedOrigin(request, env);
  const h = new Headers(response.headers);
  if (value) {
    h.set('Access-Control-Allow-Origin', value);
    if (value !== '*') h.append('Vary', 'Origin');
  }
  h.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  h.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

// Reads a small JSON object body. Returns null for anything that is not one.
export async function readJson(request, maxBytes = 8192) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) return null;
  const text = await request.text();
  if (text.length > maxBytes) return null;
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
}

export function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

export function isAdmin(request, env) {
  const given = bearer(request);
  return !!(env.ADMIN_TOKEN && given && timingSafeEqual(given, String(env.ADMIN_TOKEN)));
}
