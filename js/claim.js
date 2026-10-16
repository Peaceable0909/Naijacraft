// The "choose your land" screen: a map of all 64 plots. Free land is selectable; taken land and landmarks are not.
import { $ } from './game.js';
import { PLOTS, PLOT, SX, SZ, CITY, districtAt, plotAt, mapX } from './world.js';
import { claimOrder } from '../shared/layout.js';

const SCALE = 2;

export function createClaimScreen({ minimap, getOwners, onClaim }) {
  const canvas = $('claim-map'), tip = $('claim-tip');
  canvas.width = SX * SCALE; canvas.height = SZ * SCALE;
  let selected = null, hover = null, open = false, busy = false;
  const order = claimOrder();

  const plotUnder = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = mapX((e.clientX - r.left) / r.width * SX), z = (e.clientY - r.top) / r.height * SZ;     // maps draw x mirrored
    return plotAt(x, z);
  };

  function describe(p) {
    const owners = getOwners();
    const center = CITY / 2, d = Math.round(Math.hypot(p.x + PLOT / 2 - center, p.z + PLOT / 2 - center));
    // nearest landmark
    let near = null, nd = Infinity;
    for (const q of PLOTS) {
      if (q.claimable || !q.name) continue;
      const dd = Math.hypot(q.x - p.x, q.z - p.z);
      if (dd < nd) { nd = dd; near = q; }
    }
    const bits = [];
    bits.push(d < 70 ? 'Right by the central plaza.' : d < 130 ? 'A short walk from the plaza.' : 'Out in the quiet suburbs.');
    if (near && nd < 90) bits.push(`Close to ${near.name}.`);
    if (p.row === 7) bits.push('The beach is just down the road.');
    if (p.col === 0 || p.col === 7 || p.row === 0) bits.push('Corner of the city wall: extra privacy.');
    return { d, bits, taken: owners.get(p.number) };
  }

  function info() {
    const box = $('claim-info');
    if (!selected) {
      box.innerHTML = '<p class="empty">Tap a green plot on the map to see what it\'s like. Every plot is the same size, so choose by neighbourhood.</p>';
      $('claim-go').disabled = true; $('claim-go').textContent = 'Pick a plot on the map';
      return;
    }
    const p = selected, { bits } = describe(p);
    box.innerHTML = '';
    const h = document.createElement('h3'); h.textContent = `Plot ${p.number}`;
    const sub = document.createElement('p'); sub.className = 'muted'; sub.textContent = p.district;
    const ul = document.createElement('ul');
    for (const b of bits) { const li = document.createElement('li'); li.textContent = b; ul.appendChild(li); }
    box.append(h, sub, ul);
    $('claim-go').disabled = busy; $('claim-go').textContent = busy ? 'Claiming...' : `Claim plot ${p.number}`;
  }

  function draw() {
    const g = canvas.getContext('2d');
    const owners = getOwners();
    minimap.drawBase(canvas);
    g.fillStyle = 'rgba(2, 14, 9, .38)';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const fs = 11 * SCALE / 1.4;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const p of PLOTS) {
      const x = mapX(p.x + PLOT) * SCALE, z = p.z * SCALE, w = PLOT * SCALE;
      const taken = owners.get(p.number);
      if (p.claimable && !taken) {
        const sel = selected && selected.number === p.number, hov = hover && hover.number === p.number;
        g.fillStyle = sel ? 'rgba(255,255,255,.55)' : hov ? 'rgba(125,255,180,.5)' : 'rgba(125,255,180,.28)';
        g.fillRect(x, z, w, w);
        g.strokeStyle = sel ? '#fff' : '#7dffb4'; g.lineWidth = sel ? 4 : 2;
        g.strokeRect(x + 1, z + 1, w - 2, w - 2);
        g.fillStyle = sel ? '#06281a' : '#eafff3'; g.font = `800 ${fs * 1.5}px Nunito, system-ui, sans-serif`;
        g.fillText(String(p.number), x + w / 2, z + w / 2);
      } else {
        g.fillStyle = taken ? 'rgba(14, 22, 18, .78)' : 'rgba(40, 30, 6, .5)';
        g.fillRect(x, z, w, w);
        g.strokeStyle = taken ? 'rgba(170,181,174,.7)' : 'rgba(255,200,61,.7)'; g.lineWidth = 2;
        g.strokeRect(x + 1, z + 1, w - 2, w - 2);
        g.fillStyle = taken ? '#cdd6d0' : '#ffd761'; g.font = `800 ${fs}px Nunito, system-ui, sans-serif`;
        const label = taken ? taken.owner : p.name || (p.owner ? p.owner + "'s home" : 'Plot ' + p.number);
        g.fillText(label, x + w / 2, z + w / 2, w - 8);
      }
    }
  }

  // On short screens (a phone held sideways) the map is sized to fit the height so nothing needs scrolling.
  function layout() {
    const wrap = canvas.parentElement;
    const head = $('claim').querySelector('.claim-head');
    const avail = window.innerHeight - (head ? head.offsetHeight : 0) - 56;
    const byHeight = Math.max(220, avail) * (canvas.width / canvas.height);
    canvas.style.width = Math.min(wrap.clientWidth || 640, byHeight, 640) + 'px';
  }
  window.addEventListener('resize', () => { if (open) layout(); });

  function redraw() { if (open) { draw(); info(); } }

  canvas.addEventListener('mousemove', (e) => {
    const p = plotUnder(e);
    hover = p && p.claimable && !getOwners().get(p.number) ? p : null;
    canvas.style.cursor = hover ? 'pointer' : 'default';
    if (p) {
      const r = canvas.getBoundingClientRect();
      tip.textContent = p.claimable ? (getOwners().get(p.number) ? `${getOwners().get(p.number).owner}'s plot` : `Plot ${p.number} - ${p.district}`) : (p.name || `${p.owner}'s home`);
      tip.style.left = e.clientX - r.left + 'px'; tip.style.top = e.clientY - r.top + 'px';
      tip.classList.remove('hidden');
    } else tip.classList.add('hidden');
    draw();
  });
  canvas.addEventListener('mouseleave', () => { hover = null; tip.classList.add('hidden'); draw(); });
  canvas.addEventListener('click', (e) => {
    const p = plotUnder(e);
    if (p && p.claimable && !getOwners().get(p.number)) { selected = p; $('claim-error').textContent = ''; }
    redraw();
  });

  async function submit(target) {
    if (busy) return;
    busy = true; $('claim-error').textContent = ''; info();
    try { await onClaim(target); } catch (e) { $('claim-error').textContent = e.message || 'Could not claim that plot.'; if (selected && getOwners().get(selected.number)) selected = null; }
    busy = false; redraw();
  }
  $('claim-go').addEventListener('click', () => selected && submit(selected.number));
  $('claim-auto').addEventListener('click', () => submit('auto'));

  return {
    show() { open = true; selected = null; hover = null; busy = false; $('claim-error').textContent = ''; $('claim').classList.remove('hidden'); layout(); draw(); info(); },
    hide() { open = false; $('claim').classList.add('hidden'); },
    redraw,
    // Shows the server's refusal ("someone else got that plot first") inside the screen.
    fail(message) { busy = false; $('claim-error').textContent = message; if (selected && getOwners().get(selected.number)) selected = null; redraw(); },
    get isOpen() { return open; },
    order,
    districtAt,
  };
}
