// Gun + game audio. Every sound is synthesized once at startup with an OfflineAudioContext
// (real biquad filters, saturation, compression and a generated convolution reverb), then played
// through cheap BufferSource → Gain → StereoPanner chains. No downloads needed.
//
// Real recordings can replace any sound: list them in public/sounds/manifest.json, e.g.
//   { "ak": "ak.mp3", "ak_far": "ak_far.mp3", "glock": "glock.ogg", "sniper": "sniper.wav" }
let ctx = null;
let master = null;
const buffers = {};
let volume = 0.7;
const SR = 44100;

// ---------------------------------------------------------------- DSP building blocks
function noiseBuf(oc, sec, seed = 1) {
  const b = oc.createBuffer(1, Math.max(1, Math.ceil(sec * SR)), SR);
  const d = b.getChannelData(0);
  let s = seed * 9301 + 49297;
  for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; }
  return b;
}
function env(oc, t0, peak, tau, attack = 0.0006) {
  const g = oc.createGain();
  g.gain.setValueAtTime(0, 0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.setTargetAtTime(0, t0 + attack, tau);
  return g;
}
function filt(oc, type, f, Q = 0.7) { const b = oc.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; return b; }
function noiseLayer(oc, out, t0, dur, filters, peak, tau, attack, seed) {
  const src = oc.createBufferSource(); src.buffer = noiseBuf(oc, dur, seed);
  let node = src;
  for (const f of filters) { node.connect(f); node = f; }
  const g = env(oc, t0, peak, tau, attack); node.connect(g); g.connect(out);
  src.start(t0);
}
function shaper(oc, drive) {
  const ws = oc.createWaveShaper(); const n = 2048; const c = new Float32Array(n);
  const k = Math.tanh(drive);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / k; }
  ws.curve = c; ws.oversample = '2x';
  return ws;
}
// stereo outdoor reverb: decaying noise that darkens over time + discrete echo taps
function impulse(oc, sec, tau, taps, seed) {
  const len = Math.ceil(sec * SR);
  const b = oc.createBuffer(2, len, SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let s = (seed + ch * 77) * 7919;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const n = (s / 0x3fffffff) - 1;
      const a = Math.min(0.93, 0.22 + t * 1.3); // one-pole coefficient: bright early, darker with time
      lp = lp + (1 - a) * (n - lp);
      d[i] = lp * Math.exp(-t / tau) * (t < 0.008 ? t / 0.008 : 1);
    }
    for (const [tt, g] of taps) {
      const i0 = Math.floor((tt + (ch ? 0.006 : 0)) * SR);
      for (let k = 0; k < 900 && i0 + k < len; k++) d[i0 + k] += g * Math.exp(-k / 140) * ((k * 7919 % 13) / 6.5 - 1) * 0.6;
    }
  }
  return b;
}

