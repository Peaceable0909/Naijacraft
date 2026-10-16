import { B, BLOCKS, DEFAULT_HOTBAR, createAtlasCanvas, shapeBoxes } from './blocks.js';
import { World, PLOTS, PLOT, SX, SZ, CITY, HEIGHT, NCX, NCZ, CHUNK, SPAWN, OFFLINE_PLOT, plotAt, districtAt, plotFront, plotByNumber, mapX } from './world.js';
import { generateCity, PLAZA } from './city.js';
import { buildChunk } from './mesher.js';
import { Player } from './player.js';
import { storage } from './storage.js';
import { registerShaders, createVoxelMaterials, createSky, createGroundPlanes, computeEnv, applyEnv, clockString, lightColor } from './render.js';
import { createCharacter, setCharacterAtlas, DEFAULT_LOOK, EMOTES, EMOTE_SECONDS } from './characters.js';
import { createEffects, detectLevel, LEVELS } from './fx.js';
import { createResidents } from './npcs.js';
import { createTraffic } from './vehicles.js';
import { createMinimap } from './minimap.js';
import { createAchievements, weeklyChallenge } from './achievements.js';
import { createTouchControls } from './touch.js';
import { sfx } from './audio.js';
import { createHud, mountLookPicker, toast, showAchievement, renderAchievements, createBubbles } from './ui.js';
import { G, $ } from './game.js';
import * as build from './building.js';
import { getServerUrl } from './config.js';
import { Auth } from './auth.js';
import { createOnline } from './online.js';
import { createRemotePlayers } from './remote.js';
import { createChat, nameColor } from './chat.js';
import { createMenu, TIPS } from './menu.js';
import { createClaimScreen } from './claim.js';
import { createAccountPanel } from './account.js';
import { showDialog, confirmDialog, dialogOpen } from './dialog.js';
import { FLAG } from '../shared/protocol.js';
import { MAX_BLOCK_ID } from '../shared/layout.js';

const BABYLON = window.BABYLON;
const DAY_LENGTH = 20 * 60;     // real seconds per Lagos day when playing offline
const MENU_TIME = 0.6;          // 14:24, bright afternoon light
const isTouch = G.isTouch;
const IDLE_INPUT = { f: 0, s: 0, jump: false, down: false, sprint: false };

function fatal(msg) {
  $('loading').classList.add('hidden');
  $('fatal-text').textContent = msg;
  $('fatal').classList.remove('hidden');
}

const settings = storage.loadSettings();
const profile = storage.loadProfile() || {};
const validLook = (l) => l && Number.isInteger(l.skin) && Number.isInteger(l.outfit) && Number.isInteger(l.hat);

const state = {
  mode: 'loading',      // loading | menu | claim | playing | chat | paused | inventory | map | help | players | emote
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
  emote: null,          // { id, kind, start, until } while the local avatar performs an emote
};
G.settings = settings; G.profile = profile; G.state = state;

let engine, scene, camera, world, player, hud, sky, minimap, residents, traffic, avatar, achievements, bubbles, touch, chat, remote, claimScreen, menu, accountPanel;
let pauseLook = null, fx = null;
let materials, env = computeEnv(state.time);
let auth = null, serverInfo = null, server = '';
const keys = {};
const mouse = { left: false, right: false, next: 0 };
let plotDirtyAt = 0, lastSpaceTap = 0, clockTime = 0, nextPosSend = 0, nextProfileSend = 0, lastRainToast = 0;
let selBox, areaBox, rainPS;
const chunkMeshes = new Array(NCX * NCZ).fill(null);
const labels = new Map();
const tagEls = new Map();
const mutes = new Set(storage.loadMutes());
let pendingClaim = null;

const frame = () => new Promise((r) => requestAnimationFrame(r));
function setLoading(text, p) { $('loading-text').textContent = text; $('loading-fill').style.width = Math.round(p * 100) + '%'; }

G.hooks.shiftHeld = () => keys.ShiftLeft || keys.ShiftRight;
G.hooks.markPlotDirty = () => { if (!G.online && G.myPlot) plotDirtyAt = performance.now() + 1500; };
G.hooks.savePlotNow = () => savePlotNow();
G.hooks.closeOverlay = () => { if (state.mode === 'inventory') resumePlay(); };

// ------------------------------------------------------------------ boot

