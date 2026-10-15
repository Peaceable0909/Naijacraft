// DOM helpers: block icons, hotbar, inventory and toast messages.
import { BLOCKS, PALETTE, TILE, ATLAS_COLS } from './blocks.js';

const $ = (id) => document.getElementById(id);

export function makeIcon(atlas, id, size = 44) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const b = BLOCKS[id];
  const k = size / 48;
  const draw = (tile, m, shade) => {
    g.save();
    g.setTransform(m[0] * k / TILE, m[1] * k / TILE, m[2] * k / TILE, m[3] * k / TILE, m[4] * k, m[5] * k);
    g.drawImage(atlas, (tile % ATLAS_COLS) * TILE, Math.floor(tile / ATLAS_COLS) * TILE, TILE, TILE, 0, 0, TILE, TILE);
    if (shade) { g.fillStyle = `rgba(0,0,0,${shade})`; g.fillRect(0, 0, TILE, TILE); }
    g.restore();
  };
  // isometric cube: top, left, right
  draw(b.top, [20, 10, -20, 10, 24, 4], 0);
  draw(b.side, [20, 10, 0, 20, 4, 14], 0.22);
  draw(b.side, [20, -10, 0, 20, 24, 24], 0.4);
  return c;
}

export function createHud(atlas, state, onSelect) {
  const hotbar = $('hotbar');
  const inv = $('inventory-grid');
  const slotEls = [];

  function renderHotbar() {
    hotbar.innerHTML = '';
    slotEls.length = 0;
    state.hotbar.forEach((id, i) => {
      const el = document.createElement('div');
      el.className = 'slot' + (i === state.sel ? ' selected' : '');
      el.title = BLOCKS[id].name;
      el.appendChild(makeIcon(atlas, id));
      const n = document.createElement('span');
      n.textContent = i + 1;
      el.appendChild(n);
      el.addEventListener('click', () => onSelect(i));
      hotbar.appendChild(el);
      slotEls.push(el);
    });
    $('block-name').textContent = BLOCKS[state.hotbar[state.sel]].name;
  }

  PALETTE.forEach((id) => {
    const el = document.createElement('button');
    el.className = 'inv-item';
    el.title = BLOCKS[id].name;
    el.appendChild(makeIcon(atlas, id, 52));
    const label = document.createElement('small');
    label.textContent = BLOCKS[id].name;
    el.appendChild(label);
    el.addEventListener('click', () => { state.hotbar[state.sel] = id; renderHotbar(); });
    inv.appendChild(el);
  });

  return { renderHotbar };
}

let toastTimer = 0;
export function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}
