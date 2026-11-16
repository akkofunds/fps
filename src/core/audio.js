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