async function boot() {
  const canvas = $('game');
  try {
    engine = new BABYLON.Engine(canvas, false, { stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  } catch (e) {
    return fatal('Your browser does not support WebGL, which Naijacraft needs. Try Chrome, Edge, Firefox or Safari.');
  }
  if (!isTouch) document.documentElement.classList.add('fx-blur');
  $('loading-tip').textContent = 'Tip: ' + TIPS[Math.floor(Math.random() * TIPS.length)];
  G.engine = engine;
  applyResolution();
  registerShaders();

  scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.55, 0.78, 0.95, 1);
  scene.skipPointerMovePicking = true;
  if (BABYLON.ScenePerformancePriority) scene.performancePriority = BABYLON.ScenePerformancePriority.Intermediate;
  G.scene = scene;

  camera = new BABYLON.FreeCamera('cam', new BABYLON.Vector3(PLAZA, 40, PLAZA), scene);
  camera.minZ = 0.1; camera.maxZ = 1000; camera.fov = 1.2;
  camera.inputs.clear();
  G.camera = camera;

  setLoading('Painting the textures...', 0.05);
  const atlas = createAtlasCanvas();
  G.atlas = atlas;
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
  G.world = world;
  generateCity(world);
  setLoading('Switching on the street lights...', 0.16);
  await frame();
  world.computeAllLight();
  world.markAllDirty();

  player = new Player(world);
  G.player = player;
  player.pos = { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z };
  player.yaw = SPAWN.yaw; player.pitch = SPAWN.pitch;

  await meshAll();
  setLoading('Waking up the neighbours...', 0.97);
  await frame();
  fx = createEffects({ scene, camera, materials, chunkMeshes, NCX, NCZ, CHUNK });
  applyGraphics();
  minimap = createMinimap(world, atlas);
  G.minimap = minimap;
  residents = createResidents(scene);
  traffic = createTraffic(scene);
  remote = createRemotePlayers({ scene, lightAt });
  rebuildAvatar();
  achievements = createAchievements(profile.achievements, (a) => { showAchievement(a); sfx.achievement(); saveProfile(); queueProfileSync(); });
  G.achievements = achievements;
  bubbles = createBubbles($('bubbles'));
  for (const pl of PLOTS) drawPlotLabel(pl);

  hud = createHud(atlas, state, { onSelect: selectSlot, onBlueprint: build.startBlueprint });
  G.hud = hud;
  hud.renderHotbar();
  chat = createChat({ onSend: sendChat, onOpenChange: onChatOpenChange });
  bindUI();
  applyViewDistance();

  engine.runRenderLoop(tick);
  window.addEventListener('resize', () => engine.resize());
  window.__naija = {
    G, world, player, scene, state, camera, keys, settings, residents, traffic, remote, achievements,
    tryBreak: build.tryBreak, tryPlace: build.tryPlace, getTarget: build.getTarget, canEdit: build.canEdit, applyEdits: build.applyEdits,
    undo: build.undo, redo: build.redo, startBlueprint: build.startBlueprint, placePaste: build.placePaste, toggleDoor: build.toggleDoor,
    exportCode: build.exportCode, importCode: build.importCode, enterOffline, showMode, teleport, setTime: (t) => { state.time = t; },
    get online() { return G.online; }, get menu() { return menu; }, get claimScreen() { return claimScreen; }, get chat() { return chat; },
    enterGame: () => enterOffline(state.name || 'Builder'),
    applyGraphics, get fx() { return fx; },
  };

  // The start screen's pickers share the saved look; a server (if any) is checked while the player reads it.
  server = await findServer();
  auth = server ? new Auth(server) : null;
  serverInfo = auth ? await auth.info() : null;
  accountPanel = auth ? createAccountPanel({ auth, getInfo: () => serverInfo }) : null;
  claimScreen = createClaimScreen({ minimap, getOwners: () => G.owners, onClaim: claimPlot });
  menu = createMenu({
    server, auth, look: state.look,
    hooks: { enterOnline, enterOffline },
  });
  menu.setOfflineName(state.name);
  pauseLook = mountLookPicker($('pause-look'), state.look, () => { rebuildAvatar(); saveProfile(); queueProfileSync(); });
  $('pause-challenge').textContent = weeklyChallenge();
  $('loading').classList.add('hidden');
  openMenu();
}

// The server is either named by ?server=, built into config.js, or is whatever served this very page.
async function findServer() {
  const configured = getServerUrl();
  if (configured) return configured;
  if (!/^https?:$/.test(location.protocol)) return '';
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch('/health', { signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok && (await r.json()).name === 'naijacraft-world') return location.origin;
  } catch { /* a plain static host: offline mode */ }
  return '';
}

function openMenu() {
  state.started = false;
  showMode('menu');
  menu.open(serverInfo);
}

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
  fx?.markShadowsDirty();
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

// ------------------------------------------------------------------ plots: borders, signs, ownership

function ringIdFor(p) {
  if (!p.claimable) return null;
  if (G.myPlot && G.myPlot.number === p.number) return B.YELLOW;
  return G.owners.has(p.number) ? B.CONCRETE : B.WHITE;
}

function refreshPlotVisual(p) {
  const id = ringIdFor(p);
  if (id != null) world.setRing(p, id);
  drawPlotLabel(p);
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
    plane.position.set(p.x + PLOT / 2, 8.5, p.z + PLOT + 3.5);
    plane.isPickable = false;
    plane.renderingGroupId = 1;
    entry = { tex, plane };
    labels.set(p.number, entry);
  }
  const mine = !!(G.myPlot && p.number === G.myPlot.number);
  const o = G.owners.get(p.number);
  let color, title, sub;
  if (mine) { color = '#c99a0a'; title = state.plotName || 'Your plot'; sub = `${state.name || 'You'}  -  PLOT ${p.number}`; }
  else if (o) { color = '#44505a'; title = o.name || `${o.owner}'s plot`; sub = `${o.owner}  -  PLOT ${p.number}`; }
  else if (p.claimable) { color = '#2a6fb0'; title = 'FREE LAND'; sub = `PLOT ${p.number}  -  ${p.district}`; }
  else { color = '#1d7a4a'; title = p.name || `${p.owner}'s home`; sub = p.name ? p.district : `SHOW HOME  -  ${p.district}`; }
  const g = entry.tex.getContext();
  g.fillStyle = color;
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(0, 0, 512, 8);
  g.fillStyle = '#fff'; g.textAlign = 'center';
  g.font = `bold ${title.length > 14 ? 44 : 60}px system-ui, sans-serif`;
  g.fillText(title.length > 22 ? title.slice(0, 21) + '...' : title, 256, 78, 480);
  g.font = '32px system-ui, sans-serif';
  g.fillText(sub, 256, 130, 480);
  entry.tex.update(true);
}

// Makes `plot` the player's own: clears the show-grass, paints the yellow border and updates the sign.
function claimLocally(plot) {
  const prev = G.myPlot;
  G.myPlot = plot;
  if (prev && prev.number !== plot.number) refreshPlotVisual(prev);
  build.clearPlotContents(plot);
  refreshPlotVisual(plot);
  build.resetHistory();
  updateOnlineUI();
}

// ------------------------------------------------------------------ avatar

function rebuildAvatar() {
  if (!scene) return;
  if (avatar) avatar.dispose();
  avatar = createCharacter(scene, state.look, 'me');
  avatar.setVisible(state.camMode !== 0 && state.started);
}

// ------------------------------------------------------------------ saving

function loadSavedPlot(plot) {
  const saved = storage.loadOfflinePlot(plot.number);
  if (!saved) return;
  const decoded = World.decodePlot(saved.data, saved.version);
  if (decoded) build.replacePlotContents(plot, decoded.ids, decoded.metas);
  else console.warn('Saved plot could not be read; starting fresh.');
}

function savePlotNow() {
  plotDirtyAt = 0;
  if (G.online || !G.myPlot) return;
  if (!storage.savePlot(G.myPlot.number, world.exportPlot(G.myPlot))) toast("Couldn't save - browser storage is full or blocked.", 'bad');
}

function saveProfile() {
  if (!player) return;
  storage.saveProfile({
    name: state.name, hotbar: state.hotbar, sel: state.sel, look: state.look, plotName: state.plotName, time: state.time,
    spawn: G.online ? profile.spawn : { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch },
    achievements: achievements ? achievements.toJSON() : profile.achievements,
  });
}

function saveAll() {
  if (!state.started) return;
  if (plotDirtyAt) savePlotNow();
  saveProfile();
}

// Looks, plot name and achievements live on the server too (so they follow the player to other devices).
function queueProfileSync() { nextProfileSend = performance.now() + 1500; }
function syncProfile() {
  nextProfileSend = 0;
  if (!G.online || !G.online.ready) return;
  G.online.profile({ look: state.look, achv: achievements.toJSON() });        // the plot name is saved only by its own button
}

// ------------------------------------------------------------------ playing offline

function enterOffline(name) {
  G.online = null;
  state.name = name;
  document.body.classList.remove('online');
  const plot = plotByNumber(OFFLINE_PLOT);
  claimLocally(plot);
  loadSavedPlot(plot);
  drawPlotLabel(plot);
  spawnPlayer();
  startPlaying(`Welcome to Lagos, ${name}! Your plot has the yellow border.`);
}

function spawnPlayer() {
  let p;
  const sp = profile.spawn;
  if (!G.online && sp && [sp.x, sp.y, sp.z].every(Number.isFinite) && !player.collides(sp.x, sp.y, sp.z)) p = sp;
  else if (G.myPlot) p = plotFront(G.myPlot);
  else p = SPAWN;
  player.pos = { x: p.x, y: p.y, z: p.z };
  player.yaw = p.yaw ?? SPAWN.yaw; player.pitch = p.pitch ?? 0.1;
  player.vel = { x: 0, y: 0, z: 0 };
  player.flying = false;
}

function startPlaying(welcomeText) {
  state.started = true;
  claimScreen?.hide();
  menu?.close();
  sfx.unlock();
  sfx.setVolume(settings.volume);
  saveProfile();
  showMode('playing');
  rebuildAvatar();
  hud.renderHotbar();
  updateOnlineUI();
  if (welcomeText) toast(welcomeText);
  requestLock();
}

// ------------------------------------------------------------------ playing online

function setNet(text, ok = false) {
  const b = $('net-banner');
  b.textContent = text || '';
  b.classList.toggle('hidden', !text);
  b.classList.toggle('ok', ok);
}

