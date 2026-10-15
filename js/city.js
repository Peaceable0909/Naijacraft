// Procedural generation of the starter Lagos: roads, plaza, street lights, landmarks and sample plots.
import { B } from './blocks.js';
import { World, PLOT, ROAD, GRID, PITCH, SIZE, PLOTS, PLAYER_PLOT, plotAt } from './world.js';

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateCity(world) {
  const rand = rng(2024);
  const PLAZA = ROAD + 2 * PITCH - ROAD; // x/z start of the central intersection (80)

  // ---- ground layer
  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      const plot = plotAt(x, z);
      let id;
      if (plot) {
        const lx = x - plot.x, lz = z - plot.z;
        const edge = lx === 0 || lz === 0 || lx === PLOT - 1 || lz === PLOT - 1;
        if (!edge) id = B.GRASS;
        else if (plot.number === PLAYER_PLOT) id = B.YELLOW;       // your land: yellow border
        else if (plot.owner === null && plot.kind === 'free') id = B.WHITE; // free land: white border
        else if (plot.owner === null) id = B.PAVEMENT;             // public space
        else id = B.CONCRETE;                                      // someone else's land
      } else {
        const rx = x % PITCH, rz = z % PITCH;
        const inX = rx < ROAD, inZ = rz < ROAD;
        if (inX && inZ) {
          id = (rx === 0 || rx === ROAD - 1) && (rz === 0 || rz === ROAD - 1) ? B.PAVEMENT : B.ASPHALT;
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
      world.set(x, 0, z, id);
    }
  }

  // ---- perimeter wall
  for (let i = 0; i < SIZE; i++) {
    for (let y = 1; y <= 2; y++) {
      world.set(i, y, 0, B.BRICK); world.set(i, y, SIZE - 1, B.BRICK);
      world.set(0, y, i, B.BRICK); world.set(SIZE - 1, y, i, B.BRICK);
    }
  }

  // ---- street lights at every intersection corner
  for (let i = 0; i <= GRID; i++) {
    for (let j = 0; j <= GRID; j++) {
      for (const dx of [0, ROAD - 1]) for (const dz of [0, ROAD - 1]) {
        const x = i * PITCH + dx, z = j * PITCH + dz;
        if (x === 0 || z === 0 || x === SIZE - 1 || z === SIZE - 1) continue;
        world.fillBox(x, 1, z, x, 4, z, B.CONCRETE);
        world.set(x, 5, z, B.LAMP);
      }
    }
  }

  // ---- central plaza + monument
  world.fillBox(PLAZA, 0, PLAZA, PLAZA + ROAD - 1, 0, PLAZA + ROAD - 1, B.PAVEMENT);
  world.fillBox(PLAZA + 1, 0, PLAZA + 1, PLAZA + 6, 0, PLAZA + 6, B.CONCRETE);
  world.fillBox(PLAZA + 2, 1, PLAZA + 2, PLAZA + 5, 2, PLAZA + 5, B.BRICK);
  world.fillBox(PLAZA + 3, 3, PLAZA + 3, PLAZA + 4, 11, PLAZA + 4, B.WHITE);
  world.fillBox(PLAZA + 3, 12, PLAZA + 3, PLAZA + 4, 13, PLAZA + 4, B.LAMP);
  world.fillBox(PLAZA + 2, 6, PLAZA + 2, PLAZA + 5, 6, PLAZA + 5, B.GREEN);   // green-white-green bands
  world.fillBox(PLAZA + 2, 8, PLAZA + 2, PLAZA + 5, 8, PLAZA + 5, B.GREEN);

  // ---- plots
  for (const p of PLOTS) {
    if (p.kind === 'house') house(world, p, rand);
    else if (p.kind === 'tower') tower(world, p);
    else if (p.kind === 'shop') shop(world, p);
    else if (p.kind === 'market') market(world, p, rand);
    else if (p.kind === 'park') park(world, p, rand);
  }

  // ---- danfo buses (yellow with a black stripe) parked along the roads
  danfo(world, 14, 44, true);
  danfo(world, 100, 121, true);
  danfo(world, 124, 100, false);
  danfo(world, 44, 140, false);
}

// ------------------------------------------------------------------ building blocks

function tree(world, x, z, h) {
  world.fillBox(x, 1, z, x, h, z, B.LOG);
  for (let y = h - 1; y <= h; y++) {
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
      if (dx === 0 && dz === 0 && y < h + 1) continue;
      world.set(x + dx, y, z + dz, B.LEAVES);
    }
  }
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.set(x + dx, h + 1, z + dz, B.LEAVES);
  world.set(x, h + 2, z, B.LEAVES);
  world.set(x, h + 1, z, B.LEAVES);
}

