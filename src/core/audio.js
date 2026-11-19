// Procedural audio: every sound is synthesized once at startup with an OfflineAudioContext
// (filtered noise, pitch sweeps, saturation, generated reverb), then played through cheap
// BufferSource → Gain → StereoPanner chains. No downloads.
// Real recordings can override any sound: list them in public/sounds/manifest.json.
let ctx = null, master = null, ambGain = null;
const buffers = {};
let volume = 0.7;
const SR = 44100;

function noiseBuf(oc, sec, seed = 1) {
  const b = oc.createBuffer(1, Math.max(1, Math.ceil(sec * SR)), SR);
  const d = b.getChannelData(0);
  let s = seed * 9301 + 49297;
  for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; }
  return b;
}
function filt(oc, type, f, Q = 0.7) { const b = oc.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; return b; }
function shaper(oc, drive) {
  const ws = oc.createWaveShaper(); const n = 2048; const c = new Float32Array(n); const k = Math.tanh(drive);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / k; }
  ws.curve = c; return ws;
}
// gain envelope from points [[t, v], ...] (linear ramps)
function envPts(oc, pts) {
  const g = oc.createGain();
  g.gain.setValueAtTime(0, 0);
  for (const [t, v] of pts) g.gain.linearRampToValueAtTime(v, t);
  return g;
}
// noise through a filter whose frequency follows a curve
function noise(oc, out, { t0 = 0, dur, type = 'bandpass', f = [800, 800], Q = 1, env, seed = 1 }) {
  const src = oc.createBufferSource(); src.buffer = noiseBuf(oc, dur + 0.05, seed);
  const fl = filt(oc, type, f[0], Q);
  fl.frequency.setValueAtTime(f[0], t0);
  for (let i = 1; i < f.length; i++) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f[i]), t0 + (dur * i) / (f.length - 1));
  const g = envPts(oc, env.map(([t, v]) => [t0 + t, v]));
  src.connect(fl); fl.connect(g); g.connect(out); src.start(t0); src.stop(t0 + dur + 0.05);
}
function tone(oc, out, { t0 = 0, dur, f = [440, 440], type = 'sine', env }) {
  const o = oc.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f[0], t0);
  for (let i = 1; i < f.length; i++) o.frequency.exponentialRampToValueAtTime(Math.max(10, f[i]), t0 + (dur * i) / (f.length - 1));
  const g = envPts(oc, env.map(([t, v]) => [t0 + t, v]));
  o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + dur + 0.05);
}
function impulse(oc, sec, tau) {
  const len = Math.ceil(sec * SR); const b = oc.createBuffer(2, len, SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch); let s = 777 + ch * 31, lp = 0;
    for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; const n = (s / 0x3fffffff) - 1; const t = i / SR; lp += (1 - Math.min(0.94, 0.3 + t * 1.5)) * (n - lp); d[i] = lp * Math.exp(-t / tau); }
  }
  return b;
}
// crackle: sparse random pops
function crackle(oc, out, t0, dur, density, gain, seed) {
  const b = oc.createBuffer(1, Math.ceil((dur + 0.1) * SR), SR); const d = b.getChannelData(0);
  let s = seed;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    if ((s % 100000) / 100000 < density / SR) { const len = 30 + (s % 120); for (let k = 0; k < len && i + k < d.length; k++) d[i + k] += ((k * 7919 + s) % 13 / 6.5 - 1) * Math.exp(-k / (len * 0.3)); }
  }
  const src = oc.createBufferSource(); src.buffer = b;
  const hp = filt(oc, 'highpass', 900, 0.7); const g = oc.createGain(); g.gain.value = gain;
  src.connect(hp); hp.connect(g); g.connect(out); src.start(t0);
}

async function render(len, build, { reverb = 0, tau = 0.4, drive = 0, stereo = false, level = 0.9 } = {}) {
  const oc = new OfflineAudioContext(stereo || reverb ? 2 : 1, Math.ceil(len * SR), SR);
  const bus = oc.createGain();
  let last = bus;
  if (drive) { const sh = shaper(oc, drive); last.connect(sh); last = sh; }
  last.connect(oc.destination);
  if (reverb) {
    const conv = oc.createConvolver(); conv.buffer = impulse(oc, Math.min(len, tau * 5), tau);
    const wet = oc.createGain(); wet.gain.value = reverb; bus.connect(conv); conv.connect(wet); wet.connect(oc.destination);
  }
  build(oc, bus);
  const buf = await oc.startRendering();
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
  const k = level / Math.max(1e-4, peak);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  return buf;
}

