import { B, BLOCKS, FABRICS, DEFAULT_HOTBAR, createAtlasCanvas, shapeBoxes } from './blocks.js';
import { World, PLOTS, PLAYER_PLOT, PLOT, SX, SZ, CITY, HEIGHT, NCX, NCZ, CHUNK, SPAWN, plotAt, districtAt } from './world.js';
import { generateCity, PLAZA } from './city.js';
import { buildChunk } from './mesher.js';
import { Player, EYE } from './player.js';
import { storage } from './storage.js';
import { registerShaders, createVoxelMaterials, createSky, createGroundPlanes, computeEnv, applyEnv, clockString, lightColor } from './render.js';
import { createCharacter, setCharacterAtlas, DEFAULT_LOOK } from './characters.js';
import { createResidents } from './npcs.js';
import { createTraffic } from './vehicles.js';
import { createMinimap } from './minimap.js';
import { createAchievements, weeklyChallenge } from './achievements.js';
import { rotateStruct } from './prefabs.js';
import { createTouchControls } from './touch.js';
import { sfx } from './audio.js';
import { createHud, mountLookPicker, toast, showAchievement, renderAchievements, createBubbles } from './ui.js';

const $ = (id) => document.getElementById(id);
const BABYLON = window.BABYLON;
const REACH = 7;
const DAY_LENGTH = 20 * 60;     // real seconds per Lagos day
const isTouch = window.matchMedia('(pointer: coarse)').matches;

function fatal(msg) {
  $('loading').classList.add('hidden');
  $('fatal-text').textContent = msg;
  $('fatal').classList.remove('hidden');
}

const settings = storage.loadSettings();
const profile = storage.loadProfile() || {};
const myPlot = PLOTS[PLAYER_PLOT - 1];
const validLook = (l) => l && Number.isInteger(l.skin) && Number.isInteger(l.outfit) && Number.isInteger(l.hat);

const state = {
  mode: 'loading',      // loading | menu | playing | paused | inventory | map | help
  started: false,
  hotbar: Array.isArray(profile.hotbar) && profile.hotbar.length === 9 && profile.hotbar.every((i) => BLOCKS[i] && BLOCKS[i].placeable) ? profile.hotbar : DEFAULT_HOTBAR.slice(),
  sel: Number.isInteger(profile.sel) ? Math.min(8, Math.max(0, profile.sel)) : 0,
  name: profile.name || '',
  look: validLook(profile.look) ? { ...profile.look } : { ...DEFAULT_LOOK },
  plotName: typeof profile.plotName === 'string' ? profile.plotName : '',
  time: typeof profile.time === 'number' ? profile.time : 0.3,
  camMode: 0,           // 0 first person, 1 behind, 2 in front
  area: null,           // { a: [x,y,z], b: [x,y,z] | null }
  paste: null,          // { struct, rot, label, blueprint }
  clipboard: null,
  rain: 0, rainTarget: 0, weatherTimer: 90,
};

let engine, scene, camera, world, player, hud, sky, minimap, residents, traffic, avatar, achievements, bubbles, touch;
let materials, env = computeEnv(state.time);
const keys = {};
const mouse = { left: false, right: false, next: 0 };
let plotDirtyAt = 0, lastSpaceTap = 0, lastDenied = 0, clockTime = 0;
let selBox, areaBox, rainPS;
const chunkMeshes = new Array(NCX * NCZ).fill(null);
const labels = new Map();
const undoStack = [], redoStack = [];

async function boot() {
  if (!BABYLON) return fatal('The 3D engine (Babylon.js) failed to load. Check your internet connection and refresh the page.');
  const canvas = $('game');
  try {
    engine = new BABYLON.Engine(canvas, false, { stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  } catch (e) {
    return fatal('Your browser does not support WebGL, which Naijacraft needs. Try Chrome, Edge, Firefox or Safari.');
  }
  applyResolution();
  registerShaders();

  scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.55, 0.78, 0.95, 1);
  scene.skipPointerMovePicking = true;
  if (BABYLON.ScenePerformancePriority) scene.performancePriority = BABYLON.ScenePerformancePriority.Intermediate;

  camera = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(84, 40, 84), scene);
  camera.minZ = 0.1; camera.maxZ = 1000; camera.fov = 1.2;
  camera.inputs.clear();

  setLoading('Painting the textures...', 0.05);
  const atlas = createAtlasCanvas();
  setCharacterAtlas(atlas);
  materials = createVoxelMaterials(scene, atlas);
  sky = createSky(scene);
  createGroundPlanes(scene);
  selBox = makeLineBox('sel', BABYLON.Color3.Black());
  areaBox = makeLineBox('area', new BABYLON.Color3(0.2, 0.8, 1));
  rainPS = makeRain();

  setLoading('Laying the roads of Lagos...', 0.1);
  await frame();
  world = new World();
  generateCity(world);
  loadSavedPlot();
  setLoading('Switching on the street lights...', 0.16);
  await frame();
  world.computeAllLight();
  world.markAllDirty();

  player = new Player(world);
  const p = profile.pos;
  const start = Array.isArray(p) && p.length === 3 && p.every(Number.isFinite) && !player.collides(p[0], p[1], p[2]);
  player.pos = start ? { x: p[0], y: p[1], z: p[2] } : { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z };
  player.yaw = start ? profile.yaw || 0 : SPAWN.yaw;
  player.pitch = start ? profile.pitch || 0 : SPAWN.pitch;

  await meshAll();
  setLoading('Waking up the neighbours...', 0.97);
  await frame();
  minimap = createMinimap(world, atlas);
  residents = createResidents(scene);
  traffic = createTraffic(scene);
  rebuildAvatar();
  achievements = createAchievements(profile.achievements, (a) => { showAchievement(a); sfx.achievement(); saveProfile(); });
  bubbles = createBubbles($('bubbles'));
  for (const pl of PLOTS) drawPlotLabel(pl);

  hud = createHud(atlas, state, { onSelect: selectSlot, onBlueprint: startBlueprint });
  hud.renderHotbar();
  bindUI();
  applyViewDistance();

  engine.runRenderLoop(tick);
  window.addEventListener('resize', () => engine.resize());
  // debug / automated-test hook
  window.__naija = { world, player, scene, state, camera, keys, tryBreak, tryPlace, getTarget, enterGame, canEdit, applyEdits, undo, redo, achievements, residents, traffic, setTime: (t) => { state.time = t; }, startBlueprint, placePaste, toggleDoor, exportCode, importCode, settings, showMode };

  $('username').value = state.name;
  $('menu-challenge').textContent = weeklyChallenge();
  $('pause-challenge').textContent = weeklyChallenge();
  mountLookPicker($('menu-look'), state.look, () => rebuildAvatar());
  if (isTouch) $('touch-note').classList.remove('hidden');
  $('loading').classList.add('hidden');
  showMode('menu');
}

