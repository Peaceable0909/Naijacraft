// The Naijacraft world server: one shared Lagos for everyone.
//
// Pure logic, independent of the Durable Object runtime. The Durable Object (world.js) hands it sockets, a SQLite
// handle and a function that verifies tokens; unit tests hand it fakes. The server is authoritative for:
//   - who owns which plot (one per player), persisted in SQLite
//   - every block edit: only the owner may edit their own plot, only valid blocks, rate limited
//   - chat, names and reports
// Positions are relayed (cosmetic) in batched binary snapshots limited to a radius around each player.
import {
  PLOT_CELLS, plotByNumber, claimOrder, cellIndex, PLOTS, PLOT_ROWS,
} from '../../shared/layout.js';
import {
  PROTOCOL_VERSION, LIMITS, OP, decodePos, encodeSnapshot, decodeEditMessage, encodeEditsBroadcast, encodePlotData,
  decodeReplace, deflate, inflate, joinPlotArrays, splitPlotBytes, validatePlotIds, isPlaceableId, unpackEdit,
} from '../../shared/protocol.js';
import { cleanText, maskBlocked, containsBlocked } from '../../shared/moderation.js';
import { Bucket } from './ratelimit.js';

export const CLOSE = { REPLACED: 4001, BANNED: 4002, PROTOCOL: 4003, FULL: 4004, IDLE: 4005, OUTDATED: 4006, AUTH: 4007 };
export const DAY_MS = 20 * 60 * 1000;          // one Lagos day lasts 20 real minutes
const FLUSH_MS = 3000;
const HEARTBEAT_MS = 2000;                      // re-send idle players this often so clients know they are still in range
const MAX_TEXT_FRAME = 8192;
const MAX_BINARY_FRAME = 1 << 20;
const SNAPSHOT_CHUNK = 60;
const AFK_MS = 60_000;                          // stop ticking when nobody has sent anything for this long

const toU8 = (x) => (x == null ? null : x instanceof Uint8Array ? x : new Uint8Array(x));
const toBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

const LOOK_MAX = { skin: 9, outfit: 15, hat: 9 };
export function sanitizeLook(look) {
  const out = { skin: 2, outfit: 0, hat: 0 };
  if (look && typeof look === 'object') {
    for (const k of Object.keys(LOOK_MAX)) {
      const v = look[k];
      if (Number.isInteger(v) && v >= 0 && v <= LOOK_MAX[k]) out[k] = v;
    }
  }
  return out;
}

let emptyBlob = null;

export class WorldCore {
  constructor({
    sql, env = {}, now = () => Date.now(), verifyToken,
    setTimeout: st = (...a) => setTimeout(...a), clearTimeout: ct = (...a) => clearTimeout(...a),
    setInterval: si = (...a) => setInterval(...a), clearInterval: ci = (...a) => clearInterval(...a),
    autoTick = true,
  }) {
    this.sql = sql; this.env = env; this.now = now; this.verifyToken = verifyToken;
    this.st = st; this.ct = ct; this.si = si; this.ci = ci; this.autoTick = autoTick;
    this.sessions = new Map();         // pid -> session
    this.byUid = new Map();            // uid -> session
    this.plots = new Map();            // plot number -> plot state
    this.plotByUid = new Map();        // uid -> plot number
    this.chatRing = [];
    this.nextPid = 1;
    this.tickTimer = null; this.flushTimer = null; this.flushing = null;
    this.startedAt = now();
    this.init();
  }

  // ------------------------------------------------------------------ storage