function updateOnlineUI() {
  const on = !!G.online;
  document.body.classList.toggle('online', on);
  $('online-pill').classList.toggle('hidden', !on);
  $('tab-account').classList.toggle('hidden', !on);
  $('time-settings').classList.toggle('hidden', on);
  $('time-note').classList.toggle('hidden', !on);
  for (const el of document.querySelectorAll('.online-only')) el.classList.toggle('hidden', !on);
  $('plot-none').classList.toggle('hidden', !(on && !G.myPlot));
  $('p-plot').classList.toggle('no-plot', !G.myPlot);
  chat?.show(on);
  if (on) $('online-count').textContent = String(G.online.players.size);
  $('plot-name').value = state.plotName;
}

async function enterOnline(setBusy) {
  setBusy('Connecting to Lagos...');
  const session = createOnline({ server, auth, look: state.look, owners: G.owners, hooks: onlineHooks });
  G.online = session;
  let welcome;
  try {
    welcome = await session.connect();
  } catch (e) {
    session.close();
    G.online = null;
    throw e;
  }
  setBusy('Loading everyone\'s builds...');
  const expected = welcome.plots.filter((p) => p.ver > 0).length;
  await session.waitForPlots(expected);
  accountPanel?.render();
  if (!session.you.plot) {
    menu.close();
    showMode('claim');
    claimScreen.show();
    updateOnlineUI();
    return;
  }
  spawnPlayer();
  startPlaying(`Welcome back to Lagos, ${session.you.name}!`);
}

// The server's answer to a claim request: resolves when it arrives, rejects with the server's message on refusal.
function claimPlot(target) {
  return new Promise((resolve, reject) => {
    pendingClaim = { resolve, reject, timer: setTimeout(() => { pendingClaim = null; reject(new Error('The server did not answer. Please try again.')); }, 9000) };
    G.online.claim(target);
  });
}

function settleClaim(err) {
  if (!pendingClaim) return false;
  clearTimeout(pendingClaim.timer);
  const p = pendingClaim;
  pendingClaim = null;
  if (err) p.reject(err); else p.resolve();
  return true;
}

const REJECT_TEXT = {
  not_owner: "That isn't your plot.", slow_down: 'Building too fast - slow down a little!', too_big: 'That was too much at once.',
  bad_block: "That block can't be placed.", bad_edit: 'That change was not understood.', bad_plot: "That build couldn't be loaded.",
};

const onlineHooks = {
  welcome(w, again) {
    const you = w.you;
    state.name = you.name;
    if (you.look) { Object.assign(state.look, you.look); pauseLook?.render(); }
    state.plotName = you.plotName || '';
    if (you.achv && you.achv.got) for (const [id, t] of Object.entries(you.achv.got)) if (!achievements.got[id]) achievements.got[id] = t;
    if (you.achv && you.achv.stats) {
      const s = you.achv.stats, mine = achievements.stats;
      mine.placed = Math.max(mine.placed || 0, s.placed || 0); mine.lights = Math.max(mine.lights || 0, s.lights || 0); mine.greeted = Math.max(mine.greeted || 0, s.greeted || 0);
      for (const f of s.fabrics || []) if (!mine.fabrics.includes(f)) mine.fabrics.push(f);
    }
    // Land: every claimed plot gets its border and sign; a plot with nothing built on it starts empty.
    const mineNumber = you.plot;
    G.myPlot = mineNumber ? plotByNumber(mineNumber) : null;
    const known = new Set(w.plots.map((p) => p.n));
    for (const p of PLOTS) {
      if (!p.claimable) continue;
      const claimed = known.has(p.number);
      const info = w.plots.find((q) => q.n === p.number);
      if (claimed && info.ver === 0) build.clearPlotContents(p);                 // owner hasn't built anything yet
      else if (!claimed && again && wasOwned.has(p.number)) build.clearPlotContents(p);   // released while we were disconnected
      refreshPlotVisual(p);
    }
    wasOwned = new Set(known);
    build.resetHistory();
    remote.clear();
    for (const pl of w.players) if (pl.pid !== you.pid) remote.add(pl);
    chat.clear();
    for (const c of w.chat) chat.say({ name: c.name, text: c.text, old: true, mine: c.pid === you.pid });
    if (again) { setNet('Back online', true); setTimeout(() => setNet(''), 2200); }
    updateOnlineUI();
  },
  status(s, reason) {
    if (!G.online || !state.started) return;
    if (s === 'reconnecting' || s === 'connecting') setNet('Connection lost. Reconnecting...');
    else if (s === 'offline' && !reason) setNet('Offline');
  },
  fatal({ code, message }) {
    setNet('');
    document.exitPointerLock?.();
    showDialog({
      title: code === 'replaced' ? 'Signed in somewhere else' : code === 'full' ? 'Lagos is full' : 'Disconnected',
      body: message,
      actions: [{ id: 'reload', label: 'Reload the game', primary: true }],
    }).then(() => location.reload());
  },
  latency(ms) { latencyMs = ms; },
  plotData(plot, ids, metas) {
    build.replacePlotContents(plot, ids, metas);
    if (G.myPlot && G.myPlot.number === plot.number) build.resetHistory();
  },
  edits(plot, list) { build.applyRemoteEdits(list); },
  owner(n, owner, name) {
    const p = plotByNumber(n);
    if (!p) return;
    if (owner && !(G.myPlot && G.myPlot.number === n)) build.clearPlotContents(p);
    wasOwned[owner ? 'add' : 'delete'](n);
    for (const r of remote.players.values()) if (r.name === owner) r.plot = n; else if (r.plot === n) r.plot = null;
    refreshPlotVisual(p);
    claimScreen?.redraw();
    renderPlayers();
  },
  claimed(n) {
    const p = plotByNumber(n);
    claimLocally(p);
    settleClaim();
    const first = !state.started;
    claimScreen?.hide();
    if (first) { spawnPlayer(); startPlaying(`Plot ${n} is yours, ${state.name}! Build anything you like.`); }
    else { teleportToPlot(p); resumePlay(); toast(`Plot ${n} is yours! Build anything you like.`); }
    queueProfileSync();
  },
  released() {
    const prev = G.myPlot;
    G.myPlot = null;
    if (prev) { build.clearPlotContents(prev); refreshPlotVisual(prev); }
    state.plotName = '';
    build.resetHistory();
    updateOnlineUI();
    toast('You gave up your plot. You can claim a new one from the Plot tab.');
  },
  saved(plotName) { state.plotName = plotName; if (G.myPlot) drawPlotLabel(G.myPlot); },
  join(p) {
    remote.add(p);
    $('online-count').textContent = String(G.online.players.size);
    if (state.started) chat.system(`${p.name} joined Lagos`);
    renderPlayers();
  },
  leave(pid, p) {
    remote.remove(pid);
    $('online-count').textContent = String(G.online.players.size);
    if (state.started && p) chat.system(`${p.name} left`);
    renderPlayers();
  },
  look(pid, look) { remote.setLook(pid, look); },
  snapshot(list) { remote.snapshot(list, performance.now()); },
  chat(m) {
    if (mutes.has(m.name.toLowerCase())) return;
    const mine = G.online && m.pid === G.online.you.pid;
    chat.say({ name: m.name, text: m.text, mine });
    const rec = remote.get(m.pid);
    if (rec && rec.shown) bubbles.show(rec, m.text, performance.now() + 5000, 'chat');
    if (!mine && state.started) sfx.click();
  },
  emote(pid, id) {
    const r = remote.emote(pid, id, performance.now());
    if (r && r.rec.shown) bubbles.show(r.rec, r.def.text, performance.now() + 2600, 'emote');
  },
  notice(text) { toast(text); chat.system(text); },
  reject(plot, reason) { toast(REJECT_TEXT[reason] || 'That change was not accepted.', 'bad'); },
  error(code, message) {
    if (settleClaim(new Error(message))) { claimScreen?.fail(message); return; }
    toast(message, 'bad');
  },
};
let wasOwned = new Set();
let latencyMs = 0;

