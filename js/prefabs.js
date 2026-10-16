// Blueprints: ready-made structures players can drop onto their plot, plus helpers to rotate
// structures and draw isometric previews. Structures are { w, h, d, cells: [[x,y,z,id,meta]] }
// with y = 0 being the first layer above the ground.
import { B, BLOCKS, CONNECTING, shapeBoxes, TILE, ATLAS_COLS, T } from './blocks.js';

class Builder {
  constructor() { this.map = new Map(); }
  set(x, y, z, id, meta = 0) {
    const k = `${x},${y},${z}`;
    if (id === B.AIR) this.map.delete(k); else this.map.set(k, [x, y, z, id, meta]);
    return this;
  }
  box(x0, y0, z0, x1, y1, z1, id, meta = 0) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id, meta);
    return this;
  }
  walls(x0, y0, z0, x1, y1, z1, id) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) { this.set(x, y, z0, id); this.set(x, y, z1, id); }
      for (let z = z0; z <= z1; z++) { this.set(x0, y, z, id); this.set(x1, y, z, id); }
    }
    return this;
  }
  door(x, y, z, facing) { return this.set(x, y, z, B.DOOR, facing).set(x, y + 1, z, B.DOOR, facing | 8); }
  // A pitched roof of stairs along x, sloping down to the front (+z) and back (-z).
  pitched(x0, x1, z0, z1, y, id, stairs) {
    for (let k = 0; ; k++) {
      const za = z0 + k, zb = z1 - k;
      if (za > zb) break;
      for (let x = x0; x <= x1; x++) {
        if (za === zb) { this.set(x, y + k, za, id); continue; }
        this.set(x, y + k, za, stairs, 2);     // rises towards the south (ridge)
        this.set(x, y + k, zb, stairs, 0);     // rises towards the north (ridge)
        for (let z = za + 1; z < zb; z++) this.set(x, y + k, z, id);
      }
      if (zb - za <= 1) break;
    }
    return this;
  }
  build(name, description) {
    const cells = [...this.map.values()];
    let mx = 0, my = 0, mz = 0, nx = Infinity, ny = Infinity, nz = Infinity;
    for (const c of cells) { nx = Math.min(nx, c[0]); ny = Math.min(ny, c[1]); nz = Math.min(nz, c[2]); }
    for (const c of cells) { c[0] -= nx; c[1] -= ny; c[2] -= nz; mx = Math.max(mx, c[0]); my = Math.max(my, c[1]); mz = Math.max(mz, c[2]); }
    return { name, description, w: mx + 1, h: my + 1, d: mz + 1, cells };
  }
}

function palm(b, x, z, h = 7) {
  b.box(x, 0, z, x, h - 1, z, B.LOG);
  b.set(x, h, z, B.PALM_LEAVES);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    b.set(x + dx, h, z + dz, B.PALM_LEAVES).set(x + dx * 2, h, z + dz * 2, B.PALM_LEAVES).set(x + dx * 3, h - 1, z + dz * 3, B.PALM_LEAVES);
  }
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) b.set(x + dx, h, z + dz, B.PALM_LEAVES).set(x + dx * 2, h - 1, z + dz * 2, B.PALM_LEAVES);
  return b;
}

function shadeTree(b, x, z, h = 5) {
  b.box(x, 0, z, x, h - 1, z, B.LOG);
  for (let y = h - 2; y <= h; y++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
    if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
    if (dx === 0 && dz === 0 && y < h) continue;
    b.set(x + dx, y, z + dz, B.LEAVES);
  }
  b.box(x - 1, h + 1, z - 1, x + 1, h + 1, z + 1, B.LEAVES);
  b.set(x + 1, h - 1, z + 2, B.ORANGE).set(x - 2, h, z, B.ORANGE); // mangoes!
  return b;
}

function waterTank(b, x, y, z) {
  for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]]) b.box(x + dx, y, z + dz, x + dx, y + 2, z + dz, B.LOG);
  b.box(x, y + 3, z, x + 2, y + 3, z + 2, B.PLANK_SLAB);
  b.box(x, y + 4, z, x + 2, y + 5, z + 2, B.TANK);
  return b;
}

