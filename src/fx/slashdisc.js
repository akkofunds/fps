import * as THREE from 'three';
import { Fx } from './fire.js';

// Layered slash "discs", the anime-slash technique: a flat quad anchored at the cut, carrying a
// sharp jagged crescent texture, lives ~0.3 s, spins a little through its life and fades out (never
// pops). Several layers are stacked a hair apart along the plane normal: a bright core crescent, a
// coloured highlight, a ring of motion streaks, dark ink strokes and a soft additive glow, each
// with its own size / rotation / spin, randomised per slash so no two look alike.
// Textures are painted procedurally on canvases at first use (no image assets).

const R = Math.random;
const TEX = {};
const SZ = 256, C0 = SZ / 2;

function canvas() { const c = document.createElement('canvas'); c.width = c.height = SZ; return c; }
const P = (a, r) => [C0 + Math.cos(a) * r * C0, C0 - Math.sin(a) * r * C0]; // texture space: CCW, y up

// a crescent from angle 0 (tail) to `span` (head): thickest just behind the head, serrated outer
// edge, the inner edge feathered; brightest at the head, fading to nothing at the tail
function crescentTex(span, thick, jag, seed) {
  const c = canvas(), g = c.getContext('2d');
  const N = 140, outer = [], inner = [];
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i <= N; i++) {
    const u = i / N, a = u * span;
    const prof = Math.pow(u, 0.7) * Math.pow(1 - u, 0.35) * 1.9;              // tapered at both ends
    const spike = (i % 6 < 3 ? (i % 6) / 3 : (6 - (i % 6)) / 3) * jag * (0.4 + rnd() * 0.8) * prof;
    const ro = 0.93 + spike * 0.06;
    outer.push(P(a, ro));
    inner.push(P(a, ro - thick * prof));
  }
  // body
  g.beginPath(); g.moveTo(...outer[0]);
  for (const p of outer) g.lineTo(...p);
  for (let i = inner.length - 1; i >= 0; i--) g.lineTo(...inner[i]);
  g.closePath();
  const rg = g.createRadialGradient(C0, C0, C0 * (0.93 - thick * 1.1), C0, C0, C0 * 0.97);
  rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(0.55, 'rgba(255,255,255,0.55)'); rg.addColorStop(0.86, 'rgba(255,255,255,1)'); rg.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = rg; g.fill();
  // a hard bright edge line along the outside of the head half
  g.lineWidth = 2.2; g.strokeStyle = 'rgba(255,255,255,1)';
  g.beginPath(); for (let i = Math.floor(N * 0.35); i <= N; i++) { const p = outer[i]; if (i === Math.floor(N * 0.35)) g.moveTo(...p); else g.lineTo(...p); } g.stroke();
  fadeTail(g, span);
  return c;
}
// motion streaks: many thin concentric arcs of random length and brightness
function streakTex(span, seed) {
  const c = canvas(), g = c.getContext('2d');
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.lineCap = 'round';
  for (let k = 0; k < 46; k++) {
    const r = 0.5 + rnd() * 0.46, a1 = span * (0.25 + rnd() * 0.75), a0 = a1 - span * (0.15 + rnd() * 0.55);
    g.strokeStyle = `rgba(255,255,255,${0.25 + rnd() * 0.75})`;
    g.lineWidth = 0.8 + rnd() * 2.6;
    g.beginPath();
    for (let i = 0; i <= 24; i++) { const a = a0 + (a1 - a0) * (i / 24); const p = P(a, r); if (i) g.lineTo(...p); else g.moveTo(...p); }
    g.stroke();
  }
  fadeTail(g, span);
  return c;
}
// ink: a few thin, broken, jagged strokes (drawn dark with normal blending)
function inkTex(span, seed) {
  const c = canvas(), g = c.getContext('2d');
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.strokeStyle = '#fff'; g.lineCap = 'round';
  for (let k = 0; k < 7; k++) {
    const r = 0.72 + rnd() * 0.24, a0 = span * rnd() * 0.5, a1 = a0 + span * (0.25 + rnd() * 0.45);
    g.lineWidth = 1.2 + rnd() * 2.4;
    g.beginPath();
    for (let i = 0; i <= 30; i++) { const a = a0 + (a1 - a0) * (i / 30); const p = P(a, r + (i % 3 === 1 ? 0.012 : 0) * (rnd() > 0.5 ? 1 : -1)); if (i) g.lineTo(...p); else g.moveTo(...p); }
    g.stroke();
  }
  fadeTail(g, span);
  return c;
}
// fade every texture out toward its tail (angle 0) so the crescent reads as moving head-first
function fadeTail(g, span) {
  g.globalCompositeOperation = 'destination-in';
  if (g.createConicGradient) {
    // conic gradients start at +x and go clockwise in canvas space = our angle 0 going "backwards"
    const cg = g.createConicGradient(-span, C0, C0);
    cg.addColorStop(0, 'rgba(0,0,0,1)');
    cg.addColorStop(Math.min(0.99, span / (2 * Math.PI)) * 0.15, 'rgba(0,0,0,1)');
    cg.addColorStop(Math.min(0.99, span / (2 * Math.PI)), 'rgba(0,0,0,0)');
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cg; g.fillRect(0, 0, SZ, SZ);
  }
  g.globalCompositeOperation = 'source-over';
}
function tex(kind) {
  if (TEX[kind]) return TEX[kind];
  const c = { jag: () => crescentTex(3.9, 0.3, 1, 7), jag2: () => crescentTex(3.3, 0.18, 1.6, 31), thin: () => crescentTex(4.4, 0.09, 0.6, 77),
    streak: () => streakTex(4.2, 13), ink: () => inkTex(3.8, 5) }[kind]();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (TEX[kind] = t);
}

