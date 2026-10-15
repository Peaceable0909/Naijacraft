// Moving traffic: yellow danfo buses and a keke napep driving loops around the city (right-hand traffic).
import { createCharMaterial } from './render.js';
import { SX, CITY, PITCH } from './world.js';

const BABYLON = window.BABYLON;

function part(scene, name, opts, mat, parent, x, y, z) {
  const m = BABYLON.MeshBuilder.CreateBox(name, opts, scene);
  m.material = mat; m.parent = parent; m.position.set(x, y, z);
  m.isPickable = false; m.renderingGroupId = 1;
  return m;
}

function wheel(scene, name, mat, parent, x, y, z, r) {
  const w = BABYLON.MeshBuilder.CreateCylinder(name, { diameter: r * 2, height: 0.3, tessellation: 10 }, scene);
  w.rotation.z = Math.PI / 2; w.material = mat; w.parent = parent; w.position.set(x, y, z);
  w.isPickable = false; w.renderingGroupId = 1;
  return w;
}

// Fewer draw calls: merge each vehicle's static parts that share a material (headlights stay separate).
function mergeByMaterial(root, keep) {
  const groups = new Map();
  for (const m of root.getChildMeshes(true)) {
    if (keep.includes(m)) continue;
    if (!groups.has(m.material)) groups.set(m.material, []);
    groups.get(m.material).push(m);
  }
  for (const [mat, list] of groups) {
    if (list.length < 2) continue;
    const merged = BABYLON.Mesh.MergeMeshes(list, true, true);
    if (!merged) continue;
    merged.material = mat; merged.parent = root; merged.isPickable = false; merged.renderingGroupId = 1;
  }
}

function buildDanfo(scene, name, mats) {
  const root = new BABYLON.TransformNode(name, scene);
  const L = 5.6, W = 2.3;
  part(scene, name + '-body', { width: W, height: 1.0, depth: L }, mats.yellow, root, 0, 0.85, 0);
  part(scene, name + '-stripe', { width: W + 0.02, height: 0.22, depth: L + 0.02 }, mats.black, root, 0, 1.15, 0);
  part(scene, name + '-win', { width: W - 0.04, height: 0.7, depth: L - 0.5 }, mats.glass, root, 0, 1.6, -0.2);
  part(scene, name + '-windscreen', { width: W - 0.2, height: 0.7, depth: 0.1 }, mats.glass, root, 0, 1.6, L / 2 - 0.02);
  part(scene, name + '-pillarF', { width: W, height: 0.7, depth: 0.25 }, mats.yellow, root, 0, 1.6, L / 2 - 0.25);
  part(scene, name + '-roof', { width: W, height: 0.15, depth: L - 0.1 }, mats.yellow, root, 0, 2.02, -0.05);
  part(scene, name + '-rack', { width: W - 0.5, height: 0.12, depth: L - 1.6 }, mats.black, root, 0, 2.15, -0.4);
  part(scene, name + '-bumper', { width: W, height: 0.25, depth: 0.15 }, mats.black, root, 0, 0.45, L / 2);
  const lights = [-0.8, 0.8].map((x, i) => part(scene, name + '-hl' + i, { width: 0.32, height: 0.2, depth: 0.06 }, mats.headlight, root, x, 0.75, L / 2 + 0.02));
  for (const [x, z, i] of [[-1.1, 1.8, 0], [1.1, 1.8, 1], [-1.1, -1.8, 2], [1.1, -1.8, 3]]) wheel(scene, name + '-w' + i, mats.tyre, root, x, 0.4, z, 0.4);
  mergeByMaterial(root, lights);
  return { root, length: L, width: W, lights };
}

function buildKeke(scene, name, mats) {
  const root = new BABYLON.TransformNode(name, scene);
  part(scene, name + '-body', { width: 1.3, height: 0.7, depth: 2.4 }, mats.green, root, 0, 0.7, 0);
  part(scene, name + '-nose', { width: 0.7, height: 0.5, depth: 0.5 }, mats.yellow, root, 0, 0.8, 1.35);
  part(scene, name + '-canopy', { width: 1.35, height: 0.08, depth: 2.2 }, mats.black, root, 0, 1.9, -0.1);
  for (const [x, z, i] of [[-0.62, -0.95, 0], [0.62, -0.95, 1], [-0.62, 0.75, 2], [0.62, 0.75, 3]]) part(scene, name + '-post' + i, { width: 0.06, height: 0.9, depth: 0.06 }, mats.black, root, x, 1.45, z);
  part(scene, name + '-screen', { width: 1.1, height: 0.6, depth: 0.05 }, mats.glass, root, 0, 1.45, 0.95);
  const lights = [part(scene, name + '-hl', { width: 0.25, height: 0.2, depth: 0.05 }, mats.headlight, root, 0, 0.85, 1.62)];
  for (const [x, z, i] of [[0, 1.3, 0], [-0.6, -0.8, 1], [0.6, -0.8, 2]]) wheel(scene, name + '-w' + i, mats.tyre, root, x, 0.3, z, 0.3);
  mergeByMaterial(root, lights);
  return { root, length: 2.6, width: 1.3, lights };
}