const BLUEPRINTS = [
  () => {
    const b = new Builder();
    b.box(0, 0, 0, 10, 0, 7, B.TILES);
    b.walls(0, 0, 0, 10, 3, 7, B.BRICK);
    for (const x of [2, 3, 7, 8]) { b.box(x, 1, 7, x, 2, 7, B.GLASS); b.box(x, 1, 0, x, 2, 0, B.GLASS); }
    b.box(0, 1, 3, 0, 2, 4, B.GLASS).box(10, 1, 3, 10, 2, 4, B.GLASS);
    b.set(5, 0, 7, B.AIR).door(5, 0, 7, 2);
    b.set(5, 3, 3, B.LAMP).set(1, 0, 1, B.BOOKSHELF).set(1, 1, 1, B.BOOKSHELF);
    b.box(1, 0, 4, 2, 0, 5, B.PLANK_SLAB);
    b.pitched(-1, 11, -1, 8, 4, B.ZINC, B.ZINC_STAIRS);
    b.set(5, 0, 8, B.CONCRETE_SLAB).set(5, 0, 9, B.CONCRETE_SLAB);
    waterTank(b, 12, 0, 0);
    return b.build('Bungalow', 'Brick home with a zinc roof and its own water tank.');
  },
  () => {
    const b = new Builder();
    b.box(0, 0, 0, 8, 0, 6, B.TILES);
    for (const [x, z] of [[0, 0], [8, 0], [0, 6], [8, 6]]) b.box(x, 0, z, x, 3, z, B.LOG);
    b.walls(0, 0, 0, 8, 2, 0, B.PLANKS);
    b.box(1, 0, 1, 7, 0, 1, B.PLANKS);
    b.set(2, 1, 1, B.BLACK).set(4, 1, 1, B.BLACK).set(6, 1, 1, B.ORANGE);
    b.box(1, 0, 4, 3, 0, 4, B.PLANK_SLAB).box(5, 0, 4, 7, 0, 4, B.PLANK_SLAB);
    b.box(-1, 4, -1, 9, 4, 7, B.ZINC_SLAB);
    b.box(1, 3, 6, 7, 3, 6, B.GREEN).set(4, 3, 6, B.WHITE);
    b.set(4, 3, 3, B.LAMP);
    return b.build('Mama Put', 'Open-air canteen with a counter, benches and pots of jollof.');
  },
  () => {
    const b = new Builder();
    b.box(0, 0, 0, 9, 0, 9, B.MARBLE);
    b.walls(0, 0, 0, 9, 3, 9, B.WHITE);
    b.box(0, 4, 0, 9, 4, 9, B.BEIGE);
    b.walls(0, 5, 0, 9, 7, 9, B.WHITE);
    b.box(0, 8, 0, 9, 8, 9, B.BEIGE);
    for (const y of [1, 5]) for (const x of [2, 3, 6, 7]) { b.box(x, y, 9, x, y + 1, 9, B.GLASS); b.box(x, y, 0, x, y + 1, 0, B.GLASS); }
    for (const y of [1, 5]) { b.box(0, y, 4, 0, y + 1, 5, B.GLASS); b.box(9, y, 4, 9, y + 1, 5, B.GLASS); }
    b.door(4, 0, 9, 2).set(5, 0, 9, B.AIR).set(5, 1, 9, B.AIR);
    b.door(5, 0, 9, 2);
    b.door(4, 5, 9, 2);
    b.box(1, 4, 10, 8, 4, 11, B.CONCRETE_SLAB, 1);  // balcony (top slab, level with the floor)
    b.box(1, 5, 11, 8, 5, 11, B.GLASS);
    for (let k = 0; k < 4; k++) b.set(8 - k, k, 2, B.CONCRETE_STAIRS, 3);
    b.box(5, 4, 1, 8, 4, 3, B.AIR);
    b.set(4, 3, 4, B.LAMP).set(4, 7, 4, B.LAMP);
    b.walls(0, 9, 0, 9, 9, 9, B.BEIGE);
    b.box(1, 9, 1, 3, 9, 3, B.SOLAR).box(1, 9, 5, 3, 9, 7, B.SOLAR);
    b.box(6, 9, 6, 7, 10, 7, B.TANK);
    return b.build('Duplex', 'Two-storey family home with a balcony, solar panels and a water tank.');
  },
  () => palm(new Builder(), 3, 3, 7).build('Palm Tree', 'A tall coconut palm.'),
  () => shadeTree(new Builder(), 2, 2, 5).build('Mango Tree', 'Shade tree, fruit included.'),
  () => {
    const b = new Builder();
    b.box(0, 0, 0, 3, 0, 3, B.CONCRETE);
    b.walls(0, 1, 0, 3, 2, 3, B.PLANKS);
    b.box(1, 1, 3, 2, 2, 3, B.AIR);
    b.set(1, 1, 1, B.GENERATOR).set(2, 1, 1, B.GENERATOR);
    b.box(-1, 3, -1, 4, 3, 4, B.ZINC_SLAB);
    return b.build('Generator House', '"I better pass my neighbour." Right-click the generator.');
  },
  () => {
    const b = new Builder();
    b.walls(0, 0, 0, 9, 1, 6, B.TILES);
    b.box(1, 0, 1, 8, 1, 5, B.WATER);
    b.box(-1, 0, -1, 10, 0, -1, B.MARBLE).box(-1, 0, 7, 10, 0, 7, B.MARBLE);
    b.set(4, 0, 8, B.CONCRETE_STAIRS, 0).set(5, 0, 8, B.CONCRETE_STAIRS, 0);
    b.box(11, 0, 1, 11, 2, 1, B.LOG).box(11, 3, 0, 11, 3, 2, B.ANKARA_ORANGE);
    return b.build('Swimming Pool', 'Tiled pool with a sun shade. Jump in and swim!');
  },
  () => {
    const b = new Builder();
    b.walls(0, 0, 0, 6, 0, 6, B.LEAVES);
    b.set(3, 0, 6, B.AIR);                     // gap in the hedge to walk in
    const flowers = [B.HIBISCUS, B.YELLOW_FLOWER, B.FERN, B.TALL_GRASS];
    let k = 0;
    for (let z = 1; z <= 5; z++) for (const x of [1, 2, 4, 5]) b.set(x, 0, z, flowers[(k++ * 7 + z) % flowers.length]);
    b.set(3, 0, 1, B.LAMP);
    return b.build('Flower Garden', 'Hibiscus, allamanda and ferns with a hedge.');
  },
  () => {
    const b = new Builder();
    for (let z = 0; z <= 4; z++) for (let x = 0; x <= 4; x++) {
      const corner = (x === 0 || x === 4) && (z === 0 || z === 4);
      const edge = x === 0 || x === 4 || z === 0 || z === 4;
      if (!corner && edge) b.box(x, 0, z, x, 2, z, B.MUD_BRICK);
    }
    b.set(2, 0, 4, B.AIR).set(2, 1, 4, B.AIR).door(2, 0, 4, 2);
    b.box(-1, 3, -1, 5, 3, 5, B.THATCH).box(0, 4, 0, 4, 4, 4, B.THATCH).box(1, 5, 1, 3, 5, 3, B.THATCH).set(2, 6, 2, B.THATCH);
    for (const [x, z] of [[-1, -1], [5, -1], [-1, 5], [5, 5]]) b.set(x, 3, z, B.AIR);
    return b.build('Traditional Hut', 'Mud-brick walls under a thatched roof.');
  },
  () => {
    const b = new Builder();
    b.walls(0, 0, 0, 3, 2, 3, B.BLUE);
    b.box(1, 1, 3, 2, 1, 3, B.AIR).box(1, 0, 3, 2, 0, 3, B.PLANK_SLAB);
    b.box(-1, 3, -1, 4, 3, 4, B.ZINC_SLAB);
    b.box(0, 3, 4, 3, 3, 4, B.YELLOW);
    b.set(1, 0, 1, B.ORANGE).set(2, 0, 1, B.RED);
    return b.build('Kiosk', 'Corner shop for recharge cards, sweets and cold drinks.');
  },
  () => waterTank(new Builder(), 0, 0, 0).build('Water Tank Stand', 'The black GeePee tank on wooden legs.'),
  () => {
    const b = new Builder();
    const L = 9, W = 3;
    for (let x = 0; x < L; x++) for (let z = 0; z < W; z++) {
      const edge = x === 0 || z === 0 || x === L - 1 || z === W - 1;
      b.set(x, 0, z, B.YELLOW).set(x, 1, z, B.BLACK).set(x, 2, z, edge ? B.GLASS : B.YELLOW).set(x, 3, z, B.YELLOW);
    }
    b.set(L - 1, 0, 0, B.LAMP).set(L - 1, 0, W - 1, B.LAMP);
    return b.build('Danfo Bus', 'A parked yellow danfo. Oshodi! Oshodi!');
  },
  () => {
    const b = new Builder();
    b.box(0, 0, 0, 0, 4, 0, B.CONCRETE).set(0, 5, 0, B.LAMP);
    return b.build('Street Light', 'Light up your street at night.');
  },
  () => {
    const b = new Builder();
    b.box(0, 0, 0, 0, 2, 0, B.WHITE).box(6, 0, 0, 6, 2, 0, B.WHITE).box(0, 3, 0, 6, 3, 0, B.WHITE);
    b.box(0, 0, 14, 0, 2, 14, B.WHITE).box(6, 0, 14, 6, 2, 14, B.WHITE).box(0, 3, 14, 6, 3, 14, B.WHITE);
    b.box(3, 0, 7, 3, 0, 7, B.WHITE);
    return b.build('Football Goals', 'Two goalposts for a 5-a-side match.');
  },
];