const SFX = {
  bolt: [0.45, (oc, o) => {
    noise(oc, o, { dur: 0.35, f: [500, 2400, 900], Q: 1.2, env: [[0.01, 0.9], [0.08, 0.6], [0.35, 0]], seed: 3 });
    tone(oc, o, { dur: 0.15, f: [220, 70], env: [[0.005, 0.7], [0.15, 0]] });
    crackle(oc, o, 0.02, 0.3, 60, 0.4, 5);
  }, { reverb: 0.15, tau: 0.25, drive: 1.5, level: 0.8 }],
  boltHit: [0.4, (oc, o) => {
    noise(oc, o, { dur: 0.3, type: 'lowpass', f: [3000, 400], env: [[0.004, 1], [0.3, 0]], seed: 7 });
    crackle(oc, o, 0.01, 0.25, 140, 0.6, 9);
  }, { drive: 2, level: 0.75 }],
  orb: [0.8, (oc, o) => {
    noise(oc, o, { dur: 0.7, f: [200, 1300, 400], Q: 0.9, env: [[0.05, 0.9], [0.25, 0.8], [0.7, 0]], seed: 11 });
    tone(oc, o, { dur: 0.6, f: [90, 140, 60], type: 'sawtooth', env: [[0.05, 0.25], [0.6, 0]] });
    crackle(oc, o, 0.05, 0.6, 90, 0.5, 13);
  }, { reverb: 0.25, tau: 0.35, drive: 1.8 }],
  explode: [2.2, (oc, o) => {
    tone(oc, o, { dur: 0.6, f: [150, 32], env: [[0.004, 1], [0.6, 0]] });
    noise(oc, o, { dur: 1.2, type: 'lowpass', f: [5000, 1200, 200], env: [[0.003, 1], [0.15, 0.55], [1.2, 0]], seed: 17 });
    noise(oc, o, { dur: 0.05, type: 'highpass', f: [1500, 1500], env: [[0.001, 1], [0.05, 0]], seed: 19 });
    crackle(oc, o, 0.05, 1.6, 50, 0.45, 21);
  }, { reverb: 0.4, tau: 0.6, drive: 2.6, level: 0.95 }],
  wall: [1.5, (oc, o) => {
    noise(oc, o, { dur: 1.3, f: [180, 900, 500], Q: 0.8, env: [[0.12, 1], [0.6, 0.7], [1.3, 0]], seed: 23 });
    tone(oc, o, { dur: 0.5, f: [70, 40], env: [[0.01, 0.8], [0.5, 0]] });
    crackle(oc, o, 0.1, 1.3, 120, 0.6, 25);
  }, { reverb: 0.3, tau: 0.5, drive: 2 }],
  fireLoop: [2.0, (oc, o) => {
    noise(oc, o, { dur: 2.0, type: 'lowpass', f: [700, 700], env: [[0.0, 0.5], [2.0, 0.5]], seed: 27 });
    crackle(oc, o, 0, 2.0, 70, 0.7, 29);
  }, { level: 0.6 }],
  leap: [1.0, (oc, o) => {
    tone(oc, o, { dur: 0.4, f: [120, 45], env: [[0.004, 1], [0.4, 0]] });
    noise(oc, o, { dur: 0.8, f: [300, 2600, 800], Q: 1, env: [[0.02, 1], [0.2, 0.7], [0.8, 0]], seed: 31 });
    crackle(oc, o, 0.02, 0.6, 80, 0.4, 33);
  }, { reverb: 0.3, tau: 0.4, drive: 2 }],
  meteorCall: [1.4, (oc, o) => {
    tone(oc, o, { dur: 1.3, f: [110, 330], type: 'sawtooth', env: [[0.1, 0.35], [1.0, 0.5], [1.3, 0]] });
    tone(oc, o, { dur: 1.3, f: [165, 495], type: 'triangle', env: [[0.1, 0.3], [1.3, 0]] });
    noise(oc, o, { dur: 1.3, f: [300, 3000], Q: 2, env: [[0.2, 0.3], [1.2, 0.6], [1.3, 0]], seed: 35 });
  }, { reverb: 0.5, tau: 0.7, drive: 1.2, level: 0.7 }],
  meteorFall: [1.4, (oc, o) => {
    noise(oc, o, { dur: 1.35, f: [4000, 600], Q: 3, env: [[0.2, 0.3], [1.2, 1], [1.35, 0]], seed: 37 });
    tone(oc, o, { dur: 1.35, f: [1400, 300], type: 'sine', env: [[0.3, 0.15], [1.3, 0.4], [1.35, 0]] });
  }, { level: 0.6 }],
  meteorHit: [3.0, (oc, o) => {
    tone(oc, o, { dur: 1.0, f: [110, 22], env: [[0.004, 1], [1.0, 0]] });
    noise(oc, o, { dur: 2.0, type: 'lowpass', f: [6000, 900, 120], env: [[0.003, 1], [0.3, 0.6], [2.0, 0]], seed: 41 });
    crackle(oc, o, 0.1, 2.6, 60, 0.5, 43);
  }, { reverb: 0.6, tau: 0.9, drive: 3, level: 1 }],
  spark: [0.45, (oc, o) => {
    tone(oc, o, { dur: 0.25, f: [1800, 700], type: 'triangle', env: [[0.003, 0.5], [0.25, 0]] });
    tone(oc, o, { dur: 0.18, f: [2600, 1200], type: 'sine', env: [[0.003, 0.35], [0.18, 0]] });
    noise(oc, o, { dur: 0.3, f: [3000, 900], Q: 2, env: [[0.005, 0.6], [0.3, 0]], seed: 81 });
    crackle(oc, o, 0.02, 0.3, 90, 0.35, 83);
  }, { reverb: 0.25, tau: 0.3, drive: 1.4, level: 0.75 }],
  sigil: [1.0, (oc, o) => {
    [880, 1320, 1760].forEach((f, i) => tone(oc, o, { t0: i * 0.05, dur: 0.8, f: [f, f * 0.99], type: 'sine', env: [[0.01, 0.35], [0.8, 0]] }));
    noise(oc, o, { dur: 0.4, type: 'lowpass', f: [600, 200], env: [[0.005, 0.6], [0.4, 0]], seed: 85 });
  }, { reverb: 0.5, tau: 0.6, level: 0.6 }],
  blink: [0.6, (oc, o) => {
    noise(oc, o, { dur: 0.35, f: [5000, 400], Q: 1.5, env: [[0.005, 1], [0.35, 0]], seed: 87 });
    tone(oc, o, { dur: 0.3, f: [300, 1600], type: 'sine', env: [[0.01, 0.4], [0.3, 0]] });
  }, { reverb: 0.3, tau: 0.35, level: 0.7 }],
  novaChant: [2.6, (oc, o) => {
    // rising, detuned drone + shimmering partials: the incantation
    for (const [f, d] of [[110, 0], [110.6, 0], [165, 0.2], [220, 0.5], [330, 0.9], [440, 1.3]]) tone(oc, o, { t0: d, dur: 2.5 - d, f: [f, f * 2.2], type: 'sawtooth', env: [[0.2, 0.12], [2.2 - d, 0.22], [2.5 - d, 0]] });
    noise(oc, o, { dur: 2.5, f: [200, 4000], Q: 3, env: [[0.3, 0.2], [2.3, 0.6], [2.5, 0]], seed: 89 });
    crackle(oc, o, 0.5, 2.0, 80, 0.4, 91);
  }, { reverb: 0.7, tau: 1.0, drive: 1.3, level: 0.75 }],
  novaBoom: [6.0, (oc, o) => {
    tone(oc, o, { dur: 2.5, f: [90, 18], env: [[0.005, 1], [2.5, 0]] });
    tone(oc, o, { dur: 1.2, f: [180, 30], type: 'triangle', env: [[0.005, 0.6], [1.2, 0]] });
    noise(oc, o, { dur: 4.5, type: 'lowpass', f: [8000, 1200, 300, 80], env: [[0.004, 1], [0.6, 0.8], [2.5, 0.35], [4.5, 0]], seed: 93 });
    noise(oc, o, { dur: 0.08, type: 'highpass', f: [1000, 1000], env: [[0.001, 1], [0.08, 0]], seed: 95 });
    crackle(oc, o, 0.2, 5.0, 45, 0.5, 97);
  }, { reverb: 0.8, tau: 1.6, drive: 3.5, level: 1 }],
  dash: [0.4, (oc, o) => {
    noise(oc, o, { dur: 0.32, f: [600, 3200, 900], Q: 0.8, env: [[0.02, 1], [0.32, 0]], seed: 47 });
    crackle(oc, o, 0.0, 0.25, 50, 0.3, 49);
  }, { level: 0.7 }],
  roll: [0.5, (oc, o) => {
    noise(oc, o, { dur: 0.45, type: 'lowpass', f: [400, 250], env: [[0.01, 0.8], [0.2, 0.5], [0.45, 0]], seed: 51 });
    noise(oc, o, { dur: 0.4, f: [2500, 4000], Q: 0.6, env: [[0.02, 0.3], [0.4, 0]], seed: 53 });
  }, { level: 0.6 }],
  jump: [0.25, (oc, o) => { noise(oc, o, { dur: 0.2, f: [800, 2000], Q: 0.7, env: [[0.01, 0.6], [0.2, 0]], seed: 55 }); }, { level: 0.35 }],
  land: [0.3, (oc, o) => { noise(oc, o, { dur: 0.25, type: 'lowpass', f: [300, 150], env: [[0.004, 1], [0.25, 0]], seed: 57 }); noise(oc, o, { dur: 0.15, f: [3000, 3000], Q: 0.5, env: [[0.004, 0.3], [0.15, 0]], seed: 59 }); }, { level: 0.6 }],
  step: [0.16, (oc, o) => { noise(oc, o, { dur: 0.12, type: 'highpass', f: [2500, 3500], env: [[0.004, 0.6], [0.12, 0]], seed: 61 }); noise(oc, o, { dur: 0.08, type: 'lowpass', f: [250, 200], env: [[0.003, 0.7], [0.08, 0]], seed: 63 }); }, { level: 0.45 }],
  splash: [0.4, (oc, o) => { noise(oc, o, { dur: 0.35, f: [1200, 3000, 1500], Q: 0.6, env: [[0.01, 1], [0.35, 0]], seed: 65 }); }, { level: 0.5 }],
  hit: [0.12, (oc, o) => { tone(oc, o, { dur: 0.08, f: [1700, 1500], env: [[0.002, 0.8], [0.08, 0]] }); }, { level: 0.5 }],
  head: [0.35, (oc, o) => { tone(oc, o, { dur: 0.3, f: [2600, 2580], env: [[0.002, 0.7], [0.3, 0]] }); tone(oc, o, { dur: 0.2, f: [3900, 3880], env: [[0.002, 0.4], [0.2, 0]] }); }, { level: 0.55 }],
  kill: [0.6, (oc, o) => { tone(oc, o, { dur: 0.12, f: [660, 650], type: 'square', env: [[0.004, 0.5], [0.12, 0]] }); tone(oc, o, { t0: 0.09, dur: 0.4, f: [990, 980], type: 'square', env: [[0.004, 0.5], [0.4, 0]] }); }, { reverb: 0.2, tau: 0.3, level: 0.55 }],
  hurt: [0.3, (oc, o) => { tone(oc, o, { dur: 0.2, f: [160, 80], env: [[0.003, 1], [0.2, 0]] }); noise(oc, o, { dur: 0.15, type: 'lowpass', f: [900, 300], env: [[0.003, 0.6], [0.15, 0]], seed: 67 }); }, { level: 0.7 }],
  death: [1.2, (oc, o) => { tone(oc, o, { dur: 1.0, f: [300, 60], type: 'triangle', env: [[0.01, 0.7], [1.0, 0]] }); noise(oc, o, { dur: 0.9, type: 'lowpass', f: [1200, 200], env: [[0.01, 0.6], [0.9, 0]], seed: 69 }); }, { reverb: 0.4, tau: 0.6, level: 0.7 }],
  ui: [0.08, (oc, o) => { tone(oc, o, { dur: 0.05, f: [950, 1150], env: [[0.002, 0.6], [0.05, 0]] }); }, { level: 0.4 }],
  uiHover: [0.05, (oc, o) => { tone(oc, o, { dur: 0.03, f: [1800, 1900], env: [[0.002, 0.3], [0.03, 0]] }); }, { level: 0.2 }],
  found: [1.0, (oc, o) => { [523, 659, 784, 1046].forEach((f, i) => tone(oc, o, { t0: i * 0.1, dur: 0.5, f: [f, f], type: 'triangle', env: [[0.005, 0.5], [0.5, 0]] })); }, { reverb: 0.3, tau: 0.5, level: 0.6 }],
  ultReady: [0.9, (oc, o) => { tone(oc, o, { dur: 0.8, f: [400, 800], type: 'triangle', env: [[0.02, 0.5], [0.8, 0]] }); noise(oc, o, { dur: 0.6, f: [500, 3000], Q: 1.5, env: [[0.05, 0.4], [0.6, 0]], seed: 71 }); }, { reverb: 0.4, tau: 0.5, level: 0.6 }],
  bird: [0.5, (oc, o) => { for (let i = 0; i < 3; i++) tone(oc, o, { t0: i * 0.13, dur: 0.09, f: [3200 + i * 300, 4200 + i * 200, 3000], env: [[0.01, 0.4], [0.09, 0]] }); }, { reverb: 0.3, tau: 0.4, level: 0.25 }],
  wind: [6.0, (oc, o) => { noise(oc, o, { dur: 6.0, type: 'bandpass', f: [300, 600, 250, 500, 300], Q: 0.5, env: [[0.0, 0.5], [1.5, 0.8], [3, 0.5], [4.5, 0.9], [6, 0.5]], seed: 73 }); }, { level: 0.5 }],
};

