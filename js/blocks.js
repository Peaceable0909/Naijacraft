// Block definitions and the procedural texture atlas.
// All art is generated in code (original to Naijacraft) - no third-party assets.

export const TILE = 16;
export const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'concrete', 'brick', 'planks', 'glass',
  'roof', 'lamp', 'asphalt', 'pavement', 'line_x', 'line_z', 'white', 'red',
  'blue', 'green', 'yellow', 'orange', 'log_side', 'log_top', 'leaves', 'sand',
  'wet_sand', 'water', 'thatch', 'mud_brick', 'zinc', 'ankara_orange', 'ankara_green', 'ankara_red',
  'adire', 'flag', 'tiles', 'marble', 'bookshelf', 'generator', 'generator_top', 'solar_top',
  'solar_side', 'black', 'pink', 'purple', 'beige', 'neon_pink', 'neon_cyan', 'tall_grass',
  'hibiscus', 'yellow_flower', 'fern', 'door_bottom', 'door_top', 'palm_leaves', 'tank_side', 'tank_top',
];
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = Math.ceil(TILE_NAMES.length / ATLAS_COLS);
export const T = Object.fromEntries(TILE_NAMES.map((n, i) => [n, i]));

// Block ids are persisted in saves and share codes, so never reorder - only append.
export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, CONCRETE: 4, BRICK: 5, PLANKS: 6, GLASS: 7,
  ROOF: 8, LAMP: 9, ASPHALT: 10, PAVEMENT: 11, LINE_X: 12, LINE_Z: 13, WHITE: 14,
  RED: 15, BLUE: 16, GREEN: 17, YELLOW: 18, ORANGE: 19, LOG: 20, LEAVES: 21,
  SAND: 22, WET_SAND: 23, WATER: 24, THATCH: 25, MUD_BRICK: 26, ZINC: 27,
  ANKARA_ORANGE: 28, ANKARA_GREEN: 29, ANKARA_RED: 30, ADIRE: 31, FLAG: 32, TILES: 33,
  MARBLE: 34, BOOKSHELF: 35, GENERATOR: 36, SOLAR: 37, BLACK: 38, PINK: 39, PURPLE: 40,
  BEIGE: 41, NEON_PINK: 42, NEON_CYAN: 43, TALL_GRASS: 44, HIBISCUS: 45, YELLOW_FLOWER: 46,
  FERN: 47, PLANK_SLAB: 48, CONCRETE_SLAB: 49, BRICK_SLAB: 50, PLANK_STAIRS: 51,
  CONCRETE_STAIRS: 52, BRICK_STAIRS: 53, DOOR: 54, PALM_LEAVES: 55, TANK: 56,
  ZINC_SLAB: 57, ZINC_STAIRS: 58,
};

