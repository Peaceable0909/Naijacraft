// Harness for exercising WorldCore with fake sockets and an in-memory SQLite database.
import { WorldCore } from '../../src/world-core.js';
import { memorySql } from './sql.js';
import * as P from '../../../shared/protocol.js';
import * as L from '../../../shared/layout.js';

export class FakeWs {
  constructor() { this.sent = []; this.closed = null; }
  send(d) { this.sent.push(d); }
  close(code, reason) { this.closed = { code, reason }; }
  json(type) { return this.sent.filter((d) => typeof d === 'string').map((d) => JSON.parse(d)).filter((m) => !type || m.t === type); }
  last(type) { const a = this.json(type); return a[a.length - 1]; }
  bin(op) { return this.sent.filter((d) => typeof d !== 'string' && new Uint8Array(d, 0, 1)[0] === op); }
  clear() { this.sent = []; }
}

export function makeWorld({ sql = memorySql(), env = {}, clock = { t: 1_800_000_000_000 }, tokens = {} } = {}) {
  const core = new WorldCore({
    sql, env, now: () => clock.t, autoTick: false,
    setTimeout: (fn, ms) => ({ fn, ms }), clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    verifyToken: async (token) => tokens[token] || null,
  });
  const tokenFor = (name, extra = {}) => { tokens[name] = { uid: 'uid-' + name, name, guest: false, ...extra }; return name; };
  async function join(name, { look, extra, tokenName } = {}) {
    const ws = new FakeWs();
    const s = core.connect(ws, {});
    await core.message(s, JSON.stringify({ t: 'hello', v: P.PROTOCOL_VERSION, token: tokenName ?? tokenFor(name, extra), look }));
    return { ws, s, name };
  }
  const say = (c, msg) => core.message(c.s, JSON.stringify(msg));
  const place = (c, plot, edits) => core.message(c.s, P.encodeEditMessage(plot, edits.map((e) => P.packEdit(...e))));
  const move = (c, x, y, z, extra = {}) => core.message(c.s, P.encodePos({ x, y, z, yaw: 0, pitch: 0, flags: 0, emote: 0, ...extra }));
  return { core, sql, clock, tokens, tokenFor, join, say, place, move, P, L };
}
