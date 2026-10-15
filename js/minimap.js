// Top-down map of the city: a small minimap in the corner and a full map with teleport.
import { BLOCKS, tileAverages } from './blocks.js';
import { SX, SZ, HEIGHT, PLOTS, PLAYER_PLOT, PLOT, CITY } from './world.js';

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
      const c = avg[BLOCKS[id].top];
      const k = 0.78 + Math.min(0.4, y * 0.025);
      const i = (z * SX + x) * 4;
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

  const me = PLOTS[PLAYER_PLOT - 1];
  // Draws the map into a canvas. scale: pixels per block.
  function draw(canvas, player, extras = {}, full = false) {
    const g = canvas.getContext('2d');
    const s = canvas.width / SX;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#1b5e8a';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(base, 0, 0, SX * s, SZ * s);
    g.strokeStyle = '#f2c230'; g.lineWidth = Math.max(1.5, s * 0.8);
    g.strokeRect(me.x * s, me.z * s, PLOT * s, PLOT * s);
    if (full) {
      g.font = `bold ${Math.round(s * 4)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      for (const p of PLOTS) {
        const label = p.number === PLAYER_PLOT ? (extras.plotName || 'Your plot') : p.name || (p.owner ? p.owner : 'Plot ' + p.number);
        g.fillStyle = 'rgba(0,0,0,.55)';
        const w = g.measureText(label).width + 8;
        g.fillRect((p.x + PLOT / 2) * s - w / 2, (p.z + PLOT / 2) * s - s * 3, w, s * 4.6);
        g.fillStyle = p.number === PLAYER_PLOT ? '#f2c230' : '#fff';
        g.fillText(label, (p.x + PLOT / 2) * s, (p.z + PLOT / 2) * s + s * 0.6);
      }
      g.fillStyle = '#fff';
      g.fillText('BAR BEACH', (SX / 2) * s, (CITY + 9) * s);
      g.fillText('ATLANTIC OCEAN', (SX / 2) * s, SZ * s + s * 6);
    }
    for (const v of extras.vehicles || []) { g.fillStyle = '#f2c230'; g.fillRect(v.x * s - s * 1.2, v.z * s - s * 1.2, s * 2.4, s * 2.4); }
    for (const r of extras.residents || []) { g.fillStyle = '#ffffff'; g.fillRect(r.x * s - s * 0.6, r.z * s - s * 0.6, s * 1.2, s * 1.2); }
    // player arrow
    const px = player.pos.x * s, pz = player.pos.z * s, a = player.yaw;
    const r = Math.max(5, s * 3);
    g.save();
    g.translate(px, pz);
    g.rotate(-a + Math.PI);
    g.fillStyle = '#e63946'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.7, r * 0.8); g.lineTo(0, r * 0.4); g.lineTo(-r * 0.7, r * 0.8); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }

  return { draw, update };
}
