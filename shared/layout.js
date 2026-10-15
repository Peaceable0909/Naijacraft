// World layout shared by the browser client and the Cloudflare Worker.
// Pure data and functions: no DOM, no Babylon, no Worker APIs.

export const PLOT = 32;                        // plot edge length in blocks
export const ROAD = 8;                         // road width
export const GRID = 8;                         // plots per side
export const PITCH = PLOT + ROAD;              // 40
export const CITY = ROAD + GRID * PITCH;       // 328: the walled city
export const BEACH = 28;                       // sand strip south of the city
export const SX = CITY;
export const SZ = CITY + BEACH;                // 356
export const HEIGHT = 64;
export const PLOT_ROWS = HEIGHT - 1;           // buildable rows per plot (y = 1..63)
export const PLOT_CELLS = PLOT * PLOT * PLOT_ROWS;   // 64,512

// Highest valid block id and the ids players can never place. Append-only, like the block registry
// (a test keeps these in sync with js/blocks.js).
export const MAX_BLOCK_ID = 67;
export const NON_PLACEABLE = [10, 12, 13, 23];

// Orientation. The 3D view is left-handed (as in Babylon.js): looking north (-z), +x is on your LEFT. So that the maps
// match what you see, plots are numbered from the north-west corner at the HIGH-x side, and every 2D map draws
// x mirrored (see mapX). Plot 1 is the top-left of every map, and numbers read like a page, left to right.
export const mapX = (x) => SX - x;

export const DISTRICT_NAMES = [
  ['Ikeja', 'Yaba', 'Surulere', 'Apapa'],
  ['Lagos Island', 'Ikoyi', 'Victoria Island', 'Lekki'],
];

// Districts are 2 plot columns wide and 4 plot rows tall; the beach is its own place.
export function districtAt(x, z) {
  if (z >= CITY) return 'Bar Beach';
  const col = 3 - Math.max(0, Math.min(3, Math.floor(x / (CITY / 4))));
  return DISTRICT_NAMES[z < CITY / 2 ? 0 : 1][col];
}

// Column 0 is the left-most column on the map, which is the high-x side of the world.
export function plotOrigin(col, row) {
  return { x: ROAD + (GRID - 1 - col) * PITCH, z: ROAD + row * PITCH };
}

// Plots that are not free land: landmarks and show homes, keyed by plot number.
// kind: house | shop | tower | market | park | landmark.  owner: a show-home "resident" name.
const SPECIAL = {
  9: { kind: 'market', style: 'bazaar', name: 'Computer Village' },
  2: { kind: 'house', style: 'bungalow', owner: 'Adaeze' },
  11: { kind: 'landmark', style: 'techhub', name: 'Yaba Tech Hub' },
  20: { kind: 'house', style: 'villa', owner: 'Tunde' },
  13: { kind: 'landmark', style: 'stadium', name: 'Teslim Balogun Stadium' },
  22: { kind: 'landmark', style: 'theatre', name: 'National Theatre' },
  29: { kind: 'house', style: 'bungalow', owner: 'Bisi' },
  8: { kind: 'landmark', style: 'port', name: 'Apapa Port' },
  23: { kind: 'house', style: 'duplex', owner: 'Chidi' },
  33: { kind: 'park', style: 'fountain', name: 'Freedom Park' },
  42: { kind: 'market', style: 'bazaar', name: 'Balogun Market' },
  58: { kind: 'house', style: 'villa', owner: 'Zainab' },
  44: { kind: 'tower', style: 'office', owner: 'Emeka' },
  62: { kind: 'landmark', style: 'towers', name: 'Eko Atlantic' },
  46: { kind: 'shop', style: 'boutique', owner: 'Ngozi' },
  48: { kind: 'park', style: 'conservation', name: 'Lekki Conservation Centre' },
  63: { kind: 'house', style: 'duplex', owner: 'Funmi' },
};

function makePlot(number) {
  const col = (number - 1) % GRID, row = Math.floor((number - 1) / GRID);
  const o = plotOrigin(col, row);
  const s = SPECIAL[number];
  return {
    number, col, row, x: o.x, z: o.z,
    kind: s ? s.kind : 'free',
    style: s ? s.style : null,
    owner: s && s.owner ? s.owner : null,    // show-home resident (decor), not a player
    name: s && s.name ? s.name : null,
    claimable: !s,
    district: districtAt(o.x + PLOT / 2, o.z + PLOT / 2),
  };
}

export const PLOTS = Array.from({ length: GRID * GRID }, (_, i) => makePlot(i + 1));
export const CLAIMABLE_COUNT = PLOTS.filter((p) => p.claimable).length;

export function plotByNumber(n) {
  return Number.isInteger(n) && n >= 1 && n <= PLOTS.length ? PLOTS[n - 1] : null;
}

// Which plot (if any) contains the block column (x, z)?
export function plotAt(x, z) {
  x = Math.floor(x); z = Math.floor(z);
  const lx = x - ROAD, lz = z - ROAD;
  if (lx < 0 || lz < 0) return null;
  const xc = Math.floor(lx / PITCH), row = Math.floor(lz / PITCH);
  if (xc >= GRID || row >= GRID) return null;
  if (lx - xc * PITCH >= PLOT || lz - row * PITCH >= PLOT) return null;
  return PLOTS[row * GRID + (GRID - 1 - xc)];
}

// Free plots ordered by distance from the central plaza: the first one is the "best" land left.
export function claimOrder() {
  const c = CITY / 2;
  const dist = (p) => Math.hypot(p.x + PLOT / 2 - c, p.z + PLOT / 2 - c);
  return PLOTS.filter((p) => p.claimable).sort((a, b) => dist(a) - dist(b) || a.number - b.number);
}

// Where to stand to look at a plot's front: the pavement just south of its centre (two blocks east of the mid-block lamp post).
export function plotFront(plot) {
  return { x: plot.x + PLOT / 2 + 2.5, y: 1, z: plot.z + PLOT + 0.5, yaw: Math.PI };
}

export const SPAWN = { x: CITY / 2, y: 1, z: CITY / 2 + 11, yaw: Math.PI, pitch: 0.12 };
export const OFFLINE_PLOT = 28;   // the free plot next to the plaza that offline players use

// Index of a cell inside a plot's flat arrays: y-major from y = 1, then z, then x.
export function cellIndex(px, y, pz) {
  return ((y - 1) * PLOT + pz) * PLOT + px;
}
