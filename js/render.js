// Shaders and environment: voxel lighting (sun, shadows, lamps, water, wind), sky (sun, moon, stars, clouds),
// land / ocean planes, characters, and the day / night maths. Every material reads the same environment uniforms.
import { ATLAS_COLS, ATLAS_ROWS, TILE, CELL, buildGpuAtlas } from './blocks.js';
import { SX, SZ } from './world.js';

const BABYLON = window.BABYLON;

// Shared by every shader that fogs: distance fog that glows towards the sun, a little thicker near the ground.
const FOG_GLSL = `
uniform vec3 fogColor; uniform vec2 fogRange; uniform vec3 cameraPos; uniform vec3 sunDir; uniform vec3 sunColor;
vec3 applyFog(vec3 col, vec3 wpos) {
  vec3 d = wpos - cameraPos;
  float dist = length(d);
  float f = clamp((dist - fogRange.x) / (fogRange.y - fogRange.x), 0.0, 1.0);
  f = f * f * (3.0 - 2.0 * f);
  f *= mix(1.0, 0.8, clamp(wpos.y * 0.04, 0.0, 1.0));
  float toSun = pow(max(dot(d / max(dist, 0.001), sunDir), 0.0), 5.0);
  return mix(col, fogColor + sunColor * (0.16 * toSun), f);
}`;

const NOISE_GLSL = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }`;

const DEPTH_GLSL = `
vec3 packDepth(float d) { vec3 e = fract(d * vec3(1.0, 255.0, 65025.0)); e -= e.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0); return e; }
float unpackDepth(vec3 c) { return dot(c, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0)); }`;

const SHADERS = {
  voxelVertexShader: `
precision highp float;
attribute vec3 position; attribute vec2 uv; attribute vec4 color;
uniform mat4 worldViewProjection; uniform float time; uniform float swayAmount;
varying vec2 vUV; varying vec4 vColor; varying vec3 vPos;
void main() {
  vec3 p = position;
  if (swayAmount > 0.0 && color.a > 0.78 && color.a < 0.96) {                  // plants and leaves move in the wind
    float k = clamp((color.a - 0.8) / 0.15, 0.0, 1.0) * swayAmount;
    float ph = time * 1.6 + p.x * 0.55 + p.z * 0.4;
    p.x += (sin(ph) + 0.5 * sin(ph * 2.3 + 1.7)) * 0.07 * k;
    p.z += (cos(ph * 0.9 + 0.5) + 0.5 * sin(ph * 1.9)) * 0.05 * k;
  }
  vUV = uv; vColor = color; vPos = position;
  gl_Position = worldViewProjection * vec4(p, 1.0);
}`,
  voxelFragmentShader: `
