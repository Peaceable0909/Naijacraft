// Synthesised sound effects and ambience (WebAudio, no audio files to download).
let ctx = null, master = null, noiseBuf = null;
let volume = 0.7;
const amb = {};

function ensure() {
  if (ctx) return ctx.state === 'running';
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx.state === 'running';
}

function noise(dur, { freq = 1000, q = 1, type = 'bandpass', gain = 0.3, attack = 0.005, when = 0 } = {}) {
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random()); src.stop(t + dur + 0.05);
}

function tone(freq, dur, { type = 'sine', gain = 0.2, slide = 0, when = 0, attack = 0.005 } = {}) {
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

const MATERIAL = {
  stone: { freq: 900, q: 0.8 }, wood: { freq: 500, q: 2.5 }, soft: { freq: 350, q: 0.6 },
  glass: { freq: 3200, q: 4 }, metal: { freq: 1800, q: 8 }, water: { freq: 600, q: 1 },
};

function loop(name, build) {
  if (amb[name]) return amb[name];
  amb[name] = build();
  return amb[name];
}
function noiseLoop(type, freq, q) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f); f.connect(g); g.connect(master); src.start();
  return { g, f };
}

let cricketTimer = 0, genTimer = 0;

export const sfx = {
  unlock() { ensure(); if (ctx && ctx.state !== 'running') ctx.resume(); },
  setVolume(v) { volume = v; if (master) master.gain.value = v; },
  ok() { return ctx && ctx.state === 'running' && volume > 0; },
  place(kind = 'stone') { if (!this.ok()) return; const m = MATERIAL[kind] || MATERIAL.stone; noise(0.08, { freq: m.freq * 0.8, q: m.q, gain: 0.35 }); tone(m.freq * 0.25, 0.07, { gain: 0.12 }); },
  break(kind = 'stone') {
    if (!this.ok()) return;
    const m = MATERIAL[kind] || MATERIAL.stone;
    noise(0.18, { freq: m.freq, q: m.q, gain: 0.4 });
    if (kind === 'glass') for (let i = 0; i < 4; i++) tone(2500 + Math.random() * 2000, 0.12, { gain: 0.05, when: i * 0.03 });
  },
  step(kind = 'stone') { if (!this.ok()) return; const m = MATERIAL[kind] || MATERIAL.stone; noise(0.06, { freq: m.freq * 0.6, q: m.q, gain: 0.08 }); },
  splash() { if (!this.ok()) return; noise(0.4, { freq: 800, q: 0.5, gain: 0.25, type: 'lowpass' }); },
  door(open) { if (!this.ok()) return; tone(open ? 220 : 180, 0.15, { type: 'triangle', gain: 0.12, slide: open ? 60 : -40 }); noise(0.1, { freq: 500, q: 3, gain: 0.15 }); },
  horn() { if (!this.ok()) return; for (const f of [392, 494]) { tone(f, 0.28, { type: 'square', gain: 0.05 }); tone(f, 0.28, { type: 'square', gain: 0.05, when: 0.36 }); } },
  click() { if (!this.ok()) return; tone(880, 0.05, { type: 'triangle', gain: 0.06 }); },
  achievement() { if (!this.ok()) return; [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.1, when: i * 0.09 })); },
  photo() { if (!this.ok()) return; noise(0.05, { freq: 4000, q: 1, gain: 0.3 }); noise(0.08, { freq: 2500, q: 1, gain: 0.2, when: 0.08 }); },
  generator() { if (!this.ok()) return; genTimer = 6; },
  undo() { if (!this.ok()) return; tone(600, 0.08, { type: 'triangle', gain: 0.08, slide: -200 }); },

  // Called every frame with the scene state.
  ambience(dt, { night, rain, beachDist, indoors }) {
    if (!this.ok()) return;
    const waves = loop('waves', () => noiseLoop('lowpass', 500, 0.7));
    const wv = Math.max(0, 1 - beachDist / 45) * (0.18 + 0.08 * Math.sin(ctx.currentTime * 0.6));
    waves.g.gain.setTargetAtTime(wv, ctx.currentTime, 0.3);
    const rainL = loop('rain', () => noiseLoop('highpass', 1200, 0.4));
    rainL.g.gain.setTargetAtTime(rain * (indoors ? 0.05 : 0.14), ctx.currentTime, 0.5);
    const gen = loop('gen', () => noiseLoop('lowpass', 120, 6));
    genTimer = Math.max(0, genTimer - dt);
    gen.g.gain.setTargetAtTime(genTimer > 0 ? 0.35 : 0, ctx.currentTime, 0.2);
    cricketTimer -= dt;
    if (night > 0.6 && rain < 0.3 && cricketTimer <= 0) {
      cricketTimer = 0.4 + Math.random() * 1.2;
      const f = 4200 + Math.random() * 600;
      for (let i = 0; i < 3; i++) tone(f, 0.03, { gain: 0.012, when: i * 0.06 });
    }
  },
};
