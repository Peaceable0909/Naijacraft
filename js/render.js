// Shaders and environment: voxel lighting, sky (sun, moon, stars, clouds), land/ocean planes,
// and the day/night maths. Every material here reads the same environment uniforms.
import { ATLAS_COLS, ATLAS_ROWS, TILE } from './blocks.js';
import { SX, SZ } from './world.js';

const BABYLON = window.BABYLON;

const FOG_GLSL = `
uniform vec3 fogColor; uniform vec2 fogRange; uniform vec3 cameraPos;
vec3 applyFog(vec3 col, vec3 wpos) {
  float f = clamp((length(wpos - cameraPos) - fogRange.x) / (fogRange.y - fogRange.x), 0.0, 1.0);
  return mix(col, fogColor, f * f * (3.0 - 2.0 * f));
}`;

const SHADERS = {
  voxelVertexShader: `
precision highp float;
attribute vec3 position; attribute vec2 uv; attribute vec4 color;
uniform mat4 worldViewProjection;
varying vec2 vUV; varying vec4 vColor; varying vec3 vPos;
void main() { vUV = uv; vColor = color; vPos = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`,
  voxelFragmentShader: `
precision highp float;
varying vec2 vUV; varying vec4 vColor; varying vec3 vPos;
uniform sampler2D atlas; uniform float daylight; uniform vec3 skyTint; uniform float time;
${FOG_GLSL}
void main() {
  vec4 tex = texture2D(atlas, vUV);
  if (tex.a < 0.1) discard;
  vec3 col;
  float alpha = tex.a;
  if (vColor.a < 0.25) {
    col = tex.rgb;                                  // lamps and neon light themselves
  } else {
    float sky = pow(vColor.g, 1.6) * daylight;
    float lamp = pow(vColor.b, 1.5) * 1.08;
    vec3 light = max(max(skyTint * sky, vec3(1.0, 0.8, 0.55) * lamp), vec3(0.045, 0.05, 0.075));
    col = tex.rgb * vColor.r * light;
    if (vColor.a < 0.75) {                          // water shimmer
      col *= 0.9 + 0.12 * sin(time * 1.7 + vPos.x * 0.9 + vPos.z * 1.3);
      alpha = 0.78;
    }
  }
  gl_FragColor = vec4(applyFog(col, vPos), alpha);
}`,
  skyVertexShader: `
precision highp float;
attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 vDir;
void main() { vDir = position; gl_Position = worldViewProjection * vec4(position, 1.0); }`,
  skyFragmentShader: `
precision highp float;
varying vec3 vDir;
uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; uniform vec3 cloudLight;
uniform float night; uniform float time; uniform float rain;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5));
  if (h < 0.0) col = horizon * (1.0 + h * 0.4);
  float sd = dot(d, sunDir);
  float clear = 1.0 - rain;
  col += vec3(1.0, 0.85, 0.55) * pow(max(sd, 0.0), 48.0) * 0.45 * clear;
  col = mix(col, vec3(1.0, 0.97, 0.86), smoothstep(0.9990, 0.9994, sd) * clear);
  float md = dot(d, -sunDir);
  col = mix(col, vec3(0.9, 0.92, 1.0), smoothstep(0.9993, 0.9996, md) * night * clear);
  col += vec3(0.6, 0.65, 0.8) * pow(max(md, 0.0), 200.0) * 0.25 * night;
  if (h > 0.0) {
    vec3 cell = floor(d * 160.0);
    float s = fract(sin(dot(cell, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
    float tw = 0.6 + 0.4 * sin(time * 3.0 + s * 50.0);
    col += vec3(step(0.9972, s) * tw) * night * clear * smoothstep(0.02, 0.3, h);
    vec2 uv = d.xz / (h + 0.18) * 1.4 + vec2(time * 0.012, time * 0.005);
    float c = smoothstep(0.52 - rain * 0.3, 0.82, fbm(uv));
    col = mix(col, cloudLight, c * smoothstep(0.0, 0.18, h) * 0.85);
  }
  gl_FragColor = vec4(col, 1.0);
}`,
  planeVertexShader: `
precision highp float;
attribute vec3 position; uniform mat4 world; uniform mat4 worldViewProjection; varying vec3 vPos;
void main() { vPos = (world * vec4(position, 1.0)).xyz; gl_Position = worldViewProjection * vec4(position, 1.0); }`,
  planeFragmentShader: `
precision highp float;
varying vec3 vPos;
uniform vec3 baseColor; uniform float ocean; uniform float shore; uniform float daylight; uniform vec3 skyTint; uniform float time; uniform vec3 sunDir;
${FOG_GLSL}
void main() {
  vec3 col = baseColor;
  if (ocean > 0.5) {
    float w = sin(vPos.x * 0.21 + time * 0.9) * sin(vPos.z * 0.33 - time * 0.7) + 0.5 * sin(vPos.x * 0.07 - vPos.z * 0.11 + time * 0.5);
    col = mix(vec3(0.05, 0.28, 0.45), vec3(0.12, 0.5, 0.65), 0.5 + 0.3 * w);
    float dist = vPos.z - shore;
    float foam = (1.0 - smoothstep(0.0, 3.0, dist)) + step(0.94, sin(dist * 0.9 - time * 1.6)) * (1.0 - smoothstep(0.0, 14.0, dist)) * 0.7;
    col = mix(col, vec3(0.95, 0.97, 1.0), clamp(foam, 0.0, 1.0) * 0.75);
    vec3 v = normalize(cameraPos - vPos);
    vec3 r = reflect(-v, vec3(0.0, 1.0, 0.0));
    col += vec3(1.0, 0.9, 0.7) * pow(max(dot(r, sunDir), 0.0), 60.0) * 0.6 * daylight;
  }
  col *= max(skyTint * daylight, vec3(0.045, 0.05, 0.075));
  gl_FragColor = vec4(applyFog(col, vPos), 1.0);
}`,
  charVertexShader: `
precision highp float;
attribute vec3 position; attribute vec2 uv; attribute vec3 normal;
uniform mat4 world; uniform mat4 worldViewProjection;
varying vec2 vUV; varying vec3 vPos; varying float vShade;
void main() {
  vUV = uv; vPos = (world * vec4(position, 1.0)).xyz;
  vec3 n = normalize((world * vec4(normal, 0.0)).xyz);
  vShade = 0.72 + 0.28 * max(n.y, 0.0) + 0.12 * abs(n.z);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`,
  charFragmentShader: `
precision highp float;
varying vec2 vUV; varying vec3 vPos; varying float vShade;
uniform vec3 color; uniform float useTex; uniform sampler2D tex; uniform vec3 light; uniform float glow;
${FOG_GLSL}
void main() {
  vec4 c = useTex > 0.5 ? texture2D(tex, vUV) : vec4(1.0);
  if (c.a < 0.5) discard;
  vec3 col = glow > 0.5 ? c.rgb * color : c.rgb * color * vShade * light;
  gl_FragColor = vec4(applyFog(col, vPos), 1.0);
}`,
};