function sendChat(text) {
  if (!G.online) return;
  if (text.startsWith('/')) {
    const [cmd, ...rest] = text.slice(1).split(' ');
    if (cmd === 'me' && rest.length) { G.online.chat(`*${rest.join(' ')}*`); return; }
    if (cmd === 'help' || cmd === '?') { chat.system('Chat: just type and press Enter. Press Tab to see who is online, B for emotes.'); return; }
    chat.system(`Unknown command "/${cmd}". Try /help.`);
    return;
  }
  G.online.chat(text);
}

function onChatOpenChange(open) {
  if (open) {
    if (state.mode === 'playing') { showMode('chat'); if (document.pointerLockElement) document.exitPointerLock(); }
  } else if (state.mode === 'chat') { showMode('playing'); requestLock(); }
}

function openChat() {
  if (state.mode !== 'playing') return;
  if (!G.online) { toast('Chat works when you play online.'); return; }
  chat.open();
}

// ------------------------------------------------------------------ players list, emotes

const muteKey = (name) => name.toLowerCase();

function renderPlayers() {
  if (state.mode !== 'players' || !G.online) return;
  const list = $('players-list');
  list.innerHTML = '';
  const you = G.online.you;
  const rows = [{ pid: you.pid, name: you.name, plot: you.plot, guest: you.guest, me: true }, ...[...G.online.players.values()].filter((p) => p.pid !== you.pid)];
  rows.sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0) || a.name.localeCompare(b.name));
  const located = new Map(remote.located(performance.now()).map((o) => [o.pid, o]));
  for (const p of rows) {
    const row = document.createElement('div');
    row.className = 'prow' + (p.me ? ' me' : '');
    const dot = document.createElement('div'); dot.className = 'dot'; dot.style.background = p.me ? '#b88a00' : nameColor(p.name).replace('74%', '38%'); dot.textContent = p.name.slice(0, 1).toUpperCase();
    const who = document.createElement('div'); who.className = 'who';
    const b = document.createElement('b'); b.textContent = p.name + (p.me ? ' (you)' : '');
    const s = document.createElement('small'); s.textContent = (p.plot ? `Plot ${p.plot}` : 'No plot yet') + (p.guest ? ' - guest' : '');
    who.append(b, s);
    row.append(dot, who);
    const add = (label, fn, cls = '') => { const btn = document.createElement('button'); btn.className = 'btn ' + cls; btn.textContent = label; btn.addEventListener('click', fn); row.appendChild(btn); };
    if (p.plot && !(p.me && !G.myPlot)) add('Visit', () => { teleportToPlot(plotByNumber(p.plot)); resumePlay(); });
    if (!p.me) {
      if (located.has(p.pid)) add('Go to', () => { const o = located.get(p.pid); teleport(o.x, o.z + 2); resumePlay(); });
      add(mutes.has(muteKey(p.name)) ? 'Unmute' : 'Mute', () => { toggleMute(p.name); renderPlayers(); });
      add('Report', () => reportPlayer(p), 'danger');
    }
    list.appendChild(row);
  }
}

function toggleMute(name) {
  const k = muteKey(name);
  if (mutes.has(k)) { mutes.delete(k); toast(`${name} unmuted`); } else { mutes.add(k); toast(`${name} muted: you won't see their chat`); }
  storage.saveMutes([...mutes]);
}

async function reportPlayer(p) {
  const reasons = ['Bad language or bullying', 'Spam', 'Offensive name or plot sign', 'Something else'];
  const sel = document.createElement('select');
  for (const r of reasons) { const o = document.createElement('option'); o.textContent = r; sel.appendChild(o); }
  const pick = await showDialog({
    title: `Report ${p.name}?`, body: ['A moderator will look at recent chat and what happened.', sel],
    actions: [{ id: 'no', label: 'Cancel' }, { id: 'yes', label: 'Send report', danger: true }],
  });
  if (pick === 'yes') { G.online.report(p.pid, sel.value); }
}

function openPlayers() {
  if (!G.online) return toast('Other builders appear when you play online.');
  openOverlay('players');
  renderPlayers();
}

function openEmotes() {
  if (state.mode !== 'playing') return;
  const ring = $('emote-ring');
  ring.innerHTML = '';
  EMOTES.forEach((e, i) => {
    const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
    const b = document.createElement('button');
    b.className = 'emote-btn';
    b.style.transform = `translate(${Math.cos(a) * 112}px, ${Math.sin(a) * 112}px)`;
    b.innerHTML = `<b>${i + 1}</b>${e.label}`;
    b.addEventListener('click', () => { playEmote(e.id); resumePlay(); });
    ring.appendChild(b);
  });
  openOverlay('emote');
}

function playEmote(id) {
  const def = EMOTES.find((e) => e.id === id);
  if (!def) return;
  const now = performance.now();
  state.emote = { id, kind: def.kind, start: now, until: now + EMOTE_SECONDS * 1000 };
  if (G.online) G.online.emote(id);
  if (state.camMode === 0) { state.camMode = 1; avatar.setVisible(true); }     // so you can see yourself dance
}

// ------------------------------------------------------------------ main loop

let orbitTarget = null;
let frameCount = 0;
let hudTimer = 0, visTimer = 0, saveTimer = 0, achvTimer = 0, mapTimer = 0, compassTimer = 0, orbit = 0, stepAcc = 0, wasInWater = false;

function lightAt(x, y, z) {
  const l = world.lightAt(x, y, z);
  const c = lightColor(env, l.sky, l.blk);
  const out = new BABYLON.Color3(c[0], c[1], c[2]);
  out.open = l.sky >= 14 ? 1 : 0;                  // under open sky the shader adds direct sunlight
  return out;
}

