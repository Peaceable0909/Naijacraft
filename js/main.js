import { B, BLOCKS, DEFAULT_HOTBAR, createAtlasCanvas, ATLAS_COLS, ATLAS_ROWS, TILE } from './blocks.js';
import { World, PLOTS, PLAYER_PLOT, PLOT, SIZE, HEIGHT, NCH, CHUNK, SPAWN, plotAt, districtAt } from './world.js';
import { generateCity } from './city.js';
import { buildChunk } from './mesher.js';
import { Player, EYE } from './player.js';
import { storage } from './storage.js';
import { createHud, toast } from './ui.js';

const $ = (id) => document.getElementById(id);
const BABYLON = window.BABYLON;
const REACH = 6;

function fatal(msg) {
  $('loading').classList.add('hidden');
  $('fatal-text').textContent = msg;
  $('fatal').classList.remove('hidden');
}

const settings = storage.loadSettings();
const profile = storage.loadProfile() || {};
const myPlot = PLOTS[PLAYER_PLOT - 1];

const state = {
  mode: 'loading',      // loading | menu | playing | paused | inventory
  started: false,
  hotbar: Array.isArray(profile.hotbar) && profile.hotbar.length === 9 && profile.hotbar.every((i) => BLOCKS[i]) ? profile.hotbar : DEFAULT_HOTBAR.slice(),
  sel: Number.isInteger(profile.sel) ? Math.min(8, Math.max(0, profile.sel)) : 0,
  name: profile.name || '',
};

let engine, scene, camera, world, player, hud;
const keys = {};
const mouse = { left: false, right: false, next: 0 };
let plotDirtyAt = 0;      // time (ms) the plot should be saved at, 0 = clean
let lastSpaceTap = 0;
let lastDenied = 0;
let selBox;
const chunkMeshes = new Array(NCH * NCH).fill(null);
let opaqueMat, glassMat;
const labels = [];

async function boot() {
  if (!BABYLON) return fatal('The 3D engine (Babylon.js) failed to load. Check your internet connection and refresh the page.');
  const canvas = $('game');
  try {
    engine = new BABYLON.Engine(canvas, false, { stencil: false, powerPreference: 'high-performance' });
  } catch (e) {
    return fatal('Your browser does not support WebGL, which Naijacraft needs. Try Chrome, Edge, Firefox or Safari.');
  }
  applyResolution();

  scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.55, 0.78, 0.95, 1);
  scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
  scene.fogColor = new BABYLON.Color3(0.55, 0.78, 0.95);
  scene.skipPointerMovePicking = true;
  scene.autoClearDepthAndStencil = true;
  if (BABYLON.ScenePerformancePriority) scene.performancePriority = BABYLON.ScenePerformancePriority.Aggressive;

  camera = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(84, 40, 84), scene);
  camera.minZ = 0.1; camera.maxZ = 700; camera.fov = 1.2;
  camera.inputs.clear();

  setLoading('Painting the textures...', 0.05);
  const atlas = createAtlasCanvas();
  makeMaterials(atlas);

  // Ground beyond the city walls so the horizon isn't empty.
  const ground = BABYLON.MeshBuilder.CreateGround('far-ground', { width: 3000, height: 3000 }, scene);
  ground.position.set(SIZE / 2, 0.7, SIZE / 2);
  const gm = new BABYLON.StandardMaterial('far-ground', scene);
  gm.disableLighting = true; gm.emissiveColor = new BABYLON.Color3(0.36, 0.6, 0.27); gm.specularColor = BABYLON.Color3.Black();
  ground.material = gm; ground.isPickable = false; ground.freezeWorldMatrix();

  selBox = makeSelectionBox();

  setLoading('Laying the roads of Lagos...', 0.12);
  await frame();
  world = new World();
  generateCity(world);
  loadSavedPlot();
  world.markAllDirty();

  player = new Player(world);
  const start = profile.pos && !world.isSolid(Math.floor(profile.pos[0]), Math.floor(profile.pos[1]), Math.floor(profile.pos[2])) ? profile : null;
  player.pos = start ? { x: profile.pos[0], y: profile.pos[1], z: profile.pos[2] } : { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z };
  player.yaw = start ? profile.yaw : SPAWN.yaw;
  player.pitch = start ? profile.pitch : SPAWN.pitch;

  await meshAll();
  createPlotLabels();

  hud = createHud(atlas, state, selectSlot);
  hud.renderHotbar();
  bindUI();
  applyViewDistance();

  engine.runRenderLoop(tick);
  window.addEventListener('resize', () => engine.resize());
  window.__naija = { world, player, scene, state, camera, keys, tryBreak, tryPlace, getTarget, enterGame, canEdit }; // debug/test hook

  $('username').value = state.name;
  if (window.matchMedia('(pointer: coarse)').matches) $('touch-note').classList.remove('hidden');
  $('loading').classList.add('hidden');
  $('menu').classList.remove('hidden');
  state.mode = 'menu';
}