function lampPost(world, x, z, h = 4) {
  world.fillBox(x, 1, z, x, h, z, B.CONCRETE);
  world.set(x, h + 1, z, B.LAMP);
}

// A walled building with floors, windows, a door facing the road (+z) and a flat or pitched roof.
function building(world, o) {
  const { x0, z0, w, d, floors, wall, trim, roof, pitched, sign } = o;
  const H = 4;
  world.fillBox(x0, 0, z0, x0 + w - 1, 0, z0 + d - 1, B.PLANKS);
  const doorX = x0 + Math.floor(w / 2) - 1;
  for (let f = 0; f < floors; f++) {
    const y0 = 1 + f * H;
    for (let y = y0; y <= y0 + 2; y++) {
      for (let x = x0; x < x0 + w; x++) { world.set(x, y, z0, wall); world.set(x, y, z0 + d - 1, wall); }
      for (let z = z0; z < z0 + d; z++) { world.set(x0, y, z, wall); world.set(x0 + w - 1, y, z, wall); }
    }
    for (const [cx, cz] of [[x0, z0], [x0 + w - 1, z0], [x0, z0 + d - 1], [x0 + w - 1, z0 + d - 1]]) world.fillBox(cx, y0, cz, cx, y0 + 2, cz, trim);
    // windows (two rows tall) along every wall
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
    // ceiling slab, with a lamp hanging from its centre
    world.fillBox(x0, y0 + 3, z0, x0 + w - 1, y0 + 3, z0 + d - 1, trim);
    world.set(x0 + Math.floor(w / 2), y0 + 2, z0 + Math.floor(d / 2), B.LAMP);
    if (f > 0) world.fillBox(x0, y0 - 1, z0, x0 + w - 1, y0 - 1, z0 + d - 1, B.PLANKS); // upper floor boards
  }
  // front door (2 wide, 2 tall) and a step
  world.fillBox(doorX, 1, z0 + d - 1, doorX + 1, 2, z0 + d - 1, B.AIR);
  const slabY = floors * H;
  if (pitched) {
    for (let k = 0; ; k++) {
      const za = z0 - 1 + k, zb = z0 + d - k;
      if (za > zb) break;
      world.fillBox(x0 - 1, slabY + 1 + k, za, x0 + w, slabY + 1 + k, zb, roof);
    }
  } else {
    for (let x = x0; x < x0 + w; x++) { world.set(x, slabY + 1, z0, trim); world.set(x, slabY + 1, z0 + d - 1, trim); }
    for (let z = z0; z < z0 + d; z++) { world.set(x0, slabY + 1, z, trim); world.set(x0 + w - 1, slabY + 1, z, trim); }
    world.set(x0, slabY + 2, z0, B.LAMP); world.set(x0 + w - 1, slabY + 2, z0, B.LAMP);
    if (sign) world.fillBox(x0, slabY + 1, z0 + d - 1, x0 + w - 1, slabY + 3, z0 + d - 1, sign);
  }
  return { doorX, frontZ: z0 + d - 1 };
}

function path(world, plot, doorX, frontZ) {
  world.fillBox(doorX, 0, frontZ + 1, doorX + 1, 0, plot.z + PLOT - 2, B.PAVEMENT);
}

function house(world, plot, rand) {
  const styles = {
    1: { w: 16, d: 12, floors: 1, wall: B.BRICK, trim: B.WHITE, roof: B.ROOF, pitched: true },
    3: { w: 14, d: 14, floors: 2, wall: B.WHITE, trim: B.GREEN, roof: B.ROOF, pitched: false },
    5: { w: 20, d: 12, floors: 1, wall: B.YELLOW, trim: B.WHITE, roof: B.ROOF, pitched: true },
    8: { w: 12, d: 12, floors: 2, wall: B.BLUE, trim: B.WHITE, roof: B.ROOF, pitched: true },
    11: { w: 18, d: 16, floors: 2, wall: B.WHITE, trim: B.ORANGE, roof: B.ROOF, pitched: false },
  };
  const s = styles[plot.number] || styles[1];
  const x0 = plot.x + Math.floor((PLOT - s.w) / 2), z0 = plot.z + 4;
  const { doorX, frontZ } = building(world, { x0, z0, ...s });
  path(world, plot, doorX, frontZ);
  tree(world, plot.x + 4, plot.z + PLOT - 6, 4 + (rand() * 2 | 0));
  tree(world, plot.x + PLOT - 5, plot.z + PLOT - 6, 4 + (rand() * 2 | 0));
}

