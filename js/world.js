// World data: a flat, finite Lagos made of a GRID x GRID set of plots separated by roads.
import { B, BLOCKS } from './blocks.js';

export const PLOT = 32;              // plot edge length in blocks
export const ROAD = 8;               // road width
export const GRID = 4;               // plots per side
export const PITCH = PLOT + ROAD;
export const SIZE = ROAD + GRID * PITCH;   // 168
export const HEIGHT = 48;
export const CHUNK = 16;
export const NCH = Math.ceil(SIZE / CHUNK);

// [row half][col half]; z grows southwards.
const DISTRICTS = [['Ikeja', 'Yaba'], ['Lagos Island', 'Lekki']];
export function districtAt(x, z) {
  return DISTRICTS[z < SIZE / 2 ? 0 : 1][x < SIZE / 2 ? 0 : 1];
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

const OPAQUE = BLOCKS.map((b) => !b.transparent);

export class World {
  constructor() {
    this.data = new Uint8Array(SIZE * HEIGHT * SIZE);
    this.top = new Uint8Array(NCH * NCH);   // highest written y + 1 per chunk column
    this.dirty = new Set();
  }

  index(x, y, z) { return (y * SIZE + z) * SIZE + x; }
  inBounds(x, y, z) { return x >= 0 && z >= 0 && y >= 0 && x < SIZE && z < SIZE && y < HEIGHT; }
  get(x, y, z) { return this.inBounds(x, y, z) ? this.data[(y * SIZE + z) * SIZE + x] : 0; }
  isOpaque(x, y, z) { return OPAQUE[this.get(x, y, z)]; }

  // Collision: the invisible walls at the map edge and the bedrock floor count as solid.
  isSolid(x, y, z) {
    if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || y < 0) return true;
    if (y >= HEIGHT) return false;
    return this.data[(y * SIZE + z) * SIZE + x] !== 0;
  }

  set(x, y, z, id) {
    if (!this.inBounds(x, y, z)) return;
    this.data[(y * SIZE + z) * SIZE + x] = id;
    const cx = x >> 4, cz = z >> 4, k = cz * NCH + cx;
    if (id !== 0 && y + 1 > this.top[k]) this.top[k] = y + 1;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= SIZE || nz >= SIZE) continue;
      this.dirty.add((nz >> 4) * NCH + (nx >> 4));
    }
  }

  fillBox(x0, y0, z0, x1, y1, z1, id) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id);
  }

  markAllDirty() { for (let i = 0; i < NCH * NCH; i++) this.dirty.add(i); }

  // Voxel traversal (Amanatides & Woo). Returns the first solid cell and the face normal we entered through.
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
      if (this.get(x, y, z) !== 0) return { x, y, z, nx, ny, nz };
      if (tMx < tMy && tMx < tMz) { x += sx; t = tMx; tMx += tDx; nx = -sx; ny = 0; nz = 0; }
      else if (tMy < tMz) { y += sy; t = tMy; tMy += tDy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tMz; tMz += tDz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  // ---- persistence of a single plot (everything above the ground layer), run-length encoded
  exportPlot(plot) {
    const bytes = [];
    let prev = -1, run = 0;
    const flush = () => { if (run > 0) bytes.push(prev, run & 255, run >> 8); };
    for (let y = 1; y < HEIGHT; y++) for (let z = 0; z < PLOT; z++) for (let x = 0; x < PLOT; x++) {
      const id = this.data[this.index(plot.x + x, y, plot.z + z)];
      if (id === prev && run < 65535) run++;
      else { flush(); prev = id; run = 1; }
    }
    flush();
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.slice(i, i + 8192));
    return btoa(s);
  }

  importPlot(plot, b64) {
    let raw;
    try { raw = atob(b64); } catch { return false; }
    const total = PLOT * PLOT * (HEIGHT - 1);
    let n = 0;
    for (let i = 0; i + 2 < raw.length; i += 3) {
      if (raw.charCodeAt(i) >= BLOCKS.length) return false;
      n += raw.charCodeAt(i + 1) | (raw.charCodeAt(i + 2) << 8);
    }
    if (n !== total) return false;
    let p = 0;
    for (let i = 0; i + 2 < raw.length; i += 3) {
      const id = raw.charCodeAt(i), run = raw.charCodeAt(i + 1) | (raw.charCodeAt(i + 2) << 8);
      for (let k = 0; k < run; k++, p++) {
        const x = p % PLOT, z = Math.floor(p / PLOT) % PLOT, y = 1 + Math.floor(p / (PLOT * PLOT));
        this.set(plot.x + x, y, plot.z + z, id);
      }
    }
    return true;
  }

  clearPlot(plot) {
    this.fillBox(plot.x, 1, plot.z, plot.x + PLOT - 1, HEIGHT - 1, plot.z + PLOT - 1, B.AIR);
  }
}
