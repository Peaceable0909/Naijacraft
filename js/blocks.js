// Block definitions and the procedural texture atlas.
// All art is generated in code (original to Naijacraft) - no third-party assets.

export const TILE = 16;
export const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'concrete', 'brick', 'planks', 'glass',
  'roof', 'lamp', 'asphalt', 'pavement', 'line_x', 'line_z', 'white', 'red',
  'blue', 'green', 'yellow', 'orange', 'log_side', 'log_top', 'leaves',
];
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = Math.ceil(TILE_NAMES.length / ATLAS_COLS);
export const T = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i]));

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, CONCRETE: 4, BRICK: 5, PLANKS: 6, GLASS: 7,
  ROOF: 8, LAMP: 9, ASPHALT: 10, PAVEMENT: 11, LINE_X: 12, LINE_Z: 13, WHITE: 14,
  RED: 15, BLUE: 16, GREEN: 17, YELLOW: 18, ORANGE: 19, LOG: 20, LEAVES: 21,
};

// Block ids are persisted in saves, so never reorder - only append.
export const BLOCKS = [];
function def(id, name, top, side = top, bottom = side, opts = {}) {
  BLOCKS[id] = { id, name, top: T[top], side: T[side], bottom: T[bottom], transparent: false, fullbright: false, ...opts };
}
BLOCKS[B.AIR] = { id: 0, name: 'Air', top: 0, side: 0, bottom: 0, transparent: true, fullbright: false };
def(B.GRASS, 'Grass', 'grass_top', 'grass_side', 'dirt');
def(B.DIRT, 'Dirt', 'dirt');
def(B.STONE, 'Stone', 'stone');
def(B.CONCRETE, 'Concrete', 'concrete');
def(B.BRICK, 'Brick', 'brick');
def(B.PLANKS, 'Wood Planks', 'planks');
def(B.GLASS, 'Glass', 'glass', 'glass', 'glass', { transparent: true });
def(B.ROOF, 'Roof Tile', 'roof');
def(B.LAMP, 'Lamp', 'lamp', 'lamp', 'lamp', { fullbright: true });
def(B.ASPHALT, 'Asphalt', 'asphalt');
def(B.PAVEMENT, 'Pavement', 'pavement');
def(B.LINE_X, 'Road Line', 'line_x', 'asphalt', 'asphalt');
def(B.LINE_Z, 'Road Line', 'line_z', 'asphalt', 'asphalt');
def(B.WHITE, 'White Paint', 'white');
def(B.RED, 'Red Paint', 'red');
def(B.BLUE, 'Blue Paint', 'blue');
def(B.GREEN, 'Green Paint', 'green');
def(B.YELLOW, 'Yellow Paint', 'yellow');
def(B.ORANGE, 'Orange Paint', 'orange');
def(B.LOG, 'Log', 'log_top', 'log_side', 'log_top');
def(B.LEAVES, 'Leaves', 'leaves');

// Blocks players can build with (shown in the inventory).
export const PALETTE = [
  B.CONCRETE, B.BRICK, B.PLANKS, B.GLASS, B.ROOF, B.LAMP,
  B.WHITE, B.RED, B.BLUE, B.GREEN, B.YELLOW, B.ORANGE,
  B.STONE, B.GRASS, B.DIRT, B.LOG, B.LEAVES, B.PAVEMENT,
];
export const DEFAULT_HOTBAR = [B.CONCRETE, B.BRICK, B.PLANKS, B.GLASS, B.ROOF, B.WHITE, B.LAMP, B.STONE, B.GRASS];