const ENV_UNIFORMS = ['fogColor', 'fogRange', 'cameraPos', 'daylight', 'skyTint', 'time', 'sunDir'];
const envMaterials = new Set();

export function registerShaders() {
  Object.assign(BABYLON.Effect.ShadersStore, SHADERS);
}

function shaderMat(name, scene, shader, uniforms, samplers = [], opts = {}) {
  const mat = new BABYLON.ShaderMaterial(name, scene, { vertex: shader, fragment: shader }, {
    attributes: opts.attributes || ['position', 'uv'],
    uniforms: ['world', 'worldViewProjection', ...ENV_UNIFORMS, ...uniforms],
    samplers,
    needAlphaBlending: !!opts.alpha,
  });
  mat.backFaceCulling = opts.backFaceCulling ?? true;
  envMaterials.add(mat);
  mat.onDisposeObservable.add(() => envMaterials.delete(mat));
  return mat;
}

export function createVoxelMaterials(scene, atlas) {
  const W = ATLAS_COLS * TILE, H = ATLAS_ROWS * TILE;
  const tex = new BABYLON.DynamicTexture('atlas', { width: W, height: H }, scene, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);
  tex.getContext().drawImage(atlas, 0, 0);
  tex.update(true);
  tex.hasAlpha = true;
  tex.wrapU = tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  const opaque = shaderMat('voxel', scene, 'voxel', [], ['atlas'], { attributes: ['position', 'uv', 'color'] });
  opaque.setTexture('atlas', tex);
  const glass = shaderMat('voxel-glass', scene, 'voxel', [], ['atlas'], { attributes: ['position', 'uv', 'color'], alpha: true });
  glass.setTexture('atlas', tex);
  return { opaque, glass, atlasTexture: tex };
}

// A colour/texture material for characters and vehicles. light is set per frame.
export function createCharMaterial(scene, color, texture = null, glow = false) {
  const m = shaderMat('char', scene, 'char', ['color', 'useTex', 'light', 'glow'], ['tex'], { attributes: ['position', 'uv', 'normal'] });
  m.setColor3('color', color instanceof BABYLON.Color3 ? color : BABYLON.Color3.FromHexString(color));
  m.setFloat('useTex', texture ? 1 : 0);
  m.setFloat('glow', glow ? 1 : 0);
  m.setColor3('light', new BABYLON.Color3(1, 1, 1));
  if (texture) m.setTexture('tex', texture);
  return m;
}

export function createSky(scene) {
  const sky = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 800, segments: 20, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
  const mat = shaderMat('sky', scene, 'sky', ['horizon', 'zenith', 'cloudLight', 'night', 'rain'], [], { attributes: ['position'], backFaceCulling: false });
  sky.material = mat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  sky.renderingGroupId = 0;
  return { mesh: sky, mat };
}