// render: cube | water | cross (plants) | slab | stairs | door
// opaque: hides neighbouring faces and blocks light. solid: the player collides with it.
export const BLOCKS = [];
function def(id, name, tiles, opts = {}) {
  const [top, side, bottom] = Array.isArray(tiles) ? tiles : [tiles, tiles, tiles];
  const render = opts.render || 'cube';
  const transparent = !!opts.transparent;
  BLOCKS[id] = {
    id, name, top: T[top], side: T[side], bottom: T[bottom ?? side], render, transparent,
    opaque: opts.opaque ?? (render === 'cube' && !transparent),
    solid: opts.solid ?? (render !== 'cross' && render !== 'water'),
    light: opts.light || 0,
    placeable: opts.placeable ?? true,
    sound: opts.sound || 'stone',
  };
}
BLOCKS[B.AIR] = { id: 0, name: 'Air', top: 0, side: 0, bottom: 0, render: 'none', transparent: true, opaque: false, solid: false, light: 0, placeable: false, sound: 'stone' };
def(B.GRASS, 'Grass', ['grass_top', 'grass_side', 'dirt'], { sound: 'soft' });
def(B.DIRT, 'Dirt', 'dirt', { sound: 'soft' });
def(B.STONE, 'Stone', 'stone');
def(B.CONCRETE, 'Concrete', 'concrete');
def(B.BRICK, 'Brick', 'brick');
def(B.PLANKS, 'Wood Planks', 'planks', { sound: 'wood' });
def(B.GLASS, 'Glass', 'glass', { transparent: true, sound: 'glass' });
def(B.ROOF, 'Roof Tile', 'roof');
def(B.LAMP, 'Lamp', 'lamp', { light: 15, sound: 'glass' });
def(B.ASPHALT, 'Asphalt', 'asphalt', { placeable: false });
def(B.PAVEMENT, 'Pavement', 'pavement');
def(B.LINE_X, 'Road Line', ['line_x', 'asphalt', 'asphalt'], { placeable: false });
def(B.LINE_Z, 'Road Line', ['line_z', 'asphalt', 'asphalt'], { placeable: false });
def(B.WHITE, 'White Paint', 'white');
def(B.RED, 'Red Paint', 'red');
def(B.BLUE, 'Blue Paint', 'blue');
def(B.GREEN, 'Green Paint', 'green');
def(B.YELLOW, 'Yellow Paint', 'yellow');
def(B.ORANGE, 'Orange Paint', 'orange');
def(B.LOG, 'Log', ['log_top', 'log_side', 'log_top'], { sound: 'wood' });
def(B.LEAVES, 'Leaves', 'leaves', { sound: 'soft' });
def(B.SAND, 'Sand', 'sand', { sound: 'soft' });
def(B.WET_SAND, 'Wet Sand', 'wet_sand', { placeable: false, sound: 'soft' });
def(B.WATER, 'Water', 'water', { render: 'water', transparent: true, sound: 'water' });
def(B.THATCH, 'Thatch', 'thatch', { sound: 'soft' });
def(B.MUD_BRICK, 'Mud Brick', 'mud_brick', { sound: 'soft' });
def(B.ZINC, 'Zinc Roofing', 'zinc', { sound: 'metal' });
def(B.ANKARA_ORANGE, 'Ankara Sunset', 'ankara_orange', { sound: 'soft' });
def(B.ANKARA_GREEN, 'Ankara Forest', 'ankara_green', { sound: 'soft' });
def(B.ANKARA_RED, 'Ankara Royal', 'ankara_red', { sound: 'soft' });
def(B.ADIRE, 'Adire Indigo', 'adire', { sound: 'soft' });
def(B.FLAG, 'Naija Flag', 'flag', { sound: 'soft' });
def(B.TILES, 'Floor Tiles', 'tiles');
def(B.MARBLE, 'Marble', 'marble');
def(B.BOOKSHELF, 'Bookshelf', ['planks', 'bookshelf', 'planks'], { sound: 'wood' });
def(B.GENERATOR, 'Generator', ['generator_top', 'generator', 'generator_top'], { sound: 'metal' });
def(B.SOLAR, 'Solar Panel', ['solar_top', 'solar_side', 'solar_side'], { sound: 'metal' });
def(B.BLACK, 'Black Paint', 'black');
def(B.PINK, 'Pink Paint', 'pink');
def(B.PURPLE, 'Purple Paint', 'purple');
def(B.BEIGE, 'Beige Paint', 'beige');
def(B.NEON_PINK, 'Neon Pink', 'neon_pink', { light: 14, sound: 'glass' });
def(B.NEON_CYAN, 'Neon Cyan', 'neon_cyan', { light: 14, sound: 'glass' });
def(B.TALL_GRASS, 'Tall Grass', 'tall_grass', { render: 'cross', sound: 'soft' });
def(B.HIBISCUS, 'Hibiscus', 'hibiscus', { render: 'cross', sound: 'soft' });
def(B.YELLOW_FLOWER, 'Allamanda', 'yellow_flower', { render: 'cross', sound: 'soft' });
def(B.FERN, 'Fern', 'fern', { render: 'cross', sound: 'soft' });
def(B.PLANK_SLAB, 'Wood Slab', 'planks', { render: 'slab', sound: 'wood' });
def(B.CONCRETE_SLAB, 'Concrete Slab', 'concrete', { render: 'slab' });
def(B.BRICK_SLAB, 'Brick Slab', 'brick', { render: 'slab' });
def(B.PLANK_STAIRS, 'Wood Stairs', 'planks', { render: 'stairs', sound: 'wood' });
def(B.CONCRETE_STAIRS, 'Concrete Stairs', 'concrete', { render: 'stairs' });
def(B.BRICK_STAIRS, 'Brick Stairs', 'brick', { render: 'stairs' });
def(B.DOOR, 'Wooden Door', ['door_top', 'door_bottom', 'door_bottom'], { render: 'door', sound: 'wood' });
def(B.PALM_LEAVES, 'Palm Fronds', 'palm_leaves', { sound: 'soft' });
def(B.TANK, 'Water Tank', ['tank_top', 'tank_side', 'tank_top'], { sound: 'metal' });
def(B.ZINC_SLAB, 'Zinc Slab', 'zinc', { render: 'slab', sound: 'metal' });
def(B.ZINC_STAIRS, 'Zinc Stairs', 'zinc', { render: 'stairs', sound: 'metal' });