async function renderGun(p) {
  const oc = new OfflineAudioContext(2, Math.ceil(p.len * SR), SR);
  const dry = oc.createGain();
  const sat = shaper(oc, p.drive);
  const tone = filt(oc, 'lowpass', p.far ? 1100 : 11000, 0.5);
  const lowcut = filt(oc, 'highpass', 38, 0.7);
  const presence = filt(oc, 'peaking', p.presence || 1600, 0.9); presence.gain.value = p.far ? 0 : 4;
  dry.connect(sat); sat.connect(lowcut); lowcut.connect(presence); presence.connect(tone);
  const dryOut = oc.createGain(); dryOut.gain.value = p.far ? 0.35 : 1; tone.connect(dryOut); dryOut.connect(oc.destination);
  // reverb send (taken before saturation so the tail stays clean)
  const conv = oc.createConvolver(); conv.normalize = true; conv.buffer = impulse(oc, p.tail.sec, p.tail.tau, p.tail.taps, p.seed);
  const wetLp = filt(oc, 'lowpass', p.far ? 900 : p.tail.lp, 0.6);
  const wet = oc.createGain(); wet.gain.value = p.tail.wet * (p.far ? 1.8 : 1);
  dry.connect(conv); conv.connect(wetLp); wetLp.connect(wet); wet.connect(oc.destination);
  const t0 = p.far ? 0.02 : 0.002;
  // 1) low-end boom: sine with a fast downward pitch sweep
  const osc = oc.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(p.boom[0], t0); osc.frequency.exponentialRampToValueAtTime(p.boom[1], t0 + p.boom[2]);
  const og = env(oc, t0, p.boom[4], p.boom[3], 0.001); osc.connect(og); og.connect(dry); osc.start(t0); osc.stop(p.len);
  // 2) muzzle blast (band-passed noise) and 3) body (low-passed noise)
  noiseLayer(oc, dry, t0, 0.6, [filt(oc, 'bandpass', p.blast[0], p.blast[1])], p.blast[3], p.blast[2], 0.0004, p.seed + 1);
  noiseLayer(oc, dry, t0, 0.9, [filt(oc, 'lowpass', p.body[0], 0.8)], p.body[2], p.body[1], 0.001, p.seed + 2);
  // 0) initial blast transient (broadband, ~1 ms) — this is what makes it read as a gunshot
  noiseLayer(oc, dry, t0, 0.03, [filt(oc, 'highpass', 140, 0.6)], p.snap || 2.2, 0.0012, 0.00015, p.seed + 5);
  // 4) supersonic crack / first transient
  if (!p.far) noiseLayer(oc, dry, t0, 0.05, [filt(oc, 'highpass', p.crack[0], 0.7)], p.crack[2], p.crack[1], 0.0002, p.seed + 3);
  // 5) mechanical action (metallic resonances)
  if (!p.far) for (const [i, m] of (p.mech || []).entries()) {
    noiseLayer(oc, dry, t0 + m.t, 0.15, [filt(oc, 'bandpass', m.f, m.Q), filt(oc, 'peaking', m.f * 1.9, 4)], m.g, m.tau, 0.0003, p.seed + 10 + i);
  }
  const buf = await oc.startRendering();
  // normalize
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
  const k = (p.level || 0.95) / Math.max(1e-4, peak);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  return buf;
}

const GUNS = {
  // boom: [f0, f1, sweep s, tau s, gain]  blast: [bp Hz, Q, tau, gain]  body: [lp Hz, tau, gain]  crack: [hp Hz, tau, gain]
  ak: {
    len: 1.3, seed: 11, drive: 2.6, level: 0.95, snap: 2.4, presence: 1500,
    boom: [210, 55, 0.05, 0.026, 0.75], blast: [1150, 0.9, 0.016, 1.5], body: [650, 0.034, 0.9], crack: [2800, 0.0025, 0.9],
    mech: [{ t: 0.03, f: 2500, Q: 11, tau: 0.01, g: 0.28 }, { t: 0.052, f: 3700, Q: 14, tau: 0.008, g: 0.2 }],
    tail: { sec: 1.2, tau: 0.22, lp: 2600, wet: 0.24, taps: [[0.07, 0.45], [0.13, 0.3], [0.22, 0.2]] },
  },
  glock: { // suppressed 9mm (the model has a can): short thump + crack + loud slide clack
    len: 0.7, seed: 23, drive: 2.2, level: 0.82, snap: 1.4, presence: 1800,
    boom: [190, 80, 0.03, 0.016, 0.55], blast: [1500, 1.1, 0.012, 1.1], body: [900, 0.02, 0.55], crack: [3800, 0.0014, 0.5],
    mech: [{ t: 0.009, f: 3100, Q: 9, tau: 0.013, g: 0.55 }, { t: 0.04, f: 2300, Q: 10, tau: 0.018, g: 0.45 }, { t: 0.046, f: 5200, Q: 16, tau: 0.007, g: 0.28 }],
    tail: { sec: 0.5, tau: 0.09, lp: 2800, wet: 0.14, taps: [[0.06, 0.35], [0.12, 0.2]] },
  },
  sniper: {
    len: 2.4, seed: 37, drive: 3.4, level: 1.0, snap: 2.8, presence: 1200,
    boom: [150, 38, 0.09, 0.045, 0.95], blast: [850, 0.8, 0.028, 1.6], body: [420, 0.06, 1.1], crack: [2300, 0.0035, 1.2],
    mech: [],
    tail: { sec: 2.2, tau: 0.45, lp: 1900, wet: 0.36, taps: [[0.12, 0.5], [0.26, 0.36], [0.43, 0.25], [0.7, 0.16]] },
  },
};

