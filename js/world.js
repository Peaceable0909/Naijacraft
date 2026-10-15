// World data: a flat, finite Lagos made of a GRID x GRID set of plots separated by roads,
// with Bar Beach along the southern edge. Also owns lighting (sun + lamps) and plot persistence.
import { B, BLOCKS, OPAQUE, SOLID, EMIT, shapeBoxes } from './blocks.js';

export const PLOT = 32;              // plot edge length in blocks
export const ROAD = 8;               // road width
export const GRID = 4;               // plots per side
export const PITCH = PLOT + ROAD;
export const CITY = ROAD + GRID * PITCH;   // 168: the walled city
export const BEACH = 24;                   // sand strip south of the city
export const SX = CITY;
export const SZ = CITY + BEACH;            // 192
export const HEIGHT = 64;
export const CHUNK = 16;
export const NCX = Math.ceil(SX / CHUNK);
export const NCZ = Math.ceil(SZ / CHUNK);
const LAYER = SX * SZ;

// [row half][col half]; z grows southwards.
const DISTRICTS = [['Ikeja', 'Yaba'], ['Lagos Island', 'Lekki']];
export function districtAt(x, z) {
  if (z >= CITY) return 'Bar Beach';
  return DISTRICTS[z < CITY / 2 ? 0 : 1][x < CITY / 2 ? 0 : 1];
}

export function plotOrigin(col, row) {
  return { x: ROAD + col * PITCH, z: ROAD + row * PITCH };
}

// Which plot (if any) contains the block column (x, z)?
export function plotAt(x, z) {
  x = Math.floor(x); z = Math.floor(z);
  const lx = x - ROAD, lz = z - ROAD;
  if (lx < 0 || lz < 0) return null;
  const col = Math.floor(lx / PITCH), row = Math.floor(lz / PITCH);
  if (col >= GRID || row >= GRID) return null;
  if (lx - col * PITCH >= PLOT || lz - row * PITCH >= PLOT) return null;
  return PLOTS[row * GRID + col];
}

// kind: 'house' | 'shop' | 'tower' | 'market' | 'park' | 'free'
function mk(number, kind, owner, name) {
  const col = (number - 1) % GRID, row = Math.floor((number - 1) / GRID);
  const o = plotOrigin(col, row);
  return {
    number, col, row, x: o.x, z: o.z, kind, owner, name: name || null,
    district: districtAt(o.x + PLOT / 2, o.z + PLOT / 2),
  };
}
export const PLAYER_PLOT = 6;
export const PLOTS = [
  mk(1, 'house', 'Adaeze'), mk(2, 'free'), mk(3, 'house', 'Tunde'), mk(4, 'free'),
  mk(5, 'house', 'Bisi'), mk(6, 'free'), mk(7, 'market', null, 'Yaba Market'), mk(8, 'house', 'Chidi'),
  mk(9, 'free'), mk(10, 'park', null, 'Freedom Park'), mk(11, 'house', 'Zainab'), mk(12, 'free'),
  mk(13, 'tower', 'Emeka'), mk(14, 'free'), mk(15, 'free'), mk(16, 'shop', 'Ngozi'),
];

export const SPAWN = { x: 84, y: 1, z: 95, yaw: Math.PI, pitch: 0.12 };

const Q = new Int32Array(1 << 21);   // BFS ring buffer for light propagation
const QMASK = Q.length - 1;

export class World {
  constructor() {
    const n = SX * SZ * HEIGHT;
    this.data = new Uint8Array(n);
    this.meta = new Uint8Array(n);
    this.sky = new Uint8Array(n);    // sunlight 0-15 (scaled by time of day when drawn)
    this.blk = new Uint8Array(n);    // lamp light 0-15
    this.top = new Uint8Array(NCX * NCZ);   // highest written y + 1 per chunk column
    this.dirty = new Set();
  }

  index(x, y, z) { return (y * SZ + z) * SX + x; }
  inBounds(x, y, z) { return x >= 0 && z >= 0 && y >= 0 && x < SX && z < SZ && y < HEIGHT; }
  get(x, y, z) { return this.inBounds(x, y, z) ? this.data[(y * SZ + z) * SX + x] : 0; }
  getMeta(x, y, z) { return this.inBounds(x, y, z) ? this.meta[(y * SZ + z) * SX + x] : 0; }
  isOpaque(x, y, z) { return OPAQUE[this.get(x, y, z)]; }

  // Collision boxes (in block-local units) for a cell, or null if the player can pass through.
  // The invisible walls at the map edge and the floor below the world count as solid.
  solidBoxes(x, y, z) {
    if (x < 0 || z < 0 || x >= SX || z >= SZ || y < 0) return FULL_BOX;
    if (y >= HEIGHT) return null;
    const i = (y * SZ + z) * SX + x, id = this.data[i];
    return SOLID[id] ? shapeBoxes(id, this.meta[i]) : null;
  }

