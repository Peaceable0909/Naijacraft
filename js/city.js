// Procedural generation of the starter Lagos: roads, plaza, street lights, landmarks, sample plots
// and Bar Beach.
import { B, mulberry32 } from './blocks.js';
import { PLOT, ROAD, GRID, PITCH, CITY, SX, SZ, PLOTS, PLAYER_PLOT, plotAt } from './world.js';

export const PLAZA = ROAD + 2 * PITCH - ROAD; // x/z start of the central intersection (80)

export function generateCity(world) {
  const rand = mulberry32(2024);

  // ---- ground layer
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
          else if (plot.number === PLAYER_PLOT) id = B.YELLOW;            // your land: yellow border
          else if (plot.owner === null && plot.kind === 'free') id = B.WHITE; // free land: white border
          else if (plot.owner === null) id = B.PAVEMENT;                  // public space
          else id = B.CONCRETE;                                           // someone else's land
        } else {
          const rx = x % PITCH, rz = z % PITCH;
          const inX = rx < ROAD, inZ = rz < ROAD;
          if (inX && inZ) {
            const corner = (rx === 0 || rx === ROAD - 1) && (rz === 0 || rz === ROAD - 1);
            const zebra = (rz === 0 || rz === ROAD - 1 || rx === 0 || rx === ROAD - 1) ? false : (rz === 1 || rz === ROAD - 2) ? rx % 2 === 1 : (rx === 1 || rx === ROAD - 2) ? rz % 2 === 1 : false;
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
      world.set(x, 0, z, id);
    }
  }

  // ---- city wall (open to the beach on the south side)
  for (let z = 0; z < SZ; z++) for (let y = 1; y <= 2; y++) { world.set(0, y, z, B.BRICK); world.set(SX - 1, y, z, B.BRICK); }
  for (let x = 0; x < SX; x++) for (let y = 1; y <= 2; y++) world.set(x, y, 0, B.BRICK);

  // ---- street lights at every intersection corner
  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      for (const dx of [0, ROAD - 1]) for (const dz of [0, ROAD - 1]) {
        const x = i * PITCH + dx, z = j * PITCH + dz;
        if (x === 0 || z === 0 || x === SX - 1) continue;
        world.fillBox(x, 1, z, x, 4, z, B.CONCRETE);
        world.set(x, 5, z, B.LAMP);
      }
    }
  }

  // ---- central plaza + monument
  world.fillBox(PLAZA, 0, PLAZA, PLAZA + ROAD - 1, 0, PLAZA + ROAD - 1, B.PAVEMENT);
  world.fillBox(PLAZA + 1, 0, PLAZA + 1, PLAZA + 6, 0, PLAZA + 6, B.MARBLE);
  world.fillBox(PLAZA + 2, 1, PLAZA + 2, PLAZA + 5, 2, PLAZA + 5, B.BRICK);
  world.fillBox(PLAZA + 3, 3, PLAZA + 3, PLAZA + 4, 11, PLAZA + 4, B.WHITE);
  world.fillBox(PLAZA + 3, 12, PLAZA + 3, PLAZA + 4, 13, PLAZA + 4, B.LAMP);
  world.fillBox(PLAZA + 2, 6, PLAZA + 2, PLAZA + 5, 6, PLAZA + 5, B.GREEN);   // green-white-green bands
  world.fillBox(PLAZA + 2, 8, PLAZA + 2, PLAZA + 5, 8, PLAZA + 5, B.GREEN);
  for (const [x, z] of [[PLAZA + 1, PLAZA + 1], [PLAZA + 6, PLAZA + 1], [PLAZA + 1, PLAZA + 6], [PLAZA + 6, PLAZA + 6]]) world.set(x, 1, z, B.HIBISCUS);

  // ---- plots
  for (const p of PLOTS) {
    if (p.kind === 'house') house(world, p, rand);
    else if (p.kind === 'tower') tower(world, p);
    else if (p.kind === 'shop') shop(world, p);
    else if (p.kind === 'market') market(world, p, rand);
    else if (p.kind === 'park') park(world, p, rand);
    else if (p.kind === 'free' && p.number !== PLAYER_PLOT) wildGrass(world, p, rand);
  }

  // ---- parked danfo buses (kept clear of the lanes the moving traffic uses)
  danfo(world, 14, 44, true);
  danfo(world, 100, 124, true);
  danfo(world, 124, 100, false);
  danfo(world, 44, 140, false);

  beach(world, rand);
}

// ------------------------------------------------------------------ building blocks

