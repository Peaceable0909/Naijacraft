// Durable Object that runs the shared world. One global instance; players connect with WebSockets that use the
// Hibernation API so the object can sleep (and cost nothing) while nobody is playing.
import { DurableObject } from 'cloudflare:workers';
import { WorldCore } from './world-core.js';

export class World extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sockets = new Map();                         // WebSocket -> core session
    this.core = new WorldCore({
      sql: ctx.storage.sql,
      env,
      verifyToken: (token) => env.ACCOUNTS.get(env.ACCOUNTS.idFromName('main')).call('verify', { token }),
    });
    // After hibernation the object is rebuilt: re-attach every surviving socket to a session.
    for (const ws of ctx.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (att && att.pid) this.bind(ws, this.core.restore(ws, att));
      else { try { ws.close(4003, 'session lost'); } catch { /* ignore */ } }
    }
    // Answered by the runtime without waking us, so idle players cost nothing.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  bind(ws, session) {
    this.sockets.set(ws, session);
    session.persist = (att) => { try { ws.serializeAttachment(att); } catch { /* socket closing */ } };
    session.alive = () => {
      const t = this.ctx.getWebSocketAutoResponseTimestamp(ws);
      return t ? t.getTime() : 0;
    };
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.bind(server, this.core.connect(server, { ip: request.headers.get('CF-Connecting-IP') }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const s = this.sockets.get(ws);
    if (s) await this.core.message(s, message);
  }

  async webSocketClose(ws, code, reason) {
    const s = this.sockets.get(ws);
    if (s) this.core.onClose(s);
    this.sockets.delete(ws);
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch { /* already closed */ }
  }

  async webSocketError(ws) {
    const s = this.sockets.get(ws);
    if (s) this.core.onClose(s);
    this.sockets.delete(ws);
  }

  // RPC used by the HTTP layer.
  async admin(cmd) { return this.core.admin(cmd); }
  async releaseUser(uid) { return this.core.releaseUser(uid); }
  async stats() { return this.core.stats(); }
}