// ---------------------------------------------------------------- v2 sound design
// Layered like real game SFX: a transient click, a pitched sub "thump" for weight, a filtered
// noise body, and a tail (crackle / reverb). Overrides the thinner first-pass sounds above.
function thump(oc, o, t0, f0, f1, dur, gain = 1) {
  tone(oc, o, { t0, dur, f: [f0, f1], env: [[0.003, gain], [dur * 0.35, gain * 0.55], [dur, 0]] });
  tone(oc, o, { t0, dur: dur * 0.6, f: [f0 * 2, f1 * 1.5], type: 'triangle', env: [[0.003, gain * 0.35], [dur * 0.6, 0]] });
}
function click(oc, o, t0, gain = 1, f = 3000) { noise(oc, o, { t0, dur: 0.025, type: 'highpass', f: [f, f], env: [[0.001, gain], [0.025, 0]], seed: 401 + Math.round(f) }); }
function whoosh(oc, o, t0, dur, f0, f1, gain = 1, seed = 1) { noise(oc, o, { t0, dur, f: [f0, f1, f0 * 0.6], Q: 1.4, env: [[dur * 0.35, gain], [dur, 0]], seed }); }
function roar(oc, o, t0, dur, gain = 1, seed = 1, f = [180, 1200, 400]) {
  noise(oc, o, { t0, dur, f, Q: 0.7, env: [[0.02, gain], [dur * 0.5, gain * 0.8], [dur, 0]], seed });
  noise(oc, o, { t0, dur, type: 'lowpass', f: [300, 150], env: [[0.02, gain * 0.7], [dur, 0]], seed: seed + 1 });
  crackle(oc, o, t0, dur, 110, 0.55 * gain, seed + 2);
}
Object.assign(SFX, {
  // combat feedback
  hit: [0.16, (oc, o) => { click(oc, o, 0, 0.8, 4500); tone(oc, o, { dur: 0.09, f: [2400, 2300], type: 'triangle', env: [[0.002, 0.35], [0.09, 0]] }); thump(oc, o, 0, 220, 120, 0.07, 0.5); }, { level: 0.55 }],
  head: [0.45, (oc, o) => { click(oc, o, 0, 1, 5000); [3200, 4800, 6100].forEach((f, i) => tone(oc, o, { dur: 0.35 - i * 0.08, f: [f, f * 0.995], env: [[0.002, 0.45 - i * 0.1], [0.35 - i * 0.08, 0]] })); thump(oc, o, 0, 300, 150, 0.08, 0.6); }, { reverb: 0.15, tau: 0.25, level: 0.6 }],
  kill: [1.2, (oc, o) => {
    thump(oc, o, 0, 120, 40, 0.5, 1);
    noise(oc, o, { dur: 0.6, f: [2000, 300], Q: 1, env: [[0.005, 0.5], [0.6, 0]], seed: 411 });
    [784, 1175, 1568].forEach((f, i) => tone(oc, o, { t0: 0.04 + i * 0.03, dur: 0.9, f: [f, f], type: 'triangle', env: [[0.005, 0.32], [0.9, 0]] }));
  }, { reverb: 0.35, tau: 0.6, drive: 1.3, level: 0.65 }],
  hurt: [0.35, (oc, o) => { thump(oc, o, 0, 140, 55, 0.25, 1); noise(oc, o, { dur: 0.2, type: 'lowpass', f: [1400, 300], env: [[0.003, 0.7], [0.2, 0]], seed: 413 }); }, { drive: 1.8, level: 0.7 }],
  // movement
  jump: [0.35, (oc, o) => { whoosh(oc, o, 0, 0.28, 500, 2200, 0.7, 415); noise(oc, o, { dur: 0.08, type: 'lowpass', f: [400, 200], env: [[0.003, 0.6], [0.08, 0]], seed: 417 }); }, { level: 0.45 }],
  doubleJump: [0.6, (oc, o) => { whoosh(oc, o, 0, 0.45, 300, 3200, 1, 419); thump(oc, o, 0, 160, 70, 0.2, 0.7); crackle(oc, o, 0, 0.35, 60, 0.3, 421); }, { reverb: 0.2, tau: 0.3, drive: 1.4, level: 0.6 }],
  dash: [0.6, (oc, o) => { click(oc, o, 0, 0.6, 2500); whoosh(oc, o, 0, 0.42, 400, 4200, 1, 423); thump(oc, o, 0, 110, 60, 0.18, 0.6); crackle(oc, o, 0.02, 0.3, 60, 0.35, 425); }, { reverb: 0.15, tau: 0.25, drive: 1.6, level: 0.7 }],
  roll: [0.6, (oc, o) => { noise(oc, o, { dur: 0.5, type: 'lowpass', f: [700, 250], env: [[0.01, 0.8], [0.25, 0.5], [0.5, 0]], seed: 427 }); whoosh(oc, o, 0, 0.4, 900, 2600, 0.35, 429); thump(oc, o, 0.02, 90, 50, 0.12, 0.5); }, { level: 0.6 }],
  land: [0.35, (oc, o) => { thump(oc, o, 0, 120, 45, 0.18, 1); noise(oc, o, { dur: 0.2, f: [2200, 1200], Q: 0.6, env: [[0.004, 0.35], [0.2, 0]], seed: 431 }); }, { level: 0.6 }],
  step: [0.18, (oc, o) => { noise(oc, o, { dur: 0.14, f: [1800, 3400], Q: 0.5, env: [[0.006, 0.45], [0.14, 0]], seed: 433 }); thump(oc, o, 0, 90, 60, 0.06, 0.45); }, { level: 0.4 }],
  // Pyro: Fire Force kit
  bolt: [0.5, (oc, o) => { click(oc, o, 0, 0.5, 2000); thump(oc, o, 0, 180, 70, 0.12, 0.8); roar(oc, o, 0, 0.32, 0.7, 435, [600, 2600, 900]); }, { reverb: 0.15, tau: 0.25, drive: 1.8, level: 0.75 }],
  kick: [0.9, (oc, o) => { click(oc, o, 0, 0.6, 2200); whoosh(oc, o, 0, 0.5, 300, 3600, 1, 437); roar(oc, o, 0.02, 0.6, 0.9, 439, [200, 1800, 500]); thump(oc, o, 0, 120, 50, 0.25, 0.8); }, { reverb: 0.25, tau: 0.35, drive: 2.2, level: 0.85 }],
  kickHit: [1.4, (oc, o) => {
    click(oc, o, 0, 1, 1800); thump(oc, o, 0, 160, 34, 0.55, 1);
    noise(oc, o, { dur: 0.9, type: 'lowpass', f: [6000, 900, 150], env: [[0.003, 1], [0.12, 0.5], [0.9, 0]], seed: 441 });
    crackle(oc, o, 0.03, 1.1, 90, 0.5, 443);
  }, { reverb: 0.35, tau: 0.5, drive: 3, level: 0.95 }],
  ember: [0.35, (oc, o) => { click(oc, o, 0, 0.4, 3000); roar(oc, o, 0, 0.22, 0.6, 445, [900, 3000, 1200]); thump(oc, o, 0, 220, 110, 0.06, 0.5); }, { drive: 1.6, level: 0.6 }],
  stomp: [1.8, (oc, o) => {
    thump(oc, o, 0, 90, 26, 0.8, 1); click(oc, o, 0, 1, 1200);
    roar(oc, o, 0.02, 1.2, 1, 447, [150, 1400, 300]);
    noise(oc, o, { dur: 1.4, type: 'lowpass', f: [3000, 500, 100], env: [[0.004, 0.8], [0.3, 0.4], [1.4, 0]], seed: 449 });
  }, { reverb: 0.45, tau: 0.7, drive: 2.6, level: 1 }],
  adollaCharge: [1.0, (oc, o) => {
    for (const [f, d] of [[110, 0], [111, 0], [220, 0.15], [330, 0.35]]) tone(oc, o, { t0: d, dur: 0.95 - d, f: [f, f * 2.6], type: 'sawtooth', env: [[0.1, 0.15], [0.9 - d, 0.3], [0.95 - d, 0]] });
    noise(oc, o, { dur: 0.95, f: [200, 5000], Q: 2.5, env: [[0.1, 0.3], [0.9, 1], [0.95, 0]], seed: 451 });
    crackle(oc, o, 0.1, 0.85, 160, 0.6, 453);
  }, { reverb: 0.4, tau: 0.5, drive: 1.8, level: 0.75 }],
  adollaBeam: [2.6, (oc, o) => {
    click(oc, o, 0, 1, 1500); thump(oc, o, 0, 70, 22, 1.4, 1);
    noise(oc, o, { dur: 1.3, f: [400, 1600, 900], Q: 0.5, env: [[0.01, 1], [1.0, 0.9], [1.3, 0]], seed: 455 });
    noise(oc, o, { dur: 2.4, type: 'lowpass', f: [5000, 1500, 200], env: [[0.004, 1], [1.1, 0.7], [2.4, 0]], seed: 457 });
    tone(oc, o, { dur: 1.2, f: [180, 160], type: 'sawtooth', env: [[0.02, 0.25], [1.0, 0.2], [1.2, 0]] });
    crackle(oc, o, 0, 2.2, 140, 0.7, 459);
  }, { reverb: 0.55, tau: 0.9, drive: 3.2, level: 1 }],
  explode: [2.4, (oc, o) => {
    click(oc, o, 0, 1, 1500); thump(oc, o, 0, 140, 28, 0.7, 1);
    noise(oc, o, { dur: 1.4, type: 'lowpass', f: [7000, 1400, 180], env: [[0.003, 1], [0.15, 0.55], [1.4, 0]], seed: 461 });
    crackle(oc, o, 0.05, 1.8, 60, 0.45, 463);
  }, { reverb: 0.45, tau: 0.7, drive: 2.8, level: 0.95 }],
  // Meteora
  spark: [0.5, (oc, o) => {
    click(oc, o, 0, 0.5, 4000);
    tone(oc, o, { dur: 0.3, f: [2200, 900], type: 'triangle', env: [[0.003, 0.45], [0.3, 0]] });
    tone(oc, o, { dur: 0.22, f: [3300, 1500], env: [[0.003, 0.3], [0.22, 0]] });
    whoosh(oc, o, 0, 0.3, 1500, 5000, 0.5, 465); thump(oc, o, 0, 200, 90, 0.08, 0.5);
  }, { reverb: 0.3, tau: 0.35, drive: 1.3, level: 0.7 }],
  starCall: [1.0, (oc, o) => { [660, 990, 1320, 1980].forEach((f, i) => tone(oc, o, { t0: i * 0.06, dur: 0.8, f: [f, f * 1.01], type: 'sine', env: [[0.01, 0.3], [0.8, 0]] })); whoosh(oc, o, 0, 0.9, 400, 6000, 0.5, 467); }, { reverb: 0.6, tau: 0.8, level: 0.6 }],
  starHit: [1.4, (oc, o) => { click(oc, o, 0, 1, 2500); thump(oc, o, 0, 150, 40, 0.5, 1); noise(oc, o, { dur: 1.0, type: 'lowpass', f: [8000, 1500, 200], env: [[0.003, 0.9], [1.0, 0]], seed: 469 }); [1200, 1800].forEach((f) => tone(oc, o, { dur: 0.6, f: [f, f * 0.98], env: [[0.003, 0.2], [0.6, 0]] })); }, { reverb: 0.4, tau: 0.6, drive: 2.2, level: 0.85 }],
  vortex: [1.0, (oc, o) => { noise(oc, o, { dur: 0.9, f: [3000, 300], Q: 4, env: [[0.05, 0.6], [0.85, 1], [0.9, 0]], seed: 471 }); tone(oc, o, { dur: 0.9, f: [600, 120], type: 'sawtooth', env: [[0.05, 0.12], [0.9, 0]] }); }, { reverb: 0.4, tau: 0.5, level: 0.6 }],
  novaWord: [1.4, (oc, o) => { thump(oc, o, 0, 60, 30, 1.3, 1); noise(oc, o, { dur: 1.3, f: [100, 600, 200], Q: 1, env: [[0.01, 0.8], [1.3, 0]], seed: 473 }); [110, 164.8, 220].forEach((f) => tone(oc, o, { dur: 1.3, f: [f, f], type: 'sawtooth', env: [[0.01, 0.2], [1.3, 0]] })); }, { reverb: 0.7, tau: 1.2, drive: 2, level: 0.9 }],
  circleOn: [1.4, (oc, o) => { thump(oc, o, 0, 80, 40, 0.5, 0.8); [523, 784, 1046, 1568].forEach((f, i) => tone(oc, o, { t0: i * 0.02, dur: 1.3, f: [f, f], type: 'sine', env: [[0.01, 0.3 - i * 0.05], [1.3, 0]] })); noise(oc, o, { dur: 0.6, f: [4000, 800], Q: 2, env: [[0.01, 0.4], [0.6, 0]], seed: 475 }); }, { reverb: 0.8, tau: 1.2, level: 0.75 }],
  // Shoto: ice
  iceShot: [0.4, (oc, o) => { click(oc, o, 0, 0.6, 5000); tone(oc, o, { dur: 0.25, f: [3200, 1800], type: 'triangle', env: [[0.003, 0.35], [0.25, 0]] }); whoosh(oc, o, 0, 0.25, 2500, 7000, 0.5, 501); }, { reverb: 0.2, tau: 0.3, level: 0.6 }],
  iceHit: [0.5, (oc, o) => { click(oc, o, 0, 1, 6000); [2400, 3700, 5200].forEach((f, i) => tone(oc, o, { t0: i * 0.01, dur: 0.3, f: [f, f * 0.97], env: [[0.002, 0.3], [0.3, 0]] })); noise(oc, o, { dur: 0.3, type: 'highpass', f: [4000, 6000], env: [[0.002, 0.6], [0.3, 0]], seed: 503 }); }, { reverb: 0.25, tau: 0.3, level: 0.6 }],
  freeze: [1.2, (oc, o) => {
    noise(oc, o, { dur: 1.0, type: 'highpass', f: [7000, 2500], env: [[0.01, 0.8], [0.3, 0.5], [1.0, 0]], seed: 505 });
    for (let i = 0; i < 9; i++) { const f = 1800 + i * 430; click(oc, o, i * 0.035, 0.5, 4000 + i * 300); tone(oc, o, { t0: i * 0.035, dur: 0.25, f: [f, f * 0.96], env: [[0.002, 0.18], [0.25, 0]] }); }
    thump(oc, o, 0, 90, 50, 0.3, 0.6);
  }, { reverb: 0.4, tau: 0.6, level: 0.7 }],
  iceShatter: [1.2, (oc, o) => {
    click(oc, o, 0, 1, 3000); thump(oc, o, 0, 130, 40, 0.4, 1);
    noise(oc, o, { dur: 0.9, type: 'highpass', f: [3000, 8000, 3000], env: [[0.003, 1], [0.9, 0]], seed: 507 });
    for (let i = 0; i < 14; i++) tone(oc, o, { t0: Math.random() * 0.4, dur: 0.2, f: [2000 + Math.random() * 4000, 1500], env: [[0.002, 0.15], [0.2, 0]] });
  }, { reverb: 0.45, tau: 0.6, drive: 1.5, level: 0.85 }],
  lance: [1.0, (oc, o) => { click(oc, o, 0, 1, 2000); tone(oc, o, { dur: 0.6, f: [2400, 300], type: 'sawtooth', env: [[0.003, 0.35], [0.6, 0]] }); noise(oc, o, { dur: 0.7, f: [6000, 900], Q: 1.5, env: [[0.003, 1], [0.7, 0]], seed: 509 }); thump(oc, o, 0, 140, 40, 0.3, 0.8); crackle(oc, o, 0.05, 0.6, 120, 0.4, 511); }, { reverb: 0.4, tau: 0.6, drive: 2.2, level: 0.9 }],
  blitz: [0.9, (oc, o) => { whoosh(oc, o, 0, 0.8, 600, 5000, 1, 513); noise(oc, o, { dur: 0.7, type: 'highpass', f: [5000, 3000], env: [[0.02, 0.4], [0.7, 0]], seed: 515 }); roar(oc, o, 0, 0.7, 0.6, 517, [300, 1800, 600]); }, { reverb: 0.2, tau: 0.3, drive: 1.6, level: 0.75 }],
  rumble: [4.0, (oc, o) => { noise(oc, o, { dur: 4.0, type: 'lowpass', f: [120, 200, 90, 160], env: [[0.5, 0.8], [3.5, 1], [4.0, 0]], seed: 477 }); tone(oc, o, { dur: 4.0, f: [38, 46], env: [[0.5, 0.5], [3.5, 0.7], [4.0, 0]] }); }, { level: 0.85 }],
});

