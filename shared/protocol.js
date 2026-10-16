// Naijacraft network protocol, shared by the browser client and the Cloudflare Worker.
//
// One WebSocket per player. Low-frequency messages are JSON text frames: { t: "type", ... }.
// High-frequency data uses binary frames whose first byte is an opcode. Binary is used for positions and
// block edits because mobile data is expensive and these dominate the traffic.
//
// Client -> server
//   text   hello    { v, token, look? }                       first message; authenticates the socket
//   text   claim    { plot: number | "auto" }                 claim a free plot (one per player)
//   text   profile  { look?, plotName?, achv? }               appearance / plot sign / achievements
//   text   chat     { text }
//   text   emote    { id }
//   text   report   { pid, reason }
//   text   release  {}                                        give up your plot
//   binary POS      [op u8][x u16][y u16][z u16][yaw u8][pitch i8][flags u8][emote u8]       (11 bytes)
//   binary EDIT     [op u8][plot u8][count u16][u32 x count]                                  packed block edits
//   binary REPLACE  [op u8][plot u8][deflate-raw(ids || metas)]                               whole-plot replace
//   "ping" (text)   answered with "pong" by the runtime without waking the server
//
// Server -> client
//   text   welcome  { v, you, time, plots, players, chat, limits }
//   text   join / leave / prof / plot / claimed / chat / emote / reject / error / notice
//   binary SNAPSHOT [op u8][count u8][ (pid u16, x u16, y u16, z u16, yaw u8, pitch i8, flags u8, emote u8) x count ]
//   binary EDITS    [op u8][plot u8][ver u32][editor pid u16][count u16][u32 x count]
//   binary PLOTDATA [op u8][plot u8][ver u32][deflate-raw(ids || metas)]

import { PLOT, PLOT_CELLS, MAX_BLOCK_ID, NON_PLACEABLE, SX, SZ } from './layout.js';

export const PROTOCOL_VERSION = 1;

export const OP = {
  POS: 0x01,
  EDIT: 0x02,
  REPLACE: 0x03,
  SNAPSHOT: 0x81,
  EDITS: 0x82,
  PLOTDATA: 0x83,
};

export const LIMITS = {
  tickHz: 5,                // server snapshot rate
  posHz: 5,                 // how often the client sends its position while moving
  interestRadius: 150,      // blocks: players farther than this are not sent
  maxEditsPerMessage: 16384,
  chatMax: 160,
  plotNameMax: 24,
  maxPlayers: 120,
};

// ---------------------------------------------------------------- quantisation

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const quantX = (v) => clamp(Math.round(v * 64), 0, 65535);
export const dequantX = (q) => q / 64;
export const quantY = (v) => clamp(Math.round((v + 16) * 64), 0, 65535);
export const dequantY = (q) => q / 64 - 16;
export const quantYaw = (v) => (Math.round((((v % TAU) + TAU) % TAU) / TAU * 256)) & 255;
export const dequantYaw = (q) => (q / 256) * TAU;
export const quantPitch = (v) => clamp(Math.round((v / (Math.PI / 2)) * 127), -127, 127);
export const dequantPitch = (q) => (q / 127) * (Math.PI / 2);

export const FLAG = { FLYING: 1, SWIMMING: 2, SPRINT: 4, GROUND: 8 };

// ---------------------------------------------------------------- position (client -> server)

export function encodePos(s) {
  const buf = new ArrayBuffer(11);
  const v = new DataView(buf);
  v.setUint8(0, OP.POS);
  v.setUint16(1, quantX(s.x)); v.setUint16(3, quantY(s.y)); v.setUint16(5, quantX(s.z));
  v.setUint8(7, quantYaw(s.yaw)); v.setInt8(8, quantPitch(s.pitch));
  v.setUint8(9, s.flags & 255); v.setUint8(10, s.emote & 255);
  return buf;
}

export function decodePos(buf) {
  const v = new DataView(buf);
  if (buf.byteLength !== 11 || v.getUint8(0) !== OP.POS) return null;
  return {
    x: clamp(dequantX(v.getUint16(1)), 0, SX), y: dequantY(v.getUint16(3)), z: clamp(dequantX(v.getUint16(5)), 0, SZ),
    yaw: dequantYaw(v.getUint8(7)), pitch: dequantPitch(v.getInt8(8)), flags: v.getUint8(9), emote: v.getUint8(10),
    qx: v.getUint16(1), qy: v.getUint16(3), qz: v.getUint16(5), qyaw: v.getUint8(7), qpitch: v.getInt8(8),
  };
}

// ---------------------------------------------------------------- snapshot (server -> client)

const SNAP_ENTRY = 12;
export function encodeSnapshot(players) {
  const buf = new ArrayBuffer(2 + players.length * SNAP_ENTRY);
  const v = new DataView(buf);
  v.setUint8(0, OP.SNAPSHOT); v.setUint8(1, players.length);
  let o = 2;
  for (const p of players) {
    v.setUint16(o, p.pid); v.setUint16(o + 2, p.qx); v.setUint16(o + 4, p.qy); v.setUint16(o + 6, p.qz);
    v.setUint8(o + 8, p.qyaw); v.setInt8(o + 9, p.qpitch); v.setUint8(o + 10, p.flags & 255); v.setUint8(o + 11, p.emote & 255);
    o += SNAP_ENTRY;
  }
  return buf;
}