function tree(world, x, z, h) {
  world.fillBox(x, 1, z, x, h, z, B.LOG);
  for (let y = h - 1; y <= h; y++) {
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
      if (dx === 0 && dz === 0) continue;
      world.set(x + dx, y, z + dz, B.LEAVES);
    }
  }
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.set(x + dx, h + 1, z + dz, B.LEAVES);
  world.set(x, h + 2, z, B.LEAVES);
}

export function palmTree(world, x, z, h) {
  world.fillBox(x, 1, z, x, h, z, B.LOG);
  const y = h + 1;
  world.set(x, y, z, B.PALM_LEAVES);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    world.set(x + dx, y, z + dz, B.PALM_LEAVES); world.set(x + dx * 2, y, z + dz * 2, B.PALM_LEAVES); world.set(x + dx * 3, y - 1, z + dz * 3, B.PALM_LEAVES);
  }
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { world.set(x + dx, y, z + dz, B.PALM_LEAVES); world.set(x + dx * 2, y - 1, z + dz * 2, B.PALM_LEAVES); }
}

function lampPost(world, x, z, h = 4) {
  world.fillBox(x, 1, z, x, h, z, B.CONCRETE);
  world.set(x, h + 1, z, B.LAMP);
}

function flowers(world, x0, z0, x1, z1, rand, density = 0.5) {
  const kinds = [B.HIBISCUS, B.YELLOW_FLOWER, B.FERN, B.TALL_GRASS, B.TALL_GRASS];
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    if (world.get(x, 1, z) === B.AIR && world.get(x, 0, z) === B.GRASS && rand() < density) world.set(x, 1, z, kinds[rand() * kinds.length | 0]);
  }
}

// A walled building with floors, windows, a door facing the road (+z) and a flat or pitched roof.
function building(world, o) {
  const { x0, z0, w, d, floors, wall, trim, roof, roofStairs, pitched, sign } = o;
  const H = 4;
  world.fillBox(x0, 0, z0, x0 + w - 1, 0, z0 + d - 1, B.TILES);
  const doorX = x0 + Math.floor(w / 2) - 1;
  for (let f = 0; f < floors; f++) {
    const y0 = 1 + f * H;
    for (let y = y0; y <= y0 + 2; y++) {
      for (let x = x0; x < x0 + w; x++) { world.set(x, y, z0, wall); world.set(x, y, z0 + d - 1, wall); }
      for (let z = z0; z < z0 + d; z++) { world.set(x0, y, z, wall); world.set(x0 + w - 1, y, z, wall); }
    }
    for (const [cx, cz] of [[x0, z0], [x0 + w - 1, z0], [x0, z0 + d - 1], [x0 + w - 1, z0 + d - 1]]) world.fillBox(cx, y0, cz, cx, y0 + 2, cz, trim);
    for (let i = 2; i < w - 2; i++) {
      if (i % 4 === 1 || i % 4 === 2) {
        const x = x0 + i;
        if (f === 0 && (x === doorX || x === doorX + 1)) continue;
        world.fillBox(x, y0 + 1, z0, x, y0 + 2, z0, B.GLASS);
        world.fillBox(x, y0 + 1, z0 + d - 1, x, y0 + 2, z0 + d - 1, B.GLASS);
      }
    }
    for (let i = 2; i < d - 2; i++) {
      if (i % 4 === 1 || i % 4 === 2) {
        world.fillBox(x0, y0 + 1, z0 + i, x0, y0 + 2, z0 + i, B.GLASS);
        world.fillBox(x0 + w - 1, y0 + 1, z0 + i, x0 + w - 1, y0 + 2, z0 + i, B.GLASS);
      }
    }
    world.fillBox(x0, y0 + 3, z0, x0 + w - 1, y0 + 3, z0 + d - 1, trim);
    world.set(x0 + Math.floor(w / 2), y0 + 2, z0 + Math.floor(d / 2), B.LAMP);
    if (f > 0) world.fillBox(x0 + 1, y0 - 1, z0 + 1, x0 + w - 2, y0 - 1, z0 + d - 2, B.PLANKS);
  }
  // double front door
  world.set(doorX, 1, z0 + d - 1, B.DOOR, 2); world.set(doorX, 2, z0 + d - 1, B.DOOR, 2 | 8);
  world.set(doorX + 1, 1, z0 + d - 1, B.DOOR, 2); world.set(doorX + 1, 2, z0 + d - 1, B.DOOR, 2 | 8);
  world.fillBox(x0 + 1, 1, z0 + 1, x0 + 2, 2, z0 + 1, B.BOOKSHELF);
  const slabY = floors * H;
  if (pitched) {
    for (let k = 0; ; k++) {
      const za = z0 - 1 + k, zb = z0 + d - k;
      if (za > zb) break;
      for (let x = x0 - 1; x <= x0 + w; x++) {
        if (za === zb) { world.set(x, slabY + 1 + k, za, roof); continue; }
        world.set(x, slabY + 1 + k, za, roofStairs, 2);
        world.set(x, slabY + 1 + k, zb, roofStairs, 0);
        for (let z = za + 1; z < zb; z++) world.set(x, slabY + 1 + k, z, roof);
      }
      if (zb - za <= 1) break;
    }
  } else {
    for (let x = x0; x < x0 + w; x++) { world.set(x, slabY + 1, z0, trim); world.set(x, slabY + 1, z0 + d - 1, trim); }
    for (let z = z0; z < z0 + d; z++) { world.set(x0, slabY + 1, z, trim); world.set(x0 + w - 1, slabY + 1, z, trim); }
    world.set(x0, slabY + 2, z0, B.LAMP); world.set(x0 + w - 1, slabY + 2, z0, B.LAMP);
    world.fillBox(x0 + 2, slabY + 1, z0 + 2, x0 + 4, slabY + 1, z0 + 4, B.SOLAR);
    world.fillBox(x0 + w - 4, slabY + 1, z0 + 2, x0 + w - 3, slabY + 2, z0 + 3, B.TANK);
    if (sign) world.fillBox(x0, slabY + 1, z0 + d - 1, x0 + w - 1, slabY + 3, z0 + d - 1, sign);
  }
  return { doorX, frontZ: z0 + d - 1 };
}