const frame = () => new Promise((r) => requestAnimationFrame(r));
function setLoading(text, p) { $('loading-text').textContent = text; $('loading-fill').style.width = Math.round(p * 100) + '%'; }

// ------------------------------------------------------------------ rendering setup

function makeLineBox(name, color) {
  const o = -0.004, e = 1.004;
  const p = [[o, o, o], [e, o, o], [e, o, e], [o, o, e], [o, e, o], [e, e, o], [e, e, e], [o, e, e]].map((a) => new BABYLON.Vector3(...a));
  const lines = [[p[0], p[1], p[2], p[3], p[0]], [p[4], p[5], p[6], p[7], p[4]], [p[0], p[4]], [p[1], p[5]], [p[2], p[6]], [p[3], p[7]]];
  const box = BABYLON.MeshBuilder.CreateLineSystem(name, { lines }, scene);
  box.color = color;
  box.isPickable = false;
  box.renderingGroupId = 1;
  box.setEnabled(false);
  return box;
}

function makeRain() {
  const tex = new BABYLON.DynamicTexture('raindrop', { width: 4, height: 32 }, scene, false);
  const g = tex.getContext();
  const grad = g.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0, 'rgba(200,220,255,0)'); grad.addColorStop(1, 'rgba(220,235,255,0.9)');
  g.fillStyle = grad; g.fillRect(1, 0, 2, 32);
  tex.hasAlpha = true; tex.update(true);
  const ps = new BABYLON.ParticleSystem('rain', 2500, scene);
  ps.particleTexture = tex;
  ps.emitter = new BABYLON.Vector3(0, 20, 0);
  ps.minEmitBox = new BABYLON.Vector3(-22, 0, -22);
  ps.maxEmitBox = new BABYLON.Vector3(22, 4, 22);
  ps.direction1 = new BABYLON.Vector3(-0.5, -30, 0.2);
  ps.direction2 = new BABYLON.Vector3(0.5, -34, -0.2);
  ps.minSize = 0.05; ps.maxSize = 0.08;
  ps.minScaleY = 8; ps.maxScaleY = 12;
  ps.minLifeTime = 0.6; ps.maxLifeTime = 0.8;
  ps.emitRate = 0;
  ps.color1 = new BABYLON.Color4(0.8, 0.85, 1, 0.6);
  ps.color2 = new BABYLON.Color4(0.8, 0.85, 1, 0.4);
  ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
  ps.billboardMode = BABYLON.ParticleSystem.BILLBOARDMODE_STRETCHED;
  ps.renderingGroupId = 1;
  ps.start();
  return ps;
}

function rebuildChunk(cx, cz) {
  const k = cz * NCX + cx;
  const old = chunkMeshes[k];
  if (old) for (const m of old) m.dispose();
  const built = buildChunk(world, cx, cz);
  const meshes = [];
  for (const [layer, mat] of [['opaque', materials.opaque], ['glass', materials.glass]]) {
    const l = built[layer];
    if (!l.indices.length) continue;
    const vd = new BABYLON.VertexData();
    vd.positions = new Float32Array(l.positions);
    vd.uvs = new Float32Array(l.uvs);
    vd.colors = new Float32Array(l.colors);
    vd.indices = new Uint32Array(l.indices);
    const mesh = new BABYLON.Mesh(`chunk-${cx}-${cz}-${layer}`, scene);
    vd.applyToMesh(mesh, false);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;
    mesh.freezeWorldMatrix();
    meshes.push(mesh);
  }
  chunkMeshes[k] = meshes;
}

async function meshAll() {
  const list = [...world.dirty];
  world.dirty.clear();
  let n = 0;
  for (const k of list) {
    rebuildChunk(k % NCX, Math.floor(k / NCX));
    if (++n % 6 === 0) { setLoading('Building Lagos...', 0.2 + 0.75 * (n / list.length)); await frame(); }
  }
}

function remeshDirty(budget) {
  let n = 0;
  for (const k of world.dirty) {
    world.dirty.delete(k);
    rebuildChunk(k % NCX, Math.floor(k / NCX));
    applyChunkVisibility(k);
    if (++n >= budget) break;
  }
}

function applyChunkVisibility(k) {
  const ms = chunkMeshes[k];
  if (!ms) return;
  const cx = (k % NCX) * CHUNK + CHUNK / 2, cz = Math.floor(k / NCX) * CHUNK + CHUNK / 2;
  const dist = Math.hypot(cx - camera.position.x, cz - camera.position.z);
  const on = dist < settings.viewChunks * CHUNK + CHUNK * 1.5;
  for (const m of ms) m.setEnabled(on);
}

function applyViewDistance() {
  for (let k = 0; k < NCX * NCZ; k++) applyChunkVisibility(k);
}
const fogRange = () => [settings.viewChunks * CHUNK * 0.55, settings.viewChunks * CHUNK * 1.15];

function applyResolution() {
  engine.setHardwareScalingLevel(Number(settings.resolution) || 1);
  engine.resize();
}