  init() {
    for (const q of [
      'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)',
      'CREATE TABLE IF NOT EXISTS profiles (uid TEXT PRIMARY KEY, look TEXT NOT NULL, plot_name TEXT NOT NULL DEFAULT \'\', achv TEXT NOT NULL DEFAULT \'{}\', created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS plots (number INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, owner_name TEXT NOT NULL, ver INTEGER NOT NULL DEFAULT 0, data BLOB, claimed_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, reporter TEXT NOT NULL, reporter_name TEXT NOT NULL, target TEXT NOT NULL, target_name TEXT NOT NULL, reason TEXT NOT NULL, context TEXT NOT NULL)',
    ]) this.sql.exec(q);

    const epoch = this.sql.exec("SELECT v FROM meta WHERE k = 'epoch'").toArray()[0];
    if (epoch) this.epoch = Number(epoch.v);
    else {
      this.epoch = this.now();
      this.sql.exec("INSERT INTO meta (k, v) VALUES ('epoch', ?)", String(this.epoch));
    }

    const rows = this.sql.exec(
      `SELECT p.number, p.uid, p.owner_name, p.ver, p.data, COALESCE(pr.plot_name, '') AS plot_name
         FROM plots p LEFT JOIN profiles pr ON pr.uid = p.uid`,
    ).toArray();
    for (const r of rows) {
      this.plots.set(r.number, {
        number: r.number, uid: r.uid, ownerName: r.owner_name, plotName: r.plot_name, ver: r.ver,
        blob: toU8(r.data), ids: null, metas: null, dirty: false, hasData: r.data != null,
      });
      this.plotByUid.set(r.uid, r.number);
    }
  }

  profile(uid) {
    const r = this.sql.exec('SELECT look, plot_name, achv FROM profiles WHERE uid = ?', uid).toArray()[0];
    if (!r) return null;
    let look, achv;
    try { look = sanitizeLook(JSON.parse(r.look)); } catch { look = sanitizeLook(null); }
    try { achv = JSON.parse(r.achv); } catch { achv = {}; }
    return { look, plotName: r.plot_name, achv };
  }

  // ------------------------------------------------------------------ sessions

  connect(ws, info = {}) {
    let pid = this.nextPid;
    for (let i = 0; i < 65535 && this.sessions.has(pid); i++) pid = pid % 65535 + 1;
    this.nextPid = pid % 65535 + 1;
    const t = this.now();
    const s = {
      pid, ws, ip: info.ip || null, authed: false, ready: false, uid: null, name: null, guest: false, look: sanitizeLook(null),
      plot: null, plotName: '', x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, emote: 0,
      qx: 0, qy: 0, qz: 0, qyaw: 0, qpitch: 0, seq: 0, known: new Map(),
      connectedAt: t, lastMsg: t, queue: Promise.resolve(), persist: null, alive: null,
      bucket: { chat: new Bucket(4, 1.25, t), edit: new Bucket(70_000, 1500, t), pos: new Bucket(25, 12, t), misc: new Bucket(4, 1, t), report: new Bucket(2, 0.1, t) },
      mutedUntil: 0, chatStrikes: [],
    };
    this.sessions.set(pid, s);
    return s;
  }

  // Rebuilds a session after the Durable Object woke from hibernation.
  restore(ws, att) {
    const s = this.connect(ws);
    this.sessions.delete(s.pid);
    s.pid = att.pid; this.sessions.set(s.pid, s);
    this.nextPid = Math.max(this.nextPid, s.pid % 65535 + 1);
    Object.assign(s, { authed: true, ready: true, uid: att.uid, name: att.name, guest: !!att.guest, plot: att.plot ?? null, look: sanitizeLook(att.look) });
    this.byUid.set(s.uid, s);
    return s;
  }

  attachment(s) {
    return { pid: s.pid, uid: s.uid, name: s.name, guest: s.guest, plot: s.plot, look: s.look };
  }

  sendJson(s, obj) { this.sendRaw(s, JSON.stringify(obj)); }
  sendRaw(s, data) { try { s.ws.send(data); } catch { /* the socket is closing; the close handler cleans up */ } }

  broadcastJson(obj, except = null) {
    const text = JSON.stringify(obj);
    for (const s of this.sessions.values()) if (s.ready && s !== except) this.sendRaw(s, text);
  }
  broadcastBinary(buf, except = null) {
    for (const s of this.sessions.values()) if (s.ready && s !== except) this.sendRaw(s, buf);
  }

