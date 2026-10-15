// Turns a 16x16 column of the world into vertex data.
// Per vertex colour: r = face shade x ambient occlusion, g = sunlight, b = lamp light,
// a = material flag (1 normal, 0.5 water, 0 self-lit).
import { B, BLOCKS, OPAQUE, tileRect, shapeBoxes, T } from './blocks.js';
import { SX, SZ, HEIGHT, CHUNK, NCX } from './world.js';

// Vertices are listed counter-clockwise seen from outside; Babylon is left-handed, so triangles are
// emitted in reverse order (see quad()).
const FACES = [
  { n: [0, 1, 0], v: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], shade: 1.0, tile: 'top' },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.55, tile: 'bottom' },
  { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.72, tile: 'side' },
  { n: [-1, 0, 0], v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: 0.72, tile: 'side' },
  { n: [0, 0, 1], v: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: 0.86, tile: 'side' },
  { n: [0, 0, -1], v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.86, tile: 'side' },
];
for (const f of FACES) {
  f.axes = [0, 1, 2].filter((a) => f.n[a] === 0);
  f.axis = [0, 1, 2].find((a) => f.n[a] !== 0);
  f.dir = f.n[f.axis];
}
// Texture coordinates come from projecting the vertex onto the face (so partial boxes map naturally).
const FACE_UV = [
  (x, y, z) => [x, z], (x, y, z) => [x, z],
  (x, y, z) => [z, y], (x, y, z) => [1 - z, y],
  (x, y, z) => [1 - x, y], (x, y, z) => [x, y],
];

const AO_LEVEL = [0.58, 0.74, 0.88, 1.0];
const RECTS = [];
const rect = (t) => RECTS[t] || (RECTS[t] = tileRect(t));
const CROSS = [
  [[0.15, 0, 0.15], [0.15, 1, 0.15], [0.85, 1, 0.85], [0.85, 0, 0.85]],
  [[0.15, 0, 0.85], [0.15, 1, 0.85], [0.85, 1, 0.15], [0.85, 0, 0.15]],
];
const QUAD_UV = [[0, 0], [0, 1], [1, 1], [1, 0]];

function layer() { return { positions: [], uvs: [], colors: [], indices: [] }; }

// verts: 4 [x,y,z]; uv: 4 [u,v] in 0..1 tile space; col: 4 [r,g,b,a]
function quad(L, verts, uv, r, col, flip = false, doubleSided = false) {
  const base = L.positions.length / 3;
  for (let i = 0; i < 4; i++) {
    const v = verts[i];
    L.positions.push(v[0], v[1], v[2]);
    L.uvs.push(r[0] + uv[i][0] * (r[2] - r[0]), r[1] + uv[i][1] * (r[3] - r[1]));
    const c = col[i];
    L.colors.push(c[0], c[1], c[2], c[3]);
  }
  const tris = flip ? [1, 2, 3, 0, 1, 3] : [0, 1, 2, 0, 2, 3];
  for (let k = 0; k < 6; k += 3) L.indices.push(base + tris[k], base + tris[k + 2], base + tris[k + 1]);
  if (doubleSided) for (let k = 0; k < 6; k += 3) L.indices.push(base + tris[k], base + tris[k + 1], base + tris[k + 2]);
}

