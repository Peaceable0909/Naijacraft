// End-to-end test against the real Workers runtime (workerd via `wrangler dev`).
//   node test/integration/run.mjs            quick run (about 40 s)
//   node test/integration/run.mjs --long     also proves the Durable Object survives hibernation (about 2 min)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as P from '../../../shared/protocol.js';
import * as L from '../../../shared/layout.js';
import { deriveKey, newSalt } from '../../../js/kdf.js';

const PORT = 8799;
const HTTP = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}/ws`;
const ADMIN = 'test-admin-token';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const LONG = process.argv.includes('--long');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wrangler = null, logs = '';
async function startWrangler(persist) {
  spawnSync('node', ['scripts/build-client.mjs'], { cwd: root, stdio: 'ignore' });   // the Worker serves the game from ./public
  wrangler = spawn('npx', ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(PORT), '--persist-to', persist,
    '--var', `ADMIN_TOKEN:${ADMIN}`, '--var', 'AUTH_PEPPER:integration-pepper', '--var', 'ALLOWED_ORIGINS:*'], {
    cwd: root, detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' },
  });
  wrangler.stdout.on('data', (d) => { logs += d; });
  wrangler.stderr.on('data', (d) => { logs += d; });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${HTTP}/health`)).ok) return; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('wrangler dev did not start:\n' + logs.slice(-2000));
}
async function stopWrangler() {
  if (!wrangler) return;
  try { process.kill(-wrangler.pid, 'SIGTERM'); } catch { /* gone */ }
  await sleep(1200);
  wrangler = null;
}

async function api(method, route, body, token) {
  const res = await fetch(HTTP + route, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

class Peer {
  constructor(name) { this.name = name; this.frames = []; this.closed = null; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onmessage = (e) => this.frames.push(e.data);
      this.ws.onclose = (e) => { this.closed = { code: e.code, reason: e.reason }; };
      this.ws.onopen = () => resolve(this);
      this.ws.onerror = () => reject(new Error(this.name + ': socket error'));
    });
  }
  json(obj) { this.ws.send(JSON.stringify(obj)); }
  bin(buf) { this.ws.send(buf); }
  take(pred) { const i = this.frames.findIndex(pred); return i < 0 ? null : this.frames.splice(i, 1)[0]; }
  async wait(pred, what, ms = 8000) {
    const end = Date.now() + ms;
    for (;;) {
      const f = this.take(pred);
      if (f) return f;
      if (Date.now() > end) throw new Error(`${this.name}: timed out waiting for ${what}. Got: ${this.frames.map((x) => (typeof x === 'string' ? x.slice(0, 80) : 'bin' + new Uint8Array(x, 0, 1)[0])).join(' | ')}`);
      await sleep(25);
    }
  }
  async waitJson(type, ms) { return JSON.parse(await this.wait((f) => typeof f === 'string' && JSON.parse(f).t === type, type, ms)); }
  async waitChat(text, ms) { return JSON.parse(await this.wait((f) => typeof f === 'string' && (() => { const m = JSON.parse(f); return m.t === 'chat' && m.text === text; })(), 'chat "' + text + '"', ms)); }
  async waitBin(op, what, ms) { return this.wait((f) => typeof f !== 'string' && new Uint8Array(f, 0, 1)[0] === op, what || 'opcode ' + op, ms); }
  async hello(token, look) {
    await this.open();
    this.json({ t: 'hello', v: P.PROTOCOL_VERSION, token, look });
    this.welcome = await this.waitJson('welcome');
    return this.welcome;
  }
  async waitClose(ms = 6000) {
    const end = Date.now() + ms;
    while (!this.closed && Date.now() < end) await sleep(25);
    return this.closed;
  }
  close() { try { this.ws.close(); } catch { /* */ } }
}

let passed = 0;
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); passed++; console.log(`  ok  ${name} (${Date.now() - t} ms)`); }
  catch (e) { console.log(`  FAIL ${name}\n${e.stack}`); throw e; }
}

