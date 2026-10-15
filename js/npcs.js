// Residents who stroll the pavements around their block and greet you when you come close.
import { createCharacter, SKINS, OUTFITS, HATS } from './characters.js';
import { PLOTS, PLOT } from './world.js';
import { mulberry32 } from './blocks.js';

const NAMES = ['Mama Nkechi', 'Baba Tunde', 'Aisha', 'Segun', 'Chioma', 'Ibrahim', 'Funmi', 'Uche', 'Halima', 'Kelechi', 'Bayo', 'Amaka', 'Musa', 'Tolu'];
const LINES = [
  'How far? Welcome to Lagos!', 'Ndewo! You don settle?', 'Sannu! Nice to see you.', 'Wetin you dey build?',
  'Abeg build me shop too!', 'This your house fine well well!', 'NEPA don take light again o!',
  'Traffic for Third Mainland no be here o.', 'Go buy suya for Yaba Market!', 'E kaabo! Feel at home.',
  'Lagos no dey carry last!', 'Have you seen Bar Beach? Go south!', 'My generator dey make noise sha.',
  'Na Lagos we dey, everything possible!',
];
function timeGreeting(t) {
  const h = t * 24;
  if (h >= 5 && h < 12) return 'E kaaro! Good morning!';
  if (h >= 12 && h < 17) return 'E kaasan! Good afternoon!';
  if (h >= 17 && h < 21) return 'E kaale! Good evening!';
  return 'Ah, you dey waka this late? Sleep well o!';
}

// Waypoints around the pavement ring of a plot (cell centres), skipping the lamp posts at the corners.
function loopFor(plot) {
  const x0 = plot.x - 1, x1 = plot.x + PLOT, z0 = plot.z - 1, z1 = plot.z + PLOT;
  const c = (x, z) => [x + 0.5, z + 0.5];
  return [c(x0 + 1, z0), c(x1 - 1, z0), c(x1, z0 + 1), c(x1, z1 - 1), c(x1 - 1, z1), c(x0 + 1, z1), c(x0, z1 - 1), c(x0, z0 + 1)];
}

export function createResidents(scene, count = 14) {
  const rand = mulberry32(77);
  const residents = [];
  for (let i = 0; i < count; i++) {
    const look = { skin: rand() * SKINS.length | 0, outfit: rand() * OUTFITS.length | 0, hat: rand() < 0.5 ? 0 : 1 + (rand() * (HATS.length - 1) | 0) };
    const char = createCharacter(scene, look, 'npc' + i);
    const plot = PLOTS[(i * 5 + 3) % PLOTS.length];
    const path = loopFor(plot);
    const k = rand() * path.length | 0;
    residents.push({
      name: NAMES[i % NAMES.length], char, path, target: (k + 1) % path.length, dir: 1,
      x: path[k][0], z: path[k][1], heading: 0, speed: 1.2 + rand() * 0.6,
      idle: rand() * 3, talk: 0, cooldown: 0, line: '', visible: true,
    });
  }

  return {
    residents,
    // Returns { greeted: resident } when someone starts talking to the player.
    update(dt, player, envT, lightAt) {
      const events = [];
      for (const r of residents) {
        const dx = player.x - r.x, dz = player.z - r.z;
        const dist = Math.hypot(dx, dz);
        r.cooldown -= dt;
        if (dist < 3.2 && Math.abs(player.y - 1) < 3 && r.talk <= 0 && r.cooldown <= 0) {
          r.talk = 4.5; r.cooldown = 25;
          r.line = Math.random() < 0.35 ? timeGreeting(envT) : LINES[Math.random() * LINES.length | 0];
          events.push({ greeted: r });
        }
        let speed = 0;
        if (r.talk > 0) {
          r.talk -= dt;
          r.heading = turn(r.heading, Math.atan2(dx, dz), dt * 8);
          r.char.wave(r.talk);
          if (r.talk <= 0) r.char.stopWave();
        } else if (r.idle > 0) {
          r.idle -= dt;
        } else {
          const [tx, tz] = r.path[r.target];
          const ex = tx - r.x, ez = tz - r.z, d = Math.hypot(ex, ez);
          if (d < 0.08) {
            r.target = (r.target + r.dir + r.path.length) % r.path.length;
            if (Math.random() < 0.15) r.idle = 1 + Math.random() * 4;
            if (Math.random() < 0.05) { r.dir = -r.dir; r.target = (r.target + 2 * r.dir + r.path.length) % r.path.length; }
          } else {
            const step = Math.min(d, r.speed * dt);
            r.x += (ex / d) * step; r.z += (ez / d) * step;
            r.heading = turn(r.heading, Math.atan2(ex, ez), dt * 10);
            speed = r.speed;
          }
        }
        r.char.animate(dt, speed);
        r.char.root.position.set(r.x, 1, r.z);
        r.char.root.rotation.y = r.heading;
        r.char.setLight(lightAt(r.x, 1.5, r.z));
      }
      return events;
    },
  };
}

function turn(cur, target, rate) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * Math.min(1, rate);
}