const frame = () => new Promise((r) => requestAnimationFrame(r));
function setLoading(text, p) { $('loading-text').textContent = text; $('loading-fill').style.width = Math.round(p * 100) + '%'; }

// ------------------------------------------------------------------ rendering setup

function makeMaterials(atlas) {
  const W = ATLAS_COLS * TILE, H = ATLAS_ROWS * TILE;
  const make = (name, alpha) => {
    const t = new BABYLON.DynamicTexture(name, { width: W, height: H }, scene, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);
    t.getContext().drawImage(atlas, 0, 0);
    t.update(true);
    t.hasAlpha = alpha;
    t.wrapU = t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    return t;
  };
  opaqueMat = new BABYLON.StandardMaterial('opaque', scene);
  opaqueMat.diffuseTexture = make('atlas-opaque', false);
  glassMat = new BABYLON.StandardMaterial('glass', scene);
  glassMat.diffuseTexture = make('atlas-glass', true);
  glassMat.useAlphaFromDiffuseTexture = true;
  glassMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
  for (const m of [opaqueMat, glassMat]) {
    m.disableLighting = true;
    m.emissiveColor = new BABYLON.Color3(1, 1, 1);
    m.specularColor = BABYLON.Color3.Black();
    m.backFaceCulling = true;
  }
}

function makeSelectionBox() {
  const o = -0.003, e = 1.003;
  const p = [[o, o, o], [e, o, o], [e, o, e], [o, o, e], [o, e, o], [e, e, o], [e, e, e], [o, e, e]].map((a) => new BABYLON.Vector3(...a));
  const lines = [
    [p[0], p[1], p[2], p[3], p[0]], [p[4], p[5], p[6], p[7], p[4]],
    [p[0], p[4]], [p[1], p[5]], [p[2], p[6]], [p[3], p[7]],
  ];
  const box = BABYLON.MeshBuilder.CreateLineSystem('sel', { lines }, scene);
  box.color = BABYLON.Color3.Black();
  box.isPickable = false;
  box.setEnabled(false);
  return box;
}

function rebuildChunk(cx, cz) {
  const k = cz * NCH + cx;
  const old = chunkMeshes[k];
  if (old) for (const m of old) m.dispose();
  const built = buildChunk(world, cx, cz);
  const meshes = [];
  for (const [layer, mat] of [['opaque', opaqueMat], ['glass', glassMat]]) {
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
    mesh.freezeWorldMatrix();
    meshes.push(mesh);
  }
  chunkMeshes[k] = meshes;
  return meshes;
}

async function meshAll() {
  const keysToBuild = [...world.dirty];
  world.dirty.clear();
  let n = 0;
  for (const k of keysToBuild) {
    rebuildChunk(k % NCH, Math.floor(k / NCH));
    if (++n % 6 === 0) { setLoading('Building chunks...', 0.2 + 0.78 * (n / keysToBuild.length)); await frame(); }
  }
}

function remeshDirty(budget) {
  let n = 0;
  for (const k of world.dirty) {
    world.dirty.delete(k);
    rebuildChunk(k % NCH, Math.floor(k / NCH));
    applyChunkVisibility(k);
    if (++n >= budget) break;
  }
}

function applyChunkVisibility(k) {
  const ms = chunkMeshes[k];
  if (!ms) return;
  const cx = (k % NCH) * CHUNK + CHUNK / 2, cz = Math.floor(k / NCH) * CHUNK + CHUNK / 2;
  const dist = Math.hypot(cx - camera.position.x, cz - camera.position.z);
  const on = dist < settings.viewChunks * CHUNK + CHUNK * 1.5;
  for (const m of ms) m.setEnabled(on);
}