  set(x, y, z, id, meta = 0) {
    if (!this.inBounds(x, y, z)) return;
    const i = (y * SZ + z) * SX + x;
    this.data[i] = id;
    this.meta[i] = meta;
    const k = (z >> 4) * NCX + (x >> 4);
    if (id !== 0 && y + 1 > this.top[k]) this.top[k] = y + 1;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= SX || nz >= SZ) continue;
      this.dirty.add((nz >> 4) * NCX + (nx >> 4));
    }
  }

  fillBox(x0, y0, z0, x1, y1, z1, id, meta = 0) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id, meta);
  }

  markAllDirty() { for (let i = 0; i < NCX * NCZ; i++) this.dirty.add(i); }
  markBoxDirty(x0, z0, x1, z1) {
    for (let cz = Math.max(0, (z0 - 1) >> 4); cz <= Math.min(NCZ - 1, (z1 + 1) >> 4); cz++)
      for (let cx = Math.max(0, (x0 - 1) >> 4); cx <= Math.min(NCX - 1, (x1 + 1) >> 4); cx++) this.dirty.add(cz * NCX + cx);
  }

  // Voxel traversal (Amanatides & Woo). Returns the first targetable cell and the face we entered through.
  // Water is ignored so you can build in and through it.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tDx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMx = dx > 0 ? (x + 1 - ox) * tDx : dx < 0 ? (ox - x) * tDx : Infinity;
    let tMy = dy > 0 ? (y + 1 - oy) * tDy : dy < 0 ? (oy - y) * tDy : Infinity;
    let tMz = dz > 0 ? (z + 1 - oz) * tDz : dz < 0 ? (oz - z) * tDz : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    while (t <= maxDist) {
      const id = this.get(x, y, z);
      if (id !== 0 && id !== B.WATER) {
        return { x, y, z, nx, ny, nz, id, meta: this.getMeta(x, y, z), hx: ox + dx * t, hy: oy + dy * t, hz: oz + dz * t };
      }
      if (tMx < tMy && tMx < tMz) { x += sx; t = tMx; tMx += tDx; nx = -sx; ny = 0; nz = 0; }
      else if (tMy < tMz) { y += sy; t = tMy; tMy += tDy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tMz; tMz += tDz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  // ------------------------------------------------------------------ lighting
  // Sunlight falls straight down from the sky and spreads sideways losing 1 per block;
  // lamps spread the same way. Light changes are recomputed in a box around each edit.

  computeAllLight() { this.relight(0, SX - 1, 0, SZ - 1); }

  lightAt(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (!this.inBounds(x, y, z)) return { sky: 15, blk: 0 };
    const i = (y * SZ + z) * SX + x;
    return { sky: this.sky[i], blk: this.blk[i] };
  }

  // Recomputes light for columns x0..x1, z0..z1 (inclusive). Returns the bbox of changed cells or null.
  relight(x0, x1, z0, z1) {
    x0 = Math.max(0, x0); z0 = Math.max(0, z0); x1 = Math.min(SX - 1, x1); z1 = Math.min(SZ - 1, z1);
    const { data, sky, blk } = this;
    const old = new Uint8Array((x1 - x0 + 1) * (z1 - z0 + 1) * HEIGHT * 2);
    let o = 0;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      let open = true;
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const i = y * LAYER + z * SX + x;
        old[o++] = sky[i]; old[o++] = blk[i];
        const id = data[i];
        if (OPAQUE[id]) { open = false; sky[i] = 0; } else sky[i] = open ? 15 : 0;
        blk[i] = EMIT[id];
      }
    }
    this.propagate(sky, x0, x1, z0, z1);
    this.propagate(blk, x0, x1, z0, z1);

    o = 0;
    let cx0 = Infinity, cx1 = -1, cz0 = Infinity, cz1 = -1;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const i = y * LAYER + z * SX + x;
        if (old[o] !== sky[i] || old[o + 1] !== blk[i]) {
          if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (z < cz0) cz0 = z; if (z > cz1) cz1 = z;
        }
        o += 2;
      }
    }
    return cx1 < 0 ? null : [cx0, cz0, cx1, cz1];
  }

  propagate(arr, x0, x1, z0, z1) {
    const data = this.data;
    let head = 0, tail = 0;
    const push = (i) => { Q[tail & QMASK] = i; tail++; };
    const canGo = (j, v) => !OPAQUE[data[j]] && arr[j] < v - 1;

    // seeds: lit cells inside the box that can still spread
    for (let y = 0; y < HEIGHT; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = y * LAYER + z * SX + x, v = arr[i];
      if (v <= 1) continue;
      if ((x > x0 && canGo(i - 1, v)) || (x < x1 && canGo(i + 1, v)) || (z > z0 && canGo(i - SX, v)) ||
          (z < z1 && canGo(i + SX, v)) || (y > 0 && canGo(i - LAYER, v)) || (y < HEIGHT - 1 && canGo(i + LAYER, v))) push(i);
    }
    // light flowing in from just outside the box
    for (let y = 0; y < HEIGHT; y++) {
      for (let z = z0; z <= z1; z++) {
        if (x0 > 0) { const i = y * LAYER + z * SX + x0 - 1; if (arr[i] > 1) push(i); }
        if (x1 < SX - 1) { const i = y * LAYER + z * SX + x1 + 1; if (arr[i] > 1) push(i); }
      }
      for (let x = x0; x <= x1; x++) {
        if (z0 > 0) { const i = y * LAYER + (z0 - 1) * SX + x; if (arr[i] > 1) push(i); }
        if (z1 < SZ - 1) { const i = y * LAYER + (z1 + 1) * SX + x; if (arr[i] > 1) push(i); }
      }
    }

    while (head < tail) {
      const i = Q[head & QMASK]; head++;
      const v = arr[i];
      if (v <= 1) continue;
      const x = i % SX, t = (i - x) / SX, z = t % SZ, y = (t - z) / SZ;
      const nv = v - 1;
      const inX = x >= x0 && x <= x1, inZ = z >= z0 && z <= z1;
      let j;
      if (inZ) {
        if (x > x0 && x - 1 <= x1) { j = i - 1; if (!OPAQUE[data[j]] && arr[j] < nv) { arr[j] = nv; push(j); } }
        if (x < x1 && x + 1 >= x0) { j = i + 1; if (!OPAQUE[data[j]] && arr[j] < nv) { arr[j] = nv; push(j); } }
      }
      if (inX) {
        if (z > z0 && z - 1 <= z1) { j = i - SX; if (!OPAQUE[data[j]] && arr[j] < nv) { arr[j] = nv; push(j); } }
        if (z < z1 && z + 1 >= z0) { j = i + SX; if (!OPAQUE[data[j]] && arr[j] < nv) { arr[j] = nv; push(j); } }
      }
      if (inX && inZ) {
        if (y > 0) { j = i - LAYER; if (!OPAQUE[data[j]] && arr[j] < nv) { arr[j] = nv; push(j); } }
        if (y < HEIGHT - 1) { j = i + LAYER; if (!OPAQUE[data[j]] && arr[j] < nv) { arr[j] = nv; push(j); } }
      }
    }
  }

  // ------------------------------------------------------------------ regions & persistence

  // Non-air cells in a box, relative to its min corner: { w, h, d, cells: [[x,y,z,id,meta]] }
  readRegion(x0, y0, z0, x1, y1, z1) {
    const cells = [];
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const id = this.get(x, y, z);
      if (id) cells.push([x - x0, y - y0, z - z0, id, this.getMeta(x, y, z)]);
    }
    return { w: x1 - x0 + 1, h: y1 - y0 + 1, d: z1 - z0 + 1, cells };
  }

  // Plot contents above the ground layer, run-length encoded as (id, meta, count lo, count hi).
  exportPlot(plot) {
    const bytes = [];
    let pid = -1, pmeta = -1, run = 0;
    const flush = () => { if (run > 0) bytes.push(pid, pmeta, run & 255, run >> 8); };
    for (let y = 1; y < HEIGHT; y++) for (let z = 0; z < PLOT; z++) for (let x = 0; x < PLOT; x++) {
      const i = this.index(plot.x + x, y, plot.z + z);
      const id = this.data[i], m = this.meta[i];
      if (id === pid && m === pmeta && run < 65535) run++;
      else { flush(); pid = id; pmeta = m; run = 1; }
    }
    flush();
    return toBase64(bytes);
  }

  // Decodes a plot export into a flat array of [id, meta] per cell (y-major from y=1), or null if invalid.
  // version 1 saves (prototype) had no meta and only 47 rows.
  static decodePlot(b64, version = 2) {
    let raw;
    try { raw = atob(b64); } catch { return null; }
    const rows = version === 1 ? 47 : HEIGHT - 1;
    const total = PLOT * PLOT * rows;
    const stride = version === 1 ? 3 : 4;
    const ids = new Uint8Array(PLOT * PLOT * (HEIGHT - 1));
    const metas = new Uint8Array(ids.length);
    let p = 0;
    for (let i = 0; i + stride - 1 < raw.length; i += stride) {
      const id = raw.charCodeAt(i);
      const m = version === 1 ? 0 : raw.charCodeAt(i + 1);
      const run = raw.charCodeAt(i + stride - 2) | (raw.charCodeAt(i + stride - 1) << 8);
      if (id >= BLOCKS.length || !BLOCKS[id] || p + run > total) return null;
      ids.fill(id, p, p + run); metas.fill(m, p, p + run);
      p += run;
    }
    return p === total ? { ids, metas } : null;
  }

  applyPlot(plot, decoded) {
    const { ids, metas } = decoded;
    let p = 0;
    for (let y = 1; y < HEIGHT; y++) for (let z = 0; z < PLOT; z++) for (let x = 0; x < PLOT; x++, p++) {
      this.set(plot.x + x, y, plot.z + z, ids[p], metas[p]);
    }
  }
}

const FULL_BOX = [[0, 0, 0, 1, 1, 1]];

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.slice(i, i + 8192));
  return btoa(s);
}