export function buildChunk(world, cx, cz) {
  const out = { opaque: layer(), glass: layer() };
  const { data, meta, sky, blk } = world;
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const x1 = Math.min(x0 + CHUNK, SX), z1 = Math.min(z0 + CHUNK, SZ);
  const ymax = Math.min(HEIGHT, world.top[cz * NCX + cx]);
  const LAYER = SX * SZ;

  const inb = (x, y, z) => x >= 0 && z >= 0 && y >= 0 && x < SX && z < SZ && y < HEIGHT;
  const idAt = (x, y, z) => (inb(x, y, z) ? data[y * LAYER + z * SX + x] : 0);
  const skyAt = (x, y, z) => (inb(x, y, z) ? sky[y * LAYER + z * SX + x] : 15);
  const blkAt = (x, y, z) => (inb(x, y, z) ? blk[y * LAYER + z * SX + x] : 0);
  const opq = (x, y, z) => OPAQUE[idAt(x, y, z)];

  const verts = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const uvs = [[0, 0], [0, 0], [0, 0], [0, 0]];
  const cols = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]];
  const p = [0, 0, 0];

  for (let y = 0; y < ymax; y++) {
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        const ci = y * LAYER + z * SX + x;
        const id = data[ci];
        if (id === 0) continue;
        const b = BLOCKS[id];

        if (b.render === 'cube') {
          const L = b.transparent ? out.glass : out.opaque;
          for (let fi = 0; fi < 6; fi++) {
            const f = FACES[fi];
            const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
            if (ny < 0) continue;
            const nid = idAt(nx, ny, nz);
            if (OPAQUE[nid] || (b.transparent && nid === id)) continue;
            const r = rect(b[f.tile]);
            const ao = [3, 3, 3, 3];
            for (let i = 0; i < 4; i++) {
              const v = f.v[i];
              verts[i][0] = x + v[0]; verts[i][1] = y + v[1]; verts[i][2] = z + v[2];
              const c = cols[i];
              if (b.light) { c[0] = 1; c[1] = 1; c[2] = 1; c[3] = 0; continue; }
              if (b.transparent) { c[0] = f.shade; c[1] = skyAt(nx, ny, nz) / 15; c[2] = blkAt(nx, ny, nz) / 15; c[3] = 1; continue; }
              // ambient occlusion + smooth lighting from the 4 cells touching this vertex
              const a1 = f.axes[0], a2 = f.axes[1];
              const s1 = v[a1] * 2 - 1, s2 = v[a2] * 2 - 1;
              p[0] = nx; p[1] = ny; p[2] = nz; p[a1] += s1; const o1 = opq(p[0], p[1], p[2]);
              let ls = skyAt(nx, ny, nz), lb = blkAt(nx, ny, nz), n = 1;
              if (!o1) { ls += skyAt(p[0], p[1], p[2]); lb += blkAt(p[0], p[1], p[2]); n++; }
              p[a1] -= s1; p[a2] += s2; const o2 = opq(p[0], p[1], p[2]);
              if (!o2) { ls += skyAt(p[0], p[1], p[2]); lb += blkAt(p[0], p[1], p[2]); n++; }
              p[a1] += s1; const oc = opq(p[0], p[1], p[2]);
              if (!oc && !(o1 && o2)) { ls += skyAt(p[0], p[1], p[2]); lb += blkAt(p[0], p[1], p[2]); n++; }
              const level = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
              ao[i] = level;
              c[0] = f.shade * AO_LEVEL[level]; c[1] = ls / (n * 15); c[2] = lb / (n * 15); c[3] = 1;
            }
            quad(L, verts, QUAD_UV, r, cols, ao[0] + ao[2] < ao[1] + ao[3]);
          }
        } else if (b.render === 'water') {
          const above = idAt(x, y + 1, z) === B.WATER;
          const h = above ? 1 : 0.875;
          for (let fi = 0; fi < 6; fi++) {
            const f = FACES[fi];
            const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
            if (ny < 0) continue;
            const nid = idAt(nx, ny, nz);
            if (nid === B.WATER || OPAQUE[nid]) continue;
            const ls = skyAt(nx, ny, nz) / 15, lb = blkAt(nx, ny, nz) / 15;
            for (let i = 0; i < 4; i++) {
              const v = f.v[i];
              verts[i][0] = x + v[0]; verts[i][1] = y + v[1] * h; verts[i][2] = z + v[2];
              const c = cols[i]; c[0] = f.shade; c[1] = ls; c[2] = lb; c[3] = 0.5;
            }
            quad(out.glass, verts, QUAD_UV, rect(b.top), cols, false, fi === 0);
          }
        } else if (b.render === 'cross') {
          const ls = sky[ci] / 15, lb = blk[ci] / 15;
          for (const q of CROSS) {
            for (let i = 0; i < 4; i++) {
              verts[i][0] = x + q[i][0]; verts[i][1] = y + q[i][1]; verts[i][2] = z + q[i][2];
              const c = cols[i]; c[0] = 0.95; c[1] = ls; c[2] = lb; c[3] = 1;
            }
            quad(out.opaque, verts, QUAD_UV, rect(b.side), cols, false, true);
          }
        } else {
          // slabs, stairs, doors: a few boxes, lit by the light inside their own cell
          const m = meta[ci];
          const ls = sky[ci] / 15, lb = blk[ci] / 15;
          const doorTile = b.render === 'door' ? (m & 8 ? T.door_top : T.door_bottom) : -1;
          for (const bx of shapeBoxes(id, m)) {
            for (let fi = 0; fi < 6; fi++) {
              const f = FACES[fi];
              const onEdge = f.dir > 0 ? bx[f.axis + 3] === 1 : bx[f.axis] === 0;
              if (onEdge && opq(x + f.n[0], y + f.n[1], z + f.n[2])) continue;
              const r = rect(doorTile >= 0 ? doorTile : b[f.tile]);
              for (let i = 0; i < 4; i++) {
                const v = f.v[i];
                const lx = v[0] ? bx[3] : bx[0], ly = v[1] ? bx[4] : bx[1], lz = v[2] ? bx[5] : bx[2];
                verts[i][0] = x + lx; verts[i][1] = y + ly; verts[i][2] = z + lz;
                const uv = FACE_UV[fi](lx, ly, lz);
                uvs[i][0] = uv[0]; uvs[i][1] = uv[1];
                const c = cols[i]; c[0] = f.shade; c[1] = ls; c[2] = lb; c[3] = 1;
              }
              quad(out.opaque, verts, uvs, r, cols);
            }
          }
        }
      }
    }
  }
  return out;
}
