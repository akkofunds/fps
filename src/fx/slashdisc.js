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

// Clean geometry only: smooth round edges, smooth tapers, continuous lines (no jitter, no zig-zags).
// The crescent runs from angle 0 (tail) to `span` (head); every texture fades out toward the tail.
const smooth = (u) => u * u * (3 - 2 * u);
// thickness along the crescent: grows smoothly from a fine point at the tail, fullest just behind
// the head, then rounds off to a point at the head
const prof = (u) => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 0.85);

function bladeTex(span, thick, rim) {
  const c = canvas(), g = c.getContext('2d');
  const N = 220, ro = 0.94, outer = [], inner = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, a = u * span;
    outer.push(P(a, ro));
    inner.push(P(a, ro - thick * prof(u)));
  }
  g.beginPath(); g.moveTo(...outer[0]);
  for (const p of outer) g.lineTo(...p);
  for (let i = inner.length - 1; i >= 0; i--) g.lineTo(...inner[i]);
  g.closePath();
  // solid toward the outer edge, softly feathered toward the inside
  const rg = g.createRadialGradient(C0, C0, C0 * (ro - thick), C0, C0, C0 * ro);
  rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(0.45, 'rgba(255,255,255,0.5)'); rg.addColorStop(0.82, 'rgba(255,255,255,0.95)'); rg.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = rg; g.fill();
  // a crisp, continuous bright rim along the outside
  if (rim) {
    g.lineWidth = rim; g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,1)';
    g.beginPath(); g.arc(C0, C0, C0 * ro, -span, -span * 0.12, false); g.stroke();
  }
  fadeTail(g, span);
  return c;
}
// smooth concentric trail lines (like motion blur behind the edge): continuous arcs of a few
// lengths and weights, evenly spread
function trailTex(span) {
  const c = canvas(), g = c.getContext('2d');
  g.lineCap = 'round';
  const L = [[0.9, 0.9, 3.2, 0.95], [0.84, 0.75, 2.2, 0.8], [0.78, 0.6, 1.6, 0.65], [0.71, 0.82, 1.2, 0.5], [0.64, 0.5, 1.0, 0.4], [0.57, 0.68, 0.8, 0.3]];
  for (const [r, len, w, al] of L) {
    g.strokeStyle = `rgba(255,255,255,${al})`; g.lineWidth = w;
    g.beginPath(); g.arc(C0, C0, C0 * r, -span, -span * (1 - len), false); g.stroke();
  }
  fadeTail(g, span);
  return c;
}
// fade every texture out toward its tail (angle 0) so the crescent reads as moving head-first
function fadeTail(g, span) {
  g.globalCompositeOperation = 'destination-in';
  if (g.createConicGradient) {
    // canvas angles run clockwise; our crescent runs counter-clockwise from 0 to `span`
    const cg = g.createConicGradient(-span, C0, C0);
    const f = Math.min(0.999, span / (2 * Math.PI));
    cg.addColorStop(0, 'rgba(0,0,0,1)'); cg.addColorStop(f * 0.25, 'rgba(0,0,0,1)'); cg.addColorStop(f, 'rgba(0,0,0,0)'); cg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cg; g.fillRect(0, 0, SZ, SZ);
  }
  g.globalCompositeOperation = 'source-over';
}
void smooth;
export function slashTex(kind) { return tex(kind); }
function tex(kind) {
  if (TEX[kind]) return TEX[kind];
  const c = { blade: () => bladeTex(3.6, 0.26, 3), thin: () => bladeTex(3.9, 0.07, 2), shade: () => bladeTex(3.4, 0.34, 0), trail: () => trailTex(3.8) }[kind]();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
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
  // the same slash in red: a vivid red blade, a hot pink-white rim and trails, deep red shade
  crimson: { core: [1.55, 0.16, 0.1], hi: [1.75, 0.72, 0.62], ink: [0.12, 0.0, 0.0], glow: [0.95, 0.06, 0.03] },
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
    const life = (o.life || 0.3) * (0.95 + R() * 0.1), spin = (o.spin ?? 3.2) * (0.9 + R() * 0.2);
    const S = size * (0.93 + R() * 0.14), r0 = (R() - 0.5) * 0.16 - 0.3;   // starts a touch "behind" and spins into place
    // back to front: soft glow, dark shade for depth, trail lines, the blade, a fine bright edge
    const layers = [
      { tex: 'blade', color: pal.glow, add: true, size: S * 1.1, alpha: 0.5, z: -0.02, rot: r0 - 0.04, order: 3 },
      { tex: 'shade', color: pal.ink, size: S * 1.03, alpha: (o.ink ?? 0.6) * 0.75, z: -0.015, rot: r0 - 0.1 },
      { tex: 'trail', color: pal.hi, size: S * 0.96, alpha: 0.85, z: -0.005, rot: r0 - 0.06 },
      { tex: 'blade', color: pal.core, size: S, alpha: 1, z: 0, rot: r0 },
      { tex: 'thin', color: pal.hi, size: S * 1.04, alpha: 0.95, z: 0.01, rot: r0 + 0.04, order: 5 },
    ];
    for (const L of layers) this._disc({ ...base, ...L, life, spin, grow: 0.22 });
    if (o.light) this.light(c, o.light, size * 3, 0.1, new THREE.Color(...pal.hi).getHex());
    // shards of the highlight colour flung off the head of the cut
    if (o.shards) {
      const p = c.clone().addScaledVector(base.e1, Math.cos(2.6) * size * 0.45).addScaledVector(base.e2, Math.sin(2.6) * size * 0.45);
      for (let k = 0; k < Math.ceil(o.shards * 0.5); k++) {
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
      { tex: 'trail', color: [0.7, 0.72, 0.76], size: size, alpha: 0.7, z: 0.0, rot: 0 },
      { tex: 'trail', color: [0.82, 0.84, 0.88], size: size * 0.7, alpha: 0.55, z: 0.01, rot: 2.1 },
    ]) this._disc({ ...base, ...L, life: life * (0.85 + R() * 0.3), spin: 2.4 + R(), grow: 0.35, order: 2, delay: 0 });
  },
});
