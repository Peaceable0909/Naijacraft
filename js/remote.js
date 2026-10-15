// Other players: avatars that move smoothly between the position snapshots the server sends five times a second.
import { createCharacter, EMOTES, EMOTE_SECONDS } from './characters.js';

const INTERP_DELAY = 220;       // ms: draw other players slightly in the past so there is always a newer sample to blend towards
const STALE_MS = 6000;          // no data for this long: the player is out of range, so hide them
const SHOW_DIST = 130;          // blocks
const TAU = Math.PI * 2;

function lerpAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

export function createRemotePlayers({ scene, lightAt }) {
  const players = new Map();

  function add(info) {
    let r = players.get(info.pid);
    if (r) { r.name = info.name; r.plot = info.plot ?? null; r.guest = !!info.guest; return r; }
    r = {
      pid: info.pid, name: info.name, look: info.look, plot: info.plot ?? null, guest: !!info.guest,
      char: null, shown: false, samples: [], x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, flags: 0, seen: 0, fresh: true,
      snapEmote: 0, emoteKind: null, emoteStart: 0, emoteUntil: 0, dist: Infinity,
    };
    players.set(info.pid, r);
    return r;
  }

  function remove(pid) {
    const r = players.get(pid);
    if (!r) return;
    if (r.char) r.char.dispose();
    players.delete(pid);
  }

  function setLook(pid, look) {
    const r = players.get(pid);
    if (!r) return;
    r.look = look;
    if (r.char) { r.char.dispose(); r.char = null; r.shown = false; }
  }

  function setPlot(pid, plot) { const r = players.get(pid); if (r) r.plot = plot; }

  function snapshot(list, now) {
    for (const e of list) {
      const r = players.get(e.pid);
      if (!r) continue;
      r.samples.push({ t: now, x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch });
      if (r.samples.length > 8) r.samples.shift();
      r.flags = e.flags; r.snapEmote = e.emote; r.seen = now;
    }
  }

  function emote(pid, id, now) {
    const r = players.get(pid);
    const def = EMOTES.find((e) => e.id === id);
    if (!r || !def) return null;
    r.emoteKind = def.kind; r.emoteStart = now; r.emoteUntil = now + EMOTE_SECONDS * 1000;
    return { rec: r, def };
  }

  function hide(r) {
    if (r.char && r.shown) { r.char.setVisible(false); r.shown = false; }
  }

  function update(dt, now, cam) {
    const rt = now - INTERP_DELAY;
    for (const r of players.values()) {
      const s = r.samples;
      if (!s.length || now - r.seen > STALE_MS) { hide(r); r.dist = Infinity; r.fresh = true; continue; }
      let a = s[0], b = s[0];
      if (rt >= s[s.length - 1].t) { a = b = s[s.length - 1]; }
      else if (rt > s[0].t) {
        for (let i = 0; i < s.length - 1; i++) if (rt >= s[i].t && rt <= s[i + 1].t) { a = s[i]; b = s[i + 1]; break; }
      }
      const f = a === b ? 0 : Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t)));
      const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f;
      const yaw = lerpAngle(a.yaw, b.yaw, f), pitch = a.pitch + (b.pitch - a.pitch) * f;
      if (r.fresh) { r.x = x; r.y = y; r.z = z; r.fresh = false; }
      const moved = Math.hypot(x - r.x, z - r.z);
      r.speed += (Math.min(12, dt > 0 ? moved / dt : 0) - r.speed) * Math.min(1, dt * 10);
      r.x = x; r.y = y; r.z = z; r.yaw = yaw; r.pitch = pitch;
      r.dist = Math.hypot(x - cam.x, z - cam.z);
      if (r.dist > SHOW_DIST) { hide(r); continue; }
      if (!r.char) r.char = createCharacter(scene, r.look, 'remote' + r.pid);
      if (!r.shown) { r.char.setVisible(true); r.shown = true; }

      let pose = null;
      if (now < r.emoteUntil) pose = { kind: r.emoteKind, t: (now - r.emoteStart) / 1000 };
      else if (r.snapEmote) { const def = EMOTES.find((e) => e.id === r.snapEmote); if (def) pose = { kind: def.kind, t: now / 1000 }; }
      if (r.speed > 1.4) pose = null;
      r.char.animate(dt, r.speed, pose);
      r.char.root.position.set(x, y, z);
      r.char.root.rotation.y = yaw;
      r.char.setLight(lightAt(x, y + 1, z));
    }
  }

  return {
    players, add, remove, setLook, setPlot, snapshot, emote, update,
    get: (pid) => players.get(pid),
    clear() { for (const pid of [...players.keys()]) remove(pid); },
    // Players currently drawn, for name tags.
    visible() { const out = []; for (const r of players.values()) if (r.shown) out.push(r); return out; },
    // Everyone we have a recent position for, for the maps.
    located(now) { const out = []; for (const r of players.values()) if (r.samples.length && now - r.seen < STALE_MS) out.push({ x: r.x, z: r.z, name: r.name, pid: r.pid }); return out; },
  };
}