// colour palettes: core, highlight, ink, glow
export const SLASH_PAL = {
  steel: { core: [1.35, 1.38, 1.45], hi: [0.55, 0.95, 1.15], ink: [0.02, 0.025, 0.035], glow: [0.28, 0.34, 0.5] },
  fire: { core: [1.5, 1.12, 0.55], hi: [1.35, 0.42, 0.06], ink: [0.12, 0.02, 0.0], glow: [0.6, 0.18, 0.02] },
  ice: { core: [1.15, 1.32, 1.5], hi: [0.3, 0.78, 1.4], ink: [0.01, 0.04, 0.12], glow: [0.1, 0.3, 0.65] },
  cursed: { core: [1.15, 1.25, 1.55], hi: [0.5, 0.5, 1.45], ink: [0.02, 0.02, 0.1], glow: [0.18, 0.2, 0.7] },
  wind: { core: [1.35, 1.4, 1.45], hi: [0.85, 0.9, 1.0], ink: [0.03, 0.03, 0.04], glow: [0.25, 0.27, 0.32] },
  // the Kine Slayer: white steel edge, a sharp lime highlight, black ink (anime wind-blade look)
  lime: { core: [1.12, 1.42, 0.92], hi: [0.36, 1.6, 0.1], ink: [0.01, 0.03, 0.01], glow: [0.22, 0.75, 0.05] },
};

const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _s = new THREE.Vector3();