// short one-shot effects (mag clicks, bolt, steps…)
async function renderFx(len, build) {
  const oc = new OfflineAudioContext(1, Math.ceil(len * SR), SR);
  const out = oc.createGain(); out.connect(oc.destination);
  build(oc, out);
  const buf = await oc.startRendering();
  const d = buf.getChannelData(0); let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const k = 0.9 / Math.max(1e-4, peak); for (let i = 0; i < d.length; i++) d[i] *= k;
  return buf;
}
const metal = (oc, out, t, f, g, tau, seed) => noiseLayer(oc, out, t, 0.2, [filt(oc, 'bandpass', f, 12), filt(oc, 'peaking', f * 2.3, 5)], g, tau, 0.0003, seed);
function toneLayer(oc, out, t, f0, f1, g, tau, type = 'sine') {
  const o = oc.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + tau * 4);
  const e = env(oc, t, g, tau, 0.001); o.connect(e); e.connect(out); o.start(t); o.stop(t + tau * 8);
}
const FX = {
  reload: [0.25, (oc, o) => { metal(oc, o, 0.002, 2700, 1, 0.018, 3); noiseLayer(oc, o, 0.002, 0.2, [filt(oc, 'lowpass', 600)], 0.6, 0.03, 0.001, 4); }],
  bolt: [0.3, (oc, o) => { metal(oc, o, 0.002, 1900, 0.8, 0.02, 5); noiseLayer(oc, o, 0.01, 0.2, [filt(oc, 'bandpass', 3200, 2)], 0.35, 0.05, 0.01, 6); metal(oc, o, 0.06, 3400, 0.9, 0.012, 7); }],
  empty: [0.12, (oc, o) => { metal(oc, o, 0.002, 4300, 1, 0.008, 8); }],
  step: [0.18, (oc, o) => { noiseLayer(oc, o, 0.002, 0.2, [filt(oc, 'lowpass', 260)], 1, 0.035, 0.003, 9); noiseLayer(oc, o, 0.004, 0.1, [filt(oc, 'bandpass', 2400, 1.2)], 0.25, 0.015, 0.001, 10); }],
  land: [0.25, (oc, o) => { noiseLayer(oc, o, 0.002, 0.3, [filt(oc, 'lowpass', 200)], 1, 0.06, 0.003, 11); }],
  wood: [0.3, (oc, o) => { noiseLayer(oc, o, 0.002, 0.3, [filt(oc, 'bandpass', 650, 3)], 1, 0.05, 0.001, 12); toneLayer(oc, o, 0.002, 320, 260, 0.4, 0.04); }],
  hit: [0.12, (oc, o) => { toneLayer(oc, o, 0, 1500, 1300, 0.6, 0.02); noiseLayer(oc, o, 0, 0.05, [filt(oc, 'highpass', 3000)], 0.3, 0.006, 0.0005, 13); }],
  head: [0.45, (oc, o) => { toneLayer(oc, o, 0, 2600, 2550, 0.6, 0.08); toneLayer(oc, o, 0, 3900, 3880, 0.35, 0.06); toneLayer(oc, o, 0, 5300, 5300, 0.15, 0.04); }],
  kill: [0.35, (oc, o) => { toneLayer(oc, o, 0, 700, 690, 0.5, 0.05, 'square'); toneLayer(oc, o, 0.07, 1050, 1040, 0.5, 0.07, 'square'); }],
  ui: [0.08, (oc, o) => { toneLayer(oc, o, 0, 950, 1100, 0.5, 0.012); }],
  found: [0.7, (oc, o) => { toneLayer(oc, o, 0, 440, 445, 0.5, 0.12); toneLayer(oc, o, 0.12, 660, 665, 0.5, 0.15); toneLayer(oc, o, 0.24, 880, 885, 0.5, 0.2); }],
};

