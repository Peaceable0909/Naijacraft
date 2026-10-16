// Blocky characters: the player's avatar and the residents of Lagos.
import { T, TILE, ATLAS_COLS } from './blocks.js';
import { createCharMaterial } from './render.js';

const BABYLON = window.BABYLON;

export const SKINS = ['#4a2e1f', '#6b3f26', '#8a5636', '#a86b45', '#c88d62'];
export const OUTFITS = [
  { name: 'Ankara Sunset', tile: 'ankara_orange', pants: '#2b2b30' },
  { name: 'Ankara Forest', tile: 'ankara_green', pants: '#efe4cc' },
  { name: 'Ankara Royal', tile: 'ankara_red', pants: '#1f2a44' },
  { name: 'Adire Indigo', tile: 'adire', pants: '#1a2340' },
  { name: 'Agbada White', color: '#f2efe6', pants: '#f2efe6', robe: true },
  { name: 'Super Eagles', color: '#0b8a4a', pants: '#ffffff', trim: '#ffffff' },
  { name: 'Yaba Tech Hoodie', color: '#30343c', pants: '#3b5a8a' },
];
export const HATS = ['None', 'Fila cap', 'Gele headwrap', 'Cap', 'Hard hat'];
export const DEFAULT_LOOK = { skin: 2, outfit: 0, hat: 0 };

// Emotes players can play. The ids are sent over the network (1-8), so only ever append.
export const EMOTES = [
  { id: 1, kind: 'wave', label: 'Wave', text: 'Hello!' },
  { id: 2, kind: 'dance', label: 'Dance', text: 'Shaku shaku!' },
  { id: 3, kind: 'cheer', label: 'Cheer', text: 'Yaaay!' },
  { id: 4, kind: 'clap', label: 'Clap', text: 'Well done!' },
  { id: 5, kind: 'laugh', label: 'Laugh', text: 'Hahaha!' },
  { id: 6, kind: 'salute', label: 'Salute', text: 'Respect!' },
];
export const EMOTE_SECONDS = 4.5;

let atlasCanvas = null;
const patternCache = new Map();
export function setCharacterAtlas(atlas) { atlasCanvas = atlas; }

function patternTexture(scene, tileName) {
  if (patternCache.has(tileName)) return patternCache.get(tileName);
  const t = T[tileName];
  const tex = new BABYLON.DynamicTexture('pat-' + tileName, { width: 32, height: 32 }, scene, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);
  const g = tex.getContext();
  g.imageSmoothingEnabled = false;
  const sx = (t % ATLAS_COLS) * TILE, sy = Math.floor(t / ATLAS_COLS) * TILE;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) g.drawImage(atlasCanvas, sx, sy, TILE, TILE, i * 16, j * 16, 16, 16);
  tex.update(true);
  patternCache.set(tileName, tex);
  return tex;
}

let faceTex = null;
function faceTexture(scene) {
  if (faceTex) return faceTex;
  faceTex = new BABYLON.DynamicTexture('face', { width: 16, height: 16 }, scene, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);
  faceTex.hasAlpha = true;
  const g = faceTex.getContext();
  g.clearRect(0, 0, 16, 16);
  g.fillStyle = '#ffffff'; g.fillRect(3, 6, 3, 2); g.fillRect(10, 6, 3, 2);
  g.fillStyle = '#1b1210'; g.fillRect(4, 6, 2, 2); g.fillRect(10, 6, 2, 2);
  g.fillStyle = '#2a1a14'; g.fillRect(3, 4, 3, 1); g.fillRect(10, 4, 3, 1);
  g.fillStyle = '#5a2a22'; g.fillRect(6, 11, 4, 1);
  faceTex.update(true);
  return faceTex;
}

function box(name, scene, w, h, d, mat, parent, x, y, z) {
  const m = BABYLON.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.material = mat; m.parent = parent; m.position.set(x, y, z);
  m.isPickable = false; m.renderingGroupId = 1;
  return m;
}