Object.assign(Fx.prototype, {
  _disc(L) {
    this.discPool = this.discPool || [];
    let q = this.discPool.find((x) => !x.visible);
    if (!q) {
      if (this.discPool.length >= 72) q = this.discPool.reduce((p, x) => (p.userData.t / p.userData.life > x.userData.t / x.userData.life ? p : x));
      else {
        q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: true }));
        q.matrixAutoUpdate = false; q.frustumCulled = false;
        this.scene.add(q); this.discPool.push(q);
        if (!this._discTick) {
          this._discTick = true;
          this.effects.push({ update: (dt) => { for (const x of this.discPool) if (x.visible) this._discStep(x, dt); return true; } });
        }
      }
    }
    q.material.map = tex(L.tex); q.material.color.setRGB(...L.color);
    q.material.blending = L.add ? THREE.AdditiveBlending : THREE.NormalBlending;
    q.material.needsUpdate = true;
    q.renderOrder = L.order || 4;
    q.userData = L; q.visible = true;
    this._discStep(q, 0);
  },
  _discStep(q, dt) {
    const L = q.userData;
    L.t += dt;
    const k = L.t / L.life;
    if (k >= 1) { q.visible = false; return; }
    // spin decelerates through the life; scale pops in then keeps growing a little
    const th = L.rot + L.spin * L.life * (1 - Math.pow(1 - k, 2)) * 0.5;
    const sc = L.size * (k < 0.12 ? 0.82 + 0.18 * (k / 0.12) : 1 + L.grow * (k - 0.12));
    const c = Math.cos(th), s = Math.sin(th);
    _a.copy(L.e1).multiplyScalar(c).addScaledVector(L.e2, s);
    _b.copy(L.e2).multiplyScalar(c).addScaledVector(L.e1, -s);
    _m.makeBasis(_a, _b, L.n).scale(_s.set(sc, sc, sc)).setPosition(L.c.x + L.n.x * L.z, L.c.y + L.n.y * L.z, L.c.z + L.n.z * L.z);
    q.matrix.copy(_m); q.matrixWorldNeedsUpdate = true;
    // fade in fast, hold, fade out over the back half (no abrupt cut)
    q.material.opacity = L.alpha * (k < 0.08 ? k / 0.08 : k < 0.45 ? 1 : 1 - Math.pow((k - 0.45) / 0.55, 1.4));
  },

  // one layered slash. c: anchor; from / to: the plane of the cut (the crescent starts along
  // `from` and sweeps toward `to`); size: diameter (m); pal: SLASH_PAL entry; o: { life, spin, delay, light }
  slashDisc(c, from, to, size, pal = SLASH_PAL.steel, o = {}) {
    if (o.delay) { const d = o.delay; o = { ...o, delay: 0 }; setTimeout(() => this.slashDisc(c, from, to, size, pal, o), d * 1000); return; }
    _e1.copy(from).normalize(); _e2.copy(to).addScaledVector(_e1, -_e1.dot(to)).normalize(); _n.crossVectors(_e1, _e2);
    const base = { c: c.clone(), e1: _e1.clone(), e2: _e2.clone(), n: _n.clone(), t: 0 };
    const life = (o.life || 0.3) * (0.9 + R() * 0.2), spin = (o.spin ?? 3.2) * (0.8 + R() * 0.4);
    const S = size * (0.9 + R() * 0.2), r0 = (R() - 0.5) * 0.35 - 0.35;   // starts a touch "behind" and spins into place
    const layers = [
      { tex: 'jag', color: pal.glow, add: true, size: S * 1.12, alpha: 0.55, z: -0.02, rot: r0, order: 3 },
      { tex: 'streak', color: pal.hi, size: S * 1.06, alpha: 0.85, z: -0.01, rot: r0 - 0.12 },
      { tex: 'jag', color: pal.core, size: S, alpha: 1, z: 0, rot: r0 },
      { tex: R() < 0.5 ? 'jag2' : 'thin', color: pal.hi, size: S * (0.82 + R() * 0.1), alpha: 0.95, z: 0.01, rot: r0 + 0.25 + R() * 0.2 },
      { tex: 'ink', color: pal.ink, size: S * 1.02, alpha: o.ink ?? 0.85, z: 0.02, rot: r0 + 0.05, order: 5 },
    ];
    for (const L of layers) this._disc({ ...base, ...L, life: life * (0.9 + R() * 0.2), spin: spin * (0.85 + R() * 0.3), grow: 0.25 + R() * 0.15 });
    if (o.light) this.light(c, o.light, size * 3, 0.1, new THREE.Color(...pal.hi).getHex());
    // shards of the highlight colour flung off the head of the cut
    if (o.shards) {
      const p = c.clone().addScaledVector(base.e1, Math.cos(2.6) * size * 0.45).addScaledVector(base.e2, Math.sin(2.6) * size * 0.45);
      for (let k = 0; k < o.shards; k++) {
        const v = base.e2.clone().multiplyScalar(-4 - R() * 5).addScaledVector(base.e1, -2 - R() * 3).add(new THREE.Vector3((R() - 0.5) * 3, 1 + R() * 3, (R() - 0.5) * 3));
        this.fire.emit(p.x + (R() - 0.5) * 0.4, p.y + (R() - 0.5) * 0.4, p.z + (R() - 0.5) * 0.4, v.x, v.y, v.z, 0.35 + R() * 0.3, 0.07 + R() * 0.05, 0.03, [pal.hi[0] * 1.3, pal.hi[1] * 1.3, pal.hi[2] * 1.3, 1], [pal.hi[0] * 0.5, pal.hi[1] * 0.5, pal.hi[2] * 0.5, 0], 1.5, -7);
      }
    }
  },

  // the grey wind that lingers on the ground after a big cut: flat streak + ink swirls turning slowly
  windSwirl(c, size, o = {}) {
    const n = new THREE.Vector3(0, 1, 0), a = R() * 6.283;
    const e1 = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), e2 = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const base = { c: new THREE.Vector3(c.x, c.y + 0.08, c.z), e1, e2: o.cw ? e2.negate() : e2, n, t: 0 };
    void n;
    base.n = new THREE.Vector3().crossVectors(base.e1, base.e2);
    const life = o.life || 0.8;
    for (const L of [
      { tex: 'streak', color: [0.62, 0.64, 0.68], size: size, alpha: 0.75, z: 0.0, rot: 0 },
      { tex: 'streak', color: [0.75, 0.77, 0.8], size: size * 0.72, alpha: 0.6, z: 0.01, rot: 1.9 },
      { tex: 'ink', color: [0.05, 0.05, 0.06], size: size * 0.9, alpha: 0.55, z: 0.02, rot: 3.6 },
    ]) this._disc({ ...base, ...L, life: life * (0.85 + R() * 0.3), spin: 2.4 + R(), grow: 0.35, order: 2, delay: 0 });
  },
});