// ---------------------------------------------------------------- texture atlas

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
function put(c, x, y, r, g, b, a = 1) {
  c.fillStyle = `rgba(${clamp(r)},${clamp(g)},${clamp(b)},${a})`;
  c.fillRect(x, y, 1, 1);
}
function noiseFill(c, ox, oy, base, amp, rand) {
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const n = (rand() - 0.5) * 2 * amp;
    put(c, ox + x, oy + y, base[0] + n, base[1] + n, base[2] + n);
  }
}
function flat(base) {
  return (c, ox, oy, rand) => {
    noiseFill(c, ox, oy, base, 5, rand);
    for (let i = 0; i < TILE; i++) { // soft edge so blocks read as blocks
      put(c, ox + i, oy + TILE - 1, base[0] * 0.88, base[1] * 0.88, base[2] * 0.88);
      put(c, ox + TILE - 1, oy + i, base[0] * 0.88, base[1] * 0.88, base[2] * 0.88);
    }
  };
}

const PAINT = {
  grass_top(c, ox, oy, r) {
    noiseFill(c, ox, oy, [84, 158, 56], 14, r);
    for (let i = 0; i < 14; i++) put(c, ox + (r() * 16 | 0), oy + (r() * 16 | 0), 60, 128, 40);
  },
  grass_side(c, ox, oy, r) {
    noiseFill(c, ox, oy, [134, 96, 67], 12, r);
    for (let x = 0; x < TILE; x++) {
      const depth = 3 + (r() < 0.4 ? 1 : 0) + (r() < 0.15 ? 1 : 0);
      for (let y = 0; y < depth; y++) { const n = (r() - 0.5) * 24; put(c, ox + x, oy + y, 84 + n, 158 + n, 56 + n); }
    }
  },
  dirt(c, ox, oy, r) {
    noiseFill(c, ox, oy, [134, 96, 67], 12, r);
    for (let i = 0; i < 12; i++) put(c, ox + (r() * 16 | 0), oy + (r() * 16 | 0), 100, 70, 48);
  },
  stone(c, ox, oy, r) {
    noiseFill(c, ox, oy, [128, 128, 130], 14, r);
    for (let i = 0; i < 4; i++) {
      const x = r() * 10 | 0, y = r() * 16 | 0, l = 3 + (r() * 4 | 0);
      for (let k = 0; k < l; k++) put(c, ox + x + k, oy + y, 92, 92, 96);
    }
  },
  concrete(c, ox, oy, r) {
    noiseFill(c, ox, oy, [176, 176, 172], 7, r);
    for (let i = 0; i < TILE; i++) { put(c, ox + i, oy + TILE - 1, 150, 150, 148); put(c, ox + TILE - 1, oy + i, 150, 150, 148); }
  },
  brick(c, ox, oy, r) {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const off = ((y >> 2) % 2) * 4;
      if (y % 4 === 3 || (x + off) % 8 === 7) { put(c, ox + x, oy + y, 196, 184, 168); continue; }
      const n = (r() - 0.5) * 24; put(c, ox + x, oy + y, 168 + n, 78 + n * 0.6, 58 + n * 0.5);
    }
  },
  planks(c, ox, oy, r) {
    for (let y = 0; y < TILE; y++) {
      const rowTone = ((y >> 2) * 37 % 13) - 6;
      for (let x = 0; x < TILE; x++) {
        if (y % 4 === 3) { put(c, ox + x, oy + y, 128, 90, 52); continue; }
        const n = (r() - 0.5) * 10 + rowTone; put(c, ox + x, oy + y, 178 + n, 134 + n, 82 + n);
      }
    }
  },
  glass(c, ox, oy) {
    c.clearRect(ox, oy, TILE, TILE);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
      if (edge) put(c, ox + x, oy + y, 205, 232, 242, 0.95);
      else if ((x === 3 && y >= 3 && y <= 6) || (x === 4 && y >= 4 && y <= 5) || (x === 5 && y === 4)) put(c, ox + x, oy + y, 255, 255, 255, 0.7);
      else put(c, ox + x, oy + y, 170, 215, 235, 0.32);
    }
  },
  roof(c, ox, oy, r) {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const n = (r() - 0.5) * 16;
      if (y % 4 === 3) put(c, ox + x, oy + y, 128, 54, 34);
      else if ((x + ((y >> 2) % 2) * 4) % 8 === 7) put(c, ox + x, oy + y, 150, 64, 40);
      else put(c, ox + x, oy + y, 182 + n, 84 + n * 0.6, 50 + n * 0.4);
    }
  },
  lamp(c, ox, oy) {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
      const cross = x === 7 || x === 8 || y === 7 || y === 8;
      if (edge) put(c, ox + x, oy + y, 214, 160, 60);
      else if (cross) put(c, ox + x, oy + y, 255, 246, 200);
      else put(c, ox + x, oy + y, 255, 226, 140);
    }
  },
  asphalt(c, ox, oy, r) {
    noiseFill(c, ox, oy, [54, 56, 60], 6, r);
    for (let i = 0; i < 6; i++) put(c, ox + (r() * 16 | 0), oy + (r() * 16 | 0), 88, 90, 94);
  },
  pavement(c, ox, oy, r) {
    noiseFill(c, ox, oy, [156, 152, 144], 5, r);
    for (let i = 0; i < TILE; i++) { put(c, ox + 7, oy + i, 120, 116, 110); put(c, ox + i, oy + 7, 120, 116, 110); put(c, ox + 15, oy + i, 120, 116, 110); put(c, ox + i, oy + 15, 120, 116, 110); }
  },
  line_z(c, ox, oy, r) { // bar runs along the vertical axis of the tile (= world z on top faces)
    noiseFill(c, ox, oy, [54, 56, 60], 6, r);
    for (let y = 0; y < TILE; y++) for (let x = 6; x < 10; x++) put(c, ox + x, oy + y, 236, 196, 40);
  },
  line_x(c, ox, oy, r) {
    noiseFill(c, ox, oy, [54, 56, 60], 6, r);
    for (let y = 6; y < 10; y++) for (let x = 0; x < TILE; x++) put(c, ox + x, oy + y, 236, 196, 40);
  },
  white: flat([236, 236, 232]),
  red: flat([196, 48, 44]),
  blue: flat([48, 92, 180]),
  green: flat([52, 148, 72]),
  yellow: flat([238, 198, 52]),
  orange: flat([232, 126, 40]),
  log_side(c, ox, oy, r) {
    for (let x = 0; x < TILE; x++) {
      const streak = (r() - 0.5) * 28;
      for (let y = 0; y < TILE; y++) { const n = streak + (r() - 0.5) * 8; put(c, ox + x, oy + y, 104 + n, 74 + n, 44 + n); }
    }
  },
  log_top(c, ox, oy) {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.5) put(c, ox + x, oy + y, 104, 74, 44);
      else if (Math.floor(d) % 2 === 0) put(c, ox + x, oy + y, 150, 112, 70);
      else put(c, ox + x, oy + y, 126, 92, 56);
    }
  },
  leaves(c, ox, oy, r) {
    noiseFill(c, ox, oy, [56, 138, 52], 22, r);
    for (let i = 0; i < 40; i++) put(c, ox + (r() * 16 | 0), oy + (r() * 16 | 0), 30, 96, 36);
  },
};

export function createAtlasCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE;
  canvas.height = ATLAS_ROWS * TILE;
  const c = canvas.getContext('2d');
  TILE_NAMES.forEach((name, i) => {
    const ox = (i % ATLAS_COLS) * TILE, oy = Math.floor(i / ATLAS_COLS) * TILE;
    PAINT[name](c, ox, oy, mulberry32(1000 + i * 7919));
  });
  return canvas;
}

// UV rectangle for a tile index: [u0, vBottom, u1, vTop], inset half a texel to stop bleeding.
export function tileRect(tile) {
  const col = tile % ATLAS_COLS, row = Math.floor(tile / ATLAS_COLS);
  const eu = 0.5 / (ATLAS_COLS * TILE), ev = 0.5 / (ATLAS_ROWS * TILE);
  return [col / ATLAS_COLS + eu, 1 - (row + 1) / ATLAS_ROWS + ev, (col + 1) / ATLAS_COLS - eu, 1 - row / ATLAS_ROWS - ev];
}