  closeSession(s, code, reason) {
    try { s.ws.close(code, reason); } catch { /* already closed */ }
    this.drop(s);
  }

  drop(s) {
    if (this.sessions.get(s.pid) !== s) return;
    this.sessions.delete(s.pid);
    if (s.uid && this.byUid.get(s.uid) === s) this.byUid.delete(s.uid);
    if (s.ready) {
      this.broadcastJson({ t: 'leave', pid: s.pid });
      this.sql.exec('UPDATE profiles SET last_seen = ? WHERE uid = ?', this.now(), s.uid);
    }
    s.ready = false;
    if (this.flushNeeded()) this.flushSoon(0);
    if (!this.sessions.size) this.stopTick();
  }

  onClose(s) { this.drop(s); }

  // ------------------------------------------------------------------ message routing

  // Messages from one socket are processed strictly in order, even when handling one needs to await.
  message(s, data) {
    s.queue = s.queue.then(() => this.handle(s, data)).catch((e) => {
      this.sendJson(s, { t: 'error', code: 'internal', message: 'Something went wrong on the server.' });
      if (this.env.DEBUG) console.error(e);
    });
    return s.queue;
  }

  async handle(s, data) {
    if (!this.sessions.has(s.pid)) return;
    s.lastMsg = this.now();
    this.ensureTick();
    if (typeof data === 'string') {
      if (data.length > MAX_TEXT_FRAME) return this.closeSession(s, CLOSE.PROTOCOL, 'message too large');
      let msg;
      try { msg = JSON.parse(data); } catch { return this.closeSession(s, CLOSE.PROTOCOL, 'bad json'); }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      if (!s.authed) {
        if (msg.t !== 'hello') return this.closeSession(s, CLOSE.PROTOCOL, 'hello first');
        return this.hello(s, msg);
      }
      if (!s.ready) return;
      switch (msg.t) {
        case 'claim': return this.claim(s, msg);
        case 'chat': return this.chat(s, msg);
        case 'profile': return this.updateProfile(s, msg);
        case 'emote': return this.emote(s, msg);
        case 'report': return this.report(s, msg);
        case 'release': return this.release(s);
        default: return undefined;
      }
    }
    if (!s.ready) return;
    const buf = data instanceof ArrayBuffer ? data : data.buffer ? toBuffer(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) : null;
    if (!buf || buf.byteLength > MAX_BINARY_FRAME || buf.byteLength < 1) return;
    switch (new Uint8Array(buf, 0, 1)[0]) {
      case OP.POS: return this.position(s, buf);
      case OP.EDIT: return this.edit(s, buf);
      case OP.REPLACE: return this.replace(s, buf);
      default: return undefined;
    }
  }

  // ------------------------------------------------------------------ joining

