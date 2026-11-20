import * as THREE from 'three';
import { Fx } from './fire.js';

// Kine Slayer VFX: no cursed energy, so nothing glows with power. Everything here is steel, air and
// impact: blade trails that follow the spear's edge, thin anime slash lines, wind streaks behind a
// body moving too fast, dust and broken ground, and the Inverted Spear's "null" shatter.

const R = Math.random;
const STEEL = [3.0, 3.1, 3.3, 1], STEEL_E = [0.9, 1.0, 1.25, 0];
const EDGE = [3.6, 3.6, 3.8, 1], EDGE_E = [1.4, 1.5, 1.9, 0];
const WIND = [1.4, 1.5, 1.6, 0.55], WIND_E = [0.8, 0.85, 0.95, 0];
const DUST0 = [0.46, 0.42, 0.36, 0.6], DUST1 = [0.55, 0.52, 0.46, 0];
const NULL0 = [0.25, 0.3, 0.5, 0.9], NULL1 = [0.03, 0.03, 0.08, 0];

// a tapered streak texture (bright core, soft edges, pointed ends)
let STREAK = null;
function streakTex() {
  if (STREAK) return STREAK;
  const c = document.createElement('canvas'); c.width = 128; c.height = 16;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 16);
  for (let x = 0; x < 128; x++) for (let y = 0; y < 16; y++) {
    const u = x / 127, v = Math.abs(y / 15 - 0.5) * 2;
    const taper = Math.pow(Math.sin(Math.PI * u), 0.7);       // pointed at both ends
    const w = Math.max(0, 1 - v / Math.max(0.05, taper));       // thinner toward the ends
    const a = Math.pow(w, 1.6) * taper;
    const i = (y * 128 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  STREAK = new THREE.CanvasTexture(c);
  return STREAK;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Vector3(), _q = new THREE.Quaternion(), _x = new THREE.Vector3(1, 0, 0);

Object.assign(Fx.prototype, {
  // ---------------------------------------------------------------- slash lines (pooled)
  // a thin bright line from a to b that snaps open to full length and then thins out: the classic
  // anime "the cut already happened" streak. Two crossed quads so it reads from any angle.
  slashLine(a, b, width = 0.12, life = 0.3, color = null) {
    this.slashPool = this.slashPool || [];
    let s = this.slashPool.find((x) => !x.visible);
    if (!s) {
      if (this.slashPool.length >= 24) s = this.slashPool.reduce((p, q) => (p.userData.t / p.userData.life > q.userData.t / q.userData.life ? p : q));
      else {
        const geo = new THREE.PlaneGeometry(1, 1);
        // normal blending: additive white over sunlit grass turns yellow-green; this stays clean white
        const mat = new THREE.MeshBasicMaterial({ map: streakTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
        s = new THREE.Group();
        const q1 = new THREE.Mesh(geo, mat), q2 = new THREE.Mesh(geo, mat);
        q2.rotation.x = Math.PI / 2;
        s.add(q1, q2); s.userData.mat = mat;
        s.frustumCulled = false;
        this.scene.add(s); this.slashPool.push(s);
      }
    }
    _a.copy(a); _b.copy(b);
    const len = _a.distanceTo(_b);
    s.position.copy(_a).lerp(_b, 0.5);
    _m.copy(_b).sub(_a).normalize();
    s.quaternion.setFromUnitVectors(_x, _m);
    s.userData.len = len; s.userData.w = width; s.userData.t = 0; s.userData.life = life;
    s.userData.mat.color.setRGB(...(color || [2.2, 2.2, 2.4]));
    s.scale.set(0.01, width, width);
    s.visible = true;
    if (!this._slashTick) {
      this._slashTick = true;
      this.effects.push({ update: (dt) => {
        for (const x of this.slashPool) {
          if (!x.visible) continue;
          const u = (x.userData.t += dt) / x.userData.life;
          if (u >= 1) { x.visible = false; continue; }
          // opens in the first 12% of its life, then the width collapses
          const open = Math.min(1, u / 0.12);
          const w = x.userData.w * (u < 0.12 ? 1.3 : Math.pow(1 - (u - 0.12) / 0.88, 1.4));
          x.scale.set(x.userData.len * (0.15 + 0.85 * (1 - Math.pow(1 - open, 3))), Math.max(0.002, w), Math.max(0.002, w));
          x.userData.mat.opacity = 1;
        }
        return true;
      } });
    }
    return s;
  },

  // ---------------------------------------------------------------- M1: blade trail along the spear
  // getSeg(k, out): a point along the spear (0 = butt, 1 = tip)
  slashSwing(getSeg, dir, i) {
    const fin = i === 3, dur = fin ? 0.26 : 0.2;
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), la = new THREE.Vector3(), lb = new THREE.Vector3();
    let t = 0, first = true;
    this.effects.push({ update: (dt) => {
      t += dt;
      getSeg(0.35, pa); getSeg(1.08, pb);
      if (first) { la.copy(pa); lb.copy(pb); first = false; }
      // a sheet of particles between last frame's blade and this frame's: a smear of the edge
      const n = fin ? 10 : 8;
      for (let k = 0; k < n; k++) {
        const u = R(), w = R();
        const x = (la.x + (lb.x - la.x) * u) * (1 - w) + (pa.x + (pb.x - pa.x) * u) * w;
        const y = (la.y + (lb.y - la.y) * u) * (1 - w) + (pa.y + (pb.y - pa.y) * u) * w;
        const z = (la.z + (lb.z - la.z) * u) * (1 - w) + (pa.z + (pb.z - pa.z) * u) * w;
        const edge = u > 0.75;
        this.fire.emit(x, y, z, (R() - 0.5) * 0.3, (R() - 0.5) * 0.3, (R() - 0.5) * 0.3, edge ? 0.14 : 0.1, edge ? 0.07 : 0.05, 0.01, edge ? EDGE : STEEL, edge ? EDGE_E : STEEL_E, 4, 0);
      }
      la.copy(pa); lb.copy(pb);
      return t < dur;
    } });
    // the slash line along the arc of the cut, just as it lands
    setTimeout(() => {
      getSeg(1.05, pb);
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const tilt = [0.55, -0.45, -0.9, 0][i];
      const half = fin ? 0 : 0.95;
      if (fin) {
        // the thrust: a straight streak along the spear's line
        this.slashLine(pb.clone().addScaledVector(dir, -0.8), pb.clone().addScaledVector(dir, 1.6), 0.16, 0.24);
      } else {
        const a = pb.clone().addScaledVector(side, -half).add(new THREE.Vector3(0, -tilt * half, 0));
        const b = pb.clone().addScaledVector(side, half).add(new THREE.Vector3(0, tilt * half, 0));
        this.slashLine(a, b, 0.1, 0.22);
      }
    }, (fin ? 0.12 : 0.07) * 1000);
  },

  slashImpact(p, dir, heavy) {
    // a bright X of cuts across the target
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const s = heavy ? 1.3 : 0.75;
    const ang = R() * Math.PI;
    for (let k = 0; k < (heavy ? 3 : 2); k++) {
      const a = ang + k * (Math.PI / (heavy ? 3 : 2)) + (R() - 0.5) * 0.3;
      const off = side.clone().multiplyScalar(Math.cos(a) * s).add(new THREE.Vector3(0, Math.sin(a) * s, 0));
      this.slashLine(p.clone().sub(off), p.clone().add(off), heavy ? 0.13 : 0.08, heavy ? 0.32 : 0.22);
    }
    // sparks off the steel: fast, thin, a little gravity
    for (let k = 0; k < (heavy ? 46 : 20); k++) {
      const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), sp = (heavy ? 8 : 5) + R() * 8;
      this.fire.emit(p.x, p.y, p.z, Math.cos(a) * sq * sp + dir.x * sp * 0.6, u * sp * 0.6 + 1.5, Math.sin(a) * sq * sp + dir.z * sp * 0.6, 0.12 + R() * 0.16, 0.05, 0.01, EDGE, STEEL_E, 2.5, -9);
    }
    // a blunt pressure puff
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.07, heavy ? 1.2 : 0.6, heavy ? 2.2 : 1.1, [2.6, 2.7, 3.0, 1], STEEL_E, 0, 0);
    this.ring(p, heavy ? 2.6 : 1.2, heavy ? 0.28 : 0.18, new THREE.Color(2.6, 2.7, 3.0));
    this.light(p, heavy ? 16 : 7, heavy ? 9 : 5, heavy ? 0.16 : 0.08, 0xdfe8ff);
    if (heavy) for (let k = 0; k < 8; k++) { const a = R() * 6.283; this.smoke.emit(p.x, p.y - 0.8, p.z, Math.cos(a) * 3 + dir.x * 5, 0.5 + R(), Math.sin(a) * 3 + dir.z * 5, 0.6 + R() * 0.3, 0.4, 1.4, DUST0, DUST1, 2.4, 0.1); }
  },

  // ---------------------------------------------------------------- E: Flash Step
  // a long streak of displaced air along the path, kicked-up dust where he left and where he stopped
  flashStep(o, d, len, big) {
    const a = new THREE.Vector3(o.x, o.y + 1.0, o.z), b = a.clone().add(new THREE.Vector3(d.x * len, 0, d.z * len));
    this.slashLine(a, b, big ? 0.5 : 0.32, big ? 0.45 : 0.32, [1.6, 1.7, 1.9]);
    this.slashLine(a.clone().add(new THREE.Vector3(0, 0.45, 0)), b.clone().add(new THREE.Vector3(0, 0.4, 0)), 0.12, 0.28, [1.4, 1.5, 1.7]);
    this.slashLine(a.clone().add(new THREE.Vector3(0, -0.6, 0)), b.clone().add(new THREE.Vector3(0, -0.55, 0)), 0.1, 0.26, [1.2, 1.3, 1.5]);
    for (let k = 0; k < 24; k++) {
      const u = R();
      const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u;
      this.fire.emit(x + (R() - 0.5) * 0.6, o.y + 0.2 + R() * 1.6, z + (R() - 0.5) * 0.6, d.x * 6 + (R() - 0.5), (R() - 0.5), d.z * 6 + (R() - 0.5), 0.2 + R() * 0.15, 0.06, 0.02, WIND, WIND_E, 3, 0);
    }
    for (const [p, k] of [[o, -1], [{ x: o.x + d.x * len, y: o.y, z: o.z + d.z * len }, 1]]) {
      for (let i = 0; i < 10; i++) {
        const a2 = R() * 6.283;
        this.smoke.emit(p.x, p.y + 0.1, p.z, Math.cos(a2) * 2.4 + d.x * k * 3, 0.4 + R() * 0.6, Math.sin(a2) * 2.4 + d.z * k * 3, 0.5 + R() * 0.3, 0.35, 1.2, DUST0, DUST1, 2.6, 0.1);
      }
    }
    this.ring({ x: o.x, y: o.y, z: o.z }, big ? 2.2 : 1.4, 0.22, new THREE.Color(1.6, 1.7, 1.9));
  },

  // ---------------------------------------------------------------- C: Skyfall
  skyLeap(o) {
    for (let i = 0; i < 26; i++) {
      const a = R() * 6.283, sp = 3 + R() * 5;
      this.smoke.emit(o.x, o.y + 0.1, o.z, Math.cos(a) * sp, 0.3 + R() * 1.2, Math.sin(a) * sp, 0.6 + R() * 0.4, 0.4, 1.6, DUST0, DUST1, 2.6, 0.2);
    }
    for (let i = 0; i < 14; i++) this.fire.emit(o.x + (R() - 0.5) * 0.5, o.y + R() * 0.4, o.z + (R() - 0.5) * 0.5, (R() - 0.5) * 2, 10 + R() * 8, (R() - 0.5) * 2, 0.22, 0.06, 0.02, WIND, WIND_E, 3, 0);
    this.ring(o, 2.6, 0.3, new THREE.Color(1.3, 1.25, 1.1));
    this.scorch(o.x, o.z, 1.1, 5);
  },
  // the dive: a falling streak from the jump point to the target
  skyDive(from, to) {
    this.slashLine(new THREE.Vector3(from.x, from.y + 1, from.z), new THREE.Vector3(to.x, to.y + 0.8, to.z), 0.3, 0.4, [1.7, 1.8, 2.0]);
    // a warning mark where he will land
    this.ring(to, 3.8, 0.45, new THREE.Color(2.2, 2.2, 2.4));
  },
  skySlam(c) {
    for (let i = 0; i < 46; i++) {
      const a = R() * 6.283, sp = 4 + R() * 9;
      this.smoke.emit(c.x, c.y + 0.15, c.z, Math.cos(a) * sp, 0.6 + R() * 2.4, Math.sin(a) * sp, 0.7 + R() * 0.5, 0.5, 2.2, DUST0, DUST1, 2.4, 0.4);
    }
    // broken ground: chunks thrown up
    for (let i = 0; i < 22; i++) {
      const a = R() * 6.283, sp = 3 + R() * 5;
      this.fire.emit(c.x + Math.cos(a) * 0.5, c.y + 0.2, c.z + Math.sin(a) * 0.5, Math.cos(a) * sp, 6 + R() * 6, Math.sin(a) * sp, 0.7 + R() * 0.4, 0.09, 0.07, [0.5, 0.42, 0.32, 1], [0.35, 0.3, 0.24, 1], 0.5, -22);
    }
    // radial cracks of light along the ground
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * 6.283 + R() * 0.4, l = 2.6 + R() * 1.6;
      this.slashLine(new THREE.Vector3(c.x, c.y + 0.08, c.z), new THREE.Vector3(c.x + Math.cos(a) * l, c.y + 0.08, c.z + Math.sin(a) * l), 0.14, 0.4, [2.4, 2.4, 2.6]);
    }
    this.fire.emit(c.x, c.y + 0.6, c.z, 0, 0, 0, 0.1, 2.2, 4.4, [2.6, 2.6, 2.8, 1], STEEL_E, 0, 0);
    this.ring(c, 4.2, 0.4, new THREE.Color(2.4, 2.4, 2.6));
    this.ring(c, 2.4, 0.26, new THREE.Color(3, 3, 3.2));
    this.light(c, 20, 12, 0.2, 0xe8eeff);
    this.scorch(c.x, c.z, 2.6, 8);
  },

  // ---------------------------------------------------------------- V: Inverted Spear
  nullCast(getTip) {
    // a cold glint running up the blade
    let t = 0;
    const p = new THREE.Vector3();
    this.effects.push({ update: (dt) => {
      t += dt;
      getTip(Math.min(1.05, t / 0.12), p);
      this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.12, 0.16, 0.02, EDGE, EDGE_E, 0, 0);
      return t < 0.14;
    } });
  },
  // technique nullified: everything around the target collapses inward into nothing, then a ring
  // of shattered "glass" flies out
  nullHit(p, dir) {
    this.slashLine(p.clone().addScaledVector(dir, -1.4), p.clone().addScaledVector(dir, 1.8), 0.2, 0.3);
    for (let k = 0; k < 40; k++) {
      const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), r = 1.6 + R() * 0.6;
      // implode: particles start on a shell and rush to the centre
      const x = p.x + Math.cos(a) * sq * r, y = p.y + u * r, z = p.z + Math.sin(a) * sq * r;
      this.fire.emit(x, y, z, (p.x - x) * 7, (p.y - y) * 7, (p.z - z) * 7, 0.14, 0.12, 0.02, NULL0, NULL1, 0, 0);
    }
    setTimeout(() => {
      for (let k = 0; k < 34; k++) {
        const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), sp = 6 + R() * 8;
        this.fire.emit(p.x, p.y, p.z, Math.cos(a) * sq * sp, u * sp, Math.sin(a) * sq * sp, 0.3 + R() * 0.2, 0.07, 0.03, EDGE, [0.5, 0.6, 1.0, 0], 2, -6);
      }
      this.ring(p, 2.6, 0.3, new THREE.Color(1.6, 1.8, 3.0));
      this.ring(p, 1.4, 0.2, new THREE.Color(3, 3, 3.3));
      this.light(p, 14, 8, 0.15, 0xb8c8ff);
    }, 110);
  },

  // ---------------------------------------------------------------- X: Heavenly Severance
  severCut(from, to, p, dir, fin) {
    // the path he took (too fast to see) and the cut through the target
    this.slashLine(new THREE.Vector3(from.x, from.y + 1.0, from.z), new THREE.Vector3(to.x, to.y + 1.0, to.z), 0.18, 0.3, [1.5, 1.6, 1.8]);
    if (fin) {
      this.slashLine(p.clone().addScaledVector(dir, -2.4), p.clone().addScaledVector(dir, 3.6), 0.34, 0.5);
      this.slashImpact(p, dir, true);
      this.ring(p, 5, 0.45, new THREE.Color(2.8, 2.8, 3.1));
    } else this.slashImpact(p, dir, false);
  },
  severStart(o) {
    for (let k = 0; k < 18; k++) {
      const a = R() * 6.283, sp = 3 + R() * 4;
      this.smoke.emit(o.x, o.y + 0.1, o.z, Math.cos(a) * sp, 0.4 + R(), Math.sin(a) * sp, 0.5 + R() * 0.3, 0.35, 1.3, DUST0, DUST1, 2.6, 0.1);
    }
    this.ring(o, 2.2, 0.25, new THREE.Color(2, 2, 2.2));
  },
});