function path(world, plot, doorX, frontZ) {
  world.fillBox(doorX, 0, frontZ + 1, doorX + 1, 0, plot.z + PLOT - 2, B.PAVEMENT);
}

function house(world, plot, rand) {
  const styles = {
    1: { w: 16, d: 12, floors: 1, wall: B.BRICK, trim: B.WHITE, roof: B.ROOF, roofStairs: B.BRICK_STAIRS, pitched: true },
    3: { w: 14, d: 14, floors: 2, wall: B.WHITE, trim: B.GREEN, pitched: false },
    5: { w: 20, d: 12, floors: 1, wall: B.YELLOW, trim: B.WHITE, roof: B.ZINC, roofStairs: B.ZINC_STAIRS, pitched: true },
    8: { w: 12, d: 12, floors: 2, wall: B.BLUE, trim: B.WHITE, roof: B.ZINC, roofStairs: B.ZINC_STAIRS, pitched: true },
    11: { w: 18, d: 16, floors: 2, wall: B.BEIGE, trim: B.ORANGE, pitched: false },
  };
  const s = styles[plot.number] || styles[1];
  const x0 = plot.x + Math.floor((PLOT - s.w) / 2), z0 = plot.z + 4;
  const { doorX, frontZ } = building(world, { x0, z0, ...s });
  path(world, plot, doorX, frontZ);
  tree(world, plot.x + 4, plot.z + PLOT - 6, 4 + (rand() * 2 | 0));
  tree(world, plot.x + PLOT - 5, plot.z + PLOT - 6, 4 + (rand() * 2 | 0));
  flowers(world, plot.x + 2, frontZ + 2, plot.x + PLOT - 3, plot.z + PLOT - 3, rand, 0.12);
}

function tower(world, plot) {
  const { doorX, frontZ } = building(world, { x0: plot.x + 10, z0: plot.z + 6, w: 12, d: 12, floors: 5, wall: B.CONCRETE, trim: B.BLUE, pitched: false });
  path(world, plot, doorX, frontZ);
  world.fillBox(plot.x + 15, 22, plot.z + 11, plot.x + 16, 26, plot.z + 12, B.CONCRETE);
  world.set(plot.x + 15, 27, plot.z + 11, B.NEON_CYAN); world.set(plot.x + 16, 27, plot.z + 12, B.NEON_CYAN);
  world.set(plot.x + 15, 27, plot.z + 12, B.NEON_PINK); world.set(plot.x + 16, 27, plot.z + 11, B.NEON_PINK);
}

function shop(world, plot) {
  const { doorX, frontZ } = building(world, { x0: plot.x + 5, z0: plot.z + 6, w: 22, d: 14, floors: 1, wall: B.ORANGE, trim: B.WHITE, pitched: false, sign: B.GREEN });
  path(world, plot, doorX, frontZ);
  world.fillBox(plot.x + 5, 1, plot.z + 21, plot.x + 26, 1, plot.z + 24, B.CONCRETE_SLAB);
  for (let x = plot.x + 6; x <= plot.x + 25; x += 3) world.set(x, 7, plot.z + 19, B.NEON_PINK);
  lampPost(world, plot.x + 3, plot.z + 24);
  lampPost(world, plot.x + 28, plot.z + 24);
}