export const OPAQUE = BLOCKS.map((b) => b.opaque);
export const SOLID = BLOCKS.map((b) => b.solid);
export const EMIT = BLOCKS.map((b) => b.light);

// Inventory tabs. Blueprints are added by the UI.
export const CATEGORIES = [
  { name: 'Building', blocks: [B.CONCRETE, B.BRICK, B.PLANKS, B.GLASS, B.ROOF, B.ZINC, B.THATCH, B.MUD_BRICK, B.STONE, B.MARBLE, B.TILES, B.PAVEMENT, B.LOG, B.TANK, B.SAND, B.DIRT] },
  { name: 'Colours & Fabrics', blocks: [B.WHITE, B.BLACK, B.RED, B.ORANGE, B.YELLOW, B.GREEN, B.BLUE, B.PURPLE, B.PINK, B.BEIGE, B.ANKARA_ORANGE, B.ANKARA_GREEN, B.ANKARA_RED, B.ADIRE, B.FLAG] },
  { name: 'Nature', blocks: [B.GRASS, B.LEAVES, B.PALM_LEAVES, B.LOG, B.TALL_GRASS, B.HIBISCUS, B.YELLOW_FLOWER, B.FERN, B.WATER, B.SAND, B.DIRT] },
  { name: 'Lights & Deco', blocks: [B.LAMP, B.NEON_PINK, B.NEON_CYAN, B.BOOKSHELF, B.GENERATOR, B.SOLAR, B.TANK, B.DOOR] },
  { name: 'Shapes', blocks: [B.PLANK_SLAB, B.CONCRETE_SLAB, B.BRICK_SLAB, B.ZINC_SLAB, B.PLANK_STAIRS, B.CONCRETE_STAIRS, B.BRICK_STAIRS, B.ZINC_STAIRS, B.DOOR] },
];
export const FABRICS = [B.ANKARA_ORANGE, B.ANKARA_GREEN, B.ANKARA_RED, B.ADIRE];
export const DEFAULT_HOTBAR = [B.CONCRETE, B.BRICK, B.PLANKS, B.GLASS, B.ZINC, B.DOOR, B.LAMP, B.ANKARA_ORANGE, B.HIBISCUS];

// ---------------------------------------------------------------- shapes

const FULL = [[0, 0, 0, 1, 1, 1]];
const DOOR_T = 0.1875;
// facing: 0 north (-z), 1 east (+x), 2 south (+z), 3 west (-x)
const STAIR_TOP = [[0, 0.5, 0, 1, 1, 0.5], [0.5, 0.5, 0, 1, 1, 1], [0, 0.5, 0.5, 1, 1, 1], [0, 0.5, 0, 0.5, 1, 1]];
const DOOR_CLOSED = [[0, 0, 0, 1, 1, DOOR_T], [1 - DOOR_T, 0, 0, 1, 1, 1], [0, 0, 1 - DOOR_T, 1, 1, 1], [0, 0, 0, DOOR_T, 1, 1]];
const DOOR_OPEN = [[0, 0, 0, DOOR_T, 1, 1], [0, 0, 0, 1, 1, DOOR_T], [1 - DOOR_T, 0, 0, 1, 1, 1], [0, 0, 1 - DOOR_T, 1, 1, 1]];