  async hello(s, msg) {
    if (msg.v !== PROTOCOL_VERSION) {
      this.sendJson(s, { t: 'error', code: 'outdated', message: 'Your game is out of date. Please refresh the page.' });
      return this.closeSession(s, CLOSE.OUTDATED, 'outdated');
    }
    let who = null;
    try { who = typeof msg.token === 'string' ? await this.verifyToken(msg.token) : null; } catch { who = null; }
    if (!who) {
      this.sendJson(s, { t: 'error', code: 'auth', message: 'Please sign in again.' });
      return this.closeSession(s, CLOSE.AUTH, 'bad token');
    }
    if (this.sessions.size >= LIMITS.maxPlayers + 8) {
      this.sendJson(s, { t: 'error', code: 'full', message: 'Lagos is full right now. Please try again soon.' });
      return this.closeSession(s, CLOSE.FULL, 'full');
    }

    // Profile: first visit creates one (cosmetics only; the name always comes from the account).
    let prof = this.profile(who.uid);
    const t = this.now();
    if (!prof) {
      const look = sanitizeLook(msg.look);
      this.sql.exec('INSERT INTO profiles (uid, look, plot_name, achv, created_at, last_seen) VALUES (?, ?, \'\', \'{}\', ?, ?)', who.uid, JSON.stringify(look), t, t);
      prof = { look, plotName: '', achv: {} };
    }

    // Everything the newcomer needs must be ready before we register them, so that no edit can slip in between
    // "sent the plot data" and "started receiving edits".
    await this.ensureAllBlobs();

    // ---- synchronous from here: no awaits until the newcomer is fully registered
    const old = this.byUid.get(who.uid);
    if (old && old !== s) {
      this.sendJson(old, { t: 'error', code: 'replaced', message: 'You signed in from another place.' });
      this.closeSession(old, CLOSE.REPLACED, 'signed in elsewhere');
    }
    if (!this.sessions.has(s.pid)) return;            // the socket closed while we were verifying
    s.authed = true; s.uid = who.uid; s.name = who.name; s.guest = !!who.guest; s.look = prof.look; s.plotName = prof.plotName;
    s.plot = this.plotByUid.get(who.uid) ?? null;
    this.byUid.set(s.uid, s);
    if (s.plot) {
      const p = this.plots.get(s.plot);
      if (p.ownerName !== s.name) {
        p.ownerName = s.name;
        this.sql.exec('UPDATE plots SET owner_name = ? WHERE number = ?', s.name, s.plot);
      }
    }
    this.sql.exec('UPDATE profiles SET last_seen = ? WHERE uid = ?', t, s.uid);
    if (s.persist) s.persist(this.attachment(s));

    this.sendJson(s, {
      t: 'welcome', v: PROTOCOL_VERSION,
      you: { pid: s.pid, name: s.name, guest: s.guest, look: s.look, plot: s.plot, plotName: s.plotName, achv: prof.achv },
      time: { now: this.now(), epoch: this.epoch, dayMs: DAY_MS },
      plots: [...this.plots.values()].map((p) => ({ n: p.number, owner: p.ownerName, name: p.plotName, ver: p.ver })),
      players: [...this.sessions.values()].filter((o) => o.ready).map((o) => this.playerInfo(o)),
      chat: this.chatRing.slice(-20).map((c) => ({ pid: c.pid, name: c.name, text: c.text, ts: c.ts })),
      limits: { chatMax: LIMITS.chatMax, plotNameMax: LIMITS.plotNameMax, tickHz: LIMITS.tickHz, posHz: LIMITS.posHz, claimable: PLOTS.filter((p) => p.claimable).length },
    });
    for (const p of this.plots.values()) if (p.blob) this.sendRaw(s, encodePlotData(p.number, p.ver, p.blob));
    s.ready = true;
    this.broadcastJson({ t: 'join', player: this.playerInfo(s) }, s);
    this.ensureTick();
  }

  playerInfo(s) {
    return { pid: s.pid, name: s.name, look: s.look, plot: s.plot, guest: s.guest };
  }

  // ------------------------------------------------------------------ land

  plotNeedsBlob(p) { return !p.blob && p.hasData; }

  async ensureBlob(p) {
    if (!this.plotNeedsBlob(p)) return;
    const ver = p.ver;
    const blob = await deflate(joinPlotArrays(p.ids, p.metas));
    if (p.ver === ver && !p.blob) p.blob = blob;
  }

  async ensureAllBlobs() {
    for (let i = 0; i < 6; i++) {
      const missing = [...this.plots.values()].filter((p) => this.plotNeedsBlob(p));
      if (!missing.length) return;
      await Promise.all(missing.map((p) => this.ensureBlob(p)));
    }
  }

  async loadArrays(p) {
    if (p.ids) return;
    if (p.blob) {
      const parts = splitPlotBytes(await inflate(p.blob));
      if (p.ids) return;                               // another message loaded it meanwhile
      if (!parts) throw new Error('corrupt stored plot ' + p.number);
      p.ids = parts.ids.slice(); p.metas = parts.metas.slice();
    } else {
      p.ids = new Uint8Array(PLOT_CELLS); p.metas = new Uint8Array(PLOT_CELLS);
    }
  }

