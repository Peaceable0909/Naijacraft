// Visual effects and quality: sun shadows (a depth map rendered from the sun), the post-processing pipeline
// (glow, anti-aliasing, tone mapping), soft blob shadows under characters, and the quality presets that switch
// them on or off. Presets only control effects; view distance and sharpness stay under the player's control.
import { createBlobMaterial } from './render.js';

const BABYLON = window.BABYLON;

export const PRESETS = {
  fast:      { shadows: 0,    radius: 0,  bloom: false, fxaa: false, sway: 0, quality: 0, hdr: false },
  balanced:  { shadows: 1024, radius: 44, bloom: true,  fxaa: true,  sway: 1, quality: 1, hdr: true },
  beautiful: { shadows: 2048, radius: 60, bloom: true,  fxaa: true,  sway: 1, quality: 2, hdr: true },
};
export const LEVELS = ['fast', 'balanced', 'beautiful'];

// A best guess at what this device can handle, used when the player leaves graphics on Auto.
export function detectLevel(engine, isTouch) {
  let renderer = '';
  try {
    const gl = engine._gl;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch { /* unknown */ }
  if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) return 'fast';
  const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  if (isTouch) return mem >= 6 && cores >= 6 && /apple|adreno \(?[67]|mali-g7/i.test(renderer) ? 'balanced' : 'fast';
  if (/rtx|geforce gtx 1[06]|radeon rx|radeon pro|apple m\d|apple gpu|arc a|nvidia/i.test(renderer)) return 'beautiful';
  return cores >= 4 && mem >= 4 ? 'balanced' : 'fast';
}

export function createEffects({ scene, camera, materials, chunkMeshes, NCX, NCZ, CHUNK }) {
  const dummy = BABYLON.RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);
  const voxelMats = [materials.opaque, materials.glass];
  let level = 'balanced', cfg = PRESETS.balanced;
  let pipeline = null, pipelineHdr = null;
  let shadow = null;                 // { rtt, cam, size, radius, focus, dir, last, depth }
  let dirty = true, lastRender = 0;
  const blobMat = createBlobMaterial(scene);
  const blobs = new Map();

  for (const m of voxelMats) m.setTexture('shadowMap', dummy);

  // ---------------------------------------------------------------- shadows
  function disposeShadow() {
    if (!shadow) return;
    const i = scene.customRenderTargets.indexOf(shadow.rtt);
    if (i >= 0) scene.customRenderTargets.splice(i, 1);
    shadow.rtt.dispose();
    shadow.cam.dispose();
    shadow = null;
    for (const m of voxelMats) { m.setTexture('shadowMap', dummy); m.setVector4('shadowParams', new BABYLON.Vector4(0, 1 / 1024, 0.001, 0)); }
  }

  function makeShadow(size, radius) {
    const rtt = new BABYLON.RenderTargetTexture('sunShadow', size, scene, false, true, BABYLON.Constants.TEXTURETYPE_UNSIGNED_BYTE, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);
    rtt.wrapU = rtt.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    rtt.clearColor = new BABYLON.Color4(1, 1, 1, 1);
    rtt.refreshRate = 0;
    const cam = new BABYLON.FreeCamera('sunCam', new BABYLON.Vector3(0, 100, 0), scene);
    cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    cam.orthoLeft = -radius; cam.orthoRight = radius; cam.orthoTop = radius; cam.orthoBottom = -radius;
    const depth = 520;
    cam.minZ = 1; cam.maxZ = depth;
    rtt.activeCamera = cam;
    scene.customRenderTargets.push(rtt);
    shadow = { rtt, cam, size, radius, focus: new BABYLON.Vector3(1e9, 0, 0), dir: new BABYLON.Vector3(0, 1, 0), depth, lastDir: null };
    for (const m of voxelMats) m.setTexture('shadowMap', rtt);
    dirty = true;
  }

  const VIEW_TMP = new BABYLON.Vector3();
  function refreshShadow(env, player, now) {
    const s = shadow;
    const power = env.lightPower;
    const on = power > 0.06;
    const texel = (2 * s.radius) / s.size;
    for (const m of voxelMats) m.setVector4('shadowParams', new BABYLON.Vector4(on ? 1 : 0, 1 / s.size, 0.22 / (s.depth - 1), 0));
    if (!on) return;
    const dir = new BABYLON.Vector3(...env.lightDir);
    // snap the centre to an 8 block grid so shadows stay still while you walk between refreshes
    const fx = Math.round(player.x / 8) * 8, fz = Math.round(player.z / 8) * 8;
    const moved = Math.abs(fx - s.focus.x) > 0.5 || Math.abs(fz - s.focus.z) > 0.5;
    const turned = !s.lastDir || BABYLON.Vector3.Dot(dir, s.lastDir) < 0.99996;           // about half a degree
    if (!moved && !turned && !(dirty && now - lastRender > 220)) return;
    s.focus.set(fx, 10, fz);
    s.lastDir = dir.clone();
    const D = 260;
    s.cam.position.copyFrom(s.focus).addInPlace(dir.scale(D));
    s.cam.setTarget(s.focus);
    s.cam.getViewMatrix(true);
    const view = s.cam.getViewMatrix();
    const vp = view.multiply(s.cam.getProjectionMatrix(true));
    // every chunk whose footprint, seen along the light, lands inside the shadow map can cast onto it
    const list = [];
    const margin = CHUNK * 0.75 + 6;
    for (let k = 0; k < chunkMeshes.length; k++) {
      const ms = chunkMeshes[k];
      if (!ms) continue;
      const cx = (k % NCX) * CHUNK + CHUNK / 2, cz = Math.floor(k / NCX) * CHUNK + CHUNK / 2;
      let hit = false;
      for (const y of [4, 24, 50]) {
        BABYLON.Vector3.TransformCoordinatesFromFloatsToRef(cx, y, cz, view, VIEW_TMP);
        if (Math.abs(VIEW_TMP.x) < s.radius + margin && Math.abs(VIEW_TMP.y) < s.radius + margin) { hit = true; break; }
      }
      if (!hit) continue;
      for (const m of ms) if (m.name.endsWith('-opaque') && m.isEnabled()) list.push(m);
    }
    s.rtt.renderList = list;
    s.rtt.setMaterialForRendering(list, materials.shadowDepth);
    for (const m of voxelMats) m.setMatrix('lightVP', vp);
    s.rtt.resetRefreshCounter();
    dirty = false;
    lastRender = now;
    void texel;
  }

  // ---------------------------------------------------------------- post-processing
  function disposePipeline() {
    if (pipeline) { pipeline.dispose(); pipeline = null; pipelineHdr = null; }
  }

  function setupPipeline() {
    const wants = cfg.bloom || cfg.fxaa;
    if (!wants) { disposePipeline(); return; }
    if (pipeline && pipelineHdr !== cfg.hdr) disposePipeline();
    if (!pipeline) {
      pipeline = new BABYLON.DefaultRenderingPipeline('fx', cfg.hdr, scene, [camera]);
      pipelineHdr = cfg.hdr;
      pipeline.imageProcessingEnabled = false;             // our shaders already output display colours; the pipeline only adds glow and anti-aliasing
      pipeline.bloomKernel = 56;
      pipeline.bloomScale = 0.5;
    }
    pipeline.bloomEnabled = cfg.bloom;
    pipeline.bloomThreshold = cfg.hdr ? 1.12 : 0.9;
    pipeline.bloomWeight = cfg.hdr ? 0.42 : 0.25;
    pipeline.fxaaEnabled = cfg.fxaa;
  }

  // ---------------------------------------------------------------- blob shadows
  const blobMeshes = (key) => {
    let m = blobs.get(key);
    if (!m) {
      m = BABYLON.MeshBuilder.CreateGround('blob', { width: 1, height: 1 }, scene);
      m.material = blobMat;
      m.isPickable = false;
      m.renderingGroupId = 1;
      blobs.set(key, m);
    }
    return m;
  };

  function apply(name) {
    level = PRESETS[name] ? name : 'balanced';
    cfg = PRESETS[level];
    for (const m of voxelMats) { m.setFloat('swayAmount', cfg.sway); m.setFloat('quality', cfg.quality); }
    disposeShadow();
    if (cfg.shadows) makeShadow(cfg.shadows, cfg.radius);
    setupPipeline();
    return level;
  }

  return {
    apply,
    get level() { return level; },
    get config() { return cfg; },
    markShadowsDirty() { dirty = true; },
    debug() { return shadow ? { size: shadow.size, list: shadow.rtt.renderList ? shadow.rtt.renderList.length : -1, focus: shadow.focus.asArray(), params: voxelMats[0].getEffect() ? 'effect' : 'noeffect', refresh: shadow.rtt.refreshRate, ready: shadow.rtt.isReadyForRendering ? shadow.rtt.isReadyForRendering() : null, rtt: shadow.rtt, cam: shadow.cam, mat: voxelMats[0] } : null; },
    get pipeline() { return pipeline; },
    // call every frame: refreshes the shadow map when needed and dims the blob shadows with the light
    update(env, player, now) {
      if (shadow) refreshShadow(env, player, now);
      blobMat.setFloat('strength', Math.max(0.12, Math.min(0.55, 0.14 + 0.9 * env.lightPower)));
    },
    // A soft dark disc on the ground below an entity. `key` is any stable object.
    blob(key, x, groundY, z, radius, visible = true) {
      const m = blobMeshes(key);
      if (!visible) { m.setEnabled(false); return; }
      m.setEnabled(true);
      m.position.set(x, groundY + 0.03, z);
      m.scaling.set(radius * 2, 1, radius * 2);
      m.__used = true;
    },
    pruneBlobs(alive) {
      for (const [k, m] of blobs) if (!alive.has(k)) { m.dispose(); blobs.delete(k); }
    },
    dispose() { disposeShadow(); disposePipeline(); },
  };
}