// Meta bits - slab: 1 = top half. stairs: 0-1 facing. door: 0-1 facing, 4 = open, 8 = upper half.
export function shapeBoxes(id, meta) {
  switch (BLOCKS[id].render) {
    case 'slab': return meta & 1 ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
    case 'stairs': return [[0, 0, 0, 1, 0.5, 1], STAIR_TOP[meta & 3]];
    case 'door': return [(meta & 4 ? DOOR_OPEN : DOOR_CLOSED)[meta & 3]];
    default: return FULL;
  }
}

// ---------------------------------------------------------------- texture atlas

export function mulberry32(seed) {
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
function pixels(fn) { // fn(x, y, rand) -> [r,g,b] or [r,g,b,a] or null (transparent)
  return (c, ox, oy, rand) => {
    c.clearRect(ox, oy, TILE, TILE);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const p = fn(x, y, rand);
      if (p) put(c, ox + x, oy + y, p[0], p[1], p[2], p[3] ?? 1);
    }
  };
}
const jit = (rand, a) => (rand() - 0.5) * 2 * a;
function flat(base) {
  return pixels((x, y, r) => {
    const k = x === TILE - 1 || y === TILE - 1 ? 0.88 : 1;
    const n = jit(r, 5);
    return [base[0] * k + n, base[1] * k + n, base[2] * k + n];
  });
}
// Draws a plant (cross sprite) on a transparent tile.
function plant(draw) {
  return (c, ox, oy, rand) => {
    c.clearRect(ox, oy, TILE, TILE);
    draw((x, y, col) => { if (x >= 0 && y >= 0 && x < TILE && y < TILE) put(c, ox + x, oy + y, col[0], col[1], col[2]); }, rand);
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
  concrete: pixels((x, y, r) => {
    const n = jit(r, 7);
    return x === 15 || y === 15 ? [150, 150, 148] : [176 + n, 176 + n, 172 + n];
  }),
  brick: pixels((x, y, r) => {
    const off = ((y >> 2) % 2) * 4;
    if (y % 4 === 3 || (x + off) % 8 === 7) return [196, 184, 168];
    const n = jit(r, 12); return [168 + n, 78 + n * 0.6, 58 + n * 0.5];
  }),
  planks: pixels((x, y, r) => {
    if (y % 4 === 3) return [128, 90, 52];
    const n = jit(r, 5) + ((y >> 2) * 37 % 13) - 6; return [178 + n, 134 + n, 82 + n];
  }),
  glass: pixels((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [205, 232, 242, 0.95];
    if ((x === 3 && y >= 3 && y <= 6) || (x === 4 && y >= 4 && y <= 5) || (x === 5 && y === 4)) return [255, 255, 255, 0.7];
    return [170, 215, 235, 0.32];
  }),
  roof: pixels((x, y, r) => {
    const n = jit(r, 8);
    if (y % 4 === 3) return [128, 54, 34];
    if ((x + ((y >> 2) % 2) * 4) % 8 === 7) return [150, 64, 40];
    return [182 + n, 84 + n * 0.6, 50 + n * 0.4];
  }),
  lamp: pixels((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [214, 160, 60];
    if (x === 7 || x === 8 || y === 7 || y === 8) return [255, 246, 200];
    return [255, 226, 140];
  }),
  asphalt(c, ox, oy, r) {
    noiseFill(c, ox, oy, [54, 56, 60], 6, r);
    for (let i = 0; i < 6; i++) put(c, ox + (r() * 16 | 0), oy + (r() * 16 | 0), 88, 90, 94);
  },
  pavement: pixels((x, y, r) => {
    if (x % 8 === 7 || y % 8 === 7) return [120, 116, 110];
    const n = jit(r, 5); return [156 + n, 152 + n, 144 + n];
  }),
  line_z: pixels((x, y, r) => (x >= 6 && x < 10 ? [236, 196, 40] : [54 + jit(r, 6), 56, 60])),
  line_x: pixels((x, y, r) => (y >= 6 && y < 10 ? [236, 196, 40] : [54 + jit(r, 6), 56, 60])),
  white: flat([236, 236, 232]),
  red: flat([196, 48, 44]),
  blue: flat([48, 92, 180]),
  green: flat([52, 148, 72]),
  yellow: flat([238, 198, 52]),
  orange: flat([232, 126, 40]),
  black: flat([34, 34, 38]),
  pink: flat([236, 122, 172]),
  purple: flat([128, 72, 170]),
  beige: flat([222, 200, 160]),
  log_side(c, ox, oy, r) {
    for (let x = 0; x < TILE; x++) {
      const streak = (r() - 0.5) * 28;
      for (let y = 0; y < TILE; y++) { const n = streak + (r() - 0.5) * 8; put(c, ox + x, oy + y, 104 + n, 74 + n, 44 + n); }
    }
  },
  log_top: pixels((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) return [104, 74, 44];
    return Math.floor(d) % 2 === 0 ? [150, 112, 70] : [126, 92, 56];
  }),
  leaves(c, ox, oy, r) {
    noiseFill(c, ox, oy, [56, 138, 52], 22, r);
    for (let i = 0; i < 40; i++) put(c, ox + (r() * 16 | 0), oy + (r() * 16 | 0), 30, 96, 36);
  },
  palm_leaves: pixels((x, y, r) => {
    const n = jit(r, 14);
    if ((x - y + 32) % 5 === 0) return [128, 196, 72];
    if ((x + y) % 7 === 0) return [44, 110, 40];
    return [72 + n, 152 + n, 52 + n];
  }),
  sand: pixels((x, y, r) => { const n = jit(r, 10); return r() < 0.06 ? [240, 226, 180] : [219 + n, 196 + n, 140 + n]; }),
  wet_sand: pixels((x, y, r) => { const n = jit(r, 8); return [170 + n, 145 + n, 100 + n]; }),
  water: pixels((x, y, r) => {
    if ((y === 4 && x > 2 && x < 9) || (y === 11 && x > 7 && x < 14)) return [170, 215, 240, 0.8];
    const n = jit(r, 8); return [40 + n, 112 + n, 178 + n, 0.72];
  }),
  thatch: pixels((x, y, r) => {
    const n = jit(r, 14);
    if ((x + y * 2) % 5 === 0) return [150, 112, 50];
    return [200 + n, 162 + n, 82 + n * 0.6];
  }),
  mud_brick: pixels((x, y, r) => {
    const off = ((y >> 3) % 2) * 8;
    if (y % 8 === 7 || (x + off) % 16 === 15) return [118, 72, 44];
    const n = jit(r, 12); return [164 + n, 104 + n * 0.8, 64 + n * 0.6];
  }),
  zinc: pixels((x, y, r) => {
    const n = jit(r, 5);
    if (r() < 0.03) return [168, 92, 44];
    return x % 4 < 2 ? [196 + n, 200 + n, 206 + n] : [138 + n, 144 + n, 152 + n];
  }),
  ankara_orange: pixels((x, y, r) => {
    const cell = (cx, cy) => Math.hypot(x - cx, y - cy);
    const d1 = Math.min(cell(4, 4), cell(12, 12), cell(-4, 12), cell(12, -4), cell(20, 4), cell(4, 20));
    const d2 = Math.min(cell(12, 4), cell(4, 12));
    if (d1 < 1.6) return [250, 212, 60];
    if (d1 < 3.3) return [30, 70, 170];
    if (d2 < 1.8) return [36, 140, 70];
    const n = jit(r, 6); return [232 + n, 120 + n, 30];
  }),
  ankara_green: pixels((x, y, r) => {
    const v = (y + Math.abs((x % 8) - 4)) % 8;
    if (v < 2) return [245, 200, 40];
    if (v === 4 && x % 2 === 0) return [200, 40, 40];
    const n = jit(r, 6); return [20 + n, 118 + n, 70 + n];
  }),
  ankara_red: pixels((x, y, r) => {
    const d = Math.abs((x % 8) - 4) + Math.abs((y % 8) - 4);
    if (d <= 1) return [240, 230, 210];
    if (d === 3) return [24, 22, 22];
    const n = jit(r, 6); return [190 + n, 32 + n, 42 + n];
  }),
  adire: pixels((x, y, r) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    const n = jit(r, 10);
    if (Math.floor(d) % 3 === 0 && d < 8) return [176, 194, 232];
    if ((x === 0 || x === 15) && (y === 0 || y === 15)) return [220, 230, 250];
    return [32 + n, 52 + n, 112 + n];
  }),
  flag: pixels((x, y, r) => { const n = jit(r, 4); return x > 4 && x < 11 ? [244 + n, 244 + n, 240 + n] : [0, 135 + n, 81 + n]; }),
  tiles: pixels((x, y) => {
    if (x % 4 === 3 || y % 4 === 3) return [204, 194, 172];
    return ((x >> 2) + (y >> 2)) % 2 ? [190, 96, 60] : [234, 222, 198];
  }),
  marble(c, ox, oy, r) {
    noiseFill(c, ox, oy, [232, 232, 228], 4, r);
    for (let v = 0; v < 2; v++) {
      let x = r() * 16, y = 0;
      while (y < 16) { put(c, ox + (x | 0), oy + y, 168, 168, 176); x = (x + (r() - 0.4) * 2 + 16) % 16; y++; }
    }
  },
  bookshelf: pixels((x, y, r) => {
    if (y === 0 || y === 15 || y === 7 || y === 8 || x === 0 || x === 15) return [150, 105, 60];
    const books = [[170, 40, 40], [40, 90, 160], [40, 130, 70], [210, 170, 50], [120, 60, 140], [230, 230, 220]];
    const b = books[(x * 7 + (y < 8 ? 3 : 11)) % books.length];
    if ((y === 1 || y === 9) && x % 3 === 0) return [80, 56, 32];
    return [b[0] + jit(r, 6), b[1], b[2]];
  }),
  generator: pixels((x, y) => {
    if (x === 0 || x === 15 || y === 0 || y >= 13) return [60, 60, 64];
    if (x >= 2 && x <= 9 && y >= 3 && y <= 10) return y % 2 === 0 ? [44, 44, 48] : [210, 172, 36];
    if (x >= 11 && x <= 14 && y >= 3 && y <= 9) {
      if (x === 12 && y === 5) return [220, 40, 40];
      if (x === 13 && y === 7) return [40, 200, 80];
      return [120, 120, 124];
    }
    return [232, 192, 42];
  }),
  generator_top: pixels((x, y, r) => {
    if (Math.hypot(x - 11, y - 5) < 2) return [24, 24, 26];
    if ((y === 9 || y === 10) && x > 1 && x < 14) return [50, 50, 54];
    const n = jit(r, 6); return [110 + n, 110 + n, 114 + n];
  }),
  solar_top: pixels((x, y) => {
    if (x % 4 === 0 || y % 4 === 0) return [170, 180, 190];
    return (x + y) % 9 === 0 ? [60, 90, 150] : [22, 42, 94];
  }),
  solar_side: pixels((x, y, r) => { const n = jit(r, 4); return y < 4 ? [80, 90, 110] : [150 + n, 150 + n, 156 + n]; }),
  neon_pink: pixels((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [255, 50, 150];
    if (x === 7 || x === 8 || y === 7 || y === 8) return [255, 214, 236];
    return [255, 96, 178];
  }),
  neon_cyan: pixels((x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [20, 190, 220];
    if (x === 7 || x === 8 || y === 7 || y === 8) return [214, 255, 255];
    return [70, 232, 244];
  }),
  tall_grass: plant((p, r) => {
    for (let k = 0; k < 10; k++) {
      const x0 = 1 + (r() * 14 | 0), h = 6 + (r() * 9 | 0), lean = (r() - 0.5) * 0.4;
      const g = [60 + (r() * 40 | 0), 150 + (r() * 40 | 0), 40];
      for (let i = 0; i < h; i++) p(Math.round(x0 + lean * i), 15 - i, g);
    }
  }),
  hibiscus: plant((p, r) => {
    for (let y = 7; y < 16; y++) p(8, y, [50, 120, 40]);
    for (const [cx, cy] of [[5, 11], [11, 10], [6, 14]]) for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) < 3) p(cx + dx, cy + dy, [56 + (r() * 30 | 0), 140, 50]);
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.hypot(dx, dy);
      if (d < 1.2) p(8 + dx, 5 + dy, [250, 220, 80]);
      else if (d < 3.8) p(8 + dx, 5 + dy, [220 + (r() * 30 | 0), 30, 50]);
    }
  }),
  yellow_flower: plant((p, r) => {
    for (const [fx, fy, sy] of [[5, 5, 7], [11, 8, 10]]) {
      for (let y = sy; y < 16; y++) p(fx, y, [50, 120, 40]);
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < 1) p(fx + dx, fy + dy, [220, 120, 30]);
        else if (d < 2.9) p(fx + dx, fy + dy, [250, 206 + (r() * 30 | 0), 40]);
      }
    }
    for (let x = 3; x < 13; x++) p(x, 13 + (x % 3 === 0 ? 0 : 1), [60, 140, 50]);
  }),
  fern: plant((p) => {
    for (const [dir, len] of [[-1, 7], [1, 7], [-1, 5], [1, 5], [0, 9]]) {
      for (let i = 0; i < len; i++) {
        const x = 8 + Math.round(dir * i * 0.8), y = 15 - Math.round(i * (dir === 0 ? 1.4 : 1));
        p(x, y, [40, 130, 50]);
        if (i % 2 === 0) { p(x - 1, y, [60, 160, 60]); p(x + 1, y, [60, 160, 60]); }
      }
    }
  }),
  door_bottom: pixels((x, y, r) => {
    if (x === 0 || x === 15 || y === 15) return [110, 72, 38];
    if (x >= 12 && x <= 13 && y >= 1 && y <= 2) return [232, 192, 60];
    if ((x === 3 || x === 12) && y >= 2 && y <= 12) return [128, 86, 46];
    if ((y === 2 || y === 12) && x >= 3 && x <= 12) return [128, 86, 46];
    const n = jit(r, 6) + (x % 4 === 0 ? -10 : 0); return [166 + n, 114 + n, 62 + n];
  }),
  door_top: pixels((x, y, r) => {
    if (x === 0 || x === 15 || y === 0) return [110, 72, 38];
    if (x >= 3 && x <= 12 && y >= 3 && y <= 11) return x === 7 || x === 8 || y === 7 ? [128, 86, 46] : [170, 210, 230];
    const n = jit(r, 6) + (x % 4 === 0 ? -10 : 0); return [166 + n, 114 + n, 62 + n];
  }),
  tank_side: pixels((x, y) => {
    if (y === 4 || y === 11) return [64, 64, 68];
    return x % 4 === 0 ? [54, 54, 58] : [28, 28, 31];
  }),
  tank_top: pixels((x, y) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < 1.2) return [90, 90, 94];
    if (d < 4.5) return [58, 58, 62];
    return [28, 28, 31];
  }),
};

export function createAtlasCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE;
  canvas.height = ATLAS_ROWS * TILE;
  const c = canvas.getContext('2d', { willReadFrequently: true });
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

// Average colour of a tile (for the minimap).
export function tileAverages(atlas) {
  const g = atlas.getContext('2d', { willReadFrequently: true });
  const out = [];
  for (let i = 0; i < TILE_NAMES.length; i++) {
    const ox = (i % ATLAS_COLS) * TILE, oy = Math.floor(i / ATLAS_COLS) * TILE;
    const d = g.getImageData(ox, oy, TILE, TILE).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let k = 0; k < d.length; k += 4) if (d[k + 3] > 40) { r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++; }
    out.push(n ? [r / n, gg / n, b / n] : [0, 0, 0]);
  }
  return out;
}