  claim(s, msg) {
    if (!this.bucketOk(s, 'misc', 1, 'Slow down a little!')) return;
    if (s.plot) return this.sendJson(s, { t: 'error', code: 'already_claimed', message: 'You already have a plot.' });
    let target = null;
    if (msg.plot === 'auto') target = claimOrder().find((p) => !this.plots.has(p.number)) || null;
    else {
      target = plotByNumber(msg.plot);
      if (target && (!target.claimable || this.plots.has(target.number))) {
        return this.sendJson(s, { t: 'error', code: this.plots.has(target.number) ? 'plot_taken' : 'not_claimable', message: this.plots.has(target.number) ? 'Someone else got that plot first.' : 'That land is not for sale.' });
      }
    }
    if (!target) return this.sendJson(s, { t: 'error', code: 'no_land', message: 'There is no free land left right now.' });
    const t = this.now();
    this.sql.exec('INSERT INTO plots (number, uid, owner_name, ver, data, claimed_at, updated_at) VALUES (?, ?, ?, 0, NULL, ?, ?)', target.number, s.uid, s.name, t, t);
    this.plots.set(target.number, {
      number: target.number, uid: s.uid, ownerName: s.name, plotName: s.plotName, ver: 0, blob: null, ids: null, metas: null, dirty: false, hasData: false,
    });
    this.plotByUid.set(s.uid, target.number);
    s.plot = target.number;
    if (s.persist) s.persist(this.attachment(s));
    this.sendJson(s, { t: 'claimed', plot: target.number });
    this.broadcastJson({ t: 'plot', n: target.number, owner: s.name, name: s.plotName });
  }

  async release(s) {
    if (!this.bucketOk(s, 'misc', 1, 'Slow down a little!') || !s.plot) return;
    await this.freePlot(s.plot);
    s.plot = null;
    if (s.persist) s.persist(this.attachment(s));
    this.sendJson(s, { t: 'released' });
  }

  async freePlot(number) {
    const p = this.plots.get(number);
    if (!p) return;
    this.plots.delete(number);
    this.plotByUid.delete(p.uid);
    this.sql.exec('DELETE FROM plots WHERE number = ?', number);
    const owner = this.byUid.get(p.uid);
    if (owner) { owner.plot = null; if (owner.persist) owner.persist(this.attachment(owner)); }
    if (!emptyBlob) emptyBlob = await deflate(new Uint8Array(PLOT_CELLS * 2));
    this.broadcastJson({ t: 'plot', n: number, owner: null, name: '' });
    this.broadcastBinary(encodePlotData(number, p.ver + 1, emptyBlob));
  }

  // ------------------------------------------------------------------ building

  // Takes `n` tokens from one of the player's rate limits. A message makes the refusal visible to the player.
  bucketOk(s, name, n = 1, message = null) {
    if (s.bucket[name].take(n, this.now())) return true;
    if (message) this.sendJson(s, { t: 'notice', text: message });
    return false;
  }

  async rejectEdit(s, number, reason) {
    this.sendJson(s, { t: 'reject', plot: number, reason });
    const p = number != null ? this.plots.get(number) : null;
    if (p && p.uid === s.uid) {                          // resync the owner with the truth
      await this.ensureBlob(p);
      if (p.blob) this.sendRaw(s, encodePlotData(p.number, p.ver, p.blob));
    }
  }

