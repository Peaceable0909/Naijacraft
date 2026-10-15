// The online session: keeps the account token fresh, owns the WebSocket (js/net.js) and mirrors what the server tells us
// (who owns which plot, who is online) so the rest of the game can just read it.
import { Net, NetError } from './net.js';
import { tokenExpiry } from './auth.js';
import { wsUrl } from './config.js';
import { unpackEdit } from '../shared/protocol.js';
import { plotByNumber } from '../shared/layout.js';

const WEEK = 7 * 24 * 3600;

export function createOnline({ server, auth, look, owners, hooks }) {
  const net = new Net({ url: wsUrl(server), getToken: async () => auth.token, look });
  const players = new Map();                 // pid -> { pid, name, look, plot, guest }
  const session = {
    net, players, owners,
    you: null,                               // { pid, name, guest, look, plot, plotName }
    clock: { offset: 0, epoch: 0, dayMs: 1_200_000 },
    limits: { chatMax: 160, plotNameMax: 24 },
    joined: false,
    plotFramesSeen: 0,
  };
  let firstWelcome = true;

  // ---- time shared by everyone (the Lagos day cycle, weather, residents and traffic)
  session.serverNow = () => Date.now() + session.clock.offset;
  session.dayFraction = () => {
    const { epoch, dayMs } = session.clock;
    return ((((session.serverNow() - epoch) / dayMs) % 1) + 1.3) % 1;       // the world starts at 07:12
  };

  Object.defineProperty(session, 'ready', { get: () => net.ready });

  function applyWelcome(w) {
    session.you = { ...w.you };
    session.clock = { offset: w.time.now - Date.now(), epoch: w.time.epoch, dayMs: w.time.dayMs };
    session.limits = { ...session.limits, ...w.limits };
    players.clear();
    for (const p of w.players) players.set(p.pid, p);
    players.set(w.you.pid, { pid: w.you.pid, name: w.you.name, look: w.you.look, plot: w.you.plot, guest: w.you.guest });
    owners.clear();
    for (const p of w.plots) owners.set(p.n, { owner: p.owner, name: p.name || '' });
    session.plotFramesSeen = 0;
  }

  net.on('welcome', (w) => {
    const again = !firstWelcome;
    firstWelcome = false;
    applyWelcome(w);
    hooks.welcome?.(w, again);
  });

  net.on('status', ({ state, reason }) => hooks.status?.(state, reason));
  net.on('fatal', (f) => hooks.fatal?.(f));
  net.on('latency', (ms) => hooks.latency?.(ms));

  net.on('plotdata', ({ plot, ver, ids, metas }) => {
    session.plotFramesSeen++;
    const p = plotByNumber(plot);
    if (p) hooks.plotData?.(p, ids, metas, ver);
  });

  net.on('edits', ({ plot, editor, packed }) => {
    const p = plotByNumber(plot);
    if (!p) return;
    const list = new Array(packed.length), tmp = {};
    for (let i = 0; i < packed.length; i++) {
      unpackEdit(packed[i], tmp);
      list[i] = [p.x + tmp.px, tmp.y, p.z + tmp.pz, tmp.id, tmp.meta];
    }
    hooks.edits?.(p, list, editor);
  });

  net.on('plot', ({ n, owner, name }) => {
    if (owner) owners.set(n, { owner, name: name || '' }); else owners.delete(n);
    for (const pl of players.values()) if (pl.name === owner) pl.plot = n;
    hooks.owner?.(n, owner, name || '');
  });

  net.on('claimed', ({ plot }) => { if (session.you) session.you.plot = plot; hooks.claimed?.(plot); });
  net.on('released', () => { if (session.you) session.you.plot = null; hooks.released?.(); });
  net.on('saved', (m) => { if (session.you) session.you.plotName = m.plotName; hooks.saved?.(m.plotName); });

  net.on('join', ({ player }) => { players.set(player.pid, player); hooks.join?.(player); });
  net.on('leave', ({ pid }) => { const p = players.get(pid); players.delete(pid); hooks.leave?.(pid, p); });
  net.on('prof', ({ pid, look: l }) => { const p = players.get(pid); if (p) p.look = l; hooks.look?.(pid, l); });
  net.on('snapshot', (list) => hooks.snapshot?.(list));
  net.on('chat', (m) => hooks.chat?.(m));
  net.on('emote', (m) => hooks.emote?.(m.pid, m.id));
  net.on('notice', (m) => hooks.notice?.(m.text));
  net.on('reject', (m) => hooks.reject?.(m.plot, m.reason));
  net.on('error', (m) => hooks.error?.(m.code, m.message));

  // Make sure the token is good for a while, then connect. Resolves with the welcome message.
  session.connect = async () => {
    const exp = tokenExpiry(auth.token);
    if (exp && exp - Date.now() / 1000 < WEEK) {
      try { await auth.refresh(); } catch (e) { if (e.status === 401) throw new NetError('auth', 'Please sign in again.'); }
    }
    const w = await net.connect();
    session.joined = true;
    return w;
  };

  // Waits until `count` whole-plot frames have arrived after the welcome (they follow it immediately).
  session.waitForPlots = (count, timeoutMs = 7000) => new Promise((resolve) => {
    const t0 = performance.now();
    const check = () => {
      if (session.plotFramesSeen >= count || performance.now() - t0 > timeoutMs) return resolve(session.plotFramesSeen);
      setTimeout(check, 40);
      return undefined;
    };
    check();
  });

  session.close = () => net.close();
  session.sendPos = (s) => net.sendPos(s);
  session.sendEdits = (plot, edits) => net.sendEdits(plot, edits);
  session.replacePlot = (plot, ids, metas) => net.replacePlot(plot, ids, metas);
  session.claim = (n) => net.claim(n);
  session.chat = (text) => net.chat(text);
  session.emote = (id) => net.emote(id);
  session.profile = (fields) => net.profile(fields);
  session.report = (pid, reason) => net.report(pid, reason);
  session.release = () => net.release();
  return session;
}
