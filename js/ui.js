// DOM helpers: hotbar, inventory (blocks + blueprints), character picker, toasts, achievements, bubbles.
import { BLOCKS, CATEGORIES } from './blocks.js';
import { makeBlockIcon, makeStructPreview, blueprints } from './prefabs.js';
import { SKINS, OUTFITS, HATS, drawLookPreview } from './characters.js';
import { ACHIEVEMENTS } from './achievements.js';

const $ = (id) => document.getElementById(id);
const iconCache = new Map();
function icon(atlas, id, size) {
  const k = id + ':' + size;
  if (!iconCache.has(k)) iconCache.set(k, makeBlockIcon(atlas, id, size));
  const src = iconCache.get(k);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

export function createHud(atlas, state, { onSelect, onBlueprint }) {
  const hotbar = $('hotbar');

  function renderHotbar() {
    hotbar.innerHTML = '';
    state.hotbar.forEach((id, i) => {
      const el = document.createElement('div');
      el.className = 'slot' + (i === state.sel ? ' selected' : '');
      el.title = BLOCKS[id].name;
      el.appendChild(icon(atlas, id, 44));
      const n = document.createElement('span');
      n.textContent = i + 1;
      el.appendChild(n);
      el.addEventListener('click', () => onSelect(i));
      el.addEventListener('touchstart', (e) => { e.preventDefault(); onSelect(i); }, { passive: false });
      hotbar.appendChild(el);
    });
    $('block-name').textContent = BLOCKS[state.hotbar[state.sel]].name;
  }

  // inventory tabs
  const tabs = $('inv-tabs'), grid = $('inventory-grid');
  const tabNames = [...CATEGORIES.map((c) => c.name), 'Blueprints'];
  let current = 0;
  function renderTab() {
    tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === current));
    grid.innerHTML = '';
    grid.classList.toggle('bp', current === CATEGORIES.length);
    if (current < CATEGORIES.length) {
      $('inv-note').textContent = `Click a block to put it in hotbar slot ${state.sel + 1}. Press E to close.`;
      for (const id of CATEGORIES[current].blocks) {
        const el = document.createElement('button');
        el.className = 'inv-item';
        el.title = BLOCKS[id].name;
        el.appendChild(icon(atlas, id, 52));
        const label = document.createElement('small');
        label.textContent = BLOCKS[id].name;
        el.appendChild(label);
        el.addEventListener('click', () => { state.hotbar[state.sel] = id; renderHotbar(); el.classList.add('picked'); setTimeout(() => el.classList.remove('picked'), 300); });
        grid.appendChild(el);
      }
    } else {
      $('inv-note').textContent = 'Pick a blueprint, then right-click on your plot to build it. R rotates, left-click cancels.';
      blueprints().forEach((bp) => {
        const el = document.createElement('button');
        el.className = 'inv-item bp-item';
        if (!bp.preview) bp.preview = makeStructPreview(atlas, bp, 96);
        const c = document.createElement('canvas'); c.width = c.height = 96; c.getContext('2d').drawImage(bp.preview, 0, 0);
        el.appendChild(c);
        const t = document.createElement('b'); t.textContent = bp.name; el.appendChild(t);
        const d = document.createElement('small'); d.textContent = `${bp.description} (${bp.w}x${bp.d})`; el.appendChild(d);
        el.addEventListener('click', () => onBlueprint(bp));
        grid.appendChild(el);
      });
    }
  }
  tabNames.forEach((name, i) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => { current = i; renderTab(); });
    tabs.appendChild(b);
  });

  return {
    renderHotbar,
    openTab(i) { if (i !== undefined) current = i; renderTab(); },
    blueprintTab: CATEGORIES.length,
  };
}

// Skin / outfit / hat swatches with a live preview. Calls onChange(look) on every change.
export function mountLookPicker(container, look, onChange) {
  container.innerHTML = `
    <canvas class="look-preview" width="90" height="150"></canvas>
    <div class="look-rows">
      <div class="look-row"><span>Skin</span><div class="sw skin"></div></div>
      <div class="look-row"><span>Outfit</span><div class="sw outfit"></div></div>
      <div class="look-row"><span>Hat</span><div class="sw hat"></div></div>
    </div>`;
  const preview = container.querySelector('canvas');
  const rows = { skin: container.querySelector('.skin'), outfit: container.querySelector('.outfit'), hat: container.querySelector('.hat') };
  const opts = {
    skin: SKINS.map((c) => ({ style: `background:${c}`, title: '' })),
    outfit: OUTFITS.map((o) => ({ label: o.name.split(' ').slice(-1)[0], title: o.name })),
    hat: HATS.map((h) => ({ label: h.split(' ')[0], title: h })),
  };
  function render() {
    for (const key of Object.keys(rows)) {
      rows[key].innerHTML = '';
      opts[key].forEach((o, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch' + (look[key] === i ? ' on' : '') + (o.style ? ' color' : '');
        if (o.style) b.style.cssText = o.style;
        if (o.label) b.textContent = o.label;
        b.title = o.title;
        b.addEventListener('click', () => { look[key] = i; render(); onChange(look); });
        rows[key].appendChild(b);
      });
    }
    drawLookPreview(preview, look);
  }
  render();
  return { render };
}

let toastTimer = 0;
export function toast(msg, kind = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 2600);
}

const achvQueue = [];
let achvBusy = false;
export function showAchievement(a) {
  achvQueue.push(a);
  if (!achvBusy) nextAchievement();
}
function nextAchievement() {
  const a = achvQueue.shift();
  if (!a) { achvBusy = false; return; }
  achvBusy = true;
  const el = $('achv');
  el.innerHTML = `<small>Achievement unlocked</small><b>${a.title}</b><span>${a.desc}</span>`;
  el.classList.add('show');
  setTimeout(() => { el.classList.remove('show'); setTimeout(nextAchievement, 400); }, 3200);
}

export function renderAchievements(container, got) {
  container.innerHTML = '';
  for (const a of ACHIEVEMENTS) {
    const row = document.createElement('div');
    row.className = 'achv-row' + (got[a.id] ? ' got' : '');
    row.innerHTML = `<i>${got[a.id] ? '★' : '☆'}</i><div><b>${a.title}</b><small>${a.desc}</small></div>`;
    container.appendChild(row);
  }
}

// Speech bubbles that follow a point in the 3D world.
export function createBubbles(root) {
  const pool = [];
  return {
    show(key, text, until) {
      let b = pool.find((p) => p.key === key);
      if (!b) { b = { key, el: document.createElement('div') }; b.el.className = 'bubble'; root.appendChild(b.el); pool.push(b); }
      b.el.textContent = text; b.until = until;
      return b;
    },
    // project(key) -> {x, y} in CSS pixels or null when off-screen
    update(now, project) {
      for (let i = pool.length - 1; i >= 0; i--) {
        const b = pool[i];
        const p = now < b.until ? project(b.key) : null;
        if (!p) {
          if (now >= b.until) { b.el.remove(); pool.splice(i, 1); } else b.el.style.display = 'none';
          continue;
        }
        b.el.style.display = '';
        b.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      }
    },
  };
}