// Returns a character whose root sits at its feet, facing +z.
export function createCharacter(scene, look = DEFAULT_LOOK, name = 'char') {
  const root = new BABYLON.TransformNode(name, scene);
  const mats = [];
  const mat = (color, tex = null) => { const m = createCharMaterial(scene, color, tex); mats.push(m); return m; };
  const outfit = OUTFITS[look.outfit % OUTFITS.length];
  const skin = mat(SKINS[look.skin % SKINS.length]);
  const top = outfit.tile ? mat('#ffffff', patternTexture(scene, outfit.tile)) : mat(outfit.color);
  const pants = mat(outfit.pants);
  const shoes = mat('#2a1d16');

  const hips = new BABYLON.TransformNode(name + '-hips', scene); hips.parent = root; hips.position.y = 0.75;
  const legs = [-0.12, 0.12].map((x, i) => {
    const pivot = new BABYLON.TransformNode(name + '-leg' + i, scene); pivot.parent = hips; pivot.position.x = x;
    box(name + '-legm' + i, scene, 0.22, 0.65, 0.24, pants, pivot, 0, -0.33, 0);
    box(name + '-shoe' + i, scene, 0.23, 0.1, 0.28, shoes, pivot, 0, -0.7, 0.02);
    return pivot;
  });
  box(name + '-body', scene, 0.5, 0.62, 0.28, top, root, 0, 1.06, 0);
  if (outfit.robe) box(name + '-robe', scene, 0.62, 0.5, 0.34, top, root, 0, 0.62, 0);
  if (outfit.trim) box(name + '-trim', scene, 0.52, 0.06, 0.3, mat(outfit.trim), root, 0, 1.34, 0);
  const arms = [-0.33, 0.33].map((x, i) => {
    const pivot = new BABYLON.TransformNode(name + '-arm' + i, scene); pivot.parent = root; pivot.position.set(x, 1.33, 0);
    box(name + '-sleeve' + i, scene, 0.16, 0.3, 0.18, top, pivot, 0, -0.13, 0);
    box(name + '-hand' + i, scene, 0.15, 0.32, 0.17, skin, pivot, 0, -0.43, 0);
    return pivot;
  });
  const head = new BABYLON.TransformNode(name + '-head', scene); head.parent = root; head.position.y = 1.58;
  box(name + '-headm', scene, 0.42, 0.42, 0.42, skin, head, 0, 0, 0);
  const face = BABYLON.MeshBuilder.CreatePlane(name + '-face', { size: 0.42 }, scene);
  const fm = createCharMaterial(scene, '#ffffff', faceTexture(scene)); mats.push(fm);
  face.material = fm; face.parent = head; face.position.z = 0.212; face.rotation.y = Math.PI;
  face.isPickable = false; face.renderingGroupId = 1;
  const hair = mat('#16100c');
  box(name + '-hair', scene, 0.44, 0.1, 0.44, hair, head, 0, 0.22, 0);

  switch (HATS[look.hat % HATS.length]) {
    case 'Fila cap': {
      const c = mat(['#7a2a6a', '#b0303a', '#2a4a8a'][look.outfit % 3]);
      box(name + '-fila', scene, 0.46, 0.16, 0.46, c, head, 0, 0.27, 0);
      box(name + '-fila2', scene, 0.2, 0.12, 0.46, c, head, -0.16, 0.38, 0);
      break;
    }
    case 'Gele headwrap': {
      const g = outfit.tile ? top : mat('#d4a017');
      box(name + '-gele1', scene, 0.5, 0.18, 0.5, g, head, 0, 0.28, -0.02);
      box(name + '-gele2', scene, 0.58, 0.2, 0.42, g, head, 0, 0.44, -0.06);
      box(name + '-gele3', scene, 0.66, 0.12, 0.3, g, head, 0, 0.58, -0.1);
      break;
    }
    case 'Cap': {
      const c = mat('#c0392b');
      box(name + '-cap', scene, 0.46, 0.14, 0.46, c, head, 0, 0.27, 0);
      box(name + '-brim', scene, 0.4, 0.04, 0.22, c, head, 0, 0.21, 0.3);
      break;
    }
    case 'Hard hat': {
      const c = mat('#f2c230');
      box(name + '-hh', scene, 0.5, 0.18, 0.5, c, head, 0, 0.29, 0);
      box(name + '-hhb', scene, 0.58, 0.04, 0.58, c, head, 0, 0.22, 0.02);
      break;
    }
    default: break;
  }

  let phase = 0;
  // Poses override the walking swing for a moment. t = seconds since the pose began.
  function applyPose(kind, t) {
    const [L, R] = arms;
    switch (kind) {
      case 'wave': R.rotation.x = -2.7 + Math.sin(t * 9) * 0.22; R.rotation.z = -0.1; break;
      case 'dance': {
        const k = Math.sin(t * 9);
        L.rotation.x = -2.4 + k * 0.5; R.rotation.x = -2.4 - k * 0.5;
        legs[0].rotation.x = k * 0.55; legs[1].rotation.x = -k * 0.55; head.rotation.z = Math.sin(t * 4.5) * 0.15;
        break;
      }
      case 'cheer': {
        const k = Math.sin(t * 10) * 0.25;
        L.rotation.x = R.rotation.x = -3.0 + k; L.rotation.z = 0.2; R.rotation.z = -0.2;
        break;
      }
      case 'clap': {
        const c = (Math.sin(t * 14) * 0.5 + 0.5) * 0.4;
        L.rotation.x = R.rotation.x = -1.4; L.rotation.z = c; R.rotation.z = -c;
        break;
      }
      case 'laugh': {
        const k = Math.sin(t * 16) * 0.12;
        head.rotation.x = -0.28 + k; L.rotation.x = R.rotation.x = -0.7 + k * 0.6;
        break;
      }
      case 'salute': R.rotation.x = -2.1; R.rotation.z = -0.4; break;
      default: break;
    }
  }
  return {
    root,
    head,
    animate(dt, speed, pose = null) {
      const amp = Math.min(1, speed / 4);
      phase += dt * (3 + speed * 1.6);
      const s = Math.sin(phase) * 0.7 * amp;
      legs[0].rotation.x = s; legs[1].rotation.x = -s;
      arms[0].rotation.x = -s * 0.8; arms[1].rotation.x = s * 0.8;
      arms[0].rotation.z = arms[1].rotation.z = 0;
      head.rotation.x = head.rotation.z = 0;
      if (pose) applyPose(pose.kind, pose.t);
    },
    wave(t) { arms[1].rotation.x = -2.6 + Math.sin(t * 10) * 0.3; arms[1].rotation.z = -0.2; },
    stopWave() { arms[1].rotation.z = 0; },
    setLight(c) { const open = c.open === undefined ? 1 : c.open; for (const m of mats) { m.setColor3('light', c); m.setFloat('openSky', open); } },
    setVisible(v) { root.getChildMeshes().forEach((m) => m.setEnabled(v)); },
    dispose() { root.dispose(); mats.forEach((m) => m.dispose()); },
  };
}