  async edit(s, buf) {
    const msg = decodeEditMessage(buf);
    if (!msg) return this.rejectEdit(s, s.plot, 'bad_edit');
    if (!s.plot || msg.plot !== s.plot || this.plots.get(s.plot)?.uid !== s.uid) return this.sendJson(s, { t: 'reject', plot: msg.plot, reason: 'not_owner' });
    const count = msg.packed.length;
    if (count === 0) return undefined;
    if (count > LIMITS.maxEditsPerMessage) return this.rejectEdit(s, s.plot, 'too_big');
    if (!this.bucketOk(s, 'edit', count)) return this.rejectEdit(s, s.plot, 'slow_down');
    const tmp = {};
    for (let i = 0; i < count; i++) {
      unpackEdit(msg.packed[i], tmp);
      if (tmp.y < 1 || tmp.y > PLOT_ROWS || !isPlaceableId(tmp.id)) return this.rejectEdit(s, s.plot, 'bad_block');
    }
    const p = this.plots.get(s.plot);
    await this.loadArrays(p);
    if (this.plots.get(s.plot) !== p) return undefined;  // released while we were loading
    for (let i = 0; i < count; i++) {
      unpackEdit(msg.packed[i], tmp);
      const idx = cellIndex(tmp.px, tmp.y, tmp.pz);
      p.ids[idx] = tmp.id; p.metas[idx] = tmp.meta;
    }
    p.ver += 1; p.blob = null; p.dirty = true; p.hasData = true;
    this.flushSoon();
    this.broadcastBinary(encodeEditsBroadcast(p.number, p.ver, s.pid, msg.packed), s);
    return undefined;
  }

  async replace(s, buf) {
    const msg = decodeReplace(buf);
    if (!msg || !s.plot || msg.plot !== s.plot) return this.sendJson(s, { t: 'reject', plot: msg ? msg.plot : null, reason: 'not_owner' });
    if (!this.bucketOk(s, 'edit', PLOT_CELLS / 4)) return this.rejectEdit(s, s.plot, 'slow_down');
    let parts = null;
    try { parts = splitPlotBytes(await inflate(msg.blob)); } catch { parts = null; }
    if (!parts || !validatePlotIds(parts.ids)) return this.rejectEdit(s, s.plot, 'bad_plot');
    const p = this.plots.get(s.plot);
    if (!p || p.uid !== s.uid) return undefined;
    p.ids = parts.ids.slice(); p.metas = parts.metas.slice();
    p.ver += 1; p.blob = msg.blob.slice(); p.dirty = true; p.hasData = true;
    this.flushSoon();
    this.broadcastBinary(encodePlotData(p.number, p.ver, p.blob), s);
    return undefined;
  }

  // ------------------------------------------------------------------ persistence

  flushNeeded() {
    for (const p of this.plots.values()) if (p.dirty) return true;
    return false;
  }

  flushSoon(delay = FLUSH_MS) {
    if (this.flushTimer) return;
    this.flushTimer = this.st(() => { this.flushTimer = null; this.flush(); }, delay);
  }