// Graphics: the quality preset (Auto picks one for this device) and keeping the frame rate healthy.
let graphicsLevel = 'balanced';
function applyGraphics(level) {
  const want = level || (settings.quality === 'auto' ? detectLevel(engine, isTouch) : settings.quality);
  graphicsLevel = fx.apply(want);
}
const fpsWatch = { t: 0, frames: 0, warm: 0, lowWindows: 0 };
function watchFrameRate(dt) {
  // Only on Auto, never in automated browsers, and only once the world has settled after loading.
  if (settings.quality !== 'auto' || navigator.webdriver || !state.started || state.mode !== 'playing') { fpsWatch.warm = 0; fpsWatch.t = 0; fpsWatch.frames = 0; return; }
  fpsWatch.warm += dt;
  if (fpsWatch.warm < 6) return;
  fpsWatch.t += dt; fpsWatch.frames++;
  if (fpsWatch.t < 3) return;
  const fps = fpsWatch.frames / fpsWatch.t;
  fpsWatch.t = 0; fpsWatch.frames = 0;
  fpsWatch.lowWindows = fps < 26 ? fpsWatch.lowWindows + 1 : 0;
  if (fpsWatch.lowWindows >= 2) {                  // two slow windows in a row: step down one level
    fpsWatch.lowWindows = 0;
    const i = LEVELS.indexOf(graphicsLevel);
    if (i > 0) { applyGraphics(LEVELS[i - 1]); toast('Switched to ' + LEVELS[i - 1] + ' graphics to keep things smooth.'); } else if (Number(settings.resolution) < 1.5) { settings.resolution = 1.5; applyResolution(); }
  }
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

const hash01 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

function tick() {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000 || 0.016);
  const now = performance.now();
  clockTime += dt;
  const online = G.online;
  const live = state.mode === 'playing' || state.mode === 'chat';

  if (!state.started) state.rain = 0;
  else if (online) state.time = online.dayFraction();
  else if (!settings.freezeTime) state.time = (state.time + dt / DAY_LENGTH) % 1;
  if (state.started) updateWeather(dt);
  env = computeEnv(state.started ? state.time : MENU_TIME, state.rain);       // the start screen always glows at golden hour

  if (live) {
    const playing = state.mode === 'playing';
    player.update(dt, playing ? inputState() : IDLE_INPUT);
    footsteps(dt);
    const hit = build.getTarget();
    updateSelection(hit);
    const t = touch || {};
    const wantBreak = mouse.left || t.break, wantPlace = mouse.right || t.place;
    if (playing && (wantBreak || wantPlace) && now >= mouse.next) {
      mouse.next = now + 160;
      if (wantBreak) { if (state.paste) { state.paste = null; build.updateModeBar(); } else build.tryBreak(hit); } else build.tryPlace(hit);
    }
    if (state.emote && (now > state.emote.until || player.moving > 1.2 || (t.f || t.s))) state.emote = null;
  } else {
    selBox.setEnabled(false);
  }
  updateAreaBox();

  // camera
  if (!state.started) {
    orbit += dt * 0.045;
    camera.position.set(PLAZA + 4 + Math.sin(orbit) * 95, 40, PLAZA + 18 + Math.cos(orbit) * 95);
    camera.setTarget(orbitTarget || (orbitTarget = new BABYLON.Vector3(PLAZA + 4, 7, PLAZA + 4)));
  } else {
    placeCamera();
  }

  const pl = player.pos;
  if (avatar && state.started) {
    avatar.root.position.set(pl.x, pl.y, pl.z);
    avatar.root.rotation.y = player.yaw;
    avatar.animate(dt, live ? player.moving : 0, state.emote ? { kind: state.emote.kind, t: (now - state.emote.start) / 1000 } : null);
    avatar.setLight(lightAt(pl.x, pl.y + 1, pl.z));
  }

  const shared = (online ? online.serverNow() : Date.now()) / 1000;
  const npcEvents = residents.update(shared, dt, pl, state.time, lightAt);
  for (const e of npcEvents) {
    bubbles.show(e.greeted, `${e.greeted.name}: ${e.greeted.line}`, now + 4500);
    if (state.started) { achievements.stats.greeted++; if (achievements.stats.greeted >= 5) achievements.unlock('greet'); }
  }
  const tl = lightAt(PLAZA, 30, PLAZA);
  const trafficEvents = traffic.update(shared, dt, pl, tl, env.night > 0.5);
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
  if (remote) remote.update(dt, now, camera.position);
  updateNameTags();
  bubbles.update(now, projectBubble);

  if (online && online.ready && state.started && now >= nextPosSend) {
    nextPosSend = now + 200;
    online.sendPos({
      x: pl.x, y: pl.y, z: pl.z, yaw: player.yaw, pitch: player.pitch,
      flags: (player.flying ? FLAG.FLYING : 0) | (player.inWater ? FLAG.SWIMMING : 0) | (keys.ShiftLeft && player.moving > 1 ? FLAG.SPRINT : 0) | (player.onGround ? FLAG.GROUND : 0),
      emote: state.emote ? state.emote.id : 0,
    });
  }
  if (nextProfileSend && now >= nextProfileSend) syncProfile();

  rainPS.emitter.set(camera.position.x, camera.position.y + 16, camera.position.z);
  const indoors = world.lightAt(camera.position.x, camera.position.y, camera.position.z).sky < 14;
  rainPS.emitRate = state.rain > 0.05 && !indoors ? 2400 * state.rain : 0;

  if (world.dirty.size) remeshDirty(4);
  if (plotDirtyAt && now > plotDirtyAt) savePlotNow();

  const [fs, fe] = fogRange();
  applyEnv(env, sky, camera, fs, fe, clockTime);
  scene.clearColor.set(env.horizon[0], env.horizon[1], env.horizon[2], 1);

  if ((hudTimer -= dt) <= 0) { hudTimer = 0.12; updateHud(); }
  if ((compassTimer -= dt) <= 0 && state.started) { compassTimer = 0.05; drawCompass(); }
  if ((mapTimer -= dt) <= 0 && state.started) {
    mapTimer = 0.25;
    minimap.drawLocal($('minimap'), player, mapExtras());
  }
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
  chat.update(now);
  const beachDist = Math.max(0, SZ - pl.z);
  sfx.ambience(dt, { night: env.night, rain: state.rain, beachDist: state.started ? beachDist : 200, indoors });
  $('water-tint').classList.toggle('hidden', !(state.started && player.headInWater && state.camMode === 0));
  fx.update(env, camera.position, now);
  updateBlobs(now);
  watchFrameRate(dt);
  // Behind a full-screen overlay nobody is looking at the world closely, so draw it at a quarter of the speed.
  const covered = state.started && state.mode !== 'playing' && state.mode !== 'chat';
  if (!covered || (frameCount++ & 3) === 0) scene.render();
}

// Height of the first solid cell below (x, y, z): where an entity's soft shadow lands.
function groundBelow(x, y, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  for (let yy = Math.floor(y + 0.4); yy >= Math.max(0, Math.floor(y) - 14); yy--) if (world.solidBoxes(ix, yy, iz)) return yy + 1;
  return 1;
}

let blobPrune = 0;
function updateBlobs(now) {
  if (!state.started) { fx.pruneBlobs(new Set()); return; }
  const alive = blobPrune < now ? new Set() : null;
  const put = (key, x, y, z, r, on) => { fx.blob(key, x, groundBelow(x, y, z), z, r * (1 - Math.min(0.5, Math.max(0, y - groundBelow(x, y, z)) / 10)), on); if (alive) alive.add(key); };
  const p = player.pos;
  put(avatar, p.x, p.y, p.z, 0.5, state.camMode !== 0);
  for (const r of residents.residents) put(r, r.x, 1, r.z, 0.5, r.visible);
  for (const r of remote.visible()) put(r, r.x, r.y, r.z, 0.5, true);
  for (const v of traffic.vehicles) put(v, v.x, 1, v.z, v.kind === 'danfo' ? 1.9 : 1.1, v.root.isEnabled());
  if (alive) { fx.pruneBlobs(alive); blobPrune = now + 1500; }
}

function mapExtras() {
  return {
    vehicles: traffic.vehicles, residents: residents.residents, myPlot: G.myPlot, owners: G.owners, plotName: state.plotName,
    others: remote ? remote.located(performance.now()) : [],
  };
}