// 2D front view of a look, for the menu preview.
export function drawLookPreview(canvas, look) {
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);
  const s = H / 2.1;
  const cx = W / 2, base = H - 6;
  const outfit = OUTFITS[look.outfit % OUTFITS.length];
  const R = (x, y, w, h, fill) => { g.fillStyle = fill; g.fillRect(cx + x * s, base - (y + h) * s, w * s, h * s); };
  let topFill = outfit.color;
  if (outfit.tile && atlasCanvas) {
    const t = T[outfit.tile];
    const pc = document.createElement('canvas'); pc.width = pc.height = 16;
    pc.getContext('2d').drawImage(atlasCanvas, (t % ATLAS_COLS) * TILE, Math.floor(t / ATLAS_COLS) * TILE, TILE, TILE, 0, 0, 16, 16);
    topFill = g.createPattern(pc, 'repeat');
  }
  const skin = SKINS[look.skin % SKINS.length];
  R(-0.23, 0, 0.22, 0.1, '#2a1d16'); R(0.01, 0, 0.22, 0.1, '#2a1d16');
  R(-0.23, 0.1, 0.22, 0.65, outfit.pants); R(0.01, 0.1, 0.22, 0.65, outfit.pants);
  R(-0.25, 0.75, 0.5, 0.62, topFill);
  if (outfit.robe) R(-0.31, 0.37, 0.62, 0.5, topFill);
  R(-0.41, 0.9, 0.16, 0.45, topFill); R(0.25, 0.9, 0.16, 0.45, topFill);
  R(-0.41, 0.72, 0.16, 0.2, skin); R(0.25, 0.72, 0.16, 0.2, skin);
  R(-0.21, 1.37, 0.42, 0.42, skin);
  R(-0.22, 1.73, 0.44, 0.08, '#16100c');
  R(-0.14, 1.56, 0.07, 0.05, '#1b1210'); R(0.07, 1.56, 0.07, 0.05, '#1b1210');
  R(-0.06, 1.45, 0.12, 0.02, '#5a2a22');
  const hat = HATS[look.hat % HATS.length];
  if (hat === 'Fila cap') { R(-0.23, 1.79, 0.46, 0.16, '#7a2a6a'); R(-0.23, 1.95, 0.2, 0.1, '#7a2a6a'); }
  if (hat === 'Gele headwrap') { R(-0.25, 1.79, 0.5, 0.18, topFill); R(-0.29, 1.95, 0.58, 0.2, topFill); R(-0.33, 2.13, 0.66, 0.1, topFill); }
  if (hat === 'Cap') { R(-0.23, 1.79, 0.46, 0.14, '#c0392b'); R(-0.05, 1.79, 0.4, 0.04, '#c0392b'); }
  if (hat === 'Hard hat') { R(-0.29, 1.79, 0.58, 0.04, '#f2c230'); R(-0.25, 1.81, 0.5, 0.18, '#f2c230'); }
}