const persist = mkdtempSync(path.join(tmpdir(), 'naija-it-'));
const peers = [];
const track = (p) => { peers.push(p); return p; };
let exitCode = 0;
try {
  console.log('starting wrangler dev (workerd) ...');
  await startWrangler(persist);

  let adaeze, bisi;   // { token, name }
  await step('health and CORS', async () => {
    const h = await api('GET', '/health');
    assert.equal(h.body.ok, true); assert.equal(h.body.protocol, P.PROTOCOL_VERSION); assert.equal(h.body.google, false);
    const pre = await fetch(HTTP + '/auth/guest', { method: 'OPTIONS', headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
    assert.match(pre.headers.get('access-control-allow-headers'), /Authorization/);
    assert.equal((await api('GET', '/nothing')).status, 404);
  });

  await step('accounts: guest, signup with a stretched password, login, wrong password, name check', async () => {
    const g = await api('POST', '/auth/guest', {});
    assert.equal(g.status, 201); assert.match(g.body.user.name, /^Guest\d+$/);
    adaeze = { token: g.body.token, name: g.body.user.name };

    const salt = newSalt(), k = await deriveKey('a-long-secret-phrase', salt, 100_000);
    const up = await api('POST', '/auth/signup', { username: 'Bisi_Lagos', salt, k, iter: 100_000 });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.match(up.body.recovery, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    const pre = await api('POST', '/auth/prelogin', { username: 'bisi_lagos' });
    assert.equal(pre.body.salt, salt);
    const k2 = await deriveKey('a-long-secret-phrase', pre.body.salt, pre.body.iter);
    const login = await api('POST', '/auth/login', { username: 'bisi_lagos', k: k2 });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    bisi = { token: login.body.token, name: login.body.user.name };
    const bad = await api('POST', '/auth/login', { username: 'Bisi_Lagos', k: await deriveKey('wrong password', salt, 100_000) });
    assert.equal(bad.status, 401);
    assert.equal((await api('GET', '/auth/check?name=Bisi_Lagos')).body.available, false);
    assert.equal((await api('GET', '/auth/check?name=Fresh_Name')).body.available, true);
    assert.equal((await api('GET', '/auth/me', undefined, bisi.token)).body.user.name, 'Bisi_Lagos');
    assert.equal((await api('GET', '/auth/me', undefined, 'garbage')).status, 401);
    assert.equal((await api('POST', '/auth/signup', 'not an object')).status, 400);
    assert.equal((await api('POST', '/auth/google', { credential: 'x.y.z' })).status, 501);
  });

  const A = track(new Peer('adaeze')), B = track(new Peer('bisi'));
  let plotA;
  await step('websocket: hello, claim land, build, and a second player sees it all', async () => {
    const wa = await A.hello(adaeze.token, { skin: 1, outfit: 2, hat: 1 });
    assert.equal(wa.you.name, adaeze.name); assert.equal(wa.you.plot, null);
    A.json({ t: 'claim', plot: 'auto' });
    plotA = (await A.waitJson('claimed')).plot;
    assert.equal(plotA, L.OFFLINE_PLOT);
    A.bin(P.encodeEditMessage(plotA, [P.packEdit(3, 1, 3, 4, 0), P.packEdit(4, 1, 3, 7, 2)]));
    A.json({ t: 'chat', text: 'Welcome to my plot' });

    const wb = await B.hello(bisi.token);
    assert.equal(wb.you.name, 'Bisi_Lagos');
    assert.ok(wb.plots.some((p) => p.n === plotA && p.owner === adaeze.name));
    assert.ok(wb.players.some((p) => p.name === adaeze.name));
    assert.equal(wb.chat.at(-1).text, 'Welcome to my plot');
    const frame = P.decodePlotData(await B.waitBin(P.OP.PLOTDATA));
    assert.equal(frame.plot, plotA);
    const parts = P.splitPlotBytes(await P.inflate(frame.blob));
    assert.equal(parts.ids[L.cellIndex(3, 1, 3)], 4);
    assert.equal(parts.metas[L.cellIndex(4, 1, 3)], 2);
    assert.equal((await A.waitJson('join')).player.name, 'Bisi_Lagos');
  });

  await step('live edits, positions, chat and emotes flow between players; ownership is enforced', async () => {
    A.bin(P.encodeEditMessage(plotA, [P.packEdit(5, 2, 5, 6, 0)]));
    const ed = P.decodeEditsBroadcast(await B.waitBin(P.OP.EDITS));
    assert.equal(ed.plot, plotA); assert.equal(P.unpackEdit(ed.packed[0]).id, 6);

    A.bin(P.encodePos({ x: 150.5, y: 1, z: 160.25, yaw: 1, pitch: 0.2, flags: P.FLAG.SPRINT, emote: 0 }));
    B.bin(P.encodePos({ x: 155, y: 1, z: 160, yaw: 0, pitch: 0, flags: 0, emote: 0 }));
    const snap = await B.wait((f) => typeof f !== 'string' && new Uint8Array(f, 0, 1)[0] === P.OP.SNAPSHOT && P.decodeSnapshot(f).some((p) => p.pid === A.welcome.you.pid), 'snapshot with Adaeze', 5000);
    const me = P.decodeSnapshot(snap).find((p) => p.pid === A.welcome.you.pid);
    assert.ok(Math.abs(me.x - 150.5) < 0.02 && Math.abs(me.z - 160.25) < 0.02);
    assert.equal(me.flags, P.FLAG.SPRINT);

    B.json({ t: 'chat', text: 'Nice house!' });
    assert.equal((await A.waitChat('Nice house!')).name, 'Bisi_Lagos');
    A.json({ t: 'emote', id: 2 });
    assert.equal((await B.waitJson('emote')).id, 2);

    B.bin(P.encodeEditMessage(plotA, [P.packEdit(0, 1, 0, 4, 0)]));          // Bisi tries to build on Adaeze's land
    assert.equal((await B.waitJson('reject')).reason, 'not_owner');
    A.json({ t: 'chat', text: 'this is shit' });
    assert.equal((await B.waitChat('this is ****')).name, adaeze.name);
  });

  await step('admin: protected, shows players and reports, announces, bans', async () => {
    assert.equal((await api('GET', '/admin/summary')).status, 401);
    assert.equal((await api('GET', '/admin/summary', undefined, 'nope')).status, 401);
    const sum = await api('GET', '/admin/summary', undefined, ADMIN);
    assert.equal(sum.body.world.players, 2); assert.equal(sum.body.world.claimedPlots, 1);
    assert.equal(sum.body.accounts.accounts, 2);
    B.json({ t: 'report', pid: A.welcome.you.pid, reason: 'testing reports' });
    await B.waitJson('notice');
    const reports = await api('GET', '/admin/reports', undefined, ADMIN);
    assert.equal(reports.body[0].target_name, adaeze.name);
    assert.equal((await api('POST', '/admin/announce', { text: 'Maintenance at midnight' }, ADMIN)).status, 200);
    assert.equal((await A.waitJson('notice')).text, 'Maintenance at midnight');
    const players = await api('GET', '/admin/players', undefined, ADMIN);
    assert.equal(players.body.length, 2);
  });

  await step('persistence: stop the server, start it again, everything is still there', async () => {
    await sleep(3500);                              // let the debounced save run
    A.close(); B.close();
    await stopWrangler();
    await startWrangler(persist);
    const refreshed = await api('POST', '/auth/refresh', {}, adaeze.token);
    assert.equal(refreshed.status, 200, 'old tokens still verify (the signing secret persisted)');
    adaeze.token = refreshed.body.token;
    const A2 = track(new Peer('adaeze2'));
    const w = await A2.hello(adaeze.token);
    assert.equal(w.you.plot, plotA, 'she still owns her land');
    const frame = P.decodePlotData(await A2.waitBin(P.OP.PLOTDATA));
    const parts = P.splitPlotBytes(await P.inflate(frame.blob));
    assert.equal(parts.ids[L.cellIndex(3, 1, 3)], 4);
    assert.equal(parts.ids[L.cellIndex(5, 2, 5)], 6, 'including the last edit');
    A2.close();
    const login = await api('POST', '/auth/login', { username: 'bisi_lagos', k: await deriveKey('a-long-secret-phrase', (await api('POST', '/auth/prelogin', { username: 'bisi_lagos' })).body.salt, 100_000) });
    assert.equal(login.status, 200, 'passwords survive restarts too');
  });

  await step('ban and account deletion take effect immediately', async () => {
    const B3 = track(new Peer('bisi3'));
    const login = await api('POST', '/auth/login', { username: 'bisi_lagos', k: await deriveKey('a-long-secret-phrase', (await api('POST', '/auth/prelogin', { username: 'bisi_lagos' })).body.salt, 100_000) });
    await B3.hello(login.body.token);
    assert.equal((await api('POST', '/admin/ban', { name: 'Bisi_Lagos' }, ADMIN)).status, 200);
    assert.equal((await B3.waitClose()).code, 4002);
    const refused = track(new Peer('refused'));
    await refused.open();
    refused.json({ t: 'hello', v: P.PROTOCOL_VERSION, token: login.body.token });
    assert.equal((await refused.waitClose()).code, 4007, 'a banned account cannot rejoin');
    assert.equal((await api('POST', '/admin/unban', { name: 'Bisi_Lagos' }, ADMIN)).status, 200);

    const A3 = track(new Peer('adaeze3'));
    await A3.hello(adaeze.token);
    const del = await api('DELETE', '/auth/account', {}, adaeze.token);
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.equal((await A3.waitClose()).code, 4002);
    assert.equal((await api('GET', '/auth/me', undefined, adaeze.token)).status, 401);
    const sum = await api('GET', '/admin/summary', undefined, ADMIN);
    assert.equal(sum.body.world.claimedPlots, 0, 'her land is free again');
  });

  if (LONG) {
    await step('hibernation: the world object is rebuilt from sockets and keeps working', async () => {
      const g = await api('POST', '/auth/guest', {});
      const H = track(new Peer('sleeper'));
      await H.hello(g.body.token);
      H.json({ t: 'claim', plot: 'auto' });
      const plot = (await H.waitJson('claimed')).plot;
      const before = (await api('GET', '/admin/summary', undefined, ADMIN)).body.world.uptimeSec;
      console.log(`      idle for 100 s (only pings) while uptime counter is ${before} s ...`);
      for (let i = 0; i < 4; i++) { await sleep(25_000); H.ws.send('ping'); await H.wait((f) => f === 'pong', 'pong from the runtime', 3000); }
      const mid = (await api('GET', '/admin/summary', undefined, ADMIN)).body.world;
      console.log(`      uptime counter now ${mid.uptimeSec} s, ticking=${mid.ticking}`);
      assert.ok(mid.uptimeSec < before + 100, 'the object was evicted and rebuilt at least once while idle');
      H.bin(P.encodeEditMessage(plot, [P.packEdit(1, 1, 1, 4, 0)]));
      await sleep(500);
      assert.equal(H.frames.filter((f) => typeof f === 'string' && JSON.parse(f).t === 'reject').length, 0, 'an edit after hibernation is accepted');
      H.json({ t: 'chat', text: 'still here' });
      const seer = track(new Peer('seer'));
      const g2 = await api('POST', '/auth/guest', {});
      const w = await seer.hello(g2.body.token);
      assert.ok(w.players.some((p) => p.pid === H.welcome.you.pid), 'the sleeper is still listed as online');
      assert.equal(w.chat.at(-1).text, 'still here');
    });
  }
  console.log(`\nall ${passed} integration steps passed`);
} catch (e) {
  exitCode = 1;
  console.log('\nwrangler log tail:\n' + logs.slice(-1500));
} finally {
  for (const p of peers) p.close();
  await stopWrangler();
  rmSync(persist, { recursive: true, force: true });
}
process.exit(exitCode);
