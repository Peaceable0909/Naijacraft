// Procedural generation of Lagos: roads, plaza, street lights, landmarks, show homes and Bar Beach.
//
// Generation is fully deterministic (one seeded random stream, fixed order), because every player's browser builds
// the city itself and they must all get the identical result. Land that players claim is cleared and replaced by
// what the server stores, so nothing here needs to be transmitted.
import { B, mulberry32 } from './blocks.js';
import { PLOT, ROAD, GRID, PITCH, CITY, SX, SZ, PLOTS, plotAt } from './world.js';

export const PLAZA = (GRID / 2) * PITCH;     // start of the central intersection (160); it is ROAD blocks wide

// Pixel letters (3 x 5) for signs.
const FONT = {
  L: ['100', '100', '100', '100', '111'], A: ['010', '101', '111', '101', '101'], G: ['011', '100', '101', '101', '011'],
  O: ['010', '101', '101', '101', '010'], S: ['011', '100', '010', '001', '110'], Y: ['101', '101', '010', '010', '010'],
  B: ['110', '101', '110', '101', '110'], T: ['111', '010', '010', '010', '010'], E: ['111', '100', '110', '100', '111'],
  C: ['011', '100', '100', '100', '011'], H: ['101', '101', '111', '101', '101'], K: ['101', '101', '110', '101', '101'],
};