let cache = null;
export function blueprints() {
  if (!cache) cache = BLUEPRINTS.map((fn) => fn());
  return cache;
}

// Rotate a structure 90 degrees clockwise (seen from above) `turns` times. Stairs and doors turn with it.
export function rotateStruct(s, turns) {
  let cur = s;
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
    const cells = cur.cells.map(([x, y, z, id, meta]) => {
      const r = BLOCKS[id].render;
      const m = r === 'stairs' || r === 'door' ? (meta & ~3) | (((meta & 3) + 1) % 4) : meta;
      return [cur.d - 1 - z, y, x, id, m];
    });
    cur = { ...cur, w: cur.d, d: cur.w, cells };
  }
  return cur;
}

// ------------------------------------------------------------------ isometric drawing

const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
function iso(x, y, z, s, ox, oy) { return [ox + (x - z) * C30 * s, oy + (x + z) * S30 * s - y * s]; }

function face(g, atlas, tile, P0, Pu, Pv, sx0, sy0, sw, sh, shade) {
  const tx = (tile % ATLAS_COLS) * TILE, ty = Math.floor(tile / ATLAS_COLS) * TILE;
  const w = Math.max(1, sw * TILE), h = Math.max(1, sh * TILE);
  g.save();
  g.setTransform((Pu[0] - P0[0]) / w, (Pu[1] - P0[1]) / w, (Pv[0] - P0[0]) / h, (Pv[1] - P0[1]) / h, P0[0], P0[1]);
  g.drawImage(atlas, tx + sx0 * TILE, ty + sy0 * TILE, w, h, 0, 0, w, h);
  if (shade) { g.fillStyle = `rgba(0,0,0,${shade})`; g.fillRect(0, 0, w, h); }
  g.restore();
}

