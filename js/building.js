// Everything that changes blocks: placing and breaking, undo / redo, the area tools, blueprints, share codes.
// Edits are applied locally first (so building feels instant) and then sent to the server when online.
import { B, BLOCKS, FABRICS, shapeBoxes } from './blocks.js';
import { World, PLOT, CITY, HEIGHT, plotAt } from './world.js';
import { EYE } from './player.js';
import { rotateStruct } from './prefabs.js';
import { sfx } from './audio.js';
import { toast } from './ui.js';
import { isPlaceableId } from '../shared/protocol.js';
import { G, $ } from './game.js';

const REACH = 7;
const BIG_EDIT = 3000;       // above this many cells, send the whole plot instead of individual edits
let lastDenied = 0;

// ------------------------------------------------------------------ looking

export const eyePos = () => ({ x: G.player.pos.x, y: G.player.pos.y + EYE, z: G.player.pos.z });

export function lookDir() {
  const { yaw, pitch } = G.player, cp = Math.cos(pitch);
  return { x: cp * Math.sin(yaw), y: -Math.sin(pitch), z: cp * Math.cos(yaw) };
}

export function getTarget() {
  const e = eyePos(), d = lookDir();
  return G.world.raycast(e.x, e.y, e.z, d.x, d.y, d.z, REACH);
}

function facing() {
  const fx = Math.sin(G.player.yaw), fz = Math.cos(G.player.yaw);
  return Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 2 : 0);
}

// ------------------------------------------------------------------ rules

function deny(msg, notify) {
  if (notify && performance.now() - lastDenied > 700) { lastDenied = performance.now(); toast(msg, 'bad'); }
  return false;
}

export function canEdit(x, y, z, notify = false) {
  if (y < 1) return deny("The ground can't be changed.", notify);
  if (y >= HEIGHT) return deny('That is as high as the sky limit goes.', notify);
  const p = plotAt(x, z);
  if (!p) return deny(z >= CITY ? 'Bar Beach belongs to everyone.' : 'Roads and public spaces belong to the city.', notify);
  if (!G.myPlot) {
    return deny(G.online ? 'You need a plot first. Open the map (M) or the Plot tab to claim land.' : 'Plot ' + p.number + ' is not yours.', notify);
  }
  if (p.number !== G.myPlot.number) {
    const o = G.owners.get(p.number);
    if (o) return deny(`Plot ${p.number} belongs to ${o.owner}. Build on your yellow-bordered plot.`, notify);
    if (p.owner) return deny(`This is ${p.owner}'s house. Build on your yellow-bordered plot.`, notify);
    if (p.claimable) return deny(G.online ? `Plot ${p.number} is free land, but you can only claim one plot.` : `Plot ${p.number} is free land. Play online to claim your own!`, notify);
    return deny('This is a public space.', notify);
  }
  if (G.online && !G.online.ready) return deny('Reconnecting... hold on a moment.', notify);
  return true;
}

// ------------------------------------------------------------------ applying edits