function applyViewDistance() {
  const d = settings.viewChunks * CHUNK;
  scene.fogStart = d * 0.6;
  scene.fogEnd = d * 1.2;
  camera.maxZ = d * 1.6;
  for (let k = 0; k < NCH * NCH; k++) applyChunkVisibility(k);
}

function applyResolution() {
  engine.setHardwareScalingLevel(Number(settings.resolution) || 1);
  engine.resize();
}

function createPlotLabels() {
  for (const p of PLOTS) {
    const tex = new BABYLON.DynamicTexture('label' + p.number, { width: 512, height: 160 }, scene, false);
    tex.hasAlpha = true;
    const g = tex.getContext();
    const mine = p.number === PLAYER_PLOT;
    const bg = mine ? '#c99a0a' : p.owner ? '#44505a' : p.kind === 'free' ? '#2a6fb0' : '#1d7a4a';
    g.fillStyle = bg; g.fillRect(0, 0, 512, 160);
    g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(0, 0, 512, 8);
    g.fillStyle = '#fff'; g.textAlign = 'center';
    g.font = 'bold 64px system-ui, sans-serif';
    g.fillText(p.name || ('PLOT ' + String(p.number).padStart(2, '0')), 256, 78);
    g.font = '36px system-ui, sans-serif';
    const sub = mine ? 'YOURS (Plot ' + String(p.number).padStart(2, '0') + ')' : p.owner ? p.owner + "'s home" : p.kind === 'free' ? 'AVAILABLE' : 'PUBLIC SPACE';
    g.fillText(sub + '  -  ' + p.district, 256, 130);
    tex.update(true);
    const mat = new BABYLON.StandardMaterial('label' + p.number, scene);
    mat.diffuseTexture = tex; mat.useAlphaFromDiffuseTexture = false;
    mat.disableLighting = true; mat.emissiveColor = new BABYLON.Color3(1, 1, 1); mat.specularColor = BABYLON.Color3.Black();
    mat.backFaceCulling = false;
    const plane = BABYLON.MeshBuilder.CreatePlane('label' + p.number, { width: 8, height: 2.5 }, scene);
    plane.material = mat;
    plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
    plane.position.set(p.x + PLOT / 2, 8, p.z + PLOT + 3.5);
    plane.isPickable = false;
    labels.push(plane);
  }
}

// ------------------------------------------------------------------ plot saving

function loadSavedPlot() {
  const saved = storage.loadPlot(myPlot.number);
  if (saved && !world.importPlot(myPlot, saved)) console.warn('Saved plot could not be read; starting fresh.');
}

function savePlotNow() {
  plotDirtyAt = 0;
  if (!storage.savePlot(myPlot.number, world.exportPlot(myPlot))) toast("Couldn't save - browser storage is full or blocked.", 'bad');
}

function saveProfile() {
  storage.saveProfile({
    name: state.name, hotbar: state.hotbar, sel: state.sel,
    pos: [player.pos.x, player.pos.y, player.pos.z], yaw: player.yaw, pitch: player.pitch,
  });
}

function saveAll() {
  if (!state.started) return;
  if (plotDirtyAt) savePlotNow();
  saveProfile();
}

// ------------------------------------------------------------------ building rules

function canEdit(x, y, z, notify = false) {
  const deny = (msg) => {
    if (notify && performance.now() - lastDenied > 700) { lastDenied = performance.now(); toast(msg, 'bad'); }
    return false;
  };
  if (y < 1) return deny("The ground can't be changed.");
  if (y >= HEIGHT) return deny('That is as high as the sky limit goes.');
  const p = plotAt(x, z);
  if (!p) return deny('Roads and public spaces belong to the city.');
  if (p.number !== PLAYER_PLOT) {
    return deny(p.owner ? `Plot ${p.number} belongs to ${p.owner}. Build on your yellow-bordered plot.` : p.kind === 'free' ? `Plot ${p.number} is unclaimed. Accounts are coming soon!` : 'This is a public space.');
  }
  return true;
}

function getTarget() {
  const e = eyePos(), d = lookDir();
  return world.raycast(e.x, e.y, e.z, d.x, d.y, d.z, REACH);
}
const eyePos = () => ({ x: player.pos.x, y: player.pos.y + EYE, z: player.pos.z });
function lookDir() {
  const cp = Math.cos(player.pitch);
  return { x: cp * Math.sin(player.yaw), y: -Math.sin(player.pitch), z: cp * Math.cos(player.yaw) };
}

