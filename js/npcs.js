// Residents who stroll the pavements around their block and greet you when you come close.
//
// Positions are a pure function of the shared clock, so every player sees the same residents in the same places.
// Only the greetings (who waves at you, and when) are local.
import { createCharacter, SKINS, OUTFITS, HATS } from './characters.js';
import { PLOTS, PLOT } from './world.js';
import { mulberry32 } from './blocks.js';

const NAMES = [
  'Mama Nkechi', 'Baba Tunde', 'Aisha', 'Segun', 'Chioma', 'Ibrahim', 'Funmi', 'Uche', 'Halima', 'Kelechi', 'Bayo', 'Amaka',
  'Musa', 'Tolu', 'Ngozi', 'Femi', 'Sade', 'Obinna', 'Hauwa', 'Jide', 'Bukola', 'Emeka', 'Zainab', 'Dayo',
];
const LINES = [
  'How far? Welcome to Lagos!', 'Ndewo! You don settle?', 'Sannu! Nice to see you.', 'Wetin you dey build?',
  'Abeg build me shop too!', 'This your house fine well well!', 'NEPA don take light again o!',
  'Traffic for Third Mainland no be here o.', 'Go buy suya for Balogun Market!', 'E kaabo! Feel at home.',
  'Lagos no dey carry last!', 'Have you seen Bar Beach? Go south!', 'My generator dey make noise sha.',
  'Na Lagos we dey, everything possible!', 'Make you try the jollof for Mama Put!', 'Computer Village get everything.',
];
function timeGreeting(t) {
  const h = t * 24;
  if (h >= 5 && h < 12) return 'E kaaro! Good morning!';
  if (h >= 12 && h < 17) return 'E kaasan! Good afternoon!';
  if (h >= 17 && h < 21) return 'E kaale! Good evening!';
  return 'Ah, you dey waka this late? Sleep well o!';
}

// Waypoints around the pavement ring of a plot (cell centres). Corner lamp posts are skipped, and the loop steps
// out round the mid-block lamp posts on the south and east pavements.
function loopFor(plot) {
  const x0 = plot.x - 1, x1 = plot.x + PLOT, z0 = plot.z - 1, z1 = plot.z + PLOT;
  const midX = plot.x + PLOT / 2, midZ = plot.z + PLOT / 2;
  const c = (x, z) => [x + 0.5, z + 0.5];
  return [
    c(x0 + 1, z0), c(x1 - 1, z0),
    c(x1, z0 + 1), c(x1, midZ - 3), c(x1 + 1, midZ - 2), c(x1 + 1, midZ + 2), c(x1, midZ + 3), c(x1, z1 - 1),
    c(x1 - 1, z1), c(midX + 3, z1), c(midX + 2, z1 + 1), c(midX - 2, z1 + 1), c(midX - 3, z1), c(x0 + 1, z1),
    c(x0, z1 - 1), c(x0, z0 + 1),
  ];
}

function segmentsOf(path) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i], q = path[(i + 1) % path.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    segs.push({ p, q, len, start: total, heading: Math.atan2(q[0] - p[0], q[1] - p[1]) });
    total += len;
  }
  return { segs, total };
}

export function createResidents(scene, count = 24) {
  const rand = mulberry32(77);
  const residents = [];
  for (let i = 0; i < count; i++) {
    const look = { skin: rand() * SKINS.length | 0, outfit: rand() * OUTFITS.length | 0, hat: rand() < 0.5 ? 0 : 1 + (rand() * (HATS.length - 1) | 0) };
    const char = createCharacter(scene, look, 'npc' + i);
    const plot = PLOTS[(i * 5 + 3) % PLOTS.length];
    const { segs, total } = segmentsOf(loopFor(plot));
    const walk = 22 + rand() * 24;
    residents.push({
      name: NAMES[i % NAMES.length], char, segs, total,
      speed: 1.15 + rand() * 0.6, dir: rand() < 0.5 ? 1 : -1, offset: rand() * total,
      walk, rest: 3 + rand() * 6, shift: rand() * 100,
      x: plot.x, z: plot.z, heading: 0, moving: false,
      talk: 0, cooldown: 0, line: '', visible: true, phase: 0,
    });
  }

  function place(r, clock) {
    const cycle = r.walk + r.rest;
    const t = clock + r.shift;
    const k = Math.floor(t / cycle), ph = t - k * cycle;
    r.moving = ph < r.walk;
    const travelled = (k * r.walk + Math.min(ph, r.walk)) * r.speed;
    const s = (((r.offset + r.dir * travelled) % r.total) + r.total) % r.total;
    for (const g of r.segs) {
      if (s <= g.start + g.len) {
        const f = (s - g.start) / g.len;
        r.x = g.p[0] + (g.q[0] - g.p[0]) * f; r.z = g.p[1] + (g.q[1] - g.p[1]) * f;
        r.heading = r.dir > 0 ? g.heading : g.heading + Math.PI;
        return;
      }
    }
  }

  return {
    residents,
    // clock: shared time in seconds. Returns { greeted: resident } events when someone starts talking to the player.
    update(clock, dt, player, envT, lightAt) {
      const events = [];
      for (const r of residents) {
        place(r, clock);
        const dx = player.x - r.x, dz = player.z - r.z;
        const dist = Math.hypot(dx, dz);
        r.cooldown -= dt;
        if (dist < 3.2 && Math.abs(player.y - 1) < 3 && r.talk <= 0 && r.cooldown <= 0) {
          r.talk = 4.5; r.cooldown = 25;
          r.line = Math.random() < 0.35 ? timeGreeting(envT) : LINES[Math.random() * LINES.length | 0];
          events.push({ greeted: r });
        }
        if (r.talk > 0) {
          r.talk -= dt;
          if (!r.moving) r.heading = Math.atan2(dx, dz);        // stand and chat; keep walking if already on the move
        }
        r.char.animate(dt, r.moving ? r.speed : 0);
        if (r.talk > 0) r.char.wave(r.talk); else if (r.talk > -0.2) { r.char.stopWave(); r.talk = -1; }
        r.char.root.position.set(r.x, 1, r.z);
        r.char.root.rotation.y = r.heading;
        r.char.setLight(lightAt(r.x, 1.5, r.z));
      }
      return events;
    },
  };
}