export function decodeSnapshot(buf) {
  const v = new DataView(buf);
  if (v.getUint8(0) !== OP.SNAPSHOT) return null;
  const n = v.getUint8(1);
  if (buf.byteLength !== 2 + n * SNAP_ENTRY) return null;
  const out = [];
  let o = 2;
  for (let i = 0; i < n; i++, o += SNAP_ENTRY) {
    out.push({
      pid: v.getUint16(o), x: dequantX(v.getUint16(o + 2)), y: dequantY(v.getUint16(o + 4)), z: dequantX(v.getUint16(o + 6)),
      yaw: dequantYaw(v.getUint8(o + 8)), pitch: dequantPitch(v.getInt8(o + 9)), flags: v.getUint8(o + 10), emote: v.getUint8(o + 11),
    });
  }
  return out;
}

// ---------------------------------------------------------------- block edits

// An edit addresses a cell inside a plot: x5 z5 y6 | id8 | meta8, packed into one unsigned 32-bit value.
export function packEdit(px, y, pz, id, meta = 0) {
  return ((px & 31) | ((pz & 31) << 5) | ((y & 63) << 10) | ((id & 255) << 16) | ((meta & 255) << 24)) >>> 0;
}
export function unpackEdit(u, out = {}) {
  out.px = u & 31; out.pz = (u >>> 5) & 31; out.y = (u >>> 10) & 63; out.id = (u >>> 16) & 255; out.meta = (u >>> 24) & 255;
  return out;
}

export function isPlaceableId(id) {
  return id === 0 || (id <= MAX_BLOCK_ID && !NON_PLACEABLE.includes(id));
}

// Client -> server: [EDIT][plot][count u16][u32...]
export function encodeEditMessage(plot, packed) {
  const buf = new ArrayBuffer(4 + packed.length * 4);
  const v = new DataView(buf);
  v.setUint8(0, OP.EDIT); v.setUint8(1, plot); v.setUint16(2, packed.length);
  for (let i = 0; i < packed.length; i++) v.setUint32(4 + i * 4, packed[i]);
  return buf;
}
export function decodeEditMessage(buf) {
  const v = new DataView(buf);
  if (buf.byteLength < 4 || v.getUint8(0) !== OP.EDIT) return null;
  const count = v.getUint16(2);
  if (buf.byteLength !== 4 + count * 4) return null;
  const packed = new Uint32Array(count);
  for (let i = 0; i < count; i++) packed[i] = v.getUint32(4 + i * 4);
  return { plot: v.getUint8(1), packed };
}

// Server -> client: [EDITS][plot][ver u32][editor u16][count u16][u32...]
export function encodeEditsBroadcast(plot, ver, editor, packed) {
  const buf = new ArrayBuffer(10 + packed.length * 4);
  const v = new DataView(buf);
  v.setUint8(0, OP.EDITS); v.setUint8(1, plot); v.setUint32(2, ver); v.setUint16(6, editor); v.setUint16(8, packed.length);
  for (let i = 0; i < packed.length; i++) v.setUint32(10 + i * 4, packed[i]);
  return buf;
}
export function decodeEditsBroadcast(buf) {
  const v = new DataView(buf);
  if (buf.byteLength < 10 || v.getUint8(0) !== OP.EDITS) return null;
  const count = v.getUint16(8);
  if (buf.byteLength !== 10 + count * 4) return null;
  const packed = new Uint32Array(count);
  for (let i = 0; i < count; i++) packed[i] = v.getUint32(10 + i * 4);
  return { plot: v.getUint8(1), ver: v.getUint32(2), editor: v.getUint16(6), packed };
}

// ---------------------------------------------------------------- whole-plot blobs

export async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function inflate(bytes, maxBytes = PLOT_CELLS * 2 + 16) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel(); throw new Error('inflated data too large'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// A plot is stored as ids (PLOT_CELLS bytes) followed by metas (PLOT_CELLS bytes).
export function joinPlotArrays(ids, metas) {
  const out = new Uint8Array(PLOT_CELLS * 2);
  out.set(ids, 0); out.set(metas, PLOT_CELLS);
  return out;
}
export function splitPlotBytes(bytes) {
  if (bytes.length !== PLOT_CELLS * 2) return null;
  return { ids: bytes.subarray(0, PLOT_CELLS), metas: bytes.subarray(PLOT_CELLS) };
}
// Returns null when any id is not a valid block id.
export function validatePlotIds(ids) {
  for (let i = 0; i < ids.length; i++) if (!isPlaceableId(ids[i])) return false;
  return true;
}

export function encodePlotData(plot, ver, blob) {
  const out = new Uint8Array(6 + blob.length);
  const v = new DataView(out.buffer);
  v.setUint8(0, OP.PLOTDATA); v.setUint8(1, plot); v.setUint32(2, ver);
  out.set(blob, 6);
  return out.buffer;
}
export function decodePlotData(buf) {
  const v = new DataView(buf);
  if (buf.byteLength < 6 || v.getUint8(0) !== OP.PLOTDATA) return null;
  return { plot: v.getUint8(1), ver: v.getUint32(2), blob: new Uint8Array(buf, 6) };
}
export function encodeReplace(plot, blob) {
  const out = new Uint8Array(2 + blob.length);
  out[0] = OP.REPLACE; out[1] = plot; out.set(blob, 2);
  return out.buffer;
}
export function decodeReplace(buf) {
  const v = new DataView(buf);
  if (buf.byteLength < 3 || v.getUint8(0) !== OP.REPLACE) return null;
  return { plot: v.getUint8(1), blob: new Uint8Array(buf, 2) };
}

export { PLOT, PLOT_CELLS };