async function buildAll() {
  const jobs = [];
  for (const [id, p] of Object.entries(GUNS)) {
    jobs.push(renderGun(p).then((b) => { buffers[id] = b; }));
    jobs.push(renderGun({ ...p, far: true, len: p.len + 0.4, level: 0.9 }).then((b) => { buffers[id + '_far'] = b; }));
  }
  for (const [name, [len, fn]] of Object.entries(FX)) jobs.push(renderFx(len, fn).then((b) => { buffers[name] = b; }));
  await Promise.all(jobs);
  // optional real recordings override the synthesized versions
  try {
    const res = await fetch(new URL('sounds/manifest.json', document.baseURI));
    if (res.ok) {
      const man = await res.json();
      await Promise.all(Object.entries(man).map(async ([name, file]) => {
        try {
          const r = await fetch(new URL(`sounds/${file}`, document.baseURI));
          if (r.ok) buffers[name] = await ctx.decodeAudioData(await r.arrayBuffer());
        } catch { /* keep synth */ }
      }));
    }
  } catch { /* no manifest */ }
}

export const Audio = {
  _buffers: buffers,
  init() {
    if (ctx) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); } catch { ctx = null; return; }
    master = ctx.createGain();
    master.gain.value = volume;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.1;
    master.connect(limiter); limiter.connect(ctx.destination);
    this.ready = buildAll().catch((e) => console.warn('audio synth failed', e));
  },
  resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  setVolume(v) { volume = v; if (master) master.gain.value = v; },
  // pan: -1..1, gain: 0..1, rate: playback rate
  play(name, gain = 1, pan = 0, rate = 1) {
    if (!ctx || !buffers[name] || gain < 0.01) return;
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); p.connect(master);
    } else g.connect(master);
    src.start();
  },
  play3D(name, x, y, z, lx, ly, lz, lyaw, baseGain = 1, falloff = 40, rate = 1) {
    const dx = x - lx, dz = z - lz, dy = y - ly;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const gain = baseGain / (1 + (dist / falloff) * (dist / falloff) * 4);
    const pan = dist > 0.5 ? (dx * Math.cos(lyaw) - dz * Math.sin(lyaw)) / dist : 0;
    this.play(name, gain, pan * 0.8, rate);
  },
  // your own shot: full-bandwidth near sound with a little pitch variety
  gunLocal(id) { this.play(id, id === 'glock' ? 0.8 : 0.95, 0, 0.97 + Math.random() * 0.06); },
  // someone else's shot: crossfade near → muffled far version with distance
  gun3D(id, x, y, z, lx, ly, lz, lyaw) {
    const dx = x - lx, dz = z - lz, dy = y - ly;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const reach = id === 'sniper' ? 1.8 : id === 'glock' ? 0.6 : 1;
    const d = dist / reach;
    const near = 1 / (1 + (d / 14) * (d / 14));
    const far = Math.min(1, d / 18) * 0.85 / (1 + (d / 120) * (d / 120));
    const pan = dist > 0.5 ? ((dx * Math.cos(lyaw) - dz * Math.sin(lyaw)) / dist) * 0.8 : 0;
    const rate = 0.96 + Math.random() * 0.08;
    if (near > 0.03) this.play(id, near * 0.9, pan, rate);
    if (far > 0.03) this.play(id + '_far', far, pan * 0.6, rate);
  },
};
