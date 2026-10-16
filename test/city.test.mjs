import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { World, HEIGHT, PLOTS, PLOT, SX, SZ, NCX, NCZ } from '../js/world.js';
import { generateCity } from '../js/city.js';
import { BLOCKS, B, shapeBoxes, connects } from '../js/blocks.js';

function build() { const w = new World(); w.bulk = true; generateCity(w); w.bulk = false; return w; }
const hash = (w) => crypto.createHash('sha1').update(w.data).update(w.meta).digest('hex');
const world = build();

test('city: generation is deterministic (every player must get the identical Lagos)', () => {
  assert.equal(hash(build()), hash(world));
});

test('city: only valid block ids, sensible amount of content, nothing outside the world height', () => {
  let nonAir = 0;
  for (let i = 0; i < world.data.length; i++) { const id = world.data[i]; if (id) { nonAir++; assert.ok(id < BLOCKS.length, 'bad id ' + id); } }
  assert.ok(nonAir > 100_000 && nonAir < 400_000, 'blocks: ' + nonAir);
  for (let c = 0; c < NCX * NCZ; c++) assert.ok(world.top[c] <= HEIGHT);
});

test('city: structures stay inside their plot (only street lamps stand on the pavement around it)', () => {
  for (const p of PLOTS) {
    for (let y = 1; y < HEIGHT; y++) {
      for (let i = -1; i <= PLOT; i++) {
        for (const [x, z] of [[p.x + i, p.z - 1], [p.x + i, p.z + PLOT], [p.x - 1, p.z + i], [p.x + PLOT, p.z + i]]) {
          const id = world.get(x, y, z);
          assert.ok(!id || id === B.LAMP_POST || id === B.LANTERN || id === B.PLANK_SLAB, `plot ${p.number} (${p.style}) leaks ${BLOCKS[id]?.name} at ${x},${y},${z}`);
        }
      }
    }
  }
});

test('city: free plots start with a flag, a white border and no buildings; landmarks have content', () => {
  const free = PLOTS.filter((p) => p.claimable);
  assert.ok(free.length >= 40);
  for (const p of free.slice(0, 5)) {
    assert.equal(world.get(p.x, 0, p.z), B.WHITE, 'white border');
    assert.equal(world.get(p.x + 16, 8, p.z + 28), B.LAMP_POST, 'flag pole');
    assert.equal(world.get(p.x + 17, 6, p.z + 28), B.FLAG);
  }
  for (const p of PLOTS.filter((q) => !q.claimable)) {
    let blocks = 0;
    for (let y = 1; y < HEIGHT && blocks < 50; y++) for (let z = p.z; z < p.z + PLOT; z++) for (let x = p.x; x < p.x + PLOT; x++) if (world.get(x, y, z)) blocks++;
    assert.ok(blocks >= 50, `${p.name || p.owner} should have real content`);
  }
});

test('city: roads, plaza and beach exist', () => {
  assert.equal(world.get(164, 0, 164), B.MARBLE, 'plaza floor');
  assert.equal(world.get(163, 13, 163), B.WHITE, 'monument');
  assert.equal(world.get(7, 0, 20), B.PAVEMENT, 'kerb');
  assert.equal(world.get(5, 0, 20), B.ASPHALT, 'carriageway');
  assert.equal(world.get(100, 0, 330), B.SAND);
  assert.equal(world.get(100, 0, SZ - 1), B.WET_SAND);
  assert.equal(world.get(0, 1, 100), B.BRICK, 'city wall');
});

test('shapes: fences and panes connect to neighbours and nothing else', () => {
  assert.equal(connects(B.WOOD_FENCE, B.WOOD_FENCE), true);
  assert.equal(connects(B.WOOD_FENCE, B.IRON_FENCE), true);
  assert.equal(connects(B.WOOD_FENCE, B.BRICK), true);
  assert.equal(connects(B.WOOD_FENCE, B.GLASS), false, 'transparent blocks are not solid walls');
  assert.equal(connects(B.WOOD_FENCE, B.AIR), false);
  assert.equal(connects(B.GLASS_PANE, B.GLASS), true);
  assert.equal(connects(B.GLASS_PANE, B.BRICK), true);
  assert.equal(connects(B.GLASS_PANE, B.PLANKS), true);
  assert.equal(connects(B.GLASS_PANE, B.WOOD_FENCE), false);
  assert.equal(shapeBoxes(B.WOOD_FENCE, 0, 0).length, 1, 'a lone post');
  assert.equal(shapeBoxes(B.WOOD_FENCE, 0, 0b0101).length, 1 + 2 * 2, 'post plus two rails per connection');
  assert.equal(shapeBoxes(B.GLASS_PANE, 0, 0b1111).length, 5);
  assert.equal(shapeBoxes(B.LAMP_POST, 0, 0)[0][4], 1);
  assert.equal(shapeBoxes(B.RED_CARPET, 0, 0)[0][4], 0.0625);
});

test('world: collision boxes follow fence connections and block light correctly', () => {
  const w = new World();
  w.set(10, 1, 10, B.WOOD_FENCE); w.set(11, 1, 10, B.WOOD_FENCE); w.set(10, 1, 9, B.BRICK);
  assert.equal(w.connMask(10, 1, 10, B.WOOD_FENCE), 0b0011, 'north brick and east fence');
  assert.equal(w.solidBoxes(10, 1, 10).length, 1 + 2 * 2);
  assert.equal(w.solidBoxes(12, 1, 10), null);
  w.set(20, 1, 20, B.LANTERN);
  assert.equal(w.solidBoxes(20, 1, 20), null, 'lanterns do not block walking');
  w.set(30, 1, 30, B.GLASS_PANE);
  w.computeAllLight();
  assert.equal(w.lightAt(30, 1, 30).sky, 15, 'light passes through panes');
  assert.equal(w.lightAt(20, 1, 20).blk, 15, 'lanterns glow');
  assert.ok(w.lightAt(23, 1, 20).blk >= 11, 'and spread light');
});
