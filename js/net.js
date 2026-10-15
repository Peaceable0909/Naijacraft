// WebSocket client for the shared world. No DOM, so it also runs in Node for tests.
//
// Frames are processed strictly in order (a whole-plot download is decompressed before the edits that follow it are
// applied). The client reconnects with backoff after a dropped connection and reports its state through events:
//   status      { state: 'connecting' | 'online' | 'reconnecting' | 'offline', reason? }
//   welcome     the server's greeting (on every successful (re)connection)
//   fatal       { code, message }  the server refused us and retrying would not help
//   latency     round-trip time in ms
//   snapshot, edits, plotdata, join, leave, prof, plot, claimed, released, saved, chat, emote, notice, reject, error
import {
  PROTOCOL_VERSION, OP, LIMITS, encodePos, decodeSnapshot, decodeEditsBroadcast, decodePlotData, encodeEditMessage,
  encodeReplace, packEdit, deflate, inflate, joinPlotArrays, splitPlotBytes,
} from '../shared/protocol.js';

export class NetError extends Error {
  constructor(code, message, close = 0) { super(message); this.code = code; this.close = close; }
}

// Close codes the server uses (see worker/src/world-core.js) and what to tell the player.
const CLOSE_INFO = {
  4001: ['replaced', 'You signed in from another device or tab, so this one was disconnected.'],
  4002: ['removed', 'You were removed from the server by an administrator.'],
  4003: ['protocol', 'The connection was refused. Please refresh the page.'],
  4004: ['full', 'Lagos is full right now. Please try again in a few minutes.'],
  4005: ['idle', 'You were disconnected for being idle.'],
  4006: ['outdated', 'Your game is out of date. Please refresh the page.'],
  4007: ['auth', 'Your sign-in expired. Please sign in again.'],
};
const FATAL = new Set([4001, 4002, 4003, 4004, 4006, 4007]);

export class Net {
  constructor({ url, getToken, look, WebSocketImpl = globalThis.WebSocket, timers = globalThis }) {
    this.url = url; this.getToken = getToken; this.look = look; this.WS = WebSocketImpl; this.timers = timers;
    this.handlers = new Map();
    this.ws = null; this.pid = null; this.welcome = null; this.state = 'offline';
    this.queue = Promise.resolve();
    this.pingTimer = null; this.pingSent = 0; this.latency = 0;
    this.reconnectTimer = null; this.attempt = 0; this.wantOnline = false; this.lastPos = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }

  emit(type, payload) {
    for (const fn of this.handlers.get(type) || []) {
      try { fn(payload); } catch (e) { console.error('handler for', type, 'failed', e); }
    }
  }

  setState(state, reason) {
    this.state = state;
    this.emit('status', { state, reason });
  }

  get ready() { return this.state === 'online' && !!this.ws && this.ws.readyState === 1; }