const CALLS = ['Oshodi! Oshodi!', 'Obalende! Enter with your change o!', 'Ojuelegba! Straight!', 'CMS! CMS! Oya enter!', 'Yaba! Yaba! Straight!', 'Lekki! Ajah! Move body!'];

// Rectangular loops; corners listed in driving order (clockwise from above, right-hand traffic).
function ringRoute(i0, i1) {
  const a = i0 * PITCH, b = i1 * PITCH;
  return [[a + 5.5, a + 5.5], [b + 2.5, a + 5.5], [b + 2.5, b + 2.5], [a + 5.5, b + 2.5]];
}

export function createTraffic(scene) {
  const mats = {
    yellow: createCharMaterial(scene, '#f2c230'),
    green: createCharMaterial(scene, '#2e8b45'),
    black: createCharMaterial(scene, '#1e1e22'),
    glass: createCharMaterial(scene, '#3a4c5c'),
    tyre: createCharMaterial(scene, '#141416'),
    headlight: createCharMaterial(scene, '#fff3c4', null, true),
  };
  const outer = ringRoute(0, 4), inner = ringRoute(1, 3);
  const defs = [
    { kind: 'danfo', route: outer, speed: 7.5, offset: 0.1 },
    { kind: 'danfo', route: outer, speed: 7.5, offset: 0.6 },
    { kind: 'danfo', route: inner, speed: 6.5, offset: 0.3 },
    { kind: 'keke', route: inner, speed: 5, offset: 0.8 },
  ];
  const vehicles = defs.map((d, n) => {
    const model = d.kind === 'danfo' ? buildDanfo(scene, 'danfo' + n, mats) : buildKeke(scene, 'keke' + n, mats);
    const segs = d.route.map((p, i) => { const q = d.route[(i + 1) % d.route.length]; return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) }; });
    const total = segs.reduce((s, g) => s + g.len, 0);
    return { ...d, ...model, segs, total, dist: d.offset * total, heading: 0, stopped: 0, honked: 0, call: CALLS[n % CALLS.length], x: 0, z: 0 };
  });

  function place(v) {
    let d = ((v.dist % v.total) + v.total) % v.total;
    for (const g of v.segs) {
      if (d <= g.len) {
        const t = d / g.len;
        v.x = g.p[0] + (g.q[0] - g.p[0]) * t; v.z = g.p[1] + (g.q[1] - g.p[1]) * t;
        const target = Math.atan2(g.q[0] - g.p[0], g.q[1] - g.p[1]);
        let diff = target - v.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        v.heading += diff * Math.min(1, 0.25);
        break;
      }
      d -= g.len;
    }
    v.root.position.set(v.x, 1, v.z);
    v.root.rotation.y = v.heading;
  }
  vehicles.forEach((v) => { for (let k = 0; k < 20; k++) place(v); });

  return {
    vehicles,
    // Returns events: { honk: vehicle } when a bus brakes for the player.
    update(dt, player, light, isNight) {
      const events = [];
      for (const v of vehicles) {
        // brake if the player is in the lane just ahead
        const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
        const dx = player.x - v.x, dz = player.z - v.z;
        const ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
        const blocked = player.y < 4 && ahead > 0 && ahead < v.length / 2 + 3 && side < v.width / 2 + 0.6;
        if (blocked) {
          if (v.honked <= 0) { events.push({ honk: v }); v.honked = 4; }
        } else {
          v.dist += v.speed * dt;
        }
        v.honked -= dt;
        place(v);
        for (const l of v.lights) l.scaling.setAll(isNight ? 1.25 : 1);
      }
      for (const m of [mats.yellow, mats.green, mats.black, mats.glass, mats.tyre]) m.setColor3('light', light);
      return events;
    },
  };
}

export { CALLS };
export const ROUTE_BOUNDS = { min: 0, max: SX, city: CITY };