function placeCamera() {
  const e = build.eyePos();
  if (state.camMode === 0) {
    camera.position.set(e.x, e.y, e.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
  } else {
    const d = build.lookDir();
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
  if (state.mode !== 'playing') { selBox.setEnabled(false); return; }
  if (state.paste) {
    selBox.setEnabled(false);
    const pl = build.pastePlacement();
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
    for (const b of shapeBoxes(hit.id, hit.meta, world.connMask(hit.x, hit.y, hit.z, hit.id))) for (let i = 0; i < 3; i++) { bx[i] = Math.min(bx[i], b[i]); bx[i + 3] = Math.max(bx[i + 3], b[i + 3]); }
  }
  selBox.setEnabled(true);
  selBox.position.set(hit.x + bx[0], hit.y + bx[1], hit.z + bx[2]);
  selBox.scaling.set(bx[3] - bx[0], bx[4] - bx[1], bx[5] - bx[2]);
  selBox.color = build.canEdit(hit.x, hit.y, hit.z) || hit.id === B.DOOR ? BABYLON.Color3.Black() : new BABYLON.Color3(0.85, 0.1, 0.1);
}

function updateAreaBox() {
  if (state.paste) return;
  if (!state.area) { areaBox.setEnabled(false); return; }
  const b = state.area.b || (state.mode === 'playing' ? (() => { const h = build.getTarget(); return h ? [h.x, h.y, h.z] : state.area.a; })() : state.area.a);
  const a = state.area.a;
  areaBox.setEnabled(true);
  areaBox.color = new BABYLON.Color3(0.2, 0.8, 1);
  areaBox.position.set(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]));
  areaBox.scaling.set(Math.abs(a[0] - b[0]) + 1, Math.abs(a[1] - b[1]) + 1, Math.abs(a[2] - b[2]) + 1);
}

// Screen position of a world point in CSS pixels, or null when it is behind the camera / too far away.
function project(pos, maxDist = 40) {
  const cam = camera.position;
  const fwd = camera.getDirection(BABYLON.Axis.Z);
  const rel = pos.subtract(cam);
  if (BABYLON.Vector3.Dot(rel, fwd) < 0.5 || rel.length() > maxDist) return null;
  const w = engine.getRenderWidth(), h = engine.getRenderHeight();
  const p = BABYLON.Vector3.Project(pos, BABYLON.Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(w, h));
  const k = engine.getRenderingCanvas().clientWidth / w;
  return { x: p.x * k, y: p.y * k };
}

function projectBubble(key) {
  if (key.pid !== undefined) return project(new BABYLON.Vector3(key.x, key.y + 2.55, key.z));       // another player
  if (key.char) return project(new BABYLON.Vector3(key.x, 3.3, key.z));                              // resident
  if (key.root) return project(new BABYLON.Vector3(key.x, 4.2, key.z));                              // vehicle
  return null;
}

// Names float over other players who are close enough to read.
function updateNameTags() {
  const used = new Set();
  if (remote && state.started) {
    for (const r of remote.visible()) {
      if (r.dist > 42) continue;
      const p = project(new BABYLON.Vector3(r.x, r.y + 2.2, r.z), 42);
      if (!p) continue;
      let el = tagEls.get(r.pid);
      if (!el) {
        el = document.createElement('div');
        el.className = 'nametag' + (r.guest ? ' guest' : '');
        el.textContent = r.name;
        $('bubbles').appendChild(el);
        tagEls.set(r.pid, el);
      }
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      el.style.opacity = String(Math.max(0.25, 1 - r.dist / 48));
      used.add(r.pid);
    }
  }
  for (const [pid, el] of tagEls) if (!used.has(pid)) { el.remove(); tagEls.delete(pid); }
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
  else if (G.online) {
    // Everyone shares one sky: the weather is a pure function of the server clock, in 8 minute slots.
    const slot = Math.floor(G.online.serverNow() / 480000);
    state.rainTarget = hash01(slot) < 0.3 ? 0.55 + 0.45 * hash01(slot + 0.5) : 0;
  } else {
    state.weatherTimer -= dt;
    if (state.weatherTimer <= 0) {
      if (state.rainTarget > 0) { state.rainTarget = 0; state.weatherTimer = 180 + Math.random() * 300; }
      else if (Math.random() < 0.35) { state.rainTarget = 0.6 + Math.random() * 0.4; state.weatherTimer = 50 + Math.random() * 70; }
      else state.weatherTimer = 120 + Math.random() * 200;
    }
  }
  if (state.rainTarget > 0.3 && state.rain < 0.05 && state.started && performance.now() - lastRainToast > 120000) { lastRainToast = performance.now(); toast('Rain dey come o! Lagos shower incoming.'); }
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

// ------------------------------------------------------------------ HUD

function plotHeadline(p, px, pz) {
  if (!p) return { title: pz >= CITY ? 'Bar Beach' : 'Lagos road', sub: 'Public space', mine: false };
  const mine = !!(G.myPlot && p.number === G.myPlot.number);
  const o = G.owners.get(p.number);
  if (mine) return { title: state.plotName || 'Your plot', sub: 'Your land: build freely', mine: true };
  if (o) return { title: o.name || `${o.owner}'s plot`, sub: `Owned by ${o.owner}`, mine: false };
  if (p.claimable) return { title: `Plot ${String(p.number).padStart(2, '0')}`, sub: G.online ? 'Free land - claim it from the map' : 'Free land', mine: false };
  return { title: p.name || `${p.owner}'s home`, sub: p.name ? 'Landmark' : 'Show home', mine: false };
}

function updateHud() {
  if (!state.started) return;
  const px = Math.floor(player.pos.x), pz = Math.floor(player.pos.z);
  const p = plotAt(px, pz);
  const h = plotHeadline(p, px, pz);
  $('info').classList.toggle('mine', h.mine);
  $('info-plot').textContent = h.title;
  $('info-sub').textContent = `${districtAt(px, pz)} - ${h.sub}`;
  const hr = state.time * 24;
  $('info-clock').textContent = `${clockString(state.time)} Lagos`;
  $('info-weather').textContent = state.rain > 0.3 ? 'Rain' : hr > 5.6 && hr < 7.4 ? 'Sunrise' : hr >= 7.4 && hr < 17 ? 'Sunny' : hr >= 17 && hr < 19.4 ? 'Sunset' : 'Night';
  const extra = (G.online && latencyMs ? `  ${latencyMs}ms` : '') + (player.flying ? '  flying' : '') + (player.inWater ? '  swimming' : '');
  $('info-pos').textContent = `${px}, ${Math.floor(player.pos.y)}, ${pz}  ${Math.round(engine.getFps())}fps${extra}`;
  const hint = $('hint-bar');
  const want = G.online ? '<span><kbd>Enter</kbd> chat</span><span><kbd>Tab</kbd> players</span><span><kbd>B</kbd> emote</span><span><kbd>M</kbd> map</span><span><kbd>H</kbd> help</span>'
    : '<span><kbd>E</kbd> blocks</span><span><kbd>M</kbd> map</span><span><kbd>H</kbd> help</span>';
  if (hint.dataset.v !== want) { hint.dataset.v = want; hint.innerHTML = want; }
}

// A compass strip: which way you are looking (north is toward the top of the map).
function drawCompass() {
  const c = $('compass');
  if (!c.offsetParent && c.offsetWidth === 0) return;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  const heading = ((180 + (player.yaw * 180) / Math.PI) % 360 + 360) % 360;       // degrees clockwise from north (+x is west)
  const ppd = W / 150;
  g.font = '800 15px Nunito, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let d = -80; d <= 80; d++) {
    const deg = Math.round(heading + d);
    if (deg % 5 !== 0) continue;
    const x = W / 2 + (deg - heading) * ppd;
    if (x < 6 || x > W - 6) continue;
    const a = ((deg % 360) + 360) % 360;
    const fade = 1 - Math.abs(x - W / 2) / (W / 2);
    const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a];
    g.globalAlpha = Math.max(0.15, fade);
    if (cardinal) { g.fillStyle = cardinal === 'N' ? '#ffc83d' : '#fff'; g.fillText(cardinal, x, H / 2); } else if (a % 45 === 0) { g.fillStyle = '#cfe9dc'; g.fillText({ 45: 'NE', 135: 'SE', 225: 'SW', 315: 'NW' }[a], x, H / 2); } else { g.fillStyle = '#fff'; g.fillRect(x - 0.5, H / 2 - (a % 15 === 0 ? 6 : 3), 1, a % 15 === 0 ? 12 : 6); }
  }
  g.globalAlpha = 1;
  g.fillStyle = '#ffc83d';
  g.beginPath(); g.moveTo(W / 2 - 6, 0); g.lineTo(W / 2 + 6, 0); g.lineTo(W / 2, 8); g.closePath(); g.fill();
}