function drawPlotLabel(p) {
  let entry = labels.get(p.number);
  if (!entry) {
    const tex = new BABYLON.DynamicTexture('label' + p.number, { width: 512, height: 160 }, scene, false);
    const mat = new BABYLON.StandardMaterial('label' + p.number, scene);
    mat.diffuseTexture = tex; mat.disableLighting = true; mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    mat.specularColor = BABYLON.Color3.Black(); mat.backFaceCulling = false;
    const plane = BABYLON.MeshBuilder.CreatePlane('label' + p.number, { width: 8, height: 2.5 }, scene);
    plane.material = mat;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
    plane.position.set(p.x + PLOT / 2, 8, p.z + PLOT + 3.5);
    plane.isPickable = false;
    plane.renderingGroupId = 1;
    entry = { tex, plane };
    labels.set(p.number, entry);
  }
  const g = entry.tex.getContext();
  const mine = p.number === PLAYER_PLOT;
  g.fillStyle = mine ? '#c99a0a' : p.owner ? '#44505a' : p.kind === 'free' ? '#2a6fb0' : '#1d7a4a';
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(0, 0, 512, 8);
  g.fillStyle = '#fff'; g.textAlign = 'center';
  const title = mine && state.plotName ? state.plotName : p.name || ('PLOT ' + String(p.number).padStart(2, '0'));
  g.font = `bold ${title.length > 14 ? 46 : 62}px system-ui, sans-serif`;
  g.fillText(title, 256, 78);
  g.font = '34px system-ui, sans-serif';
  const sub = mine ? `${state.name || 'YOUR'} PLOT ${String(p.number).padStart(2, '0')}` : p.owner ? p.owner + "'s home" : p.kind === 'free' ? 'AVAILABLE' : 'PUBLIC SPACE';
  g.fillText(sub + '  -  ' + p.district, 256, 130);
  entry.tex.update(true);
}

function rebuildAvatar() {
  if (!scene) return;
  if (avatar) avatar.dispose();
  avatar = createCharacter(scene, state.look, 'me');
  avatar.setVisible(state.camMode !== 0 && state.started);
}

// ------------------------------------------------------------------ saving

function loadSavedPlot() {
  const saved = storage.loadPlot(myPlot.number);
  if (!saved) return;
  const decoded = World.decodePlot(saved.data, saved.version);
  if (decoded) world.applyPlot(myPlot, decoded);
  else console.warn('Saved plot could not be read; starting fresh.');
}

function savePlotNow() {
  plotDirtyAt = 0;
  if (!storage.savePlot(myPlot.number, world.exportPlot(myPlot))) toast("Couldn't save - browser storage is full or blocked.", 'bad');
}

function saveProfile() {
  if (!player) return;
  storage.saveProfile({
    name: state.name, hotbar: state.hotbar, sel: state.sel, look: state.look, plotName: state.plotName, time: state.time,
    pos: [player.pos.x, player.pos.y, player.pos.z], yaw: player.yaw, pitch: player.pitch,
    achievements: achievements ? achievements.toJSON() : profile.achievements,
  });
}

function saveAll() {
  if (!state.started) return;
  if (plotDirtyAt) savePlotNow();
  saveProfile();
}
function markPlotDirty() { plotDirtyAt = performance.now() + 1500; }

// ------------------------------------------------------------------ edits, undo, building rules