async function buildAll() {
  await Promise.all(Object.entries(SFX).map(([name, [len, fn, opt]]) => render(len, fn, opt).then((b) => { buffers[name] = b; })));
  try {
    const res = await fetch(new URL('sounds/manifest.json', document.baseURI));
    if (res.ok) {
      const man = await res.json();
      await Promise.all(Object.entries(man).map(async ([name, file]) => {
        try { const r = await fetch(new URL(`sounds/${file}`, document.baseURI)); if (r.ok) buffers[name] = await ctx.decodeAudioData(await r.arrayBuffer()); } catch { /* keep synth */ }
      }));
    }
  } catch { /* no manifest */ }
}

const loops = new Map();
// Sorcerer (Limitless): glassy, clean, cold — and very heavy where it counts
Object.assign(SFX, {
  flick: [0.35, (oc, o) => { click(oc, o, 0, 0.5, 5000); tone(oc, o, { dur: 0.18, f: [2600, 1400], type: 'sine', env: [[0.002, 0.35], [0.18, 0]] }); whoosh(oc, o, 0, 0.2, 2500, 8000, 0.4, 601); }, { reverb: 0.15, tau: 0.25, level: 0.55 }],
  flickHit: [0.35, (oc, o) => { click(oc, o, 0, 0.8, 6000); tone(oc, o, { dur: 0.22, f: [3400, 2600], env: [[0.002, 0.25], [0.22, 0]] }); thump(oc, o, 0, 220, 120, 0.06, 0.4); }, { reverb: 0.2, tau: 0.3, level: 0.5 }],
  blueOn: [2.4, (oc, o) => {
    // space folding inward: a falling whoosh into a low, pulling hum
    noise(oc, o, { dur: 2.2, f: [6000, 300], Q: 3, env: [[0.05, 0.7], [1.9, 0.9], [2.2, 0]], seed: 603 });
    tone(oc, o, { dur: 2.2, f: [220, 55], type: 'sawtooth', env: [[0.08, 0.12], [1.9, 0.18], [2.2, 0]] });
    tone(oc, o, { dur: 2.2, f: [880, 440], env: [[0.05, 0.1], [2.2, 0]] });
    thump(oc, o, 0, 90, 40, 0.4, 0.6);
  }, { reverb: 0.55, tau: 0.8, level: 0.75 }],
  blueImplode: [1.4, (oc, o) => { thump(oc, o, 0, 70, 24, 0.7, 1); click(oc, o, 0, 1, 1500); noise(oc, o, { dur: 1.0, type: 'lowpass', f: [3000, 200], env: [[0.003, 0.9], [1.0, 0]], seed: 605 }); }, { reverb: 0.5, tau: 0.7, drive: 2, level: 0.9 }],
  redCharge: [0.5, (oc, o) => { tone(oc, o, { dur: 0.42, f: [300, 1600], type: 'sawtooth', env: [[0.02, 0.1], [0.4, 0.22], [0.42, 0]] }); noise(oc, o, { dur: 0.42, f: [400, 5000], Q: 3, env: [[0.02, 0.2], [0.4, 0.6], [0.42, 0]], seed: 607 }); }, { reverb: 0.25, tau: 0.3, drive: 1.6, level: 0.65 }],
  redFire: [0.6, (oc, o) => { click(oc, o, 0, 1, 2500); thump(oc, o, 0, 160, 60, 0.2, 0.9); whoosh(oc, o, 0, 0.45, 600, 6000, 0.9, 609); }, { reverb: 0.25, tau: 0.35, drive: 2.4, level: 0.85 }],
  redBoom: [2.0, (oc, o) => {
    click(oc, o, 0, 1, 1800); thump(oc, o, 0, 150, 30, 0.6, 1);
    noise(oc, o, { dur: 1.2, type: 'lowpass', f: [8000, 1200, 160], env: [[0.002, 1], [0.12, 0.6], [1.2, 0]], seed: 611 });
    whoosh(oc, o, 0.02, 0.8, 3000, 300, 0.7, 613); crackle(oc, o, 0.04, 1.0, 80, 0.4, 615);
  }, { reverb: 0.45, tau: 0.7, drive: 3, level: 1 }],
  purpleCharge: [1.5, (oc, o) => {
    // two tones (Blue low, Red high) drifting together and locking into one
    tone(oc, o, { dur: 1.4, f: [110, 164.8], type: 'sawtooth', env: [[0.1, 0.12], [1.2, 0.2], [1.4, 0]] });
    tone(oc, o, { dur: 1.4, f: [440, 329.6], type: 'sawtooth', env: [[0.1, 0.1], [1.2, 0.18], [1.4, 0]] });
    noise(oc, o, { dur: 1.4, f: [200, 3000], Q: 4, env: [[0.1, 0.2], [1.3, 0.7], [1.4, 0]], seed: 617 });
    crackle(oc, o, 0.8, 0.6, 120, 0.4, 619);
  }, { reverb: 0.6, tau: 0.9, drive: 1.6, level: 0.8 }],
  purpleFire: [3.2, (oc, o) => {
    click(oc, o, 0, 1, 1200); thump(oc, o, 0, 80, 20, 1.6, 1);
    noise(oc, o, { dur: 2.6, f: [300, 1200, 400], Q: 0.6, env: [[0.01, 1], [2.0, 0.7], [2.6, 0]], seed: 621 });
    noise(oc, o, { dur: 3.0, type: 'lowpass', f: [6000, 900, 120], env: [[0.004, 1], [1.2, 0.6], [3.0, 0]], seed: 623 });
    tone(oc, o, { dur: 2.4, f: [82.4, 61.7], type: 'sawtooth', env: [[0.02, 0.3], [2.0, 0.25], [2.4, 0]] });
    crackle(oc, o, 0, 2.6, 150, 0.6, 625);
  }, { reverb: 0.6, tau: 1.1, drive: 3.4, level: 1 }],
  domainCast: [1.2, (oc, o) => { [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(oc, o, { t0: i * 0.05, dur: 1.1, f: [f, f * 0.5], env: [[0.02, 0.18], [1.1, 0]] })); noise(oc, o, { dur: 1.1, f: [8000, 400], Q: 2, env: [[0.05, 0.3], [1.1, 0]], seed: 627 }); }, { reverb: 0.8, tau: 1.2, level: 0.7 }],
  domain: [5.0, (oc, o) => {
    // the world drops away: a sub-bass hit, a vast reverse swell, a cold shimmering chord
    thump(oc, o, 0, 60, 18, 2.2, 1); click(oc, o, 0, 1, 900);
    noise(oc, o, { dur: 4.5, type: 'lowpass', f: [200, 900, 120], env: [[0.02, 0.8], [3.5, 0.6], [4.5, 0]], seed: 629 });
    [130.8, 196, 261.6, 392, 523.3, 784].forEach((f, i) => tone(oc, o, { t0: 0.1 + i * 0.08, dur: 4.4 - i * 0.2, f: [f, f * 1.003], type: i < 2 ? 'sawtooth' : 'sine', env: [[0.4, 0.14 - i * 0.012], [3.6, 0.1], [4.4 - i * 0.2, 0]] }));
    noise(oc, o, { t0: 0.2, dur: 4.2, type: 'highpass', f: [6000, 9000], env: [[0.6, 0.15], [4.2, 0]], seed: 631 });
  }, { reverb: 0.9, tau: 2.2, drive: 1.8, level: 1 }],
});