function market(world, plot, rand) {
  world.fillBox(plot.x + 1, 0, plot.z + 1, plot.x + PLOT - 2, 0, plot.z + PLOT - 2, B.PAVEMENT);
  const awnings = [B.RED, B.YELLOW, B.BLUE, B.GREEN, B.ORANGE, B.ANKARA_ORANGE, B.ADIRE, B.ANKARA_GREEN];
  const goods = [B.ORANGE, B.RED, B.GREEN, B.YELLOW, B.WHITE, B.ANKARA_RED, B.ANKARA_ORANGE];
  for (let sx = 0; sx < 4; sx++) {
    for (let sz = 0; sz < 3; sz++) {
      const x = plot.x + 3 + sx * 7, z = plot.z + 4 + sz * 9;
      for (const [px, pz] of [[x, z], [x + 4, z], [x, z + 3], [x + 4, z + 3]]) world.fillBox(px, 1, pz, px, 3, pz, B.LOG);
      world.fillBox(x + 1, 1, z + 1, x + 3, 1, z + 2, B.PLANKS);
      for (let i = 1; i <= 3; i++) for (let k = 1; k <= 2; k++) if (rand() < 0.7) world.set(x + i, 2, z + k, goods[rand() * goods.length | 0]);
      world.fillBox(x, 4, z, x + 4, 4, z + 3, awnings[(sx + sz * 3) % awnings.length]);
    }
  }
  lampPost(world, plot.x + 1, plot.z + 1, 5);
  lampPost(world, plot.x + PLOT - 2, plot.z + 1, 5);
  lampPost(world, plot.x + 1, plot.z + PLOT - 2, 5);
  lampPost(world, plot.x + PLOT - 2, plot.z + PLOT - 2, 5);
}

function park(world, plot, rand) {
  const c = plot.x + 15, cz = plot.z + 15;
  world.fillBox(c, 0, plot.z + 1, c + 1, 0, plot.z + PLOT - 2, B.PAVEMENT);
  world.fillBox(plot.x + 1, 0, cz, plot.x + PLOT - 2, 0, cz + 1, B.PAVEMENT);
  world.fillBox(c - 3, 0, cz - 3, c + 4, 0, cz + 4, B.PAVEMENT);
  // fountain: stone rim, water, a white spout with a lamp on top
  world.fillBox(c - 2, 1, cz - 2, c + 3, 1, cz + 3, B.STONE);
  world.fillBox(c - 1, 1, cz - 1, c + 2, 1, cz + 2, B.WATER);
  world.fillBox(c, 1, cz, c + 1, 2, cz + 1, B.WHITE);
  world.set(c, 3, cz, B.LAMP);
  for (const [dx, dz] of [[-6, -2], [7, -2], [-6, 3], [7, 3]]) world.fillBox(c + dx, 1, cz + dz, c + dx + (dx < 0 ? -2 : 2), 1, cz + dz, B.PLANK_SLAB);
  const spots = [[4, 4], [10, 5], [26, 4], [22, 9], [5, 22], [11, 27], [25, 24], [27, 28], [8, 10], [24, 14], [4, 14], [27, 20]];
  for (const [dx, dz] of spots) tree(world, plot.x + dx, plot.z + dz, 4 + (rand() * 3 | 0));
  lampPost(world, plot.x + 13, plot.z + 6);
  lampPost(world, plot.x + 18, plot.z + 25);
  flowers(world, plot.x + 1, plot.z + 1, plot.x + PLOT - 2, plot.z + PLOT - 2, rand, 0.12);
}

function wildGrass(world, plot, rand) {
  flowers(world, plot.x + 1, plot.z + 1, plot.x + PLOT - 2, plot.z + PLOT - 2, rand, 0.04);
}

// A yellow danfo minibus with a black stripe. alongX: length runs along x.
function danfo(world, bx, bz, alongX) {
  const L = 9, W = 3;
  const xs = alongX ? L : W, zs = alongX ? W : L;
  for (let i = 0; i < xs; i++) for (let k = 0; k < zs; k++) {
    const x = bx + i, z = bz + k;
    const edge = i === 0 || k === 0 || i === xs - 1 || k === zs - 1;
    world.set(x, 1, z, B.YELLOW);
    world.set(x, 2, z, B.BLACK);
    world.set(x, 3, z, edge ? B.GLASS : B.YELLOW);
    world.set(x, 4, z, B.YELLOW);
  }
  if (alongX) { world.set(bx + L - 1, 1, bz, B.LAMP); world.set(bx + L - 1, 1, bz + W - 1, B.LAMP); }
  else { world.set(bx, 1, bz + L - 1, B.LAMP); world.set(bx + W - 1, 1, bz + L - 1, B.LAMP); }
}