  // Compresses and stores every dirty plot. Safe to call at any time; concurrent calls share one run.
  flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      try {
        for (const p of [...this.plots.values()]) {
          if (!p.dirty) continue;
          const ver = p.ver;
          const blob = await deflate(joinPlotArrays(p.ids, p.metas));
          if (this.plots.get(p.number) !== p) continue;
          this.sql.exec('UPDATE plots SET data = ?, ver = ?, updated_at = ? WHERE number = ?', toBuffer(blob), ver, this.now(), p.number);
          if (p.ver === ver) { p.dirty = false; if (!p.blob) p.blob = blob; } else this.flushSoon();
        }
      } finally { this.flushing = null; }
    })();
    return this.flushing;
  }

  // ------------------------------------------------------------------ presence

  position(s, buf) {
    if (!this.bucketOk(s, 'pos')) return;
    const d = decodePos(buf);
    if (!d || d.y < -16 || d.y > 400) return;
    if (d.qx !== s.qx || d.qy !== s.qy || d.qz !== s.qz || d.qyaw !== s.qyaw || d.qpitch !== s.qpitch || d.flags !== s.flags || d.emote !== s.emote) {
      s.qx = d.qx; s.qy = d.qy; s.qz = d.qz; s.qyaw = d.qyaw; s.qpitch = d.qpitch; s.flags = d.flags; s.emote = d.emote;
      s.x = d.x; s.y = d.y; s.z = d.z; s.yaw = d.yaw; s.pitch = d.pitch;
      s.seq = (s.seq + 1) >>> 0;
    }
  }

  ensureTick() {
    if (this.tickTimer || !this.autoTick || !this.sessions.size) return;
    this.tickTimer = this.si(() => this.tick(), Math.round(1000 / LIMITS.tickHz));
  }

  stopTick() {
    if (this.tickTimer) { this.ci(this.tickTimer); this.tickTimer = null; }
  }

  // One server step: send each player a snapshot of nearby players, and tidy up stale connections.
  tick() {
    const now = this.now();
    const ready = [];
    let active = false;
    for (const s of [...this.sessions.values()]) {
      if (!s.authed && now - s.connectedAt > 15_000) { this.closeSession(s, CLOSE.PROTOCOL, 'no hello'); continue; }
      const alive = Math.max(s.lastMsg, s.alive ? s.alive() : 0);
      if (now - alive > 120_000) { this.closeSession(s, CLOSE.IDLE, 'idle'); continue; }
      if (now - s.lastMsg < AFK_MS) active = true;
      if (s.ready) ready.push(s);
    }
    if (!ready.length || !active) { this.stopTick(); return; }   // let the Durable Object hibernate when nobody is playing

    const r2 = LIMITS.interestRadius * LIMITS.interestRadius;
    for (const r of ready) {
      const out = [];
      for (const p of ready) {
        if (p === r) continue;
        const dx = p.x - r.x, dz = p.z - r.z;
        if (dx * dx + dz * dz > r2) { r.known.delete(p.pid); continue; }
        const last = r.known.get(p.pid);
        if (!last || last.seq !== p.seq || now - last.t >= HEARTBEAT_MS) {
          out.push({ pid: p.pid, qx: p.qx, qy: p.qy, qz: p.qz, qyaw: p.qyaw, qpitch: p.qpitch, flags: p.flags, emote: p.emote });
          r.known.set(p.pid, { seq: p.seq, t: now });
        }
      }
      for (let i = 0; i < out.length; i += SNAPSHOT_CHUNK) this.sendRaw(r, encodeSnapshot(out.slice(i, i + SNAPSHOT_CHUNK)));
      for (const pid of r.known.keys()) if (!this.sessions.has(pid)) r.known.delete(pid);
    }
  }

  // ------------------------------------------------------------------ chat, profile, reports

  chat(s, msg) {
    const now = this.now();
    if (now < s.mutedUntil) return this.sendJson(s, { t: 'notice', text: 'You are muted for a moment. Slow down!' });
    let text = typeof msg.text === 'string' ? cleanText(msg.text, LIMITS.chatMax) : '';
    if (!text) return;
    if (!this.bucketOk(s, 'chat')) {
      s.chatStrikes = s.chatStrikes.filter((t) => now - t < 60_000);
      s.chatStrikes.push(now);
      if (s.chatStrikes.length >= 6) { s.mutedUntil = now + 60_000; s.chatStrikes = []; return this.sendJson(s, { t: 'notice', text: 'You were sending messages too fast, so chat is paused for a minute.' }); }
      return this.sendJson(s, { t: 'notice', text: 'Slow down a little!' });
    }
    text = maskBlocked(text, this.env.BLOCKED_WORDS);
    const entry = { pid: s.pid, uid: s.uid, name: s.name, text, ts: now };
    this.chatRing.push(entry);
    if (this.chatRing.length > 60) this.chatRing.shift();
    this.broadcastJson({ t: 'chat', pid: s.pid, name: s.name, text, ts: now });
  }

  emote(s, msg) {
    if (!this.bucketOk(s, 'misc')) return;
    if (!Number.isInteger(msg.id) || msg.id < 1 || msg.id > 8) return;
    this.broadcastJson({ t: 'emote', pid: s.pid, id: msg.id }, s);
  }

  updateProfile(s, msg) {
    if (!this.bucketOk(s, 'misc', 1, 'Slow down a little!')) return;
    let look = s.look, plotName = s.plotName, achv = null;
    if (msg.look !== undefined) look = sanitizeLook(msg.look);
    if (typeof msg.plotName === 'string') {
      plotName = maskBlocked(cleanText(msg.plotName, LIMITS.plotNameMax), this.env.BLOCKED_WORDS);
      if (containsBlocked(plotName, this.env.BLOCKED_WORDS)) plotName = '';
    }
    if (msg.achv && typeof msg.achv === 'object') {
      const text = JSON.stringify(msg.achv);
      if (text.length <= 4000) achv = text;
    }
    const lookChanged = JSON.stringify(look) !== JSON.stringify(s.look);
    const nameChanged = plotName !== s.plotName;
    s.look = look; s.plotName = plotName;
    this.sql.exec('UPDATE profiles SET look = ?, plot_name = ?, achv = COALESCE(?, achv) WHERE uid = ?', JSON.stringify(look), plotName, achv, s.uid);
    if (s.persist) s.persist(this.attachment(s));
    if (lookChanged) this.broadcastJson({ t: 'prof', pid: s.pid, look });
    if (nameChanged && s.plot) {
      const p = this.plots.get(s.plot);
      if (p) p.plotName = plotName;
      this.broadcastJson({ t: 'plot', n: s.plot, owner: s.name, name: plotName });
    }
    this.sendJson(s, { t: 'saved', plotName });
  }

  report(s, msg) {
    if (!this.bucketOk(s, 'report')) return this.sendJson(s, { t: 'notice', text: 'Please wait a little before sending another report.' });
    const target = this.sessions.get(Number(msg.pid));
    if (!target || !target.ready || target === s) return;
    const reason = cleanText(typeof msg.reason === 'string' ? msg.reason : '', 200) || 'unspecified';
    const context = this.chatRing.filter((c) => c.uid === target.uid).slice(-5).map((c) => c.text);
    this.sql.exec('INSERT INTO reports (ts, reporter, reporter_name, target, target_name, reason, context) VALUES (?, ?, ?, ?, ?, ?, ?)',
      this.now(), s.uid, s.name, target.uid, target.name, reason, JSON.stringify(context));
    this.sendJson(s, { t: 'notice', text: 'Thanks. We will look into it.' });
  }

  // ------------------------------------------------------------------ administration (called from the HTTP layer)

  async releaseUser(uid) {
    const n = this.plotByUid.get(uid);
    if (n) await this.freePlot(n);
    this.sql.exec('DELETE FROM profiles WHERE uid = ?', uid);
    const s = this.byUid.get(uid);
    if (s) this.closeSession(s, CLOSE.BANNED, 'account removed');
    return { released: n || null };
  }

  async admin(cmd = {}) {
    switch (cmd.cmd) {
      case 'summary': return this.stats();
      case 'players':
        return [...this.sessions.values()].filter((s) => s.ready).map((s) => ({ pid: s.pid, name: s.name, guest: s.guest, plot: s.plot, x: Math.round(s.x), z: Math.round(s.z) }));
      case 'reports': {
        const limit = Math.max(1, Math.min(200, Number(cmd.limit) || 50));
        return this.sql.exec('SELECT * FROM reports ORDER BY id DESC LIMIT ?', limit).toArray().map((r) => ({ ...r, context: JSON.parse(r.context) }));
      }
      case 'kick': {
        const s = [...this.sessions.values()].find((o) => o.name && o.name.toLowerCase() === String(cmd.name).toLowerCase());
        if (s) this.closeSession(s, CLOSE.BANNED, cmd.reason || 'removed by an administrator');
        return { kicked: !!s };
      }
      case 'release': {
        const p = this.plots.get(Number(cmd.plot));
        if (!p) return { released: null };
        await this.freePlot(p.number);
        return { released: p.number };
      }
      case 'announce': {
        const text = cleanText(String(cmd.text || ''), 200);
        if (text) this.broadcastJson({ t: 'notice', text });
        return { sent: !!text };
      }
      default: return { error: 'unknown command' };
    }
  }

  stats() {
    return {
      players: [...this.sessions.values()].filter((s) => s.ready).length,
      claimedPlots: this.plots.size,
      freePlots: PLOTS.filter((p) => p.claimable).length - this.plots.size,
      uptimeSec: Math.round((this.now() - this.startedAt) / 1000),
      ticking: !!this.tickTimer,
    };
  }
}