#extension GL_OES_standard_derivatives : enable
precision highp float;
varying vec2 vUV; varying vec4 vColor; varying vec3 vPos;
uniform sampler2D atlas; uniform sampler2D shadowMap;
uniform float daylight; uniform vec3 skyTint; uniform float time; uniform float rain;
uniform mat4 lightVP; uniform vec4 shadowParams; uniform float quality;
${FOG_GLSL}
${NOISE_GLSL}
${DEPTH_GLSL}
float sunShadow(vec3 wp, vec3 n) {
  vec4 lp = lightVP * vec4(wp + n * 0.08, 1.0);
  vec3 pc = lp.xyz / lp.w * 0.5 + 0.5;
  if (pc.x <= 0.0 || pc.x >= 1.0 || pc.y <= 0.0 || pc.y >= 1.0 || pc.z >= 1.0) return 1.0;
  float edge = smoothstep(0.0, 0.08, min(min(pc.x, 1.0 - pc.x), min(pc.y, 1.0 - pc.y)));
  float lit = 0.0;
  float ref = pc.z - shadowParams.z;
  if (quality > 1.5) {                                                          // 3 x 3 taps: the softest edges
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        float d = unpackDepth(texture2D(shadowMap, pc.xy + vec2(float(i), float(j)) * shadowParams.y).rgb);
        lit += (ref > d) ? 0.0 : 1.0;
      }
    }
    lit /= 9.0;
  } else {                                                                      // 4 taps: cheaper on modest GPUs
    float t = shadowParams.y * 0.6;
    lit += (ref > unpackDepth(texture2D(shadowMap, pc.xy + vec2(-t, -t)).rgb)) ? 0.0 : 0.25;
    lit += (ref > unpackDepth(texture2D(shadowMap, pc.xy + vec2(t, -t)).rgb)) ? 0.0 : 0.25;
    lit += (ref > unpackDepth(texture2D(shadowMap, pc.xy + vec2(-t, t)).rgb)) ? 0.0 : 0.25;
    lit += (ref > unpackDepth(texture2D(shadowMap, pc.xy + vec2(t, t)).rgb)) ? 0.0 : 0.25;
  }
  return mix(1.0, lit, edge);
}
float cloudShade(vec2 p) {
  if (quality < 0.5) return 1.0;
  float c = vnoise(p * 0.018 + vec2(time * 0.016, time * 0.006)) * 0.65 + vnoise(p * 0.047 - vec2(time * 0.011, 0.0)) * 0.35;
  return 1.0 - 0.32 * smoothstep(0.5 - rain * 0.18, 0.78, c);
}
void main() {
  vec4 tex = texture2D(atlas, vUV);
  if (tex.a < 0.3) discard;
  vec3 n = normalize(cross(dFdx(vPos), dFdy(vPos)));
  vec3 toCam = cameraPos - vPos;
  if (dot(n, toCam) < 0.0) n = -n;
  vec3 col;
  float alpha = tex.a;
  if (vColor.a < 0.25) {
    col = tex.rgb * 1.35;                                                       // lamps and neon light themselves (and bloom)
  } else if (vColor.a < 0.75) {                                                  // water
    vec3 N = normalize(vec3(sin(vPos.x * 1.9 + time * 1.3) * 0.035 + sin(vPos.z * 2.7 - time * 0.9) * 0.025, 1.0, cos(vPos.z * 2.1 + time * 1.1) * 0.035));
    vec3 V = normalize(toCam);
    float fres = pow(1.0 - max(dot(V, N), 0.0), 3.0);
    float sky = pow(vColor.g, 1.6);
    vec3 base = tex.rgb * (skyTint * daylight * (0.5 + 0.5 * sky) + 0.05);
    col = mix(base, fogColor * (0.8 + 0.3 * daylight), clamp(fres * 0.75 + 0.08, 0.0, 0.85));
    col += sunColor * (pow(max(dot(reflect(-V, N), sunDir), 0.0), 90.0) * 2.4 * sky);
    alpha = clamp(0.64 + fres * 0.34, 0.0, 0.95);
  } else {
    float ao = vColor.r;
    float sky = pow(vColor.g, 1.6);
    float lamp = pow(vColor.b, 1.5);
    float hemi = 0.64 + 0.36 * (n.y * 0.5 + 0.5);
    float ndl = max(dot(n, sunDir), 0.0);
    float open = smoothstep(0.82, 1.0, vColor.g);
    float sh = 1.0;
    if (shadowParams.x > 0.5 && ndl > 0.0 && open > 0.0) sh = sunShadow(vPos, n);
    vec3 ambient = skyTint * (daylight * sky * hemi * 0.55);
    vec3 direct = sunColor * (ndl * sh * cloudShade(vPos.xz) * open);
    vec3 light = max(ambient + direct, vec3(1.0, 0.8, 0.55) * (lamp * 1.12));
    light = max(light, vec3(0.05, 0.055, 0.08));
    col = tex.rgb * ao * light;
    col *= 0.955 + 0.09 * hash13(floor(vPos - n * 0.01));                       // every block is a touch different
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
uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; uniform vec3 cloudLight; uniform vec3 sunCol; uniform vec3 trueSun;
uniform float night; uniform float time; uniform float rain;
${NOISE_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5));
  if (h < 0.0) col = horizon * (1.0 + h * 0.4);
  float clear = 1.0 - rain;
  float sd = dot(d, trueSun);
  col += sunCol * (pow(max(sd, 0.0), 6.0) * 0.1 + pow(max(sd, 0.0), 48.0) * 0.42) * clear;     // halo around the sun
  col = mix(col, vec3(1.0, 0.95, 0.8) * 3.2, smoothstep(0.9990, 0.9994, sd) * clear);          // the sun itself (glows)
  float md = dot(d, -trueSun);
  col = mix(col, vec3(0.92, 0.94, 1.0) * 1.4, smoothstep(0.9992, 0.9995, md) * night * clear);
  col += vec3(0.5, 0.58, 0.85) * pow(max(md, 0.0), 120.0) * 0.22 * night;
  if (h > 0.0) {
    vec3 sp = d * 190.0;
    vec3 cell = floor(sp);
    float s = hash13(cell);
    float r = length(fract(sp) - 0.5);
    float tw = 0.65 + 0.35 * sin(time * 2.6 + s * 60.0);
    col += vec3(1.0, 0.95, 0.9) * (step(0.9968, s) * smoothstep(0.34, 0.05, r) * tw * night * clear * smoothstep(0.02, 0.3, h) * 1.5);
    vec2 uv = d.xz / (h + 0.18) * 1.4 + vec2(time * 0.012, time * 0.005);
    float c1 = fbm(uv);
    float c = smoothstep(0.52 - rain * 0.3, 0.82, c1);
    float c2 = fbm(uv + sunDir.xz * 0.07);                                                      // density towards the sun: thin edges glow
    float lit = clamp(0.55 + (c1 - c2) * 3.0, 0.0, 1.0);
    vec3 cc = mix(cloudLight * 0.62, cloudLight * 1.08, lit);
    cc += sunCol * (0.28 * pow(max(sd, 0.0), 12.0)) * (1.0 - c * 0.5);
    col = mix(col, cc, c * smoothstep(0.0, 0.18, h) * 0.88);
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
uniform vec3 baseColor; uniform float ocean; uniform float shore; uniform float daylight; uniform vec3 skyTint; uniform float time;
${FOG_GLSL}
void main() {
  vec3 col = baseColor;
  if (ocean > 0.5) {
    float w = sin(vPos.x * 0.21 + time * 0.9) * sin(vPos.z * 0.33 - time * 0.7) + 0.5 * sin(vPos.x * 0.07 - vPos.z * 0.11 + time * 0.5);
    col = mix(vec3(0.05, 0.28, 0.45), vec3(0.12, 0.5, 0.65), 0.5 + 0.3 * w);
    float dist = vPos.z - shore;
    float foam = (1.0 - smoothstep(0.0, 3.0, dist)) + step(0.94, sin(dist * 0.9 - time * 1.6)) * (1.0 - smoothstep(0.0, 14.0, dist)) * 0.7;
    vec3 v = normalize(cameraPos - vPos);
    vec3 nrm = normalize(vec3(cos(vPos.x * 0.21 + time * 0.9) * 0.05, 1.0, cos(vPos.z * 0.33 - time * 0.7) * 0.05));
    float fres = pow(1.0 - max(dot(v, nrm), 0.0), 4.0);
    col *= max(skyTint * daylight, vec3(0.045, 0.05, 0.075));
    col = mix(col, fogColor * 0.95, clamp(fres * 0.7, 0.0, 0.8));
    col = mix(col, vec3(0.95, 0.97, 1.0) * max(daylight, 0.25), clamp(foam, 0.0, 1.0) * 0.75);
    col += sunColor * (pow(max(dot(reflect(-v, nrm), sunDir), 0.0), 70.0) * 2.0);
  } else {
    col *= max(skyTint * daylight * 0.9 + sunColor * max(sunDir.y, 0.0) * 0.45, vec3(0.045, 0.05, 0.075));
  }
  gl_FragColor = vec4(applyFog(col, vPos), 1.0);
}`,
  charVertexShader: `
precision highp float;
attribute vec3 position; attribute vec2 uv; attribute vec3 normal;
uniform mat4 world; uniform mat4 worldViewProjection;
varying vec2 vUV; varying vec3 vPos; varying vec3 vN;
void main() {
  vUV = uv; vPos = (world * vec4(position, 1.0)).xyz;
  vN = normalize((world * vec4(normal, 0.0)).xyz);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`,
  charFragmentShader: `
precision highp float;
varying vec2 vUV; varying vec3 vPos; varying vec3 vN;
uniform vec3 color; uniform float useTex; uniform sampler2D tex; uniform vec3 light; uniform float glow; uniform float openSky;
${FOG_GLSL}
void main() {
  vec4 c = useTex > 0.5 ? texture2D(tex, vUV) : vec4(1.0);
  if (c.a < 0.5) discard;
  vec3 col;
  if (glow > 0.5) col = c.rgb * color * 1.5;
  else {
    float hemi = 0.7 + 0.3 * (vN.y * 0.5 + 0.5);
    col = c.rgb * color * (light * hemi + sunColor * (max(dot(vN, sunDir), 0.0) * openSky));
  }
  gl_FragColor = vec4(applyFog(col, vPos), 1.0);
}`,
  // ---- shadow map: depth of the world as seen from the sun, packed into RGB
  shadowVoxelVertexShader: `
precision highp float;
attribute vec3 position; attribute vec2 uv; uniform mat4 worldViewProjection; varying vec2 vUV;
void main() { vUV = uv; gl_Position = worldViewProjection * vec4(position, 1.0); }`,
  shadowVoxelFragmentShader: `
precision highp float;
varying vec2 vUV; uniform sampler2D atlas;
${DEPTH_GLSL}
void main() {
  if (texture2D(atlas, vUV).a < 0.45) discard;
  gl_FragColor = vec4(packDepth(gl_FragCoord.z), 1.0);
}`,
  blobVertexShader: `
precision highp float;
attribute vec3 position; attribute vec2 uv; uniform mat4 worldViewProjection; varying vec2 vUV;
void main() { vUV = uv; gl_Position = worldViewProjection * vec4(position, 1.0); }`,
  blobFragmentShader: `
precision highp float;
varying vec2 vUV; uniform float strength;
void main() {
  float d = length(vUV - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, d)) * strength;
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.0, 0.02, 0.04, a);
}`,
};

const ENV_UNIFORMS = ['fogColor', 'fogRange', 'cameraPos', 'daylight', 'skyTint', 'time', 'sunDir', 'sunColor', 'rain'];
const envMaterials = new Set();

export function registerShaders() {
  Object.assign(BABYLON.Effect.ShadersStore, SHADERS);
}

function shaderMat(name, scene, shader, uniforms, samplers = [], opts = {}) {
  const mat = new BABYLON.ShaderMaterial(name, scene, { vertex: shader, fragment: shader }, {
    attributes: opts.attributes || ['position', 'uv'],
    uniforms: ['world', 'worldViewProjection', ...(opts.env === false ? [] : ENV_UNIFORMS), ...uniforms],
    samplers,
    needAlphaBlending: !!opts.alpha,
  });
  mat.backFaceCulling = opts.backFaceCulling ?? true;
  if (opts.env !== false) {
    envMaterials.add(mat);
    mat.onDisposeObservable.add(() => envMaterials.delete(mat));
  }
  return mat;
}

const VOXEL_UNIFORMS = ['swayAmount', 'lightVP', 'shadowParams', 'quality'];
const VOXEL_SAMPLERS = ['atlas', 'shadowMap'];

export function createVoxelMaterials(scene, atlas) {
  const { data, width, height } = buildGpuAtlas(atlas);
  const tex = new BABYLON.RawTexture(data, width, height, BABYLON.Constants.TEXTUREFORMAT_RGBA, scene, true, true, BABYLON.Texture.NEAREST_LINEAR_MIPLINEAR);
  tex.hasAlpha = true;
  tex.wrapU = tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 4;
  const attrs = ['position', 'uv', 'color'];
  const opaque = shaderMat('voxel', scene, 'voxel', VOXEL_UNIFORMS, VOXEL_SAMPLERS, { attributes: attrs });
  const glass = shaderMat('voxel-glass', scene, 'voxel', VOXEL_UNIFORMS, VOXEL_SAMPLERS, { attributes: attrs, alpha: true });
  for (const m of [opaque, glass]) {
    m.setTexture('atlas', tex);
    m.setFloat('swayAmount', 1);
    m.setFloat('quality', 1);
    m.setVector4('shadowParams', new BABYLON.Vector4(0, 1 / 2048, 0.001, 0));
    m.setMatrix('lightVP', BABYLON.Matrix.Identity());
  }
  // the depth-only material the shadow map draws chunks with
  const shadowDepth = shaderMat('voxel-shadow', scene, 'shadowVoxel', [], ['atlas'], { attributes: ['position', 'uv'], backFaceCulling: false, env: false });
  shadowDepth.setTexture('atlas', tex);
  return { opaque, glass, shadowDepth, atlasTexture: tex };
}

// A colour/texture material for characters and vehicles. light is set per frame.
export function createCharMaterial(scene, color, texture = null, glow = false) {
  const m = shaderMat('char', scene, 'char', ['color', 'useTex', 'light', 'glow', 'openSky'], ['tex'], { attributes: ['position', 'uv', 'normal'] });
  m.setColor3('color', color instanceof BABYLON.Color3 ? color : BABYLON.Color3.FromHexString(color));
  m.setFloat('useTex', texture ? 1 : 0);
  m.setFloat('glow', glow ? 1 : 0);
  m.setFloat('openSky', 1);
  m.setColor3('light', new BABYLON.Color3(1, 1, 1));
  if (texture) m.setTexture('tex', texture);
  return m;
}

// The soft dark disc under characters and vehicles.
export function createBlobMaterial(scene) {
  const m = shaderMat('blob', scene, 'blob', ['strength'], [], { attributes: ['position', 'uv'], alpha: true, backFaceCulling: false, env: false });
  m.setFloat('strength', 0.45);
  m.zOffset = -3;
  m.alphaMode = BABYLON.Engine.ALPHA_COMBINE;
  return m;
}

export function createSky(scene) {
  const sky = BABYLON.MeshBuilder.CreateSphere('sky', { diameter: 800, segments: 20, sideOrientation: BABYLON.Mesh.BACKSIDE }, scene);
  const mat = shaderMat('sky', scene, 'sky', ['horizon', 'zenith', 'cloudLight', 'night', 'rain', 'sunCol', 'trueSun'], [], { attributes: ['position'], backFaceCulling: false });
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

  // The one directional light: the sun by day, the moon by night. Both fade to nothing at the horizon so nothing pops.
  const warm = smooth(0.0, 0.5, sun[1]);
  const sunRGB = mix3([1.0, 0.58, 0.3], [1.0, 0.94, 0.82], warm);
  const sunI = 0.7 * smooth(0.0, 0.2, sun[1]) * (1 - rain * 0.75);
  const moonI = 0.22 * smooth(0.0, 0.2, -sun[1]) * (1 - rain * 0.6);
  const useSun = sun[1] >= 0;
  const lightDir = useSun ? sun : [-sun[0], -sun[1], -sun[2]];
  const lightRGB = useSun ? sunRGB.map((c) => c * sunI) : [0.38 * moonI, 0.5 * moonI, 0.85 * moonI];
  return {
    t, sun, day, dusk, night: 1 - day, horizon, zenith, skyTint, daylight, rain, cloudLight,
    lightDir, lightColor: lightRGB, lightPower: useSun ? sunI : moonI, sunRGB,
  };
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
  const dir = new BABYLON.Vector3(...env.lightDir);
  const col = new BABYLON.Color3(...env.lightColor);
  const fogRange = new BABYLON.Vector2(fogStart, fogEnd);
  for (const m of envMaterials) {
    m.setColor3('fogColor', fogColor);
    m.setVector2('fogRange', fogRange);
    m.setVector3('cameraPos', camera.position);
    m.setFloat('daylight', env.daylight);
    m.setColor3('skyTint', tint);
    m.setFloat('time', time);
    m.setVector3('sunDir', dir);
    m.setColor3('sunColor', col);
    m.setFloat('rain', env.rain);
  }
  sky.mat.setColor3('horizon', fogColor);
  sky.mat.setColor3('zenith', new BABYLON.Color3(...env.zenith));
  sky.mat.setColor3('cloudLight', new BABYLON.Color3(...env.cloudLight));
  sky.mat.setColor3('sunCol', new BABYLON.Color3(...env.sunRGB));
  sky.mat.setVector3('trueSun', new BABYLON.Vector3(...env.sun));
  sky.mat.setFloat('night', env.night);
  sky.mat.setFloat('rain', env.rain);
}

// Brightness for an entity standing in a lit cell (the same ambient curve as the voxel shader).
// `open` is 1 when the entity stands under open sky, so the shader adds direct sun on top.
export function lightColor(env, sky, blk) {
  const s = Math.pow(sky / 15, 1.6) * env.daylight * 0.62;
  const l = Math.pow(blk / 15, 1.5) * 1.12;
  return [
    Math.max(env.skyTint[0] * s, l, 0.06),
    Math.max(env.skyTint[1] * s, l * 0.8, 0.065),
    Math.max(env.skyTint[2] * s, l * 0.55, 0.09),
  ];
}

export { CELL, ATLAS_COLS, ATLAS_ROWS, TILE };
