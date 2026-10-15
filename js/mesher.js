// Turns a 16x16 column of the world into vertex data (face culling, per-face shading and ambient occlusion).
import { BLOCKS, tileRect } from './blocks.js';
import { SIZE, HEIGHT, CHUNK, NCH } from './world.js';

// Vertices are ordered so that the quad winds consistently when viewed from outside.
const FACES = [
  { n: [0, 1, 0], v: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], uv: [[0, 0], [0, 1], [1, 1], [1, 0]], shade: 1.0, tile: 'top' },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], shade: 0.55, tile: 'bottom' },
  { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uv: [[0, 0], [0, 1], [1, 1], [1, 0]], shade: 0.72, tile: 'side' },
  { n: [-1, 0, 0], v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uv: [[0, 0], [0, 1], [1, 1], [1, 0]], shade: 0.72, tile: 'side' },
  { n: [0, 0, 1], v: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], uv: [[0, 0], [0, 1], [1, 1], [1, 0]], shade: 0.86, tile: 'side' },
  { n: [0, 0, -1], v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], uv: [[0, 0], [0, 1], [1, 1], [1, 0]], shade: 0.86, tile: 'side' },
];
// For ambient occlusion: the two axes lying in each face's plane.
for (const f of FACES) f.axes = [0, 1, 2].filter((a) => f.n[a] === 0);

const AO_LEVEL = [0.58, 0.74, 0.88, 1.0];
const RECTS = []; // tile index -> uv rect (lazy)
const rect = (t) => RECTS[t] || (RECTS[t] = tileRect(t));

// Babylon is left-handed, so the outward-CCW quads above need their triangle order reversed.
const FLIP_WINDING = true;

function layer() { return { positions: [], uvs: [], colors: [], indices: [] }; }

export function buildChunk(world, cx, cz) {
  const out = { opaque: layer(), glass: layer() };
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const x1 = Math.min(x0 + CHUNK, SIZE), z1 = Math.min(z0 + CHUNK, SIZE);
  const ymax = Math.min(HEIGHT, world.top[cz * NCH + cx]);
  const data = world.data;

  for (let y = 0; y < ymax; y++) {
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        const id = data[(y * SIZE + z) * SIZE + x];
        if (id === 0) continue;
        const blk = BLOCKS[id];
        const L = blk.transparent ? out.glass : out.opaque;

        for (const f of FACES) {
          const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
          if (ny < 0) continue;
          const nid = world.get(nx, ny, nz);
          if (!(nid === 0 || (BLOCKS[nid].transparent && nid !== id))) continue;

          const r = rect(blk[f.tile]);
          const base = L.positions.length / 3;
          const ao = [1, 1, 1, 1];
          for (let i = 0; i < 4; i++) {
            const v = f.v[i];
            L.positions.push(x + v[0], y + v[1], z + v[2]);
            L.uvs.push(r[0] + f.uv[i][0] * (r[2] - r[0]), r[1] + f.uv[i][1] * (r[3] - r[1]));

            let shade = f.shade;
            if (blk.fullbright) shade = 1;
            else if (!blk.transparent) {
              const a1 = f.axes[0], a2 = f.axes[1];
              const s1 = v[a1] * 2 - 1, s2 = v[a2] * 2 - 1;
              const bx = nx, by = ny, bz = nz;
              const p = [0, 0, 0];
              p[a1] = s1; const side1 = world.isOpaque(bx + p[0], by + p[1], bz + p[2]) ? 1 : 0;
              p[a1] = 0; p[a2] = s2; const side2 = world.isOpaque(bx + p[0], by + p[1], bz + p[2]) ? 1 : 0;
              p[a1] = s1; const corner = world.isOpaque(bx + p[0], by + p[1], bz + p[2]) ? 1 : 0;
              const level = side1 && side2 ? 0 : 3 - (side1 + side2 + corner);
              ao[i] = level;
              shade *= AO_LEVEL[level];
            }
            L.colors.push(shade, shade, shade, 1);
          }
          // Flip the quad diagonal when AO is anisotropic, so shading doesn't show a seam.
          const flip = ao[0] + ao[2] < ao[1] + ao[3];
          const q = flip ? [[1, 2, 3], [0, 1, 3]] : [[0, 1, 2], [0, 2, 3]];
          for (const tri of q) {
            if (FLIP_WINDING) L.indices.push(base + tri[0], base + tri[2], base + tri[1]);
            else L.indices.push(base + tri[0], base + tri[1], base + tri[2]);
          }
        }
      }
    }
  }
  return out;
}