function tower(world, plot) {
  const { doorX, frontZ } = building(world, { x0: plot.x + 10, z0: plot.z + 6, w: 12, d: 12, floors: 4, wall: B.CONCRETE, trim: B.BLUE, roof: B.ROOF, pitched: false });
  path(world, plot, doorX, frontZ);
  world.fillBox(plot.x + 15, 18, plot.z + 11, plot.x + 16, 22, plot.z + 12, B.CONCRETE);
  world.set(plot.x + 15, 23, plot.z + 11, B.LAMP); world.set(plot.x + 16, 23, plot.z + 12, B.LAMP);
}

function shop(world, plot) {
  const { doorX, frontZ } = building(world, { x0: plot.x + 5, z0: plot.z + 6, w: 22, d: 14, floors: 1, wall: B.ORANGE, trim: B.WHITE, roof: B.ROOF, pitched: false, sign: B.GREEN });
  path(world, plot, doorX, frontZ);
  world.fillBox(plot.x + 5, 1, plot.z + 21, plot.x + 26, 1, plot.z + 24, B.PAVEMENT);
  lampPost(world, plot.x + 3, plot.z + 24);
  lampPost(world, plot.x + 28, plot.z + 24);
}

function market(world, plot, rand) {
  world.fillBox(plot.x + 1, 0, plot.z + 1, plot.x + PLOT - 2, 0, plot.z + PLOT - 2, B.PAVEMENT);
  const awnings = [B.RED, B.YELLOW, B.BLUE, B.GREEN, B.ORANGE, B.WHITE];
  const goods = [B.ORANGE, B.RED, B.GREEN, B.YELLOW, B.WHITE];
  for (let sx = 0; sx < 4; sx++) {
    for (let sz = 0; sz < 3; sz++) {
      const x = plot.x + 3 + sx * 7, z = plot.z + 4 + sz * 9;
      for (const [px, pz] of [[x, z], [x + 4, z], [x, z + 3], [x + 4, z + 3]]) world.fillBox(px, 1, pz, px, 3, pz, B.LOG);
      world.fillBox(x + 1, 1, z + 1, x + 3, 1, z + 2, B.PLANKS);
      for (let i = 1; i <= 3; i++) for (let k = 1; k <= 2; k++) if (rand() < 0.7) world.set(x + i, 2, z + k, goods[rand() * goods.length | 0]);
      world.fillBox(x, 4, z, x + 4, 4, z + 3, awnings[(sx + sz * 2) % awnings.length]);
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
  world.fillBox(c - 1, 0, cz - 1, c + 2, 0, cz + 2, B.BLUE);   // a little pond/fountain pad
  world.fillBox(c, 1, cz, c + 1, 2, cz + 1, B.WHITE);
  world.set(c, 3, cz, B.LAMP);
  for (const [dx, dz] of [[-5, -2], [6, -2], [-5, 3], [6, 3]]) world.fillBox(c + dx, 1, cz + dz, c + dx + (dx < 0 ? -2 : 2), 1, cz + dz, B.PLANKS); // benches
  const spots = [[4, 4], [10, 5], [26, 4], [22, 9], [5, 22], [11, 27], [25, 24], [27, 28], [8, 10], [24, 14], [4, 14], [27, 20]];
  for (const [dx, dz] of spots) tree(world, plot.x + dx, plot.z + dz, 4 + (rand() * 3 | 0));
  lampPost(world, plot.x + 13, plot.z + 6);
  lampPost(world, plot.x + 18, plot.z + 25);
}

// A yellow danfo minibus with a black stripe. alongX: length runs along x.
function danfo(world, bx, bz, alongX) {
  const L = 9, W = 3;
  const xs = alongX ? L : W, zs = alongX ? W : L;
  for (let i = 0; i < xs; i++) for (let k = 0; k < zs; k++) {
    const x = bx + i, z = bz + k;
    const edge = i === 0 || k === 0 || i === xs - 1 || k === zs - 1;
    world.set(x, 1, z, B.YELLOW);
    world.set(x, 2, z, B.ASPHALT);
    world.set(x, 3, z, edge ? B.GLASS : B.YELLOW);
    world.set(x, 4, z, B.YELLOW);
  }
  // headlights at the +x / +z end
  if (alongX) { world.set(bx + L - 1, 1, bz, B.LAMP); world.set(bx + L - 1, 1, bz + W - 1, B.LAMP); }
  else { world.set(bx, 1, bz + L - 1, B.LAMP); world.set(bx + W - 1, 1, bz + L - 1, B.LAMP); }
}