function markPlotDirty() { plotDirtyAt = performance.now() + 1500; }

function tryBreak(hit = getTarget()) {
  if (!hit || !canEdit(hit.x, hit.y, hit.z, true)) return false;
  world.set(hit.x, hit.y, hit.z, B.AIR);
  markPlotDirty();
  return true;
}

function tryPlace(hit = getTarget()) {
  if (!hit || (hit.nx === 0 && hit.ny === 0 && hit.nz === 0)) return false;
  const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
  if (world.get(x, y, z) !== 0 || !canEdit(x, y, z, true)) return false;
  if (player.intersectsBlock(x, y, z)) return false;
  world.set(x, y, z, state.hotbar[state.sel]);
  markPlotDirty();
  return true;
}

// ------------------------------------------------------------------ main loop

const orbitTarget = new BABYLON.Vector3(84, 6, 84);
let hudTimer = 0, visTimer = 0, saveTimer = 0, orbit = 0;
function tick() {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000 || 0.016);
  const now = performance.now();

  if (state.mode === 'playing') {
    player.update(dt, keys);
    const hit = getTarget();
    if (hit) {
      selBox.setEnabled(true);
      selBox.position.set(hit.x, hit.y, hit.z);
      selBox.color = canEdit(hit.x, hit.y, hit.z) ? BABYLON.Color3.Black() : new BABYLON.Color3(0.85, 0.1, 0.1);
    } else selBox.setEnabled(false);
    if ((mouse.left || mouse.right) && now >= mouse.next) {
      mouse.next = now + 140;
      if (mouse.left) tryBreak(hit); else tryPlace(hit);
    }
  } else {
    selBox.setEnabled(false);
  }

  if (state.mode === 'menu' || !state.started) {
    orbit += dt * 0.08;
    camera.position.set(84 + Math.sin(orbit) * 70, 34, 84 + Math.cos(orbit) * 70);
    camera.setTarget(orbitTarget);
  } else {
    camera.position.set(player.pos.x, player.pos.y + EYE, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
  }

  if (world.dirty.size) remeshDirty(4);
  if (plotDirtyAt && now > plotDirtyAt) savePlotNow();

  if ((hudTimer -= dt) <= 0) { hudTimer = 0.12; updateHud(); }
  if ((visTimer -= dt) <= 0) {
    visTimer = 0.4;
    for (let k = 0; k < NCH * NCH; k++) applyChunkVisibility(k);
    for (const l of labels) { const d = Math.hypot(l.position.x - camera.position.x, l.position.z - camera.position.z); l.setEnabled(d > 14 && d < 110); }
  }
  if (state.started && (saveTimer -= dt) <= 0) { saveTimer = 5; saveProfile(); }
  scene.render();
}

function updateHud() {
  if (!state.started) return;
  const px = Math.floor(player.pos.x), pz = Math.floor(player.pos.z);
  const p = plotAt(px, pz);
  const info = $('info');
  const district = districtAt(px, pz);
  const mine = p && p.number === PLAYER_PLOT;
  info.classList.toggle('mine', !!mine);
  $('info-plot').textContent = p ? `Plot ${String(p.number).padStart(2, '0')}${p.name ? ' - ' + p.name : ''}` : 'Lagos road';
  $('info-sub').textContent = `${district} - ${mine ? 'Your land: build freely' : p ? (p.owner ? "Owned by " + p.owner : p.kind === 'free' ? 'Unclaimed land' : 'Public space') : 'Public road'}`;
  $('info-pos').textContent = `${state.name || 'Guest'}  |  x ${px}  y ${Math.floor(player.pos.y)}  z ${pz}  |  ${Math.round(engine.getFps())} fps${player.flying ? '  |  flying' : ''}`;
}

// ------------------------------------------------------------------ input & screens

function selectSlot(i) {
  state.sel = (i + 9) % 9;
  hud.renderHotbar();
}

function showMode(mode) {
  state.mode = mode;
  $('menu').classList.toggle('hidden', mode !== 'menu');
  $('hud').classList.toggle('hidden', mode === 'menu' || mode === 'loading');
  $('pause').classList.toggle('hidden', mode !== 'paused');
  $('inventory').classList.toggle('hidden', mode !== 'inventory');
}