export function createGroundPlanes(scene) {
  const land = BABYLON.MeshBuilder.CreateGround('land', { width: 4000, height: 2000 }, scene);
  land.position.set(SX / 2, 0.7, SZ - 1000);
  const lm = shaderMat('land', scene, 'plane', ['baseColor', 'ocean', 'shore'], [], { attributes: ['position'] });
  lm.setColor3('baseColor', new BABYLON.Color3(0.36, 0.6, 0.27));
  lm.setFloat('ocean', 0);
  land.material = lm;
  const sea = BABYLON.MeshBuilder.CreateGround('ocean', { width: 4000, height: 2000, subdivisions: 1 }, scene);
  sea.position.set(SX / 2, 0.75, SZ + 1000);
  const om = shaderMat('ocean', scene, 'plane', ['baseColor', 'ocean', 'shore'], [], { attributes: ['position'] });
  om.setColor3('baseColor', new BABYLON.Color3(0.1, 0.4, 0.6));
  om.setFloat('ocean', 1);
  om.setFloat('shore', SZ);
  sea.material = om;
  for (const m of [land, sea]) { m.isPickable = false; m.renderingGroupId = 1; m.freezeWorldMatrix(); }
  return { land, sea };
}

// ------------------------------------------------------------------ day / night

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// t: 0..1 through the day (0 = midnight, 0.25 = 6am, 0.5 = noon). rain: 0..1
export function computeEnv(t, rain = 0) {
  const a = (t - 0.28) * Math.PI * 2;            // Lagos: sunrise ~6:45, sunset ~18:45
  const sx = Math.cos(a), sy = Math.sin(a), sz = 0.3;
  const len = Math.hypot(sx, sy, sz);
  const sun = [sx / len, sy / len, sz / len];
  const day = smooth(-0.12, 0.2, sun[1]);
  const dusk = Math.max(0, 1 - Math.abs(sun[1]) / 0.3) * smooth(-0.25, 0.0, sun[1]);
  let horizon = mix3([0.05, 0.07, 0.14], [0.66, 0.82, 0.95], day);
  horizon = mix3(horizon, [0.98, 0.56, 0.32], dusk * 0.65);
  let zenith = mix3([0.01, 0.02, 0.07], [0.27, 0.52, 0.9], day);
  let skyTint = mix3([0.5, 0.58, 0.95], [1, 1, 1], day);
  skyTint = mix3(skyTint, [1, 0.72, 0.5], dusk * 0.55);
  let daylight = 0.12 + 0.88 * day;
  if (rain > 0) {
    const grey = mix3([0.08, 0.09, 0.11], [0.52, 0.56, 0.6], day);
    horizon = mix3(horizon, grey, rain * 0.8);
    zenith = mix3(zenith, mix3(grey, [0.3, 0.32, 0.36], 0.5), rain * 0.8);
    daylight *= 1 - rain * 0.35;
  }
  const cloudLight = mix3([0.07, 0.08, 0.12], mix3([0.96, 0.96, 0.98], [1, 0.75, 0.6], dusk * 0.7), day);
  return { t, sun, day, dusk, night: 1 - day, horizon, zenith, skyTint, daylight, rain, cloudLight };
}

// Lagos clock string for a day fraction.
export function clockString(t) {
  const mins = Math.floor(t * 24 * 60) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// Push the environment into every shader that uses it.
export function applyEnv(env, sky, camera, fogStart, fogEnd, time) {
  const fogColor = new BABYLON.Color3(...env.horizon);
  const tint = new BABYLON.Color3(...env.skyTint);
  const sun = new BABYLON.Vector3(...env.sun);
  const fogRange = new BABYLON.Vector2(fogStart, fogEnd);
  for (const m of envMaterials) {
    m.setColor3('fogColor', fogColor);
    m.setVector2('fogRange', fogRange);
    m.setVector3('cameraPos', camera.position);
    m.setFloat('daylight', env.daylight);
    m.setColor3('skyTint', tint);
    m.setFloat('time', time);
    m.setVector3('sunDir', sun);
  }
  sky.mat.setColor3('horizon', fogColor);
  sky.mat.setColor3('zenith', new BABYLON.Color3(...env.zenith));
  sky.mat.setColor3('cloudLight', new BABYLON.Color3(...env.cloudLight));
  sky.mat.setFloat('night', env.night);
  sky.mat.setFloat('rain', env.rain);
}

// Brightness for an entity standing in a lit cell (same curve as the voxel shader).
export function lightColor(env, sky, blk) {
  const s = Math.pow(sky / 15, 1.6) * env.daylight;
  const l = Math.pow(blk / 15, 1.5) * 1.08;
  return [
    Math.max(env.skyTint[0] * s, l, 0.06),
    Math.max(env.skyTint[1] * s, l * 0.8, 0.065),
    Math.max(env.skyTint[2] * s, l * 0.55, 0.09),
  ];
}