export function generateCity(world) {
  const w = world;
  const rand = mulberry32(2024);
  const set = (x, y, z, id, meta = 0) => w.set(x, y, z, id, meta);
  const box = (x0, y0, z0, x1, y1, z1, id, meta = 0) => w.fillBox(x0, y0, z0, x1, y1, z1, id, meta);
  const hollow = (x0, y0, z0, x1, y1, z1, id) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) { set(x, y, z0, id); set(x, y, z1, id); }
      for (let z = z0; z <= z1; z++) { set(x0, y, z, id); set(x1, y, z, id); }
    }
  };
  const disc = (cx, cz, r, y, id) => {
    for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) if (Math.hypot(x - cx, z - cz) <= r + 0.3) set(x, y, z, id);
  };
  const ring = (cx, cz, r, y0, y1, id) => {
    for (let z = cz - r - 1; z <= cz + r + 1; z++) for (let x = cx - r - 1; x <= cx + r + 1; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d <= r + 0.3 && d > r - 0.75) for (let y = y0; y <= y1; y++) set(x, y, z, id);
    }
  };
  const letters = (text, xRight, y, z, scale, id, alt) => {            // readable from the south (+z), x grows to the left
    let xr = xRight;
    text.split('').forEach((ch, li) => {
      const rows = FONT[ch];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (rows[r][c] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) set(xr - c * scale - sx, y + (4 - r) * scale + sy, z, alt && li % 2 ? alt : id);
      }
      xr -= 4 * scale;
    });
  };

  // ---------------------------------------------------------------- shared pieces

  const tree = (x, z, h) => {
    box(x, 1, z, x, h, z, B.LOG);
    for (let y = h - 1; y <= h; y++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if ((Math.abs(dx) === 2 && Math.abs(dz) === 2) || (dx === 0 && dz === 0)) continue;
      set(x + dx, y, z + dz, B.LEAVES);
    }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) set(x + dx, h + 1, z + dz, B.LEAVES);
    set(x, h + 2, z, B.LEAVES);
  };
  const palm = (x, z, h) => {
    box(x, 1, z, x, h, z, B.LOG);
    const y = h + 1;
    set(x, y, z, B.PALM_LEAVES);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      set(x + dx, y, z + dz, B.PALM_LEAVES); set(x + dx * 2, y, z + dz * 2, B.PALM_LEAVES); set(x + dx * 3, y - 1, z + dz * 3, B.PALM_LEAVES);
    }
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { set(x + dx, y, z + dz, B.PALM_LEAVES); set(x + dx * 2, y - 1, z + dz * 2, B.PALM_LEAVES); }
  };
  const lampPost = (x, z, h = 5) => { box(x, 1, z, x, h, z, B.LAMP_POST); set(x, h + 1, z, B.LANTERN); };
  const flowers = (x0, z0, x1, z1, density) => {
    const kinds = [B.HIBISCUS, B.YELLOW_FLOWER, B.FERN, B.TALL_GRASS, B.TALL_GRASS];
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (w.get(x, 1, z) === B.AIR && w.get(x, 0, z) === B.GRASS && rand() < density) set(x, 1, z, kinds[rand() * kinds.length | 0]);
    }
  };
  const bench = (x, z, long, alongX) => {
    for (let i = 0; i < long; i++) set(alongX ? x + i : x, 1, alongX ? z : z + i, B.PLANK_SLAB);
    set(x, 1, z, B.WOOD_FENCE); set(alongX ? x + long - 1 : x, 1, alongX ? z : z + long - 1, B.WOOD_FENCE);
  };
  // Fence round the inside of a plot with a gate gap at the front (south) centre.
  const fenceRing = (p, id, gapCentre = p.x + PLOT / 2, gapHalf = 2) => {
    const x0 = p.x + 1, x1 = p.x + PLOT - 2, z0 = p.z + 1, z1 = p.z + PLOT - 2;
    for (let x = x0; x <= x1; x++) { set(x, 1, z0, id); if (Math.abs(x - gapCentre) > gapHalf) set(x, 1, z1, id); }
    for (let z = z0; z <= z1; z++) { set(x0, 1, z, id); set(x1, 1, z, id); }
  };
  const path = (p, doorX, frontZ) => box(doorX, 0, frontZ + 1, doorX + 1, 0, p.z + PLOT - 1, B.PAVEMENT);
  const flag = (x, z) => {                                              // Nigerian flag on a pole: "this land is free"
    box(x, 1, z, x, 8, z, B.LAMP_POST);
    box(x + 1, 6, z, x + 3, 7, z, B.FLAG);
    set(x, 9, z, B.LANTERN);
  };

  // A walled building with floors, window panes, double doors facing the road (+z) and a flat or pitched roof.
  const building = (o) => {
    const { x0, z0, w: W, d: D, floors, wall, trim, roof, roofStairs, pitched, sign, glass = false } = o;
    const H = 4;
    box(x0, 0, z0, x0 + W - 1, 0, z0 + D - 1, B.TILES);
    const doorX = x0 + Math.floor(W / 2) - 1;
    for (let f = 0; f < floors; f++) {
      const y0 = 1 + f * H;
      hollow(x0, y0, z0, x0 + W - 1, y0 + 2, z0 + D - 1, wall);
      for (const [cx, cz] of [[x0, z0], [x0 + W - 1, z0], [x0, z0 + D - 1], [x0 + W - 1, z0 + D - 1]]) box(cx, y0, cz, cx, y0 + 2, cz, trim);
      const win = glass ? B.GLASS : B.GLASS_PANE;
      for (let i = 2; i < W - 2; i++) {
        if (i % 4 === 1 || i % 4 === 2) {
          const x = x0 + i;
          if (f === 0 && (x === doorX || x === doorX + 1)) continue;
          box(x, y0 + 1, z0, x, y0 + 2, z0, win);
          box(x, y0 + 1, z0 + D - 1, x, y0 + 2, z0 + D - 1, win);
          set(x, y0, z0 + D, B.CONCRETE_SLAB);                              // window sill on the front
        }
      }
      for (let i = 2; i < D - 2; i++) {
        if (i % 4 === 1 || i % 4 === 2) {
          box(x0, y0 + 1, z0 + i, x0, y0 + 2, z0 + i, win);
          box(x0 + W - 1, y0 + 1, z0 + i, x0 + W - 1, y0 + 2, z0 + i, win);
        }
      }
      box(x0, y0 + 3, z0, x0 + W - 1, y0 + 3, z0 + D - 1, trim);
      set(x0 + Math.floor(W / 2), y0 + 2, z0 + Math.floor(D / 2), B.LAMP);
      if (f > 0) box(x0 + 1, y0 - 1, z0 + 1, x0 + W - 2, y0 - 1, z0 + D - 2, B.PLANKS);
    }
    for (const dx of [0, 1]) { set(doorX + dx, 1, z0 + D - 1, B.DOOR, 2); set(doorX + dx, 2, z0 + D - 1, B.DOOR, 2 | 8); }
    const slabY = floors * H;
    if (pitched) {
      for (let k = 0; ; k++) {
        const za = z0 - 1 + k, zb = z0 + D - k;
        if (za > zb) break;
        for (let x = x0 - 1; x <= x0 + W; x++) {
          if (za === zb) { set(x, slabY + 1 + k, za, roof); continue; }
          set(x, slabY + 1 + k, za, roofStairs, 2);
          set(x, slabY + 1 + k, zb, roofStairs, 0);
          for (let z = za + 1; z < zb; z++) set(x, slabY + 1 + k, z, roof);
        }
        if (zb - za <= 1) break;
      }
    } else {
      hollow(x0, slabY + 1, z0, x0 + W - 1, slabY + 1, z0 + D - 1, trim);
      set(x0, slabY + 2, z0, B.LANTERN); set(x0 + W - 1, slabY + 2, z0, B.LANTERN);
      box(x0 + 2, slabY + 1, z0 + 2, x0 + 4, slabY + 1, z0 + 4, B.SOLAR);
      box(x0 + W - 4, slabY + 1, z0 + 2, x0 + W - 3, slabY + 2, z0 + 3, B.TANK);
      if (sign) box(x0, slabY + 1, z0 + D - 1, x0 + W - 1, slabY + 3, z0 + D - 1, sign);
    }
    return { doorX, frontZ: z0 + D - 1, slabY };
  };

  const furnish = (x0, z0, W, D) => {                                    // a rug, a couch, a table and bookshelves
    const cx = x0 + Math.floor(W / 2);
    box(cx - 3, 1, z0 + 4, cx + 2, 1, z0 + 6, B.ANKARA_CARPET);
    set(cx - 1, 1, z0 + 5, B.PLANK_SLAB); set(cx, 1, z0 + 5, B.PLANK_SLAB);
    for (let i = -2; i <= 1; i++) set(cx + i, 1, z0 + 2, B.PLANK_STAIRS, 0);
    box(x0 + 1, 1, z0 + 1, x0 + 1, 2, z0 + 3, B.BOOKSHELF);
    box(x0 + W - 2, 1, z0 + 1, x0 + W - 2, 2, z0 + 2, B.BOOKSHELF);
  };
  const porch = (doorX, frontZ, post = B.LOG) => {
    for (const x of [doorX - 2, doorX + 3]) box(x, 1, frontZ + 3, x, 3, frontZ + 3, post);
    box(doorX - 3, 4, frontZ + 1, doorX + 4, 4, frontZ + 3, B.PLANK_SLAB);
    box(doorX, 1, frontZ + 1, doorX + 1, 1, frontZ + 3, B.RED_CARPET);
  };

  // ---------------------------------------------------------------- ground and walls

  for (let z = 0; z < SZ; z++) {
    for (let x = 0; x < SX; x++) {
      let id;
      if (z >= CITY) {
        id = z >= SZ - 4 ? B.WET_SAND : B.SAND;
      } else {
        const plot = plotAt(x, z);
        if (plot) {
          const lx = x - plot.x, lz = z - plot.z;
          const edge = lx === 0 || lz === 0 || lx === PLOT - 1 || lz === PLOT - 1;
          if (!edge) id = B.GRASS;
          else if (plot.claimable) id = B.WHITE;                      // free land: white border (yellow once it is yours)
          else if (plot.kind === 'house' || plot.kind === 'shop' || plot.kind === 'tower') id = B.CONCRETE;
          else id = B.PAVEMENT;                                       // landmarks and public spaces
        } else {
          const rx = x % PITCH, rz = z % PITCH;
          const inX = rx < ROAD, inZ = rz < ROAD;
          if (inX && inZ) {
            const corner = (rx === 0 || rx === ROAD - 1) && (rz === 0 || rz === ROAD - 1);
            const edgeBand = rx === 0 || rx === ROAD - 1 || rz === 0 || rz === ROAD - 1;
            const zebra = !edgeBand && ((rz === 1 || rz === ROAD - 2) ? rx % 2 === 1 : (rx === 1 || rx === ROAD - 2) ? rz % 2 === 1 : false);
            id = corner ? B.PAVEMENT : zebra ? B.WHITE : B.ASPHALT;
          } else if (inX) {
            if (rx === 0 || rx === ROAD - 1) id = B.PAVEMENT;
            else if ((rx === 3 || rx === 4) && z % 6 < 3) id = B.LINE_Z;
            else id = B.ASPHALT;
          } else {
            if (rz === 0 || rz === ROAD - 1) id = B.PAVEMENT;
            else if ((rz === 3 || rz === 4) && x % 6 < 3) id = B.LINE_X;
            else id = B.ASPHALT;
          }
        }
      }
      set(x, 0, z, id);
    }
  }
  for (let z = 0; z < SZ; z++) for (let y = 1; y <= 2; y++) { set(0, y, z, B.BRICK); set(SX - 1, y, z, B.BRICK); }
  for (let x = 0; x < SX; x++) for (let y = 1; y <= 2; y++) set(x, y, 0, B.BRICK);

  // ---------------------------------------------------------------- street lights

  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      for (const dx of [0, ROAD - 1]) for (const dz of [0, ROAD - 1]) {
        const x = i * PITCH + dx, z = j * PITCH + dz;
        if (x === 0 || z === 0 || x === SX - 1) continue;
        lampPost(x, z);
      }
    }
  }
  for (const p of PLOTS) {                                               // and one mid-block on the front and east side of every plot
    lampPost(p.x + PLOT / 2, p.z + PLOT, 4);
    if (p.x + PLOT < SX - ROAD) lampPost(p.x + PLOT, p.z + PLOT / 2, 4);
  }

  // ---------------------------------------------------------------- central plaza and monument

  const PZ = PLAZA;
  box(PZ, 0, PZ, PZ + ROAD - 1, 0, PZ + ROAD - 1, B.PAVEMENT);
  box(PZ + 1, 0, PZ + 1, PZ + 6, 0, PZ + 6, B.MARBLE);
  box(PZ + 2, 1, PZ + 2, PZ + 5, 2, PZ + 5, B.BRICK);
  box(PZ + 3, 3, PZ + 3, PZ + 4, 13, PZ + 4, B.WHITE);
  for (const y of [6, 9]) box(PZ + 2, y, PZ + 2, PZ + 5, y, PZ + 5, B.GREEN);   // green-white-green bands
  box(PZ + 3, 14, PZ + 3, PZ + 4, 15, PZ + 4, B.LAMP);
  set(PZ + 3, 16, PZ + 3, B.LANTERN); set(PZ + 4, 16, PZ + 4, B.LANTERN);
  for (const [x, z] of [[PZ + 1, PZ + 1], [PZ + 6, PZ + 1], [PZ + 1, PZ + 6], [PZ + 6, PZ + 6]]) set(x, 1, z, B.HIBISCUS);

  // ---------------------------------------------------------------- plots

  const wildGrass = (p) => {
    flowers(p.x + 1, p.z + 1, p.x + PLOT - 2, p.z + PLOT - 2, 0.04);
    flag(p.x + PLOT / 2, p.z + PLOT - 4);
  };

  const bungalow = (p) => {
    const x0 = p.x + 8, z0 = p.z + 6;
    const { doorX, frontZ } = building({ x0, z0, w: 16, d: 12, floors: 1, wall: B.BRICK, trim: B.WHITE, roof: B.ROOF, roofStairs: B.BRICK_STAIRS, pitched: true });
    furnish(x0, z0, 16, 12); porch(doorX, frontZ); path(p, doorX, frontZ);
    fenceRing(p, B.WOOD_FENCE);
    tree(p.x + 5, p.z + PLOT - 7, 4 + (rand() * 2 | 0)); tree(p.x + PLOT - 6, p.z + PLOT - 8, 4 + (rand() * 2 | 0));
    flowers(p.x + 2, frontZ + 4, p.x + PLOT - 3, p.z + PLOT - 3, 0.16);
  };

  const duplex = (p) => {
    const x0 = p.x + 9, z0 = p.z + 5;
    const { doorX, frontZ } = building({ x0, z0, w: 14, d: 14, floors: 2, wall: B.WHITE, trim: B.GREEN, pitched: false });
    furnish(x0, z0, 14, 14); path(p, doorX, frontZ);
    box(x0 + 2, 4, frontZ + 1, x0 + 11, 4, frontZ + 2, B.CONCRETE_SLAB, 1);          // balcony
    for (let x = x0 + 2; x <= x0 + 11; x++) set(x, 5, frontZ + 2, B.IRON_FENCE);
    box(doorX - 2, 1, frontZ + 1, doorX - 2, 3, frontZ + 1, B.WHITE); box(doorX + 3, 1, frontZ + 1, doorX + 3, 3, frontZ + 1, B.WHITE);
    fenceRing(p, B.IRON_FENCE);
    tree(p.x + 5, p.z + PLOT - 6, 5); tree(p.x + PLOT - 6, p.z + PLOT - 7, 4);
    flowers(p.x + 2, frontZ + 4, p.x + PLOT - 3, p.z + PLOT - 3, 0.14);
  };

  const villa = (p) => {
    const x0 = p.x + 6, z0 = p.z + 5;
    const { doorX, frontZ } = building({ x0, z0, w: 18, d: 13, floors: 1, wall: B.BEIGE, trim: B.BLACK, pitched: false, glass: true });
    furnish(x0, z0, 18, 13); path(p, doorX, frontZ);
    hollow(x0 - 1, 5, z0 - 1, x0 + 18, 5, z0 + 13, B.CONCRETE_SLAB);                   // a flat overhanging roof edge
    const px = p.x + 22, pz = p.z + 18;                                                // swimming pool with a deck
    box(px - 1, 0, pz - 1, px + 8, 0, pz + 6, B.TILES);
    box(px, 0, pz, px + 7, 0, pz + 5, B.WATER);
    for (const [bx, bz] of [[px - 3, pz + 1], [px - 3, pz + 3]]) { set(bx, 1, bz, B.PLANK_SLAB); set(bx + 1, 1, bz, B.PLANK_SLAB); }
    fenceRing(p, B.IRON_FENCE);
    palm(p.x + 4, p.z + PLOT - 6, 6); palm(p.x + PLOT - 5, p.z + 14, 7);
    flowers(p.x + 2, frontZ + 4, p.x + 18, p.z + PLOT - 3, 0.12);
  };

  const officeTower = (p) => {
    const x0 = p.x + 10, z0 = p.z + 6;
    const { doorX, frontZ } = building({ x0, z0, w: 12, d: 12, floors: 5, wall: B.CONCRETE, trim: B.BLUE, pitched: false });
    path(p, doorX, frontZ);
    box(doorX - 2, 4, frontZ + 1, doorX + 3, 4, frontZ + 3, B.CONCRETE_SLAB); for (const x of [doorX - 2, doorX + 3]) box(x, 1, frontZ + 3, x, 3, frontZ + 3, B.CONCRETE);
    box(p.x + 15, 22, p.z + 11, p.x + 16, 26, p.z + 12, B.CONCRETE);
    set(p.x + 15, 27, p.z + 11, B.NEON_CYAN); set(p.x + 16, 27, p.z + 12, B.NEON_CYAN); set(p.x + 15, 27, p.z + 12, B.NEON_PINK); set(p.x + 16, 27, p.z + 11, B.NEON_PINK);
    fenceRing(p, B.IRON_FENCE);
  };

  const boutique = (p) => {
    const x0 = p.x + 5, z0 = p.z + 6;
    const { doorX, frontZ } = building({ x0, z0, w: 22, d: 14, floors: 1, wall: B.ORANGE, trim: B.WHITE, pitched: false, sign: B.GREEN });
    path(p, doorX, frontZ);
    for (let x = x0 + 1; x < x0 + 21; x++) set(x, 5, frontZ + 1, B.ANKARA_ORANGE, 0);       // striped awning
    box(x0, 4, frontZ + 1, x0 + 21, 4, frontZ + 2, B.CONCRETE_SLAB, 1);
    for (let x = x0 + 6; x <= x0 + 20; x += 3) set(x, 7, frontZ, B.NEON_PINK);
    box(p.x + 5, 1, p.z + 21, p.x + 26, 1, p.z + 24, B.CONCRETE_SLAB);
    lampPost(p.x + 3, p.z + 24, 4); lampPost(p.x + 28, p.z + 24, 4);
  };

  const bazaar = (p, theme) => {
    box(p.x + 1, 0, p.z + 1, p.x + PLOT - 2, 0, p.z + PLOT - 2, B.PAVEMENT);
    const awnings = theme === 'tech' ? [B.BLACK, B.BLUE, B.PURPLE, B.NEON_CYAN, B.BLACK, B.BLUE] : [B.RED, B.YELLOW, B.ANKARA_ORANGE, B.ADIRE, B.ANKARA_GREEN, B.ORANGE, B.ANKARA_RED, B.GREEN];
    const goods = theme === 'tech' ? [B.BLACK, B.BLUE, B.WHITE, B.NEON_CYAN, B.GLASS] : [B.ORANGE, B.RED, B.GREEN, B.YELLOW, B.WHITE, B.ANKARA_RED, B.ANKARA_ORANGE];
    for (let sx = 0; sx < 4; sx++) {
      for (let sz = 0; sz < 3; sz++) {
        const x = p.x + 3 + sx * 7, z = p.z + 4 + sz * 9;
        for (const [px, pz] of [[x, z], [x + 4, z], [x, z + 3], [x + 4, z + 3]]) box(px, 1, pz, px, 3, pz, B.LOG);
        box(x + 1, 1, z + 1, x + 3, 1, z + 2, B.PLANKS);
        for (let i = 1; i <= 3; i++) for (let k = 1; k <= 2; k++) if (rand() < 0.7) set(x + i, 2, z + k, goods[rand() * goods.length | 0]);
        box(x, 4, z, x + 4, 4, z + 3, awnings[(sx + sz * 3) % awnings.length]);
        if (theme === 'tech') set(x + 2, 5, z + 3, rand() < 0.5 ? B.NEON_PINK : B.NEON_CYAN);
      }
    }
    for (const [x, z] of [[1, 1], [PLOT - 2, 1], [1, PLOT - 2], [PLOT - 2, PLOT - 2]]) lampPost(p.x + x, p.z + z, 6);
  };

  const fountainPark = (p) => {
    const c = p.x + 15, cz = p.z + 15;
    box(c, 0, p.z + 1, c + 1, 0, p.z + PLOT - 2, B.PAVEMENT);
    box(p.x + 1, 0, cz, p.x + PLOT - 2, 0, cz + 1, B.PAVEMENT);
    box(c - 3, 0, cz - 3, c + 4, 0, cz + 4, B.PAVEMENT);
    box(c - 2, 1, cz - 2, c + 3, 1, cz + 3, B.STONE);
    box(c - 1, 1, cz - 1, c + 2, 1, cz + 2, B.WATER);
    box(c, 1, cz, c + 1, 3, cz + 1, B.WHITE); set(c, 4, cz, B.LAMP);
    for (const [dx, dz] of [[-6, -2], [7, -2], [-6, 3], [7, 3]]) bench(c + dx - (dx < 0 ? 2 : 0), cz + dz, 3, true);
    for (const [dx, dz] of [[4, 4], [10, 5], [26, 4], [22, 9], [5, 22], [11, 27], [25, 24], [27, 28], [8, 10], [24, 14], [4, 14], [27, 20]]) tree(p.x + dx, p.z + dz, 4 + (rand() * 3 | 0));
    lampPost(p.x + 13, p.z + 6); lampPost(p.x + 18, p.z + 25);
    flowers(p.x + 1, p.z + 1, p.x + PLOT - 2, p.z + PLOT - 2, 0.12);
  };

  const conservation = (p) => {                                          // Lekki Conservation Centre: forest, pond, canopy walk
    for (let i = 0; i < 34; i++) {
      const x = p.x + 3 + (rand() * 26 | 0), z = p.z + 3 + (rand() * 26 | 0);
      if (Math.abs(z - (p.z + 16)) < 4) continue;
      if (rand() < 0.35) palm(x, z, 5 + (rand() * 3 | 0)); else tree(x, z, 4 + (rand() * 4 | 0));
    }
    for (let z = p.z + 22; z <= p.z + 27; z++) for (let x = p.x + 5; x <= p.x + 14; x++) set(x, 0, z, Math.hypot(x - (p.x + 9.5), z - (p.z + 24.5)) < 4.2 ? B.WATER : B.SAND);
    const y = 7, z = p.z + 16;
    for (let x = p.x + 8; x <= p.x + 23; x++) {                          // the canopy walkway on stilts
      box(x, y, z - 1, x, y, z + 1, B.PLANKS);
      set(x, y + 1, z - 1, B.WOOD_FENCE); set(x, y + 1, z + 1, B.WOOD_FENCE);
      if ((x - p.x) % 5 === 3) for (const dz of [-1, 1]) box(x, 1, z + dz, x, y - 1, z + dz, B.LOG);
    }
    for (let k = 0; k < 6; k++) {
      for (let dz = -1; dz <= 1; dz++) {
        set(p.x + 2 + k, 1 + k, z + dz, B.PLANK_STAIRS, 1);              // up from the west...
        set(p.x + 29 - k, 1 + k, z + dz, B.PLANK_STAIRS, 3);             // ...and back down at the east end
      }
    }
    flowers(p.x + 1, p.z + 1, p.x + PLOT - 2, p.z + PLOT - 2, 0.25);
  };

  // ---- landmarks

  const theatre = (p) => {                                               // the National Theatre, Iganmu
    const cx = p.x + 16, cz = p.z + 16;
    disc(cx, cz, 14, 0, B.PAVEMENT);
    disc(cx, cz, 12, 1, B.CONCRETE); disc(cx, cz, 11, 2, B.CONCRETE);
    ring(cx, cz, 12, 2, 2, B.CONCRETE_SLAB);
    for (let a = 0; a < 24; a++) { const x = Math.round(cx + Math.cos((a / 24) * Math.PI * 2) * 10), z = Math.round(cz + Math.sin((a / 24) * Math.PI * 2) * 10); box(x, 3, z, x, 10, z, B.WHITE); }
    ring(cx, cz, 8, 3, 9, B.WHITE);
    for (let a = 0; a < 16; a++) { const x = Math.round(cx + Math.cos((a / 16) * Math.PI * 2) * 8), z = Math.round(cz + Math.sin((a / 16) * Math.PI * 2) * 8); box(x, 5, z, x, 7, z, B.GLASS); }
    disc(cx, cz, 8, 3, B.MARBLE);
    const rings = [[13, 11, B.BEIGE], [12, 12, B.BEIGE], [10, 13, B.WHITE], [8, 14, B.WHITE], [6, 15, B.WHITE], [4, 16, B.GREEN], [2, 17, B.GREEN]];
    for (const [r, y, id] of rings) disc(cx, cz, r, y, id);
    ring(cx, cz, 13, 10, 10, B.LAMP);
    for (let k = 0; k < 3; k++) box(cx - 3, 1 + k, cz + 12 - k, cx + 3, 1 + k, cz + 12 - k, B.CONCRETE_STAIRS, 0);
    for (let a = 0; a < 8; a++) { const x = Math.round(cx + Math.cos((a / 8) * Math.PI * 2) * 13), z = Math.round(cz + Math.sin((a / 8) * Math.PI * 2) * 13); if (z < p.z + PLOT - 1 && x > p.x && x < p.x + PLOT - 1) lampPost(x, z, 3); }
  };

  const stadium = (p) => {                                               // Teslim Balogun Stadium: pitch, stands, floodlights
    box(p.x + 1, 0, p.z + 1, p.x + PLOT - 2, 0, p.z + PLOT - 2, B.PAVEMENT);
    const px0 = p.x + 7, px1 = p.x + 24, pz0 = p.z + 10, pz1 = p.z + 21;
    box(px0, 0, pz0, px1, 0, pz1, B.GRASS);
    for (let x = px0; x <= px1; x++) { set(x, 0, pz0, B.WHITE); set(x, 0, pz1, B.WHITE); }
    for (let z = pz0; z <= pz1; z++) { set(px0, 0, z, B.WHITE); set(px1, 0, z, B.WHITE); set((px0 + px1) >> 1, 0, z, B.WHITE); }
    for (const [gx, dir] of [[px0, -1], [px1, 1]]) {
      const cz = (pz0 + pz1) >> 1;
      for (let z = cz - 2; z <= cz + 2; z++) set(gx, 0, z, B.WHITE);
      box(gx + dir, 1, cz - 2, gx + dir, 2, cz - 2, B.IRON_FENCE); box(gx + dir, 1, cz + 2, gx + dir, 2, cz + 2, B.IRON_FENCE);
      for (let z = cz - 2; z <= cz + 2; z++) set(gx + dir, 3, z, B.IRON_FENCE);
    }
    for (let k = 0; k < 4; k++) {                                        // tiered stands on the north and south sides
      for (let x = px0 - 2; x <= px1 + 2; x++) {
        const c = (x + k) % 6 < 3 ? B.GREEN : B.WHITE;
        box(x, 1, pz0 - 1 - k, x, 1 + k, pz0 - 1 - k, c);
        box(x, 1, pz1 + 1 + k, x, 1 + k, pz1 + 1 + k, c);
      }
    }
    box(px0 - 2, 6, pz0 - 5, px1 + 2, 6, pz0 - 1, B.CONCRETE_SLAB, 1); box(px0 - 2, 6, pz1 + 1, px1 + 2, 6, pz1 + 5, B.CONCRETE_SLAB, 1);
    for (const [x, z] of [[p.x + 3, p.z + 4], [p.x + 28, p.z + 4], [p.x + 3, p.z + 27], [p.x + 28, p.z + 27]]) {
      box(x, 1, z, x, 12, z, B.LAMP_POST); box(x - 1, 13, z - 1, x + 1, 13, z + 1, B.NEON_CYAN); set(x, 14, z, B.LAMP);
    }
  };

  const techHub = (p) => {                                               // Yaba Tech Hub: a glass office with a neon sign
    const x0 = p.x + 7, z0 = p.z + 8, W = 18, D = 14, floors = 4;
    box(x0, 0, z0, x0 + W - 1, 0, z0 + D - 1, B.MARBLE);
    for (let f = 0; f < floors; f++) {
      const y0 = 1 + f * 4;
      for (let y = y0; y <= y0 + 2; y++) {
        for (let x = x0; x < x0 + W; x++) for (const z of [z0, z0 + D - 1]) set(x, y, z, (x - x0) % 3 === 0 ? B.BLACK : B.GLASS);
        for (let z = z0; z < z0 + D; z++) for (const x of [x0, x0 + W - 1]) set(x, y, z, (z - z0) % 3 === 0 ? B.BLACK : B.GLASS);
      }
      box(x0, y0 + 3, z0, x0 + W - 1, y0 + 3, z0 + D - 1, B.CONCRETE);
      for (let i = 0; i < 3; i++) set(x0 + 3 + i * 6, y0 + 2, z0 + 6, B.LAMP);
      if (f === 0) { for (let i = 0; i < 4; i++) { box(x0 + 3 + i * 4, 1, z0 + 4, x0 + 4 + i * 4, 1, z0 + 4, B.PLANK_SLAB); } }
    }
    const roofY = 1 + floors * 4;
    letters('YABA', x0 + W - 2, roofY + 1, z0 + D - 1, 1, B.NEON_CYAN, B.NEON_PINK);   // 16 wide, fits the 18-wide roof
    box(x0, roofY, z0, x0 + W - 1, roofY, z0 + D - 1, B.BLACK);
    box(p.x + PLOT / 2 - 1, 0, z0 + D, p.x + PLOT / 2, 0, p.z + PLOT - 1, B.PAVEMENT);
    for (const [x, z] of [[x0 - 2, z0 + D + 2], [x0 + W + 1, z0 + D + 2]]) lampPost(x, z, 4);
    box(x0 + 2, 1, z0 + D + 1, x0 + W - 3, 1, z0 + D + 1, B.BLUE_CARPET);
  };

  const port = (p) => {                                                  // Apapa Port: container stacks and a gantry crane
    box(p.x + 1, 0, p.z + 1, p.x + PLOT - 2, 0, p.z + PLOT - 2, B.CONCRETE);
    const cols = [B.RED, B.BLUE, B.GREEN, B.ORANGE, B.YELLOW, B.WHITE, B.PURPLE];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const x = p.x + 3 + b * 9, z = p.z + 4 + a * 8, h = 1 + (rand() * 3 | 0);
        for (let k = 0; k < h; k++) { box(x, 1 + k * 2, z, x + 6, 2 + k * 2, z + 2, cols[(a * 3 + b + k * 2) % cols.length]); box(x, 1 + k * 2, z + 1, x + 6, 1 + k * 2, z + 1, B.IRON_FENCE); }
      }
    }
    for (const x of [p.x + 29, p.x + 30]) for (const z of [p.z + 4, p.z + 24]) box(x, 1, z, x, 15, z, B.YELLOW);
    box(p.x + 29, 16, p.z + 3, p.x + 30, 16, p.z + 26, B.YELLOW);
    box(p.x + 20, 16, p.z + 14, p.x + 30, 16, p.z + 14, B.YELLOW);
    set(p.x + 20, 15, p.z + 14, B.LAMP_POST); box(p.x + 20, 9, p.z + 14, p.x + 20, 14, p.z + 14, B.IRON_FENCE); box(p.x + 19, 6, p.z + 13, p.x + 21, 8, p.z + 15, B.RED);
    lampPost(p.x + 2, p.z + 29, 6);
  };

  const towers = (p) => {                                                // Eko Atlantic: four glass skyscrapers
    box(p.x + 1, 0, p.z + 1, p.x + PLOT - 2, 0, p.z + PLOT - 2, B.MARBLE);
    const defs = [[p.x + 3, p.z + 3, 44], [p.x + 18, p.z + 4, 54], [p.x + 4, p.z + 18, 38], [p.x + 19, p.z + 19, 48]];
    defs.forEach(([x0, z0, h], t) => {
      const S = 9, crown = t % 2 ? B.NEON_PINK : B.NEON_CYAN;
      for (let y = 1; y <= h; y++) {
        const floor = y % 4 === 0;
        if (floor) box(x0, y, z0, x0 + S - 1, y, z0 + S - 1, B.CONCRETE);
        for (let i = 0; i < S; i++) {
          const mull = i % 3 === 0;
          const id = floor ? B.CONCRETE : mull ? B.CONCRETE : B.GLASS;
          set(x0 + i, y, z0, id); set(x0 + i, y, z0 + S - 1, id); set(x0, y, z0 + i, id); set(x0 + S - 1, y, z0 + i, id);
        }
        if (y % 4 === 3 && y < h - 2) set(x0 + 4, y, z0 + 4, B.LAMP);
      }
      box(x0, h + 1, z0, x0 + S - 1, h + 1, z0 + S - 1, B.BLACK);
      hollow(x0, h + 2, z0, x0 + S - 1, h + 2, z0 + S - 1, crown);
      box(x0 + 4, h + 2, z0 + 4, x0 + 4, h + 8, z0 + 4, B.LAMP_POST); set(x0 + 4, h + 9, z0 + 4, B.LANTERN);
      box(x0 + 3, 1, z0 + S - 1, x0 + 5, 2, z0 + S - 1, B.AIR);         // lobby entrance
    });
  };

  // ---------------------------------------------------------------- dispatch

  for (const p of PLOTS) {
    switch (p.style) {
      case 'bungalow': bungalow(p); break;
      case 'duplex': duplex(p); break;
      case 'villa': villa(p); break;
      case 'office': officeTower(p); break;
      case 'boutique': boutique(p); break;
      case 'bazaar': bazaar(p, p.name === 'Computer Village' ? 'tech' : 'cloth'); break;
      case 'fountain': fountainPark(p); break;
      case 'conservation': conservation(p); break;
      case 'theatre': theatre(p); break;
      case 'stadium': stadium(p); break;
      case 'techhub': techHub(p); break;
      case 'port': port(p); break;
      case 'towers': towers(p); break;
      default: if (p.claimable) wildGrass(p);
    }
  }

  // ---------------------------------------------------------------- parked danfo buses (the moving ones are entities)

  const danfo = (bx, bz, alongX) => {
    const L = 9, W = 3;
    const xs = alongX ? L : W, zs = alongX ? W : L;
    for (let i = 0; i < xs; i++) for (let k = 0; k < zs; k++) {
      const x = bx + i, z = bz + k;
      const edge = i === 0 || k === 0 || i === xs - 1 || k === zs - 1;
      set(x, 1, z, B.YELLOW); set(x, 2, z, B.BLACK); set(x, 3, z, edge ? B.GLASS : B.YELLOW); set(x, 4, z, B.YELLOW);
    }
    if (alongX) { set(bx + L - 1, 1, bz, B.LAMP); set(bx + L - 1, 1, bz + W - 1, B.LAMP); }
    else { set(bx, 1, bz + L - 1, B.LAMP); set(bx + W - 1, 1, bz + L - 1, B.LAMP); }
  };
  // Parked on roads 1, 4 and 7, which no moving traffic loop uses (loops run on roads 0/8, 2/6 and 3/5).
  danfo(90, PITCH + 1, true); danfo(250, 4 * PITCH + 1, true); danfo(100, 7 * PITCH + 1, true);
  danfo(PITCH + 1, 210, false); danfo(4 * PITCH + 1, 90, false); danfo(7 * PITCH + 1, 212, false);

  // ---------------------------------------------------------------- Bar Beach

  const z0 = CITY;
  for (let x = 12; x < SX - 8; x += 18) { lampPost(x, z0 + 1, 4); bench(x + 3, z0 + 1, 3, true); }
  for (let x = 6; x < SX - 4; x += 11) {
    const px = x + (rand() * 3 | 0), pz = z0 + 6 + (rand() * 4 | 0), h = 6 + (rand() * 3 | 0);
    if (px > 230 && px < 252) continue;                                  // leave room for the beach bar
    palm(px, pz, h);
  }
  letters('LAGOS', SX / 2 + Math.round((19 * 2) / 2), 1, z0 + 14, 2, B.GREEN, B.WHITE);
  const shades = [B.RED, B.ANKARA_ORANGE, B.BLUE, B.YELLOW, B.ANKARA_GREEN, B.PINK];
  for (let k = 0; k < 17; k++) {
    const x = 10 + k * 18 + (rand() * 4 | 0), z = z0 + 17 + (rand() * 2 | 0);
    if (Math.abs(x - SX / 2) < 26) continue;
    box(x, 1, z, x, 3, z, B.LOG); box(x - 1, 4, z - 1, x + 1, 4, z + 1, shades[k % shades.length]);
    set(x + 2, 1, z, B.PLANK_SLAB); set(x - 2, 1, z, B.PLANK_SLAB);
  }
  const lx = 40, lz = z0 + 12;                                           // lifeguard tower
  for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]]) box(lx + dx, 1, lz + dz, lx + dx, 3, lz + dz, B.LOG);
  box(lx, 4, lz, lx + 2, 4, lz + 2, B.PLANKS); box(lx, 5, lz, lx + 2, 5, lz, B.RED); box(lx, 7, lz, lx + 2, 7, lz + 2, B.ZINC_SLAB);
  for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]]) set(lx + dx, 6, lz + dz, B.LOG);
  const bx = 240, bz = z0 + 6;                                           // beach bar
  box(bx, 1, bz, bx + 6, 1, bz, B.PLANKS);
  for (const [dx, dz] of [[0, 0], [6, 0], [0, 4], [6, 4]]) box(bx + dx, 1, bz + dz, bx + dx, 3, bz + dz, B.LOG);
  box(bx - 1, 4, bz - 1, bx + 7, 4, bz + 5, B.THATCH);
  set(bx + 1, 2, bz, B.ORANGE); set(bx + 3, 2, bz, B.GREEN); set(bx + 5, 2, bz, B.NEON_CYAN);
  for (const cx of [90, 200, 280]) {                                     // fishing canoes pulled up on the sand
    const cz = SZ - 3;
    box(cx, 1, cz, cx + 5, 1, cz + 1, B.PLANKS); set(cx - 1, 1, cz, B.PLANK_SLAB); set(cx + 6, 1, cz + 1, B.PLANK_SLAB); box(cx + 1, 1, cz, cx + 4, 1, cz + 1, B.BLUE);
  }
}