function requestLock() {
  const c = $('game');
  try {
    const p = c.requestPointerLock();
    if (p && p.catch) p.catch(() => { if (state.started && state.mode !== 'inventory') showMode('paused'); });
  } catch { showMode('paused'); }
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
  saveProfile();
  showMode('playing');
  hud.renderHotbar();
  toast(`Welcome to Lagos, ${name}! Your plot has the yellow border.`);
  requestLock();
  return true;
}

function bindUI() {
  const canvas = $('game');
  $('play').addEventListener('click', enterGame);
  $('username').addEventListener('keydown', (e) => { if (e.key === 'Enter') enterGame(); e.stopPropagation(); });
  $('username').addEventListener('keyup', (e) => e.stopPropagation());
  $('resume').addEventListener('click', () => { showMode('playing'); requestLock(); });
  $('reset-plot').addEventListener('click', () => {
    if (!confirm('Clear everything you built on your plot? This cannot be undone.')) return;
    world.clearPlot(myPlot);
    storage.clearPlot(myPlot.number);
    plotDirtyAt = 0;
    toast('Your plot is clear again.');
  });

  const view = $('set-view'), res = $('set-res'), sens = $('set-sens');
  view.value = settings.viewChunks; res.value = String(settings.resolution); sens.value = settings.sensitivity;
  const label = () => { $('set-view-val').textContent = settings.viewChunks * CHUNK + ' blocks'; };
  label();
  view.addEventListener('input', () => { settings.viewChunks = Number(view.value); label(); applyViewDistance(); storage.saveSettings(settings); });
  res.addEventListener('change', () => { settings.resolution = Number(res.value); applyResolution(); storage.saveSettings(settings); });
  sens.addEventListener('input', () => { settings.sensitivity = Number(sens.value); storage.saveSettings(settings); });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) { if (state.started) showMode('playing'); }
    else if (state.started && state.mode === 'playing') { Object.keys(keys).forEach((k) => (keys[k] = false)); mouse.left = mouse.right = false; showMode('paused'); saveAll(); }
  });
  document.addEventListener('pointerlockerror', () => { if (state.started && state.mode !== 'inventory') showMode('paused'); });

  document.addEventListener('mousemove', (e) => {
    if (state.mode !== 'playing' || document.pointerLockElement !== canvas) return;
    const s = 0.0022 * settings.sensitivity;
    player.yaw += e.movementX * s;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch + e.movementY * s));
  });
  canvas.addEventListener('mousedown', (e) => {
    if (state.mode !== 'playing') return;
    e.preventDefault();
    if (e.button === 0) { mouse.left = true; mouse.next = performance.now() + 250; tryBreak(); }
    else if (e.button === 2) { mouse.right = true; mouse.next = performance.now() + 250; tryPlace(); }
    else if (e.button === 1) pickBlock();
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => { if (state.mode === 'playing') selectSlot(state.sel + (e.deltaY > 0 ? 1 : -1)); }, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && state.mode === 'playing' && !e.repeat) {
      const now = performance.now();
      if (now - lastSpaceTap < 300) { player.toggleFly(); toast(player.flying ? 'Flying on' : 'Flying off'); lastSpaceTap = 0; }
      else lastSpaceTap = now;
    }
    if (state.mode === 'playing') {
      keys[e.code] = true;
      if (/^Digit[1-9]$/.test(e.code)) selectSlot(Number(e.code.slice(5)) - 1);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    }
    if (e.code === 'KeyE' && !e.repeat) {
      if (state.mode === 'playing') { showMode('inventory'); document.exitPointerLock(); }
      else if (state.mode === 'inventory') { showMode('playing'); requestLock(); }
    }
    if (e.code === 'Escape' && state.mode === 'inventory') { showMode('paused'); }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => Object.keys(keys).forEach((k) => (keys[k] = false)));
  window.addEventListener('pagehide', saveAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveAll(); });
}

function pickBlock() {
  const hit = getTarget();
  if (!hit) return;
  const id = world.get(hit.x, hit.y, hit.z);
  if (!BLOCKS[id] || id === B.AIR) return;
  const slot = state.hotbar.indexOf(id);
  if (slot >= 0) state.sel = slot; else state.hotbar[state.sel] = id;
  hud.renderHotbar();
}

boot().catch((e) => { console.error(e); fatal('Something went wrong while starting: ' + e.message); });