// Change blocks: edits = [[x, y, z, id, meta]]. Relights, remeshes, updates the map, records undo and tells the server.
export function applyEdits(edits, { record = true, send = true } = {}) {
  const w = G.world;
  const changes = [];
  let x0 = Infinity, z0 = Infinity, x1 = -1, z1 = -1;
  for (const [x, y, z, id, meta = 0] of edits) {
    const oid = w.get(x, y, z), om = w.getMeta(x, y, z);
    if (oid === id && om === meta) continue;
    w.set(x, y, z, id, meta);
    changes.push([x, y, z, oid, om, id, meta]);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (!changes.length) return 0;
  afterChange(x0, z0, x1, z1, send);
  if (send) sendToServer(changes.map((c) => [c[0], c[1], c[2], c[5], c[6]]));
  if (record) {
    G.undoStack.push(changes);
    if (G.undoStack.length > 100) G.undoStack.shift();
    G.redoStack.length = 0;
  }
  return changes.length;
}

function sendToServer(edits) {
  if (!G.online || !G.myPlot) return;
  if (edits.length > BIG_EDIT) {
    const { ids, metas } = G.world.readPlotArrays(G.myPlot);
    G.online.replacePlot(G.myPlot, ids, metas);
  } else G.online.sendEdits(G.myPlot, edits);
}

export function afterChange(x0, z0, x1, z1, local = true) {
  const w = G.world;
  const ch = w.relight(x0 - 16, x1 + 16, z0 - 16, z1 + 16);
  if (ch) w.markBoxDirty(ch[0], ch[1], ch[2], ch[3]);
  G.minimap?.update(x0, z0, x1, z1);
  if (local) G.hooks.markPlotDirty?.();
}

// Edits made by other players, or the server overwriting a plot: no undo, nothing sent back.
export function applyRemoteEdits(edits) {
  applyEdits(edits, { record: false, send: false });
}

// Replace everything above the ground in a plot with the given flat arrays (the server's copy).
export function replacePlotContents(plot, ids, metas) {
  const w = G.world;
  w.bulk = true;
  try { w.applyPlot(plot, { ids, metas }); } finally { w.bulk = false; }
  finishBulk(plot);
}

export function clearPlotContents(plot) {
  const w = G.world;
  w.bulk = true;
  try { w.clearPlot(plot); } finally { w.bulk = false; }
  finishBulk(plot);
}

function finishBulk(plot) {
  const w = G.world;
  w.markBoxDirty(plot.x - 1, plot.z - 1, plot.x + PLOT, plot.z + PLOT);
  const ch = w.relight(plot.x - 16, plot.x + PLOT + 16, plot.z - 16, plot.z + PLOT + 16);
  if (ch) w.markBoxDirty(ch[0], ch[1], ch[2], ch[3]);
  G.minimap?.update(plot.x, plot.z, plot.x + PLOT - 1, plot.z + PLOT - 1);
}

function replay(changes, forward) {
  const w = G.world;
  let x0 = Infinity, z0 = Infinity, x1 = -1, z1 = -1;
  const sent = [];
  const list = forward ? changes : changes.slice().reverse();
  for (const [x, y, z, oid, om, id, meta] of list) {
    if (forward) { w.set(x, y, z, id, meta); sent.push([x, y, z, id, meta]); } else { w.set(x, y, z, oid, om); sent.push([x, y, z, oid, om]); }
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  afterChange(x0, z0, x1, z1);
  sendToServer(sent);
}

export function undo() {
  if (G.online && !G.online.ready) return false;
  const c = G.undoStack.pop();
  if (!c) { toast('Nothing to undo'); return false; }
  replay(c, false); G.redoStack.push(c);
  sfx.undo(); G.achievements.unlock('undo');
  toast(`Undone (${c.length} block${c.length > 1 ? 's' : ''})`);
  return true;
}

export function redo() {
  if (G.online && !G.online.ready) return false;
  const c = G.redoStack.pop();
  if (!c) { toast('Nothing to redo'); return false; }
  replay(c, true); G.undoStack.push(c);
  sfx.undo();
  toast(`Redone (${c.length} block${c.length > 1 ? 's' : ''})`);
  return true;
}

export function resetHistory() { G.undoStack.length = 0; G.redoStack.length = 0; }

// ------------------------------------------------------------------ placing and breaking

const replaceable = (id) => id === B.AIR || id === B.WATER || BLOCKS[id].render === 'cross';

export function tryBreak(hit = getTarget()) {
  if (!hit || !canEdit(hit.x, hit.y, hit.z, true)) return false;
  const edits = [[hit.x, hit.y, hit.z, B.AIR, 0]];
  if (hit.id === B.DOOR) {
    const oy = hit.meta & 8 ? hit.y - 1 : hit.y + 1;
    if (G.world.get(hit.x, oy, hit.z) === B.DOOR) edits.push([hit.x, oy, hit.z, B.AIR, 0]);
  }
  applyEdits(edits);
  sfx.break(BLOCKS[hit.id].sound);
  return true;
}

export function toggleDoor(hit) {
  const w = G.world;
  const plot = plotAt(hit.x, hit.z);
  const mine = !!(plot && G.myPlot && plot.number === G.myPlot.number);
  const shared = !!plot && !plot.claimable;          // show homes and landmarks: their doors swing for everyone, locally
  if (mine) {
    if (!canEdit(hit.x, hit.y, hit.z, true)) return false;
  } else if (!shared) {
    const o = plot ? G.owners.get(plot.number) : null;
    return deny(o ? `That door belongs to ${o.owner}.` : 'That door is not yours to open.', true);
  }
  const bottomY = hit.meta & 8 ? hit.y - 1 : hit.y;
  const m = w.getMeta(hit.x, bottomY, hit.z) ^ 4;
  const edits = [[hit.x, bottomY, hit.z, B.DOOR, m & ~8]];
  if (w.get(hit.x, bottomY + 1, hit.z) === B.DOOR) edits.push([hit.x, bottomY + 1, hit.z, B.DOOR, m | 8]);
  applyEdits(edits, { record: false, send: mine });
  sfx.door(!!(m & 4));
  if (m & 4) G.achievements.unlock('door');
  return true;
}

export function tryPlace(hit = getTarget()) {
  const { state, player, world } = G;
  if (state.paste) return placePaste();
  if (!hit) return false;
  const shift = G.hooks.shiftHeld?.();
  if (!shift) {
    if (hit.id === B.DOOR) return toggleDoor(hit);
    if (hit.id === B.GENERATOR) { sfx.generator(); toast('Brrrrrrr! I better pass my neighbour!'); G.achievements.unlock('generator'); return true; }
  }
  const id = state.hotbar[state.sel], b = BLOCKS[id];
  let x, y, z;
  if (BLOCKS[hit.id].render === 'cross') { x = hit.x; y = hit.y; z = hit.z; }
  else {
    if (hit.nx === 0 && hit.ny === 0 && hit.nz === 0) return false;
    x = hit.x + hit.nx; y = hit.y + hit.ny; z = hit.z + hit.nz;
  }
  if (!replaceable(world.get(x, y, z)) || !canEdit(x, y, z, true)) return false;
  let meta = 0;
  if (b.render === 'slab') meta = hit.ny === -1 || (hit.ny === 0 && hit.hy - Math.floor(hit.hy) > 0.5) ? 1 : 0;
  if (b.render === 'stairs' || b.render === 'door') meta = facing();
  const edits = [[x, y, z, id, meta]];
  if (b.render === 'door') {
    if (!replaceable(world.get(x, y + 1, z)) || !canEdit(x, y + 1, z, true)) return false;
    if (player.intersectsBlock(x, y + 1, z)) return false;
    edits.push([x, y + 1, z, id, meta | 8]);
  }
  if (b.solid && player.intersectsBlock(x, y, z)) return false;
  applyEdits(edits);
  sfx.place(b.sound);
  trackPlacement(id, y);
  return true;
}

export function trackPlacement(id, y) {
  const a = G.achievements, s = a.stats;
  s.placed++;
  a.unlock('first_block');
  if (s.placed >= 100) a.unlock('builder_100');
  if (s.placed >= 1000) a.unlock('builder_1000');
  if (y >= 21) a.unlock('tower');
  if (BLOCKS[id].light) { s.lights++; if (s.lights >= 5) a.unlock('lights'); }
  if (FABRICS.includes(id) && !s.fabrics.includes(id)) { s.fabrics.push(id); if (s.fabrics.length === FABRICS.length) a.unlock('fashion'); }
}

export function pickBlock() {
  const hit = getTarget();
  if (!hit) return;
  const id = hit.id, { state } = G;
  if (!BLOCKS[id] || !BLOCKS[id].placeable) return;
  const slot = state.hotbar.indexOf(id);
  if (slot >= 0) state.sel = slot; else state.hotbar[state.sel] = id;
  G.hud.renderHotbar();
}

// ------------------------------------------------------------------ area tool, copy / paste, blueprints

export function areaBounds() {
  const { a, b } = G.state.area;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
}

export function areaKey() {
  const { state } = G;
  const hit = getTarget();
  if (!state.area || state.area.b) {
    if (state.area && state.area.b) { state.area = null; updateModeBar(); toast('Area cleared'); return; }
    if (!hit) return toast('Look at a block to mark the first corner.');
    state.area = { a: [hit.x, hit.y, hit.z], b: null };
  } else {
    if (!hit) return toast('Look at a block to mark the second corner.');
    state.area.b = [hit.x, hit.y, hit.z];
  }
  state.paste = null;
  updateModeBar();
}

function areaCells(fn) {
  const [x0, y0, z0, x1, y1, z1] = areaBounds();
  const edits = [];
  for (let y = Math.max(1, y0); y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    if (canEdit(x, y, z)) { const e = fn(x, y, z); if (e) edits.push(e); }
  }
  return edits;
}

export function fillArea(clear) {
  const { state } = G;
  if (!state.area || !state.area.b) return toast('Select an area first: press F on two corners.');
  const id = clear ? B.AIR : state.hotbar[state.sel];
  if (!clear && BLOCKS[id].render === 'door') return toast("Doors can't be used to fill.");
  const edits = areaCells((x, y, z) => [x, y, z, id, 0]);
  if (!edits.length) return deny('None of that area is on your plot.', true);
  const n = applyEdits(edits);
  if (n) { sfx[clear ? 'break' : 'place'](BLOCKS[clear ? B.STONE : id].sound); toast(`${clear ? 'Cleared' : 'Filled'} ${n} blocks. Ctrl+Z to undo.`); if (!clear) trackPlacement(id, areaBounds()[4]); }
}

export function copyArea() {
  const { state, world } = G;
  if (!state.area || !state.area.b) return toast('Select an area first: press F on two corners.');
  const [x0, y0, z0, x1, y1, z1] = areaBounds();
  const r = world.readRegion(x0, Math.max(1, y0), z0, x1, y1, z1);
  r.cells = r.cells.filter((c) => isPlaceableId(c[3]));          // roads and wet sand can't be placed by players
  if (!r.cells.length) return toast('That area is empty.');
  state.clipboard = { ...r, name: 'Copied build' };
  toast(`Copied ${r.cells.length} blocks. Press V to paste on your plot.`);
}

export function startPaste(struct, label, blueprint = false) {
  G.state.paste = { struct, rot: 0, label, blueprint };
  G.state.area = null;
  updateModeBar();
}

export function startBlueprint(bp) {
  startPaste(bp, bp.name, true);
  G.hooks.closeOverlay?.();
  toast(`${bp.name}: right-click on your plot to build. R rotates.`);
}

// Where would the current paste go? Centred on the targeted cell.
export function pastePlacement() {
  const { state } = G;
  if (!state.paste) return null;
  const hit = getTarget();
  if (!hit) return null;
  const s = rotateStruct(state.paste.struct, state.paste.rot);
  const tx = hit.x + hit.nx, ty = hit.y + hit.ny, tz = hit.z + hit.nz;
  const ox = tx - Math.floor(s.w / 2), oz = tz - Math.floor(s.d / 2), oy = Math.max(1, ty);
  let ok = true;
  for (const [x, y, z] of s.cells) { if (!canEdit(ox + x, oy + y, oz + z)) { ok = false; break; } }
  return { s, ox, oy, oz, ok };
}

export function placePaste() {
  const { state } = G;
  const pl = pastePlacement();
  if (!pl) return false;
  if (!pl.ok) return deny('It has to fit completely inside your plot.', true);
  const edits = pl.s.cells.map(([x, y, z, id, meta]) => [pl.ox + x, pl.oy + y, pl.oz + z, id, meta]);
  const n = applyEdits(edits);
  sfx.place('wood');
  toast(`Built ${state.paste.label} (${n} blocks). Ctrl+Z to undo.`);
  if (state.paste.blueprint) G.achievements.unlock('blueprint');
  state.paste = null;
  updateModeBar();
  return true;
}

export function updateModeBar() {
  const { state } = G;
  const bar = $('mode-bar');
  let text = '';
  if (state.paste) text = `Placing ${state.paste.label} - right-click to build, R rotate, left-click cancel`;
  else if (state.area && !state.area.b) text = 'Area: look at the opposite corner and press F';
  else if (state.area) { const [x0, y0, z0, x1, y1, z1] = areaBounds(); text = `Area ${x1 - x0 + 1}x${y1 - y0 + 1}x${z1 - z0 + 1} - G fill, X clear, C copy, F reset`; }
  bar.textContent = text;
  bar.classList.toggle('hidden', !text);
}

// ------------------------------------------------------------------ sharing

export function exportCode() {
  return `NJC2:${encodeURIComponent(G.state.plotName)}:${G.world.exportPlot(G.myPlot)}`;
}

export function importCode(code) {
  if (!G.myPlot) return false;
  const m = /^NJC2:([^:]*):([A-Za-z0-9+/=]+)$/.exec(code.trim());
  if (!m) return false;
  const decoded = World.decodePlot(m[2], 2);
  if (!decoded) return false;
  for (let i = 0; i < decoded.ids.length; i++) if (!isPlaceableId(decoded.ids[i])) { decoded.ids[i] = 0; decoded.metas[i] = 0; }
  const plot = G.myPlot;
  replacePlotContents(plot, decoded.ids, decoded.metas);
  resetHistory();
  if (G.online) G.online.replacePlot(plot, decoded.ids, decoded.metas);
  G.hooks.savePlotNow?.();
  let name = '';
  try { name = decodeURIComponent(m[1]); } catch { name = ''; }
  return name || true;
}

export { shapeBoxes };