// Change blocks: edits = [[x, y, z, id, meta]]. Relights, remeshes, updates the map and records undo.
function applyEdits(edits, { record = true } = {}) {
  const changes = [];
  let x0 = Infinity, z0 = Infinity, x1 = -1, z1 = -1;
  for (const [x, y, z, id, meta = 0] of edits) {
    const oid = world.get(x, y, z), om = world.getMeta(x, y, z);
    if (oid === id && om === meta) continue;
    world.set(x, y, z, id, meta);
    changes.push([x, y, z, oid, om, id, meta]);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (!changes.length) return 0;
  afterChange(x0, z0, x1, z1);
  if (record) {
    undoStack.push(changes);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }
  return changes.length;
}

function afterChange(x0, z0, x1, z1) {
  const ch = world.relight(x0 - 16, x1 + 16, z0 - 16, z1 + 16);
  if (ch) world.markBoxDirty(ch[0], ch[1], ch[2], ch[3]);
  minimap?.update(x0, z0, x1, z1);
  markPlotDirty();
}

function replay(changes, forward) {
  let x0 = Infinity, z0 = Infinity, x1 = -1, z1 = -1;
  const list = forward ? changes : changes.slice().reverse();
  for (const [x, y, z, oid, om, id, meta] of list) {
    if (forward) world.set(x, y, z, id, meta); else world.set(x, y, z, oid, om);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  afterChange(x0, z0, x1, z1);
}
function undo() {
  const c = undoStack.pop();
  if (!c) { toast('Nothing to undo'); return false; }
  replay(c, false); redoStack.push(c);
  sfx.undo(); achievements.unlock('undo');
  toast(`Undone (${c.length} block${c.length > 1 ? 's' : ''})`);
  return true;
}
function redo() {
  const c = redoStack.pop();
  if (!c) { toast('Nothing to redo'); return false; }
  replay(c, true); undoStack.push(c);
  sfx.undo();
  toast(`Redone (${c.length} block${c.length > 1 ? 's' : ''})`);
  return true;
}

function deny(msg, notify) {
  if (notify && performance.now() - lastDenied > 700) { lastDenied = performance.now(); toast(msg, 'bad'); }
  return false;
}
function canEdit(x, y, z, notify = false) {
  if (y < 1) return deny("The ground can't be changed.", notify);
  if (y >= HEIGHT) return deny('That is as high as the sky limit goes.', notify);
  const p = plotAt(x, z);
  if (!p) return deny(z >= CITY ? 'Bar Beach belongs to everyone.' : 'Roads and public spaces belong to the city.', notify);
  if (p.number !== PLAYER_PLOT) {
    return deny(p.owner ? `Plot ${p.number} belongs to ${p.owner}. Build on your yellow-bordered plot.` : p.kind === 'free' ? `Plot ${p.number} is unclaimed. Accounts are coming soon!` : 'This is a public space.', notify);
  }
  return true;
}

const eyePos = () => ({ x: player.pos.x, y: player.pos.y + EYE, z: player.pos.z });
function lookDir() {
  const cp = Math.cos(player.pitch);
  return { x: cp * Math.sin(player.yaw), y: -Math.sin(player.pitch), z: cp * Math.cos(player.yaw) };
}
function getTarget() {
  const e = eyePos(), d = lookDir();
  return world.raycast(e.x, e.y, e.z, d.x, d.y, d.z, REACH);
}
function facing() {
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  return Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 2 : 0);
}
const replaceable = (id) => id === B.AIR || id === B.WATER || BLOCKS[id].render === 'cross';

function tryBreak(hit = getTarget()) {
  if (!hit || !canEdit(hit.x, hit.y, hit.z, true)) return false;
  const edits = [[hit.x, hit.y, hit.z, B.AIR, 0]];
  if (hit.id === B.DOOR) {
    const oy = hit.meta & 8 ? hit.y - 1 : hit.y + 1;
    if (world.get(hit.x, oy, hit.z) === B.DOOR) edits.push([hit.x, oy, hit.z, B.AIR, 0]);
  }
  applyEdits(edits);
  sfx.break(BLOCKS[hit.id].sound);
  return true;
}

function toggleDoor(hit) {
  const bottomY = hit.meta & 8 ? hit.y - 1 : hit.y;
  const m = world.getMeta(hit.x, bottomY, hit.z) ^ 4;
  const edits = [[hit.x, bottomY, hit.z, B.DOOR, m & ~8]];
  if (world.get(hit.x, bottomY + 1, hit.z) === B.DOOR) edits.push([hit.x, bottomY + 1, hit.z, B.DOOR, m | 8]);
  applyEdits(edits, { record: false });
  sfx.door(!!(m & 4));
  if (m & 4) achievements.unlock('door');
  return true;
}

function tryPlace(hit = getTarget()) {
  if (state.paste) return placePaste();
  if (!hit) return false;
  if (!(keys.ShiftLeft || keys.ShiftRight)) {
    if (hit.id === B.DOOR) return toggleDoor(hit);
    if (hit.id === B.GENERATOR) { sfx.generator(); toast('Brrrrrrr! I better pass my neighbour!'); achievements.unlock('generator'); return true; }
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

function trackPlacement(id, y) {
  const s = achievements.stats;
  s.placed++;
  achievements.unlock('first_block');
  if (s.placed >= 100) achievements.unlock('builder_100');
  if (s.placed >= 1000) achievements.unlock('builder_1000');
  if (y >= 21) achievements.unlock('tower');
  if (BLOCKS[id].light) { s.lights++; if (s.lights >= 5) achievements.unlock('lights'); }
  if (FABRICS.includes(id) && !s.fabrics.includes(id)) { s.fabrics.push(id); if (s.fabrics.length === FABRICS.length) achievements.unlock('fashion'); }
}

function pickBlock() {
  const hit = getTarget();
  if (!hit) return;
  const id = hit.id;
  if (!BLOCKS[id] || !BLOCKS[id].placeable) return;
  const slot = state.hotbar.indexOf(id);
  if (slot >= 0) state.sel = slot; else state.hotbar[state.sel] = id;
  hud.renderHotbar();
}

// ---- area tool, copy / paste, blueprints

function areaBounds() {
  const { a, b } = state.area;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
}

function areaKey() {
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

function fillArea(clear) {
  if (!state.area || !state.area.b) return toast('Select an area first: press F on two corners.');
  const id = clear ? B.AIR : state.hotbar[state.sel];
  if (!clear && BLOCKS[id].render === 'door') return toast("Doors can't be used to fill.");
  const edits = areaCells((x, y, z) => [x, y, z, id, 0]);
  if (!edits.length) return deny('None of that area is on your plot.', true);
  const n = applyEdits(edits);
  if (n) { sfx[clear ? 'break' : 'place'](BLOCKS[clear ? B.STONE : id].sound); toast(`${clear ? 'Cleared' : 'Filled'} ${n} blocks. Ctrl+Z to undo.`); if (!clear) trackPlacement(id, areaBounds()[4]); }
}

function copyArea() {
  if (!state.area || !state.area.b) return toast('Select an area first: press F on two corners.');
  const [x0, y0, z0, x1, y1, z1] = areaBounds();
  const r = world.readRegion(x0, Math.max(1, y0), z0, x1, y1, z1);
  if (!r.cells.length) return toast('That area is empty.');
  state.clipboard = { ...r, name: 'Copied build' };
  toast(`Copied ${r.cells.length} blocks. Press V to paste on your plot.`);
}

function startPaste(struct, label, blueprint = false) {
  state.paste = { struct, rot: 0, label, blueprint };
  state.area = null;
  updateModeBar();
}
function startBlueprint(bp) {
  startPaste(bp, bp.name, true);
  if (state.mode === 'inventory') resumePlay();
  toast(`${bp.name}: right-click on your plot to build. R rotates.`);
}

// Where would the current paste go? Centred on the targeted cell.
function pastePlacement() {
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

function placePaste() {
  const pl = pastePlacement();
  if (!pl) return false;
  if (!pl.ok) return deny('It has to fit completely inside your plot.', true);
  const edits = pl.s.cells.map(([x, y, z, id, meta]) => [pl.ox + x, pl.oy + y, pl.oz + z, id, meta]);
  const n = applyEdits(edits);
  sfx.place('wood');
  toast(`Built ${state.paste.label} (${n} blocks). Ctrl+Z to undo.`);
  if (state.paste.blueprint) achievements.unlock('blueprint');
  state.paste = null;
  updateModeBar();
  return true;
}

function updateModeBar() {
  const bar = $('mode-bar');
  let text = '';
  if (state.paste) text = `Placing ${state.paste.label} - right-click to build, R rotate, left-click cancel`;
  else if (state.area && !state.area.b) text = 'Area: look at the opposite corner and press F';
  else if (state.area) { const [x0, y0, z0, x1, y1, z1] = areaBounds(); text = `Area ${x1 - x0 + 1}x${y1 - y0 + 1}x${z1 - z0 + 1} - G fill, X clear, C copy, F reset`; }
  bar.textContent = text;
  bar.classList.toggle('hidden', !text);
}

// ---- sharing

function exportCode() {
  return `NJC2:${encodeURIComponent(state.plotName)}:${world.exportPlot(myPlot)}`;
}
function importCode(code) {
  const m = /^NJC2:([^:]*):([A-Za-z0-9+/=]+)$/.exec(code.trim());
  if (!m) return false;
  const decoded = World.decodePlot(m[2], 2);
  if (!decoded) return false;
  world.applyPlot(myPlot, decoded);
  afterChange(myPlot.x, myPlot.z, myPlot.x + PLOT - 1, myPlot.z + PLOT - 1);
  undoStack.length = 0; redoStack.length = 0;
  savePlotNow();
  return decodeURIComponent(m[1]) || true;
}

// ------------------------------------------------------------------ main loop

let orbitTarget = null;
let hudTimer = 0, visTimer = 0, saveTimer = 0, achvTimer = 0, mapTimer = 0, orbit = 0, stepAcc = 0, wasInWater = false;

function lightAt(x, y, z) {
  const l = world.lightAt(x, y, z);
  const c = lightColor(env, l.sky, l.blk);
  return new BABYLON.Color3(c[0], c[1], c[2]);
}

function inputState() {
  const k = keys;
  const t = touch || {};
  return {
    f: (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0) + (t.f || 0),
    s: (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0) + (t.s || 0),
    jump: !!(k.Space || t.jump),
    down: !!(k.ShiftLeft || k.ShiftRight || t.down),
    sprint: !!(k.ShiftLeft || k.ShiftRight) && !player.flying,
  };
}

function tick() {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000 || 0.016);
  const now = performance.now();
  clockTime += dt;

  if (!settings.freezeTime) state.time = (state.time + dt / DAY_LENGTH) % 1;
  updateWeather(dt);
  env = computeEnv(state.time, state.rain);
  const playing = state.mode === 'playing';

  if (playing) {
    player.update(dt, inputState());
    footsteps(dt);
    const hit = getTarget();
    updateSelection(hit);
    const t = touch || {};
    const wantBreak = mouse.left || t.break, wantPlace = mouse.right || t.place;
    if ((wantBreak || wantPlace) && now >= mouse.next) {
      mouse.next = now + 160;
      if (wantBreak) { if (state.paste) { state.paste = null; updateModeBar(); } else tryBreak(hit); } else tryPlace(hit);
    }
  } else {
    selBox.setEnabled(false);
  }
  updateAreaBox();

  // camera
  if (!state.started) {
    orbit += dt * 0.05;
    camera.position.set(84 + Math.sin(orbit) * 80, 38, 110 + Math.cos(orbit) * 80);
    camera.setTarget(orbitTarget || (orbitTarget = new BABYLON.Vector3(84, 6, 120)));
  } else {
    placeCamera();
  }

  const pl = player.pos;
  if (avatar && state.started) {
    avatar.root.position.set(pl.x, pl.y, pl.z);
    avatar.root.rotation.y = player.yaw;
    avatar.animate(dt, playing ? player.moving : 0);
    avatar.setLight(lightAt(pl.x, pl.y + 1, pl.z));
  }
  const npcEvents = residents.update(dt, pl, state.time, lightAt);
  for (const e of npcEvents) {
    bubbles.show(e.greeted, `${e.greeted.name}: ${e.greeted.line}`, now + 4500);
    if (state.started) { achievements.stats.greeted++; if (achievements.stats.greeted >= 5) achievements.unlock('greet'); }
  }
  const tl = lightAt(84, 30, 84);
  const trafficEvents = traffic.update(dt, pl, tl, env.night > 0.5);
  for (const e of trafficEvents) {
    if (!state.started) continue;
    sfx.horn();
    bubbles.show(e.honk, 'Beep beep! Comot for road!', now + 2500);
    achievements.unlock('danfo');
  }
  for (const v of traffic.vehicles) {
    if (state.started && v.kind === 'danfo' && Math.hypot(v.x - pl.x, v.z - pl.z) < 14 && (v.nextCall || 0) < now) {
      v.nextCall = now + 9000;
      bubbles.show(v, v.call, now + 3000);
    }
  }
  bubbles.update(now, projectBubble);

  rainPS.emitter.set(camera.position.x, camera.position.y + 16, camera.position.z);
  const indoors = world.lightAt(camera.position.x, camera.position.y, camera.position.z).sky < 14;
  rainPS.emitRate = state.rain > 0.05 && !indoors ? 2400 * state.rain : 0;

  if (world.dirty.size) remeshDirty(4);
  if (plotDirtyAt && now > plotDirtyAt) savePlotNow();

  const [fs, fe] = fogRange();
  applyEnv(env, sky, camera, fs, fe, clockTime);
  scene.clearColor.set(env.horizon[0], env.horizon[1], env.horizon[2], 1);

  if ((hudTimer -= dt) <= 0) { hudTimer = 0.12; updateHud(); }
  if ((mapTimer -= dt) <= 0 && state.started) { mapTimer = 0.25; minimap.draw($('minimap'), player, { vehicles: traffic.vehicles, residents: residents.residents }); }
  if ((visTimer -= dt) <= 0) {
    visTimer = 0.4;
    for (let k = 0; k < NCX * NCZ; k++) applyChunkVisibility(k);
    const cam = camera.position;
    for (const r of residents.residents) {
      const on = Math.hypot(r.x - cam.x, r.z - cam.z) < 70;
      if (on !== r.visible) { r.visible = on; r.char.setVisible(on); }
    }
    for (const v of traffic.vehicles) v.root.setEnabled(Math.hypot(v.x - cam.x, v.z - cam.z) < 130);
    for (const { plane } of labels.values()) {
      const d = Math.hypot(plane.position.x - camera.position.x, plane.position.z - camera.position.z);
      plane.setEnabled(d > 14 && d < 110);
    }
  }
  if (state.started && (saveTimer -= dt) <= 0) { saveTimer = 5; saveProfile(); }
  if (state.started && (achvTimer -= dt) <= 0) { achvTimer = 0.5; checkPlaceAchievements(); }
  const beachDist = Math.max(0, SZ - pl.z);
  sfx.ambience(dt, { night: env.night, rain: state.rain, beachDist: state.started ? beachDist : 200, indoors });
  $('water-tint').classList.toggle('hidden', !(state.started && player.headInWater && state.camMode === 0));
  scene.render();
}

function placeCamera() {
  const e = eyePos();
  if (state.camMode === 0) {
    camera.position.set(e.x, e.y, e.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
  } else {
    const d = lookDir();
    const sign = state.camMode === 1 ? -1 : 1;
    const dir = { x: d.x * sign, y: d.y * sign, z: d.z * sign };
    let dist = 4.5;
    const hit = world.raycast(e.x, e.y, e.z, dir.x, dir.y, dir.z, dist);
    if (hit) dist = Math.max(0.6, Math.hypot(hit.hx - e.x, hit.hy - e.y, hit.hz - e.z) - 0.3);
    camera.position.set(e.x + dir.x * dist, e.y + dir.y * dist, e.z + dir.z * dist);
    if (state.camMode === 1) camera.rotation.set(player.pitch, player.yaw, 0);
    else camera.rotation.set(-player.pitch, player.yaw + Math.PI, 0);
  }
}

function updateSelection(hit) {
  if (state.paste) {
    selBox.setEnabled(false);
    const pl = pastePlacement();
    if (pl) {
      areaBox.setEnabled(true);
      areaBox.position.set(pl.ox, pl.oy, pl.oz);
      areaBox.scaling.set(pl.s.w, pl.s.h, pl.s.d);
      areaBox.color = pl.ok ? new BABYLON.Color3(0.2, 0.9, 0.3) : new BABYLON.Color3(0.9, 0.15, 0.15);
    } else areaBox.setEnabled(false);
    return;
  }
  if (!hit) { selBox.setEnabled(false); return; }
  let bx = [0, 0, 0, 1, 1, 1];
  const r = BLOCKS[hit.id].render;
  if (r === 'cross') bx = [0.15, 0, 0.15, 0.85, 0.9, 0.85];
  else if (r !== 'cube') {
    bx = [1, 1, 1, 0, 0, 0];
    for (const b of shapeBoxes(hit.id, hit.meta)) for (let i = 0; i < 3; i++) { bx[i] = Math.min(bx[i], b[i]); bx[i + 3] = Math.max(bx[i + 3], b[i + 3]); }
  }
  selBox.setEnabled(true);
  selBox.position.set(hit.x + bx[0], hit.y + bx[1], hit.z + bx[2]);
  selBox.scaling.set(bx[3] - bx[0], bx[4] - bx[1], bx[5] - bx[2]);
  selBox.color = canEdit(hit.x, hit.y, hit.z) || hit.id === B.DOOR ? BABYLON.Color3.Black() : new BABYLON.Color3(0.85, 0.1, 0.1);
}

function updateAreaBox() {
  if (state.paste) return;
  if (!state.area) { areaBox.setEnabled(false); return; }
  const b = state.area.b || (state.mode === 'playing' ? (() => { const h = getTarget(); return h ? [h.x, h.y, h.z] : state.area.a; })() : state.area.a);
  const a = state.area.a;
  areaBox.setEnabled(true);
  areaBox.color = new BABYLON.Color3(0.2, 0.8, 1);
  areaBox.position.set(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]));
  areaBox.scaling.set(Math.abs(a[0] - b[0]) + 1, Math.abs(a[1] - b[1]) + 1, Math.abs(a[2] - b[2]) + 1);
}

function projectBubble(key) {
  let pos;
  if (key.char) pos = new BABYLON.Vector3(key.x, 3.3, key.z);
  else if (key.root) pos = new BABYLON.Vector3(key.x, 4.2, key.z);
  else return null;
  const cam = camera.position;
  const fwd = camera.getDirection(BABYLON.Axis.Z);
  const rel = pos.subtract(cam);
  if (BABYLON.Vector3.Dot(rel, fwd) < 0.5 || rel.length() > 40) return null;
  const w = engine.getRenderWidth(), h = engine.getRenderHeight();
  const p = BABYLON.Vector3.Project(pos, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(w, h));
  const c = engine.getRenderingCanvas();
  const k = c.clientWidth / w;
  return { x: p.x * k, y: p.y * k };
}

function footsteps(dt) {
  if (player.inWater && !wasInWater && !player.flying) { sfx.splash(); achievements.unlock('swim'); }
  wasInWater = player.inWater;
  if (!player.onGround || player.moving < 0.5) return;
  stepAcc += player.moving * dt;
  if (stepAcc > 1.7) {
    stepAcc = 0;
    const id = world.get(Math.floor(player.pos.x), Math.floor(player.pos.y - 0.05), Math.floor(player.pos.z));
    if (id) sfx.step(BLOCKS[id].sound);
  }
}

function updateWeather(dt) {
  if (settings.weather === 'clear') state.rainTarget = 0;
  else if (settings.weather === 'rain') state.rainTarget = 1;
  else {
    state.weatherTimer -= dt;
    if (state.weatherTimer <= 0) {
      if (state.rainTarget > 0) { state.rainTarget = 0; state.weatherTimer = 180 + Math.random() * 300; }
      else if (Math.random() < 0.35) { state.rainTarget = 0.6 + Math.random() * 0.4; state.weatherTimer = 50 + Math.random() * 70; if (state.started) toast('Rain dey come o! Lagos shower incoming.'); }
      else state.weatherTimer = 120 + Math.random() * 200;
    }
  }
  state.rain += Math.sign(state.rainTarget - state.rain) * Math.min(Math.abs(state.rainTarget - state.rain), dt * 0.15);
}

function checkPlaceAchievements() {
  const { x, y, z } = player.pos;
  const p = plotAt(x, z);
  if (env.night > 0.8) achievements.unlock('night');
  if (z >= CITY) achievements.unlock('beach');
  if (p && p.kind === 'market') achievements.unlock('market');
  if (p && p.kind === 'park') achievements.unlock('park');
  if (y > 40) achievements.unlock('fly');
}

function updateHud() {
  if (!state.started) return;
  const px = Math.floor(player.pos.x), pz = Math.floor(player.pos.z);
  const p = plotAt(px, pz);
  const mine = p && p.number === PLAYER_PLOT;
  $('info').classList.toggle('mine', !!mine);
  const plotTitle = p ? (mine && state.plotName ? state.plotName : `Plot ${String(p.number).padStart(2, '0')}${p.name ? ' - ' + p.name : ''}`) : pz >= CITY ? 'Bar Beach' : 'Lagos road';
  $('info-plot').textContent = plotTitle;
  $('info-sub').textContent = `${districtAt(px, pz)} - ${mine ? 'Your land: build freely' : p ? (p.owner ? 'Owned by ' + p.owner : p.kind === 'free' ? 'Unclaimed land' : 'Public space') : 'Public space'}`;
  const h = state.time * 24;
  const icon = state.rain > 0.3 ? 'Rain' : h > 6.6 && h < 19 ? 'Sunny' : 'Night';
  $('info-clock').textContent = `${clockString(state.time)} Lagos  |  ${icon}`;
  $('info-pos').textContent = `${state.name || 'Guest'}  |  x ${px}  y ${Math.floor(player.pos.y)}  z ${pz}  |  ${Math.round(engine.getFps())} fps${player.flying ? '  |  flying' : ''}${player.inWater ? '  |  swimming' : ''}`;
}

// ------------------------------------------------------------------ input & screens

function selectSlot(i) {
  state.sel = (i + 9) % 9;
  hud.renderHotbar();
}

const SCREENS = ['menu', 'pause', 'inventory', 'map', 'help'];
function showMode(mode) {
  state.mode = mode;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== (mode === 'paused' ? 'pause' : mode));
  $('hud').classList.toggle('hidden', mode === 'menu' || mode === 'loading');
  $('touch').classList.toggle('hidden', !(isTouch && mode === 'playing'));
  if (mode !== 'playing') { Object.keys(keys).forEach((k) => (keys[k] = false)); mouse.left = mouse.right = false; }
  if (mode === 'paused') { renderAchievements($('achv-list'), achievements.got); $('achv-count').textContent = `${achievements.count()}`; syncSettingsUI(); }
  if (mode === 'map') drawBigMap();
}

function requestLock() {
  if (isTouch) return;
  const c = $('game');
  try {
    const p = c.requestPointerLock();
    if (p && p.catch) p.catch(() => { if (state.started && state.mode === 'playing') showMode('paused'); });
  } catch { showMode('paused'); }
}
function resumePlay() { showMode('playing'); requestLock(); }
function openOverlay(mode) {
  showMode(mode);
  if (document.pointerLockElement) document.exitPointerLock();
}

function enterGame() {
  const name = $('username').value.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    $('name-error').textContent = 'Use 3-16 letters, numbers or underscores.';
    return false;
  }
  $('name-error').textContent = '';
  state.name = name;
  state.started = true;
  sfx.unlock();
  sfx.setVolume(settings.volume);
  drawPlotLabel(myPlot);
  saveProfile();
  showMode('playing');
  rebuildAvatar();
  hud.renderHotbar();
  toast(`Welcome to Lagos, ${name}! Your plot has the yellow border.`);
  requestLock();
  return true;
}

function drawBigMap() {
  minimap.draw($('bigmap'), player, { vehicles: traffic.vehicles, residents: residents.residents, plotName: state.plotName }, true);
}

function teleport(x, z) {
  x = Math.max(1.5, Math.min(SX - 1.5, x)); z = Math.max(1.5, Math.min(SZ - 1.5, z));
  let y = HEIGHT - 2;
  while (y > 1 && !world.solidBoxes(Math.floor(x), y - 1, Math.floor(z))) y--;
  player.pos = { x, y, z };
  player.vel = { x: 0, y: 0, z: 0 };
  player.flying = false;
}

function syncSettingsUI() {
  $('set-view').value = settings.viewChunks; $('set-res').value = String(settings.resolution); $('set-sens').value = settings.sensitivity;
  $('set-vol').value = settings.volume; $('set-time').value = state.time; $('set-freeze').checked = !!settings.freezeTime; $('set-weather').value = settings.weather;
  $('set-view-val').textContent = settings.viewChunks * CHUNK + ' blocks';
  $('set-time-val').textContent = clockString(state.time);
  $('plot-name').value = state.plotName;
}

function bindUI() {
  const canvas = $('game');
  $('play').addEventListener('click', enterGame);
  $('username').addEventListener('keydown', (e) => { if (e.key === 'Enter') enterGame(); e.stopPropagation(); });
  $('username').addEventListener('keyup', (e) => e.stopPropagation());
  for (const id of ['plot-name', 'code-box']) {
    $(id).addEventListener('keydown', (e) => e.stopPropagation());
    $(id).addEventListener('keyup', (e) => e.stopPropagation());
  }
  $('resume').addEventListener('click', resumePlay);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', resumePlay));
  $('open-map').addEventListener('click', () => showMode('map'));
  $('open-help').addEventListener('click', () => showMode('help'));
  $('take-photo').addEventListener('click', () => { resumePlay(); setTimeout(takePhoto, 300); });

  // pause tabs
  document.querySelectorAll('#pause-tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#pause-tabs button').forEach((o) => o.classList.toggle('active', o === b));
    document.querySelectorAll('.ptab').forEach((s) => s.classList.toggle('hidden', s.id !== b.dataset.tab));
  }));
  mountLookPicker($('pause-look'), state.look, () => { rebuildAvatar(); saveProfile(); });

  // plot tab
  $('save-plot-name').addEventListener('click', () => {
    state.plotName = $('plot-name').value.trim().slice(0, 24);
    drawPlotLabel(myPlot); saveProfile();
    if (state.plotName) { achievements.unlock('name'); toast(`Your plot is now "${state.plotName}"`); }
  });
  $('copy-code').addEventListener('click', async () => {
    const code = exportCode();
    $('code-box').value = code;
    $('code-box').select();
    try { await navigator.clipboard.writeText(code); toast('Build code copied! Paste it to a friend.'); } catch { toast('Build code is in the box - copy it from there.'); }
    achievements.unlock('share');
  });
  $('load-code').addEventListener('click', () => {
    const code = $('code-box').value;
    if (!code.trim()) return toast('Paste a build code into the box first.', 'bad');
    if (!confirm('Replace everything on your plot with this build?')) return;
    const r = importCode(code);
    if (!r) return toast("That doesn't look like a valid Naijacraft build code.", 'bad');
    toast(typeof r === 'string' ? `Loaded "${r}" onto your plot!` : 'Build loaded onto your plot!');
  });
  $('reset-plot').addEventListener('click', () => {
    if (!confirm('Clear everything you built on your plot? (You can undo this with Ctrl+Z.)')) return;
    const edits = [];
    for (let y = 1; y < HEIGHT; y++) for (let z = myPlot.z; z < myPlot.z + PLOT; z++) for (let x = myPlot.x; x < myPlot.x + PLOT; x++) if (world.get(x, y, z)) edits.push([x, y, z, B.AIR, 0]);
    applyEdits(edits);
    toast('Your plot is clear again.');
  });

  // settings
  const view = $('set-view'), res = $('set-res'), sens = $('set-sens'), vol = $('set-vol'), time = $('set-time'), freeze = $('set-freeze'), weather = $('set-weather');
  const save = () => storage.saveSettings(settings);
  view.addEventListener('input', () => { settings.viewChunks = Number(view.value); $('set-view-val').textContent = settings.viewChunks * CHUNK + ' blocks'; applyViewDistance(); save(); });
  res.addEventListener('change', () => { settings.resolution = Number(res.value); applyResolution(); save(); });
  sens.addEventListener('input', () => { settings.sensitivity = Number(sens.value); save(); });
  vol.addEventListener('input', () => { settings.volume = Number(vol.value); sfx.setVolume(settings.volume); save(); });
  time.addEventListener('input', () => { state.time = Number(time.value); $('set-time-val').textContent = clockString(state.time); });
  freeze.addEventListener('change', () => { settings.freezeTime = freeze.checked; save(); });
  weather.addEventListener('change', () => { settings.weather = weather.value; state.weatherTimer = 0; save(); });

  // map
  const warps = [['My plot', myPlot.x + PLOT / 2, myPlot.z + PLOT + 2], ['Plaza', PLAZA + 7.5, PLAZA + 9], ['Yaba Market', 104, 82], ['Freedom Park', 64, 125], ['Bar Beach', 84, CITY + 8]];
  for (const [label, x, z] of warps) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { teleport(x, z); resumePlay(); });
    $('warp-buttons').appendChild(b);
  }
  $('bigmap').addEventListener('click', (e) => {
    const r = e.target.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * SX, z = (e.clientY - r.top) / r.width * SX;
    if (z > SZ) return;
    teleport(x, z);
    resumePlay();
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) { if (state.started && state.mode !== 'playing') showMode('playing'); }
    else if (state.started && state.mode === 'playing') { showMode('paused'); saveAll(); }
  });
  document.addEventListener('pointerlockerror', () => { if (state.started && state.mode === 'playing') showMode('paused'); });

  document.addEventListener('mousemove', (e) => {
    if (state.mode !== 'playing' || document.pointerLockElement !== canvas) return;
    const s = 0.0022 * settings.sensitivity;
    player.yaw += e.movementX * s;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch + e.movementY * s));
  });
  canvas.addEventListener('mousedown', (e) => {
    sfx.unlock();
    if (isTouch || state.mode !== 'playing') return; // touch has its own buttons; ignore synthetic clicks
    if (!isTouch && document.pointerLockElement !== canvas) { requestLock(); return; }
    e.preventDefault();
    if (e.button === 0) { mouse.left = true; mouse.next = performance.now() + 250; if (state.paste) { state.paste = null; updateModeBar(); } else tryBreak(); }
    else if (e.button === 2) { mouse.right = true; mouse.next = performance.now() + 250; tryPlace(); }
    else if (e.button === 1) pickBlock();
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => { if (state.mode === 'playing') selectSlot(state.sel + (e.deltaY > 0 ? 1 : -1)); }, { passive: true });

  window.addEventListener('keydown', (e) => {
    const code = e.code;
    if (state.mode === 'playing') {
      if (code === 'Space' && !e.repeat) {
        const now = performance.now();
        if (now - lastSpaceTap < 300) { player.toggleFly(); toast(player.flying ? 'Flying on (Space up, Shift down)' : 'Flying off'); lastSpaceTap = 0; }
        else lastSpaceTap = now;
      }
      keys[code] = true;
      if (/^Digit[1-9]$/.test(code)) selectSlot(Number(code.slice(5)) - 1);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(code)) e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && code === 'KeyY') { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey || e.repeat) return;
      switch (code) {
        case 'KeyE': openOverlay('inventory'); hud.openTab(); break;
        case 'KeyM': openOverlay('map'); break;
        case 'KeyH': openOverlay('help'); break;
        case 'KeyF': areaKey(); break;
        case 'KeyG': fillArea(false); break;
        case 'KeyX': case 'Delete': fillArea(true); break;
        case 'KeyC': copyArea(); break;
        case 'KeyV': if (state.clipboard) { startPaste(state.clipboard, 'your copy'); } else toast('Nothing copied yet. Select an area (F, F) and press C.'); break;
        case 'KeyR': if (state.paste) { state.paste.rot = (state.paste.rot + 1) % 4; sfx.click(); } break;
        case 'KeyT': state.camMode = (state.camMode + 1) % 3; avatar.setVisible(state.camMode !== 0); break;
        case 'KeyP': takePhoto(); break;
        case 'Backspace': state.paste = null; state.area = null; updateModeBar(); break;
        default: break;
      }
      return;
    }
    if (e.repeat) return;
    const closeKeys = { inventory: 'KeyE', map: 'KeyM', help: 'KeyH' };
    if (closeKeys[state.mode] === code) { resumePlay(); return; }
    if (code === 'Escape' && closeKeys[state.mode]) showMode('paused');
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => Object.keys(keys).forEach((k) => (keys[k] = false)));
  window.addEventListener('pagehide', saveAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveAll(); });

  if (isTouch) {
    touch = createTouchControls($('touch'), {
      look(dx, dy) {
        const s = 0.006 * settings.sensitivity;
        player.yaw += dx * s;
        player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch + dy * s));
      },
      press(act) {
        sfx.unlock();
        if (act === 'break') { mouse.next = performance.now() + 300; if (state.paste) { state.paste = null; updateModeBar(); } else tryBreak(); }
        if (act === 'place') { mouse.next = performance.now() + 300; tryPlace(); }
        if (act === 'fly') { player.toggleFly(); toast(player.flying ? 'Flying on' : 'Flying off'); }
        if (act === 'view') { state.camMode = (state.camMode + 1) % 3; avatar.setVisible(state.camMode !== 0); }
        if (act === 'inventory') { showMode('inventory'); hud.openTab(); }
        if (act === 'map') showMode('map');
        if (act === 'pause') showMode('paused');
      },
    });
  }
}

function takePhoto() {
  const flash = $('flash');
  flash.classList.add('on');
  setTimeout(() => flash.classList.remove('on'), 60);
  sfx.photo();
  const w = engine.getRenderWidth(), h = engine.getRenderHeight();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  try {
    BABYLON.Tools.CreateScreenshotUsingRenderTarget(engine, camera, { width: w, height: h }, undefined, 'image/png', 1, false, `naijacraft-${stamp}.png`);
    toast('Photo saved to your downloads!');
    achievements.unlock('photo');
  } catch (e) {
    console.warn(e);
    toast("Couldn't take a photo on this device.", 'bad');
  }
}

boot().catch((e) => { console.error(e); fatal('Something went wrong while starting: ' + e.message); });

