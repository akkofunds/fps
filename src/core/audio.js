// Procedural WebAudio: every sound is synthesized once into an AudioBuffer at startup,
// then played through cheap BufferSource → Gain → StereoPanner chains (no asset downloads).
let ctx = null;
let master = null;
const buffers = {};
let volume = 0.7;

function noise(len) { const a = new Float32Array(len); for (let i = 0; i < len; i++) a[i] = Math.random() * 2 - 1; return a; }

function makeBuffer(seconds, fn) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  fn(d, sr, len);
  return buf;
}

// one-pole low-pass in place
function lp(d, cutoff, sr) { const a = Math.exp(-2 * Math.PI * cutoff / sr); let y = 0; for (let i = 0; i < d.length; i++) { y = (1 - a) * d[i] + a * y; d[i] = y; } }

function gunshot(seconds, body, crack, decay, cutoff) {
  return makeBuffer(seconds, (d, sr, len) => {
    const n = noise(len);
    lp(n, cutoff, sr);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t * decay);
      const thump = Math.sin(2 * Math.PI * body * t * (1 - t * 2)) * Math.exp(-t * 30);
      const c = i < sr * 0.004 ? (Math.random() * 2 - 1) * crack : 0;
      d[i] = (n[i] * 1.6 * env + thump * 0.9 + c) * 0.8;
    }
  });
}

function tone(seconds, f0, f1, decay, type = 'sine') {
  return makeBuffer(seconds, (d, sr, len) => {
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const f = f0 + (f1 - f0) * (t / seconds);
      ph += 2 * Math.PI * f / sr;
      const s = type === 'square' ? Math.sign(Math.sin(ph)) * 0.5 : Math.sin(ph);
      d[i] = s * Math.exp(-t * decay) * 0.6;
    }
  });
}

function click(seconds, cutoff) {
  return makeBuffer(seconds, (d, sr, len) => {
    const n = noise(len); lp(n, cutoff, sr);
    for (let i = 0; i < len; i++) d[i] = n[i] * Math.exp(-(i / sr) * 90) * 1.5;
  });
}

export const Audio = {
  init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    } catch { ctx = null; return; }
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    buffers.ak = gunshot(0.32, 110, 0.9, 16, 3200);
    buffers.glock = gunshot(0.2, 180, 0.7, 26, 4200);
    buffers.sniper = gunshot(0.9, 70, 1.0, 6, 2200);
    buffers.hit = tone(0.08, 1500, 1300, 50);
    buffers.head = makeBuffer(0.35, (d, sr, len) => {
      for (let i = 0; i < len; i++) { const t = i / sr; d[i] = (Math.sin(2 * Math.PI * 2600 * t) * 0.5 + Math.sin(2 * Math.PI * 3900 * t) * 0.3) * Math.exp(-t * 14) * 0.7; }
    });
    buffers.kill = tone(0.25, 700, 1400, 9, 'square');
    buffers.step = click(0.08, 600);
    buffers.reload = click(0.05, 5000);
    buffers.bolt = click(0.09, 2500);
    buffers.empty = click(0.03, 7000);
    buffers.ui = tone(0.06, 900, 1100, 40);
    buffers.found = tone(0.5, 440, 880, 4);
    buffers.land = click(0.1, 300);
    buffers.wood = click(0.12, 1200);
  },
  resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  setVolume(v) { volume = v; if (master) master.gain.value = v; },
  // pan: -1..1, gain: 0..1, rate: playback rate (pitch variety)
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
  // positional helper: listener position/yaw → gain/pan
  play3D(name, x, y, z, lx, ly, lz, lyaw, baseGain = 1, falloff = 40, rate = 1) {
    const dx = x - lx, dz = z - lz, dy = y - ly;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const gain = baseGain / (1 + (dist / falloff) * (dist / falloff) * 4);
    // listener right vector = (cos yaw, 0, -sin yaw)
    const pan = dist > 0.5 ? (dx * Math.cos(lyaw) - dz * Math.sin(lyaw)) / dist : 0;
    this.play(name, gain, pan * 0.8, rate);
  },
};