// ------------------------------------------------------------------ screens and input

function selectSlot(i) {
  state.sel = (i + 9) % 9;
  hud.renderHotbar();
}

const OVERLAYS = { menu: 'menu', claim: 'claim', paused: 'pause', inventory: 'inventory', map: 'map', help: 'help', players: 'players', emote: 'emotes' };
function showMode(mode) {
  state.mode = mode;
  for (const [m, id] of Object.entries(OVERLAYS)) $(id).classList.toggle('hidden', m !== mode);
  $('hud').classList.toggle('hidden', mode === 'menu' || mode === 'loading' || mode === 'claim');
  document.body.classList.toggle('menu-open', mode === 'menu' || mode === 'loading' || mode === 'claim');
  $('touch').classList.toggle('hidden', !(isTouch && (mode === 'playing' || mode === 'chat')));
  if (mode !== 'playing' && mode !== 'chat') { Object.keys(keys).forEach((k) => (keys[k] = false)); mouse.left = mouse.right = false; }
  if (mode === 'paused') { renderAchievements($('achv-list'), achievements.got); $('achv-count').textContent = `${achievements.count()}`; syncSettingsUI(); accountPanel?.render(); }
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
function resumePlay() { if (chat?.isOpen) chat.close(); showMode('playing'); requestLock(); }
function openOverlay(mode) {
  showMode(mode);
  if (document.pointerLockElement) document.exitPointerLock();
}

function drawBigMap() {
  minimap.drawFull($('bigmap'), player, mapExtras());
}

function teleport(x, z) {
  x = Math.max(1.5, Math.min(SX - 1.5, x)); z = Math.max(1.5, Math.min(SZ - 1.5, z));
  let y = HEIGHT - 2;
  while (y > 1 && !world.solidBoxes(Math.floor(x), y - 1, Math.floor(z))) y--;
  player.pos = { x, y, z };
  player.vel = { x: 0, y: 0, z: 0 };
  player.flying = false;
}

function teleportToPlot(p) {
  const f = plotFront(p);
  teleport(f.x, f.z);
  player.yaw = f.yaw; player.pitch = 0.1;
}

function syncSettingsUI() {
  $('set-quality').value = settings.quality || 'auto';
  $('set-view').value = settings.viewChunks; $('set-res').value = String(settings.resolution); $('set-sens').value = settings.sensitivity;
  $('set-vol').value = settings.volume; $('set-time').value = state.time; $('set-freeze').checked = !!settings.freezeTime; $('set-weather').value = settings.weather;
  $('set-view-val').textContent = settings.viewChunks * CHUNK + ' blocks';
  $('set-time-val').textContent = clockString(state.time);
  $('plot-name').value = state.plotName;
}

const isTextTarget = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

function bindUI() {
  const canvas = $('game');
  for (const id of ['plot-name', 'code-box']) {
    $(id).addEventListener('keydown', (e) => e.stopPropagation());
    $(id).addEventListener('keyup', (e) => e.stopPropagation());
  }
  $('resume').addEventListener('click', resumePlay);
  $('pause-close').addEventListener('click', resumePlay);
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', resumePlay));
  $('open-map').addEventListener('click', () => showMode('map'));
  $('open-help').addEventListener('click', () => showMode('help'));
  $('open-players').addEventListener('click', openPlayers);
  $('online-pill').addEventListener('click', openPlayers);
  $('take-photo').addEventListener('click', () => { resumePlay(); setTimeout(takePhoto, 300); });
  $('plot-claim').addEventListener('click', () => { showMode('claim'); claimScreen.show(); if (document.pointerLockElement) document.exitPointerLock(); });

  // pause tabs
  document.querySelectorAll('#pause-tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#pause-tabs button').forEach((o) => o.classList.toggle('active', o === b));
    document.querySelectorAll('.ptab').forEach((s) => s.classList.toggle('hidden', s.id !== b.dataset.tab));
  }));

  // plot tab
  $('save-plot-name').addEventListener('click', () => {
    state.plotName = $('plot-name').value.trim().slice(0, 24);
    if (G.myPlot) drawPlotLabel(G.myPlot);
    saveProfile();
    if (G.online) G.online.profile({ plotName: state.plotName });
    if (state.plotName) { achievements.unlock('name'); toast(`Your plot is now "${state.plotName}"`); }
  });
  $('copy-code').addEventListener('click', async () => {
    if (!G.myPlot) return toast('Claim a plot first.', 'bad');
    const code = build.exportCode();
    $('code-box').value = code;
    $('code-box').select();
    try { await navigator.clipboard.writeText(code); toast('Build code copied! Paste it to a friend.'); } catch { toast('Build code is in the box - copy it from there.'); }
    achievements.unlock('share');
  });
  $('load-code').addEventListener('click', async () => {
    if (!G.myPlot) return toast('Claim a plot first.', 'bad');
    const code = $('code-box').value;
    if (!code.trim()) return toast('Paste a build code into the box first.', 'bad');
    if (!(await confirmDialog('Replace your build?', 'Everything on your plot will be replaced with this build.', 'Replace it'))) return;
    const r = build.importCode(code);
    if (!r) return toast("That doesn't look like a valid Naijacraft build code.", 'bad');
    toast(typeof r === 'string' ? `Loaded "${r}" onto your plot!` : 'Build loaded onto your plot!');
  });
  $('reset-plot').addEventListener('click', async () => {
    if (!G.myPlot) return toast('Claim a plot first.', 'bad');
    if (!(await confirmDialog('Clear your plot?', 'Everything you built on your plot will be removed. You can undo this with Ctrl+Z.', 'Clear it', 'Cancel', true))) return;
    const plot = G.myPlot, edits = [];
    for (let y = 1; y < HEIGHT; y++) for (let z = plot.z; z < plot.z + PLOT; z++) for (let x = plot.x; x < plot.x + PLOT; x++) if (world.get(x, y, z)) edits.push([x, y, z, B.AIR, 0]);
    build.applyEdits(edits);
    toast('Your plot is clear again.');
  });
  $('release-plot').addEventListener('click', async () => {
    if (!G.online || !G.myPlot) return toast("You don't have a plot to give up.");
    if (!(await confirmDialog('Give up this plot?', `Plot ${G.myPlot.number} and everything on it will be erased and become free land for someone else. This cannot be undone.`, 'Give it up', 'Keep it', true))) return;
    G.online.release();
  });

  // settings
  const view = $('set-view'), res = $('set-res'), sens = $('set-sens'), vol = $('set-vol'), time = $('set-time'), freeze = $('set-freeze'), weather = $('set-weather'), quality = $('set-quality');
  const save = () => storage.saveSettings(settings);
  quality.addEventListener('change', () => { settings.quality = quality.value; applyGraphics(); syncSettingsUI(); save(); });
  view.addEventListener('input', () => { settings.viewChunks = Number(view.value); $('set-view-val').textContent = settings.viewChunks * CHUNK + ' blocks'; applyViewDistance(); save(); });
  res.addEventListener('change', () => { settings.resolution = Number(res.value); applyResolution(); save(); });
  sens.addEventListener('input', () => { settings.sensitivity = Number(sens.value); save(); });
  vol.addEventListener('input', () => { settings.volume = Number(vol.value); sfx.setVolume(settings.volume); save(); });
  time.addEventListener('input', () => { state.time = Number(time.value); $('set-time-val').textContent = clockString(state.time); });
  freeze.addEventListener('change', () => { settings.freezeTime = freeze.checked; save(); });
  weather.addEventListener('change', () => { settings.weather = weather.value; state.weatherTimer = 0; save(); });

  // map: teleport buttons and clicking the map
  const warp = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.addEventListener('click', () => { fn(); resumePlay(); });
    $('warp-buttons').appendChild(b);
  };
  warp('My plot', () => { if (G.myPlot) teleportToPlot(G.myPlot); else teleport(PLAZA + 4, PLAZA + 10); });
  warp('Plaza', () => teleport(PLAZA + 4, PLAZA + 10));
  warp('Computer Village', () => teleportToPlot(plotByNumber(9)));
  warp('Freedom Park', () => teleportToPlot(plotByNumber(33)));
  warp('Eko Atlantic', () => teleportToPlot(plotByNumber(62)));
  warp('Bar Beach', () => teleport(SX / 2, CITY + 8));
  $('bigmap').addEventListener('click', (e) => {
    const r = e.target.getBoundingClientRect();
    const x = mapX((e.clientX - r.left) / r.width * SX), z = (e.clientY - r.top) / r.height * SZ;     // maps draw x mirrored
    if (z > SZ - 1) return;
    teleport(x, z);
    resumePlay();
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) { if (state.started && state.mode !== 'playing' && state.mode !== 'chat') showMode('playing'); }
    else if (state.started && state.mode === 'playing') { showMode('paused'); saveAll(); }
  });
  document.addEventListener('pointerlockerror', () => { if (state.started && state.mode === 'playing') showMode('paused'); });

  document.addEventListener('mousemove', (e) => {
    if ((state.mode !== 'playing' && state.mode !== 'chat') || document.pointerLockElement !== canvas) return;
    const s = 0.0022 * settings.sensitivity;
    player.yaw += e.movementX * s;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch + e.movementY * s));
  });
  canvas.addEventListener('mousedown', (e) => {
    sfx.unlock();
    if (isTouch) return;                                      // touch has its own buttons; ignore synthetic clicks
    if (state.mode === 'chat') { chat.close(); return; }
    if (state.mode !== 'playing') return;
    if (document.pointerLockElement !== canvas) { requestLock(); return; }
    e.preventDefault();
    if (e.button === 0) { mouse.left = true; mouse.next = performance.now() + 250; if (state.paste) { state.paste = null; build.updateModeBar(); } else build.tryBreak(); }
    else if (e.button === 2) { mouse.right = true; mouse.next = performance.now() + 250; build.tryPlace(); }
    else if (e.button === 1) build.pickBlock();
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => { if (state.mode === 'playing') selectSlot(state.sel + (e.deltaY > 0 ? 1 : -1)); }, { passive: true });

  window.addEventListener('keydown', (e) => {
    const code = e.code;
    if (isTextTarget(e.target) || dialogOpen()) return;
    if (state.mode === 'playing') {
      if (code === 'Space' && !e.repeat) {
        const now = performance.now();
        if (now - lastSpaceTap < 300) { player.toggleFly(); toast(player.flying ? 'Flying on (Space up, Shift down)' : 'Flying off'); lastSpaceTap = 0; }
        else lastSpaceTap = now;
      }
      keys[code] = true;
      if (/^Digit[1-9]$/.test(code)) selectSlot(Number(code.slice(5)) - 1);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(code)) e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) build.redo(); else build.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && code === 'KeyY') { e.preventDefault(); build.redo(); return; }
      if (e.ctrlKey || e.metaKey || e.repeat) return;
      switch (code) {
        case 'KeyE': openOverlay('inventory'); hud.openTab(); break;
        case 'KeyM': openOverlay('map'); break;
        case 'KeyH': openOverlay('help'); break;
        case 'KeyF': build.areaKey(); break;
        case 'KeyG': build.fillArea(false); break;
        case 'KeyX': case 'Delete': build.fillArea(true); break;
        case 'KeyC': build.copyArea(); break;
        case 'KeyV': if (state.clipboard) { build.startPaste(state.clipboard, 'your copy'); } else toast('Nothing copied yet. Select an area (F, F) and press C.'); break;
        case 'KeyR': if (state.paste) { state.paste.rot = (state.paste.rot + 1) % 4; sfx.click(); } break;
        case 'KeyT': state.camMode = (state.camMode + 1) % 3; avatar.setVisible(state.camMode !== 0); break;
        case 'KeyP': takePhoto(); break;
        case 'KeyB': openEmotes(); break;
        case 'Tab': openPlayers(); break;
        case 'Enter': case 'Slash': e.preventDefault(); openChat(); if (code === 'Slash' && chat.isOpen) setTimeout(() => { $('chat-input').value = '/'; }, 10); break;
        case 'Backspace': state.paste = null; state.area = null; build.updateModeBar(); break;
        default: break;
      }
      return;
    }
    if (e.repeat) return;
    if (state.mode === 'emote' && /^Digit[1-6]$/.test(code)) { playEmote(Number(code.slice(5))); resumePlay(); return; }
    const closeKeys = { inventory: 'KeyE', map: 'KeyM', help: 'KeyH', players: 'Tab', emote: 'KeyB' };
    if (closeKeys[state.mode] === code) { e.preventDefault(); resumePlay(); return; }
    if (code === 'Escape' && (state.mode === 'players' || state.mode === 'emote')) { resumePlay(); return; }
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
        if (act === 'break') { mouse.next = performance.now() + 300; if (state.paste) { state.paste = null; build.updateModeBar(); } else build.tryBreak(); }
        if (act === 'place') { mouse.next = performance.now() + 300; build.tryPlace(); }
        if (act === 'fly') { player.toggleFly(); toast(player.flying ? 'Flying on' : 'Flying off'); }
        if (act === 'view') { state.camMode = (state.camMode + 1) % 3; avatar.setVisible(state.camMode !== 0); }
        if (act === 'inventory') { showMode('inventory'); hud.openTab(); }
        if (act === 'map') showMode('map');
        if (act === 'chat') { if (G.online) openChat(); else toast('Chat works when you play online.'); }
        if (act === 'emote') openEmotes();
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

void MAX_BLOCK_ID;