// ------------------------------------------------------------------ Bar Beach

const FONT = { // 3x5 pixel letters, rows top to bottom
  L: ['100', '100', '100', '100', '111'],
  A: ['010', '101', '111', '101', '101'],
  G: ['011', '100', '101', '101', '011'],
  O: ['010', '101', '101', '101', '010'],
  S: ['011', '100', '010', '001', '110'],
};

function beach(world, rand) {
  const z0 = CITY;
  // promenade lamps and benches along the top of the beach
  for (let x = 12; x < SX - 8; x += 16) { lampPost(world, x, z0 + 1); world.fillBox(x + 3, 1, z0 + 1, x + 5, 1, z0 + 1, B.PLANK_SLAB); }
  // palms
  for (let x = 6; x < SX - 4; x += 11) {
    const px = x + (rand() * 3 | 0), pz = z0 + 6 + (rand() * 4 | 0), h = 6 + (rand() * 3 | 0);
    if (px > 124 && px < 142) continue; // leave room for the beach bar
    palmTree(world, px, pz, h);
  }
  // big "LAGOS" letters, readable from the city (viewer faces south, so +x is on their left)
  const scale = 2, word = 'LAGOS', lz = z0 + 14;
  let xLeft = SX / 2 + Math.round(((word.length * 4 - 1) * scale) / 2);
  word.split('').forEach((ch, li) => {
    const rows = FONT[ch];
    const colour = li % 2 === 0 ? B.GREEN : B.WHITE;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (rows[r][c] !== '1') continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        world.set(xLeft - c * scale - sx, 1 + (4 - r) * scale + sy, lz, colour);
      }
    }
    xLeft -= 4 * scale;
  });
  // umbrellas with chairs
  const shades = [B.RED, B.ANKARA_ORANGE, B.BLUE, B.YELLOW, B.ANKARA_GREEN, B.PINK];
  for (let k = 0; k < 10; k++) {
    const x = 10 + k * 16 + (rand() * 4 | 0), z = z0 + 17 + (rand() * 2 | 0);
    if (Math.abs(x - SX / 2) < 24) continue;
    world.fillBox(x, 1, z, x, 3, z, B.LOG);
    world.fillBox(x - 1, 4, z - 1, x + 1, 4, z + 1, shades[k % shades.length]);
    world.set(x + 2, 1, z, B.PLANK_SLAB); world.set(x - 2, 1, z, B.PLANK_SLAB);
  }
  // lifeguard tower
  const lx = 30, lzz = z0 + 12;
  for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]]) world.fillBox(lx + dx, 1, lzz + dz, lx + dx, 3, lzz + dz, B.LOG);
  world.fillBox(lx, 4, lzz, lx + 2, 4, lzz + 2, B.PLANKS);
  world.fillBox(lx, 5, lzz, lx + 2, 5, lzz, B.RED);
  world.fillBox(lx, 7, lzz, lx + 2, 7, lzz + 2, B.ZINC_SLAB);
  for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]]) world.set(lx + dx, 6, lzz + dz, B.LOG);
  // beach bar
  const bx = 130, bz = z0 + 6;
  world.fillBox(bx, 1, bz, bx + 6, 1, bz, B.PLANKS);
  for (const [dx, dz] of [[0, 0], [6, 0], [0, 4], [6, 4]]) world.fillBox(bx + dx, 1, bz + dz, bx + dx, 3, bz + dz, B.LOG);
  world.fillBox(bx - 1, 4, bz - 1, bx + 7, 4, bz + 5, B.THATCH);
  world.set(bx + 1, 2, bz, B.ORANGE); world.set(bx + 3, 2, bz, B.GREEN); world.set(bx + 5, 2, bz, B.NEON_CYAN);
  // fishing canoes pulled up on the sand
  for (const cx of [60, 112]) {
    const cz = SZ - 3;
    world.fillBox(cx, 1, cz, cx + 5, 1, cz + 1, B.PLANKS);
    world.set(cx - 1, 1, cz, B.PLANK_SLAB); world.set(cx + 6, 1, cz + 1, B.PLANK_SLAB);
    world.fillBox(cx + 1, 1, cz, cx + 4, 1, cz + 1, B.BLUE);
  }
}