// Draw one block (any shape) at cell (cx, cy, cz).
function drawBlock(g, atlas, id, meta, cx, cy, cz, s, ox, oy, nb = 0) {
  const b = BLOCKS[id];
  const tiles = b.render === 'door' ? (meta & 8 ? T.door_top : T.door_bottom) : null;
  for (const bx of shapeBoxes(id, meta, nb)) {
    const [x0, y0, z0, x1, y1, z1] = [bx[0] + cx, bx[1] + cy, bx[2] + cz, bx[3] + cx, bx[4] + cy, bx[5] + cz];
    // top
    face(g, atlas, tiles ?? b.top, iso(x0, y1, z0, s, ox, oy), iso(x1, y1, z0, s, ox, oy), iso(x0, y1, z1, s, ox, oy), bx[0], bx[2], bx[3] - bx[0], bx[5] - bx[2], 0);
    // +z (left) face
    face(g, atlas, tiles ?? b.side, iso(x0, y1, z1, s, ox, oy), iso(x1, y1, z1, s, ox, oy), iso(x0, y0, z1, s, ox, oy), bx[0], 1 - bx[4], bx[3] - bx[0], bx[4] - bx[1], 0.2);
    // +x (right) face
    face(g, atlas, tiles ?? b.side, iso(x1, y1, z1, s, ox, oy), iso(x1, y1, z0, s, ox, oy), iso(x1, y0, z1, s, ox, oy), 1 - bx[5], 1 - bx[4], bx[5] - bx[2], bx[4] - bx[1], 0.38);
  }
}

export function makeBlockIcon(atlas, id, size = 44) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const b = BLOCKS[id];
  if (b.render === 'cross' || b.render === 'door') {
    const tiles = b.render === 'door' ? [T.door_top, T.door_bottom] : [b.side];
    const h = size * 0.86 / tiles.length;
    tiles.forEach((t, i) => g.drawImage(atlas, (t % ATLAS_COLS) * TILE, Math.floor(t / ATLAS_COLS) * TILE, TILE, TILE, (size - h) / 2, size * 0.07 + i * h, h, h));
    return c;
  }
  const s = size * 0.46;
  const meta = b.render === 'stairs' ? 3 : 0;
  if (CONNECTING[id]) {                                  // fences and panes: draw a short run so the icon shows the rails
    for (const dz of [-0.5, 0.5]) drawBlock(g, atlas, id, 0, 0, 0, dz, s, size / 2, size / 2 - s * 0.05, 5);
    return c;
  }
  drawBlock(g, atlas, id, meta, 0, 0, 0, s, size / 2, size / 2 - s * 0.05);
  return c;
}

// Isometric preview of a whole structure.
export function makeStructPreview(atlas, st, size = 96) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const span = (st.w + st.d) * C30 + 0.001;
  const tall = (st.w + st.d) * S30 + st.h;
  const s = Math.min((size * 0.92) / span, (size * 0.92) / tall);
  const ox = size / 2 + (st.d - st.w) * C30 * s / 2;
  const oy = (size - tall * s) / 2 + st.h * s;
  const cells = st.cells.slice().sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]) || a[1] - b[1]);
  for (const [x, y, z, id, meta] of cells) drawBlock(g, atlas, id, meta, x, y, z, s, ox, oy);
  return c;
}
