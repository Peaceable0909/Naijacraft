// Naijacraft backend entry point: a thin router in front of two Durable Objects.
//   GET  /health            public status and which sign-in methods are available
//   GET  /stats             how many players are online and how many plots are free
//   GET  /ws                WebSocket into the world
//   *    /auth/*            accounts (guest, password, Google)
//   *    /admin/*           moderation tools and backups, protected by the ADMIN_TOKEN secret
import { Accounts } from './accounts.js';
import { World } from './world.js';
import { json, readJson, bearer, isAdmin, allowedOrigin, withCors } from './http.js';
import { PROTOCOL_VERSION } from '../../shared/protocol.js';

export { Accounts, World };

// POST /auth/<name> -> Accounts method. Routes in NEEDS_TOKEN read the bearer token from the Authorization header.
const AUTH_POST = {
  guest: 'guest', signup: 'signup', login: 'login', google: 'google', prelogin: 'prelogin', recover: 'recover',
  refresh: 'refresh', upgrade: 'upgrade', 'link-google': 'linkGoogle', rename: 'rename', password: 'changePassword', logout: 'logoutAll',
};
const NEEDS_TOKEN = new Set(['refresh', 'upgrade', 'link-google', 'rename', 'password', 'logout']);

// The start screen shows how busy Lagos is. Cached for a few seconds so it can't be used to keep the world awake.
let statsCache = { at: 0, body: null };

const accounts = (env) => env.ACCOUNTS.get(env.ACCOUNTS.idFromName('main'));
const world = (env) => {
  const id = env.WORLD.idFromName('main');
  return env.DO_LOCATION_HINT ? env.WORLD.get(id, { locationHint: env.DO_LOCATION_HINT }) : env.WORLD.get(id);
};

function fromAccounts(result) {
  const headers = result.status === 429 && result.body.retryAfter ? { 'Retry-After': String(result.body.retryAfter) } : {};
  return json(result.body, result.status, headers);
}

async function handleAuth(request, env, url) {
  const route = url.pathname.slice('/auth/'.length);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const stub = accounts(env);

  if (request.method === 'GET' && route === 'me') return fromAccounts(await stub.call('me', { token: bearer(request) }));
  if (request.method === 'GET' && route === 'check') return fromAccounts(await stub.call('check', { name: url.searchParams.get('name') || '', ip }));

  if (request.method === 'DELETE' && route === 'account') {
    const body = (await readJson(request)) || {};
    const result = await stub.call('deleteAccount', { token: bearer(request), k: body.k });
    if (result.ok) await world(env).releaseUser(result.body.uid);
    return fromAccounts(result.ok ? { ok: true, status: 200, body: {} } : result);
  }

  if (request.method === 'POST' && Object.hasOwn(AUTH_POST, route)) {
    const body = await readJson(request);
    if (!body) return json({ error: 'bad_request', message: 'Send a JSON object.' }, 400);
    const args = { ...body, ip };                      // ip is set last so a client can never spoof it
    if (NEEDS_TOKEN.has(route)) args.token = bearer(request);
    else delete args.token;
    return fromAccounts(await stub.call(AUTH_POST[route], args));
  }
  return json({ error: 'not_found' }, 404);
}

async function handleAdmin(request, env, url) {
  if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, 401);
  const route = url.pathname.slice('/admin/'.length);
  const body = request.method === 'POST' ? (await readJson(request)) || {} : {};
  const w = world(env), a = accounts(env);
  switch (route) {
    case 'summary': return json({ world: await w.stats(), accounts: await a.call('stats', {}) });
    case 'players': return json(await w.admin({ cmd: 'players' }));
    case 'reports': return json(await w.admin({ cmd: 'reports', limit: Number(url.searchParams.get('limit')) || 50 }));
    case 'lookup': return json((await a.call('adminLookup', { name: url.searchParams.get('name') || '' })) || { error: 'not found' });
    case 'export': return json(await w.admin({ cmd: 'export' }));
    case 'announce': return json(await w.admin({ cmd: 'announce', text: body.text }));
    case 'release': return json(await w.admin({ cmd: 'release', plot: body.plot }));
    case 'kick': return json(await w.admin({ cmd: 'kick', name: body.name }));
    case 'ban':
    case 'unban': {
      const result = await a.call('adminBan', { name: body.name, banned: route === 'ban' });
      if (!result) return json({ error: 'not found' }, 404);
      if (route === 'ban') await w.admin({ cmd: 'kick', name: result.name, reason: 'banned' });
      return json(result);
    }
    default: return json({ error: 'not_found' }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), request, env);

    // WebSocket upgrades must be returned untouched.
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      if (!allowedOrigin(request, env).ok) return new Response('Origin not allowed', { status: 403 });
      return world(env).fetch(request);
    }

    let response;
    try {
      if (url.pathname === '/health') {
        response = json({
          ok: true, name: 'naijacraft-world', protocol: PROTOCOL_VERSION,
          google: !!env.GOOGLE_CLIENT_ID, googleClientId: env.GOOGLE_CLIENT_ID || null,
          captcha: !!env.TURNSTILE_SECRET, turnstileSiteKey: env.TURNSTILE_SECRET ? env.TURNSTILE_SITE_KEY || null : null,
        });
      } else if (url.pathname === '/stats') {
        if (!statsCache.body || Date.now() - statsCache.at > 10_000) {
          const s = await world(env).stats();
          statsCache = { at: Date.now(), body: { players: s.players, claimedPlots: s.claimedPlots, freePlots: s.freePlots } };
        }
        response = json(statsCache.body, 200, { 'cache-control': 'public, max-age=10' });
      } else if (url.pathname.startsWith('/auth/')) {
        if (!allowedOrigin(request, env).ok) response = json({ error: 'origin_not_allowed' }, 403);
        else response = await handleAuth(request, env, url);
      } else if (url.pathname.startsWith('/admin/')) {
        response = await handleAdmin(request, env, url);
      } else {
        response = json({ error: 'not_found' }, 404);
      }
    } catch (e) {
      if (env.DEBUG) console.error(e);
      response = json({ error: 'internal', message: 'Something went wrong on the server.' }, 500);
    }
    return withCors(response, request, env);
  },
};
