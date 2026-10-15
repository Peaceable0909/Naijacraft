// Top-down maps of the city: a round local minimap in the corner and a full map with teleport.
//
// The 3D view is left-handed, so every map draws x mirrored (map x = SX - world x). Then north is up, east is to the
// right and turning right in the game turns the arrow clockwise, exactly as on a paper map.
import { BLOCKS, tileAverages } from './blocks.js';
import { SX, SZ, HEIGHT, PLOTS, PLOT, CITY, DISTRICT_NAMES, mapX } from './world.js';

const SEA = '#1b5e8a';

export function createMinimap(world, atlas) {
  const avg = tileAverages(atlas);
  const base = document.createElement('canvas');
  base.width = SX; base.height = SZ;
  const bg = base.getContext('2d');
  const img = bg.createImageData(SX, SZ);

  function column(x, z) {
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const id = world.get(x, y, z);
      if (!id) continue;
      const b = BLOCKS[id];
      const c = avg[b.render === 'cross' ? b.side : b.top];
      const k = 0.78 + Math.min(0.4, y * 0.025);
      const i = (z * SX + (SX - 1 - x)) * 4;
      img.data[i] = Math.min(255, c[0] * k); img.data[i + 1] = Math.min(255, c[1] * k); img.data[i + 2] = Math.min(255, c[2] * k); img.data[i + 3] = 255;
      return;
    }
  }
  for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) column(x, z);
  bg.putImageData(img, 0, 0);

  function update(x0, z0, x1, z1) {
    for (let z = Math.max(0, z0); z <= Math.min(SZ - 1, z1); z++) for (let x = Math.max(0, x0); x <= Math.min(SX - 1, x1); x++) column(x, z);
    bg.putImageData(img, 0, 0);
  }

  // An arrow at (px, pz) pointing where a player facing `yaw` looks (yaw 180 degrees = north = up).
  function arrow(g, px, pz, yaw, r, fill) {
    g.save();
    g.translate(px, pz);
    g.rotate(yaw + Math.PI);
    g.fillStyle = fill; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.7, r * 0.8); g.lineTo(0, r * 0.4); g.lineTo(-r * 0.7, r * 0.8); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }

  // The corner minimap: north-up, centred on the player, `radius` blocks to each side.
  function drawLocal(canvas, player, extras = {}, radius = 44) {
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, s = W / (radius * 2);
    const cx = mapX(player.pos.x), cz = player.pos.z;
    g.imageSmoothingEnabled = false;
    g.fillStyle = SEA;
    g.fillRect(0, 0, W, H);
    g.save();
    g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); g.clip();
    const sx0 = cx - radius, sz0 = cz - radius;
    const ix0 = Math.max(0, sx0), iz0 = Math.max(0, sz0), ix1 = Math.min(SX, sx0 + radius * 2), iz1 = Math.min(SZ, sz0 + radius * 2);
    if (ix1 > ix0 && iz1 > iz0) g.drawImage(base, ix0, iz0, ix1 - ix0, iz1 - iz0, (ix0 - sx0) * s, (iz0 - sz0) * s, (ix1 - ix0) * s, (iz1 - iz0) * s);
    const sx = (x) => (mapX(x) - sx0) * s, sz = (z) => (z - sz0) * s;
    if (extras.myPlot) {
      g.strokeStyle = '#f2c230'; g.lineWidth = Math.max(2, s * 0.9);
      g.strokeRect(sx(extras.myPlot.x + PLOT), sz(extras.myPlot.z), PLOT * s, PLOT * s);
    }
    for (const v of extras.vehicles || []) { g.fillStyle = '#f2c230'; g.fillRect(sx(v.x) - s * 1.4, sz(v.z) - s * 1.4, s * 2.8, s * 2.8); }
    for (const r of extras.residents || []) { g.fillStyle = '#ffffff'; g.fillRect(sx(r.x) - s * 0.7, sz(r.z) - s * 0.7, s * 1.4, s * 1.4); }
    for (const o of extras.others || []) {
      g.fillStyle = '#7ee0ff'; g.strokeStyle = '#06324a'; g.lineWidth = 1;
      g.beginPath(); g.arc(sx(o.x), sz(o.z), Math.max(3, s * 1.1), 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.restore();
    arrow(g, W / 2, H / 2, player.yaw, Math.max(6, s * 2.6), '#e63946');
  }

  // The full map. Labels show plot owners and landmark names.
  function drawFull(canvas, player, extras = {}) {
    const g = canvas.getContext('2d');
    const s = canvas.width / SX;
    g.imageSmoothingEnabled = false;
    g.fillStyle = SEA;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(base, 0, 0, SX * s, SZ * s);
    const mine = extras.myPlot ? extras.myPlot.number : -1;
    const owners = extras.owners || new Map();
    const left = (p) => mapX(p.x + PLOT) * s, top = (p) => p.z * s;     // top-left corner of a plot on the map

    // plot outlines: yellow = yours, green = free to claim
    for (const p of PLOTS) {
      const taken = owners.get(p.number);
      if (p.number === mine) { g.strokeStyle = '#f2c230'; g.lineWidth = Math.max(2, s * 0.9); }
      else if (p.claimable && !taken) { g.strokeStyle = 'rgba(150,255,190,.85)'; g.lineWidth = Math.max(1, s * 0.5); }
      else continue;
      g.strokeRect(left(p), top(p), PLOT * s, PLOT * s);
    }

    const fs = Math.max(8, Math.round(s * 4.2));
    g.font = `700 ${fs}px "Nunito", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const p of PLOTS) {
      const taken = owners.get(p.number);
      let label, sub = '';
      if (p.number === mine) { label = extras.plotName || 'Your plot'; sub = 'You'; }
      else if (taken) { label = taken.name || taken.owner; sub = taken.name ? taken.owner : ''; }
      else if (p.name) label = p.name;
      else if (p.owner) label = p.owner + "'s home";
      else if (p.claimable) label = 'Free #' + p.number;
      else label = 'Plot ' + p.number;
      const cx = left(p) + (PLOT * s) / 2, cz = top(p) + (PLOT * s) / 2;
      const w = Math.min(PLOT * s - 4, g.measureText(label).width + 10);
      g.fillStyle = p.number === mine ? 'rgba(80,58,0,.82)' : 'rgba(6,30,22,.66)';
      const h = fs * (sub ? 2.35 : 1.5);
      g.fillRect(cx - w / 2, cz - h / 2, w, h);
      g.fillStyle = p.number === mine ? '#ffd761' : '#fff';
      g.fillText(label, cx, cz - (sub ? fs * 0.5 : 0), PLOT * s - 8);
      if (sub) { g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `600 ${Math.round(fs * 0.8)}px "Nunito", system-ui, sans-serif`; g.fillText(sub, cx, cz + fs * 0.62, PLOT * s - 8); g.font = `700 ${fs}px "Nunito", system-ui, sans-serif`; }
    }
    // district names, between the two plot columns they cover
    g.font = `800 ${Math.round(fs * 1.5)}px "Lilita One", "Nunito", system-ui, sans-serif`;
    g.fillStyle = 'rgba(255,255,255,.34)';
    for (const [i, name] of DISTRICT_NAMES.flat().entries()) {
      const col = (i % 4) * 2 + 1, row = Math.floor(i / 4) * 4 + 2;
      g.fillText(name.toUpperCase(), (col * 40 + 4) * s, (row * 40 + 6) * s);
    }
    g.font = `800 ${Math.round(fs * 1.4)}px "Lilita One", "Nunito", system-ui, sans-serif`;
    g.fillStyle = '#fff';
    g.fillText('BAR BEACH', (SX / 2) * s, (CITY + 14) * s);
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.fillText('ATLANTIC OCEAN', (SX / 2) * s, Math.min(canvas.height - fs, SZ * s + fs * 2));

    for (const v of extras.vehicles || []) { g.fillStyle = '#f2c230'; g.fillRect(mapX(v.x) * s - s * 1.2, v.z * s - s * 1.2, s * 2.4, s * 2.4); }
    for (const r of extras.residents || []) { g.fillStyle = '#ffffff'; g.fillRect(mapX(r.x) * s - s * 0.6, r.z * s - s * 0.6, s * 1.2, s * 1.2); }
    g.font = `700 ${Math.round(fs * 0.9)}px "Nunito", system-ui, sans-serif`;
    for (const o of extras.others || []) {
      const ox = mapX(o.x) * s;
      g.fillStyle = '#7ee0ff'; g.strokeStyle = '#06324a'; g.lineWidth = 2;
      g.beginPath(); g.arc(ox, o.z * s, Math.max(4, s * 1.6), 0, Math.PI * 2); g.fill(); g.stroke();
      if (o.name) { g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.7)'; g.lineWidth = 3; g.strokeText(o.name, ox, o.z * s - s * 3); g.fillText(o.name, ox, o.z * s - s * 3); }
    }
    arrow(g, mapX(player.pos.x) * s, player.pos.z * s, player.yaw, Math.max(7, s * 3), '#e63946');
  }

  // Just the terrain, scaled to fill the canvas (used behind the claim screen).
  function drawBase(canvas) {
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = SEA;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(base, 0, 0, canvas.width, (SZ / SX) * canvas.width);
  }

  return { drawLocal, drawFull, drawBase, update };
}