export const Audio = {
  init() {
    if (ctx) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch { ctx = null; return; }
    master = ctx.createGain(); master.gain.value = volume;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 2; lim.ratio.value = 16; lim.attack.value = 0.002; lim.release.value = 0.15;
    master.connect(lim); lim.connect(ctx.destination);
    ambGain = ctx.createGain(); ambGain.gain.value = 0.18; ambGain.connect(master);
    this.ready = buildAll().then(() => this._ambience()).catch((e) => console.warn('audio synth failed', e));
  },
  resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  setVolume(v) { volume = v; if (master) master.gain.value = v; },
  play(name, gain = 1, pan = 0, rate = 1) {
    if (!ctx || !buffers[name] || gain < 0.01) return null;
    const src = ctx.createBufferSource(); src.buffer = buffers[name]; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain; src.connect(g);
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(master); } else g.connect(master);
    src.start();
    return { src, g };
  },
  // positional one-shot relative to the listener (camera) position/yaw
  at(name, pos, L, gain = 1, falloff = 30, rate = 1) {
    if (!L) { this.play(name, gain, 0, rate); return; }
    const dx = pos.x - L.x, dy = pos.y - L.y, dz = pos.z - L.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const g = gain / (1 + (d / falloff) ** 2 * 3);
    const right = Math.cos(L.yaw) * dx - Math.sin(L.yaw) * dz; // camera right vector · d
    const pan = d > 0.5 ? -right / d : 0;
    this.play(name, g, pan * 0.75, rate * (0.97 + Math.random() * 0.06));
  },
  // looping source with a controllable gain (fire walls, brazier)
  loop(id, name, gain) {
    if (!ctx || !buffers[name]) return;
    let l = loops.get(id);
    if (!l) {
      const src = ctx.createBufferSource(); src.buffer = buffers[name]; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(master); src.start();
      l = { src, g }; loops.set(id, l);
    }
    l.g.gain.setTargetAtTime(gain, ctx.currentTime, 0.08);
  },
  stopLoop(id) { const l = loops.get(id); if (!l) return; l.g.gain.setTargetAtTime(0, ctx.currentTime, 0.1); setTimeout(() => { try { l.src.stop(); } catch { /* ignore */ } }, 600); loops.delete(id); },
  _ambience() {
    if (!ctx) return;
    const src = ctx.createBufferSource(); src.buffer = buffers.wind; src.loop = true; src.connect(ambGain); src.start();
    const chirp = () => { if (Math.random() < 0.7) this.play('bird', 0.12 + Math.random() * 0.15, Math.random() * 1.6 - 0.8, 0.85 + Math.random() * 0.35); setTimeout(chirp, 2500 + Math.random() * 6000); };
    setTimeout(chirp, 2000);
  },
};
