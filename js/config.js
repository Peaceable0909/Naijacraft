// Where the world server lives.
//
// After you deploy the Worker (docs/DEPLOY.md) put its address in DEFAULT_SERVER, e.g.
//   export const DEFAULT_SERVER = 'https://naijacraft-world.your-name.workers.dev';
// Leave it empty and the game runs in offline mode. For testing you can also open the page with
//   ?server=http://127.0.0.1:8787      (remembered in this browser)     or    ?server=off   to forget it.
export const DEFAULT_SERVER = '';

const KEY = 'naijacraft:v2:server';

function read() { try { return localStorage.getItem(KEY); } catch { return null; } }
function write(v) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ } }

export function normalizeServer(url) {
  if (!url) return '';
  let u = String(url).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { return new URL(u).origin; } catch { return ''; }
}

// Resolves the server address from ?server=, the saved value, or the built-in default.
export function getServerUrl(search = typeof location !== 'undefined' ? location.search : '') {
  const param = new URLSearchParams(search).get('server');
  if (param === 'off') { write(null); return ''; }
  if (param) { const u = normalizeServer(param); if (u) write(u); return u; }
  return normalizeServer(read() || DEFAULT_SERVER);
}

export const wsUrl = (httpUrl) => httpUrl.replace(/^http/i, 'ws') + '/ws';