  // Opens the connection and resolves with the welcome message.
  connect() {
    this.wantOnline = true;
    return new Promise((resolve, reject) => {
      if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } }
      this.setState(this.attempt ? 'reconnecting' : 'connecting');
      let settled = false;
      const done = (fn, v) => { if (!settled) { settled = true; this.timers.clearTimeout(timeout); fn(v); } };
      const ws = new this.WS(this.url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timeout = this.timers.setTimeout(() => { done(reject, new NetError('timeout', 'The server took too long to answer.')); try { ws.close(); } catch { /* ignore */ } }, 15000);

      ws.onopen = async () => {
        try {
          const token = await this.getToken();
          ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, token, look: this.look }));
        } catch (e) { done(reject, e); try { ws.close(); } catch { /* ignore */ } }
      };
      ws.onmessage = (ev) => {
        this.queue = this.queue.then(() => this.frame(ev.data, (w) => done(resolve, w))).catch((e) => console.error('frame error', e));
      };
      ws.onerror = () => { /* the close event that follows carries the details */ };
      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        this.stopPing();
        const info = CLOSE_INFO[ev.code];
        if (!settled) {
          this.setState('offline');
          return done(reject, info ? new NetError(info[0], info[1], ev.code) : new NetError('connect', "Couldn't connect to the Naijacraft server."));
        }
        this.pid = null;
        if (info && FATAL.has(ev.code)) {
          this.wantOnline = false;
          this.setState('offline', info[0]);
          this.emit('fatal', { code: info[0], message: info[1], close: ev.code });
        } else if (this.wantOnline) this.reconnectSoon();
        else this.setState('offline');
      };
    });
  }

  reconnectSoon() {
    this.setState('reconnecting');
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt, 5)) * (0.75 + Math.random() * 0.5);
    this.attempt++;
    this.reconnectTimer = this.timers.setTimeout(async () => {
      if (!this.wantOnline) return;
      try { await this.connect(); this.attempt = 0; } catch (e) {
        if (e instanceof NetError && ['replaced', 'removed', 'auth', 'outdated', 'protocol', 'full'].includes(e.code)) {
          this.wantOnline = false; this.setState('offline', e.code); this.emit('fatal', { code: e.code, message: e.message, close: e.close });
        } else if (this.wantOnline) this.reconnectSoon();
      }
    }, delay);
  }

  close() {
    this.wantOnline = false;
    this.stopPing();
    this.timers.clearTimeout(this.reconnectTimer);
    if (this.ws) { try { this.ws.close(1000, 'bye'); } catch { /* ignore */ } }
    this.ws = null; this.pid = null;
    this.setState('offline');
  }

  startPing() {
    this.stopPing();
    this.pingTimer = this.timers.setInterval(() => {
      if (!this.ws || this.ws.readyState !== 1) return;
      this.pingSent = Date.now();
      try { this.ws.send('ping'); } catch { /* closing */ }
    }, 20000);
  }
  stopPing() { if (this.pingTimer) { this.timers.clearInterval(this.pingTimer); this.pingTimer = null; } }

  // ---- incoming
  async frame(data, onWelcome) {
    if (typeof data === 'string') {
      if (data === 'pong') { this.latency = Date.now() - this.pingSent; this.emit('latency', this.latency); return; }
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg.t === 'welcome') {
        this.pid = msg.you.pid; this.welcome = msg; this.attempt = 0;
        this.setState('online');
        this.startPing();
        this.emit('welcome', msg);
        if (onWelcome) onWelcome(msg);
        return;
      }
      if (msg.t === 'error' && !this.pid) return;     // the close frame that follows tells us why
      this.emit(msg.t, msg);
      return;
    }
    switch (new Uint8Array(data, 0, 1)[0]) {
      case OP.SNAPSHOT: { const list = decodeSnapshot(data); if (list) this.emit('snapshot', list); break; }
      case OP.EDITS: { const e = decodeEditsBroadcast(data); if (e) this.emit('edits', e); break; }
      case OP.PLOTDATA: {
        const f = decodePlotData(data);
        if (!f) break;
        let parts = null;
        try { parts = splitPlotBytes(await inflate(f.blob)); } catch { parts = null; }
        if (parts) this.emit('plotdata', { plot: f.plot, ver: f.ver, ids: parts.ids.slice(), metas: parts.metas.slice() });
        break;
      }
      default: break;
    }
  }

  // ---- outgoing
  sendJson(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  // Position updates are cheap to drop, so send only when something changed.
  sendPos(s) {
    if (!this.ready) return;
    const key = `${Math.round(s.x * 64)},${Math.round(s.y * 64)},${Math.round(s.z * 64)},${Math.round(s.yaw * 40)},${Math.round(s.pitch * 40)},${s.flags},${s.emote}`;
    if (key === this.lastPos) return;
    this.lastPos = key;
    this.ws.send(encodePos(s));
  }

  // edits: [[x, y, z, id, meta]] in world coordinates, all inside `plot`.
  sendEdits(plot, edits) {
    if (!this.ready) return false;
    const packed = edits.map(([x, y, z, id, meta = 0]) => packEdit(x - plot.x, y, z - plot.z, id, meta));
    for (let i = 0; i < packed.length; i += LIMITS.maxEditsPerMessage) {
      this.ws.send(encodeEditMessage(plot.number, packed.slice(i, i + LIMITS.maxEditsPerMessage)));
    }
    return true;
  }

  async replacePlot(plot, ids, metas) {
    if (!this.ready) return false;
    this.ws.send(encodeReplace(plot.number, await deflate(joinPlotArrays(ids, metas))));
    return true;
  }

  claim(plot = 'auto') { this.sendJson({ t: 'claim', plot }); }
  chat(text) { this.sendJson({ t: 'chat', text }); }
  profile(fields) { this.sendJson({ t: 'profile', ...fields }); }
  emote(id) { this.sendJson({ t: 'emote', id }); }
  report(pid, reason) { this.sendJson({ t: 'report', pid, reason }); }
  release() { this.sendJson({ t: 'release' }); }
}
