import * as THREE from 'three';
import { Fx } from './fire.js';
import './arcs.js';
import { SLASH_PAL } from './slashdisc.js';

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
  // getSeg(k, out): a point along the spear (0 = butt, 1 = tip); o: his feet
  slashSwing(getSeg, dir, i, o) {
    const fin = i === 3, dur = fin ? 0.26 : 0.2;
    const pa = new THREE.Vector3(), pb = new THREE.Vector3(), la = new THREE.Vector3(), lb = new THREE.Vector3();
    let t = 0, first = true;
    // a fine smear of the edge itself, between last frame's blade and this frame's
    this.effects.push({ update: (dt) => {
      t += dt;
      getSeg(0.45, pa); getSeg(1.05, pb);
      if (first) { la.copy(pa); lb.copy(pb); first = false; }
      for (let k = 0; k < 5; k++) {
        const u = R(), w = R();
        const x = (la.x + (lb.x - la.x) * u) * (1 - w) + (pa.x + (pb.x - pa.x) * u) * w;
        const y = (la.y + (lb.y - la.y) * u) * (1 - w) + (pa.y + (pb.y - pa.y) * u) * w;
        const z = (la.z + (lb.z - la.z) * u) * (1 - w) + (pa.z + (pb.z - pa.z) * u) * w;
        this.fire.emit(x, y, z, 0, 0, 0, 0.08, 0.05, 0.01, EDGE, EDGE_E, 0, 0);
      }
      la.copy(pa); lb.copy(pb);
      return t < dur;
    } });
    if (!o) return;
    // the crescent of the cut, in the plane the blade swings through
    const F = new THREE.Vector3(dir.x, 0, dir.z).normalize(), Rt = new THREE.Vector3(-F.z, 0, F.x), U = new THREE.Vector3(0, 1, 0);
    const at = (x, y, z) => new THREE.Vector3(o.x, o.y, o.z).addScaledVector(Rt, x).addScaledVector(U, y).addScaledVector(F, z);
    const L = SLASH_PAL.lime;
    if (i === 0) {        // forehand: high right, over the front, down to the left
      this.slashDisc(at(0, 1.3, 0.35), Rt.clone().multiplyScalar(0.65).addScaledVector(U, 0.75), F, 3.0, L, { spin: 4, shards: 6, delay: 0.05 });
    } else if (i === 1) { // backhand: flat, left to right (a wide spinning swirl, like the reference)
      this.slashDisc(at(0, 1.1, 0.25), Rt.clone().negate().addScaledVector(F, -0.2), F, 3.3, L, { spin: -4.5, shards: 6, delay: 0.05 });
    } else if (i === 2) { // rising: low left up past the right shoulder
      this.slashDisc(at(0, 1.2, 0.3), Rt.clone().multiplyScalar(-0.5).addScaledVector(U, -0.8), F, 3.0, L, { spin: 4, shards: 6, delay: 0.07 });
      this.windSwirl(at(0, 0, 0.4), 2.6, { life: 0.6 });
    } else {              // the thrust: a straight streak, air twisting round the spear
      const tip = at(0, 1.25, 1.9);
      setTimeout(() => this.slashLine(at(0, 1.25, 0.3), at(0, 1.25, 3.4), 0.16, 0.24, [1.2, 1.5, 1.0]), 0.1 * 1000);
      for (let k = 0; k < 3; k++) this.slashDisc(tip.clone().addScaledVector(F, -0.5 + k * 0.55), U, Rt, 0.9 + k * 0.25, L, { spin: 14, life: 0.26, delay: 0.1 + k * 0.03 });
      this.windSwirl(at(0, 0, 1.2), 3.0, { life: 0.7 });
    }
  },

  slashImpact(p, dir, heavy) {
    // two crescents cutting across the target (an X of blade light), then displaced air
    const F = new THREE.Vector3(dir.x, 0, dir.z).normalize(), Rt = new THREE.Vector3(-F.z, 0, F.x), U = new THREE.Vector3(0, 1, 0);
    const a0 = R() * Math.PI;
    for (let k = 0; k < (heavy ? 3 : 2); k++) {
      const a = a0 + k * Math.PI / (heavy ? 3 : 2);
      const ax = Rt.clone().multiplyScalar(Math.cos(a)).addScaledVector(U, Math.sin(a));
      const r = heavy ? 1.1 : 0.75;
      // a shallow arc whose middle passes through the target, bowing away from the attacker
      this.arc({ c: p.clone().addScaledVector(F, -r * 0.9), e1: ax.clone().negate().multiplyScalar(1).addScaledVector(F, 0.0), e2: F, r: r * 1.3, angle: Math.PI, w: heavy ? 0.24 : 0.16, dur: heavy ? 0.28 : 0.2, head: 0.25, grow: 0.25, core: [2.8, 2.9, 3.1], edge: [0.4, 0.45, 0.6], ink: 0.6, delay: k * 0.03 });
    }
    this.slashDisc(p.clone(), Rt.clone().multiplyScalar(Math.cos(a0)).addScaledVector(U, Math.sin(a0)), F, heavy ? 2.4 : 1.6, SLASH_PAL.lime, { spin: 8, life: 0.24, shards: heavy ? 4 : 0 });
    this.airBurst(p, dir, heavy, null);
    this.impactStar(p, heavy ? 1.8 : 0.95, [1.3, 1.6, 1.1]);
    // sparks off the steel: fast, thin, a little gravity
    for (let k = 0; k < (heavy ? 14 : 6); k++) {
      const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), sp = (heavy ? 8 : 5) + R() * 8;
      this.fire.emit(p.x, p.y, p.z, Math.cos(a) * sq * sp + dir.x * sp * 0.6, u * sp * 0.6 + 1.5, Math.sin(a) * sq * sp + dir.z * sp * 0.6, 0.12 + R() * 0.16, 0.05, 0.01, EDGE, STEEL_E, 2.5, -9);
    }
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.06, heavy ? 0.9 : 0.45, heavy ? 1.6 : 0.8, [2.6, 2.7, 3.0, 1], STEEL_E, 0, 0);
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
    // displaced air: tall crescents peeling off the path like a wake
    const D = new THREE.Vector3(d.x, 0, d.z).normalize(), side = new THREE.Vector3(-D.z, 0, D.x), U = new THREE.Vector3(0, 1, 0);
    const n = Math.max(2, Math.min(5, Math.round(len / 3)));
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n, c = new THREE.Vector3(o.x + d.x * len * u, o.y + 1.0, o.z + d.z * len * u);
      const sgn = k % 2 ? 1 : -1;
      this.arc({ c, e1: U.clone().negate(), e2: side.clone().multiplyScalar(sgn).addScaledVector(D, -0.6), r: 1.0 + (big ? 0.4 : 0), angle: 3.0, w: 0.22, spiral: 1.3, dur: 0.34, head: 0.25, grow: 0.5,
        core: [1.45, 1.5, 1.6], edge: [0.42, 0.46, 0.56], ink: 0.55, alpha: 0.85, sparks: 0, delay: u * 0.12 });
    }
    for (const [p, k] of [[o, -1], [{ x: o.x + d.x * len, y: o.y, z: o.z + d.z * len }, 1]]) {
      for (let i = 0; i < 10; i++) {
        const a2 = R() * 6.283;
        this.smoke.emit(p.x, p.y + 0.1, p.z, Math.cos(a2) * 2.4 + d.x * k * 3, 0.4 + R() * 0.6, Math.sin(a2) * 2.4 + d.z * k * 3, 0.5 + R() * 0.3, 0.35, 1.2, DUST0, DUST1, 2.6, 0.1);
      }
    }
  },

  // ---------------------------------------------------------------- C: Skyfall
  skyLeap(o) {
    for (let i = 0; i < 26; i++) {
      const a = R() * 6.283, sp = 3 + R() * 5;
      this.smoke.emit(o.x, o.y + 0.1, o.z, Math.cos(a) * sp, 0.3 + R() * 1.2, Math.sin(a) * sp, 0.6 + R() * 0.4, 0.4, 1.6, DUST0, DUST1, 2.6, 0.2);
    }
    for (let i = 0; i < 14; i++) this.fire.emit(o.x + (R() - 0.5) * 0.5, o.y + R() * 0.4, o.z + (R() - 0.5) * 0.5, (R() - 0.5) * 2, 10 + R() * 8, (R() - 0.5) * 2, 0.22, 0.06, 0.02, WIND, WIND_E, 3, 0);
    this.groundShock(o, 1.6, { dur: 0.36 });
    for (let k = 0; k < 2; k++) this.arc({ c: new THREE.Vector3(o.x, o.y + 0.6 + k * 1.2, o.z), e1: new THREE.Vector3(Math.cos(k * 2), 0, Math.sin(k * 2)), e2: new THREE.Vector3(-Math.sin(k * 2), 0.0, Math.cos(k * 2)), r: 0.9, angle: 5.5, w: 0.18, spiral: 0.6, twist: 2.5, dur: 0.4, head: 0.4, grow: 0.3, core: [1.5, 1.55, 1.65], edge: [0.45, 0.5, 0.6], ink: 0.5, sparks: 0, delay: k * 0.06 });
    this.scorch(o.x, o.z, 1.1, 5);
  },
  // the dive: a falling streak from the jump point to the target
  skyDive(from, to) {
    this.slashLine(new THREE.Vector3(from.x, from.y + 1, from.z), new THREE.Vector3(to.x, to.y + 0.8, to.z), 0.3, 0.4, [1.7, 1.8, 2.0]);
    // a warning mark where he will land
    this.groundShock(to, 2.2, { dur: 0.45, grow: 0.3, ink: 0.6 });
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
    this.groundShock(c, 2.4, { dur: 0.5, grow: 1.4 });
    this.windSwirl(c, 7, { life: 1.0 });
    this.slashDisc(new THREE.Vector3(c.x, c.y + 0.5, c.z), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), 6, SLASH_PAL.lime, { spin: 6, life: 0.45, shards: 14 });
    this.groundShock(c, 1.4, { dur: 0.36, grow: 1.0, core: [1.8, 1.8, 1.9] });
    this.impactStar(new THREE.Vector3(c.x, c.y + 0.7, c.z), 2.6, null, 0.18);
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
      this.airBurst(p, dir, true, [[0.75, 0.95, 1.8], [0.1, 0.15, 0.6]]);
      this.impactStar(p, 2.0, [1.1, 1.3, 1.9]);
      this.light(p, 14, 8, 0.15, 0xb8c8ff);
    }, 110);
  },

  // ---------------------------------------------------------------- X: Heavenly Severance
  severCut(from, to, p, dir, fin) {
    const F = new THREE.Vector3(dir.x, 0, dir.z).normalize(), Rt = new THREE.Vector3(-F.z, 0, F.x), U = new THREE.Vector3(0, 1, 0);
    if (!fin) {
      // the path he took (too fast to see) and a crescent through the target in a fresh plane
      this.slashLine(new THREE.Vector3(from.x, from.y + 1.0, from.z), new THREE.Vector3(to.x, to.y + 1.0, to.z), 0.12, 0.26, [1.5, 1.6, 1.8]);
      const a = R() * Math.PI;
      const ax = Rt.clone().multiplyScalar(Math.cos(a)).addScaledVector(U, Math.sin(a));
      this.arc({ c: p.clone().addScaledVector(F, -1.4), e1: ax.clone().negate(), e2: F, r: 1.9, angle: Math.PI, w: 0.26, dur: 0.5, head: 0.16, grow: 0.15, core: [1.7, 1.72, 1.85], edge: [0.3, 0.35, 0.5], ink: 0.7, sparks: 3 });
      this.slashDisc(p.clone(), ax.clone(), F, 3.2, SLASH_PAL.lime, { spin: 8, life: 0.4, shards: 6 });
      this.impactStar(p, 1.0, [1.3, 1.6, 1.1]);
      for (let k = 0; k < 14; k++) {
        const u = R() * 2 - 1, aa = R() * 6.283, sq = Math.sqrt(1 - u * u), sp = 5 + R() * 7;
        this.fire.emit(p.x, p.y, p.z, Math.cos(aa) * sq * sp, u * sp * 0.6 + 1, Math.sin(aa) * sq * sp, 0.12 + R() * 0.14, 0.05, 0.01, EDGE, STEEL_E, 2.5, -9);
      }
      return;
    }
    // the release: every cut lands at once — a burst of huge crescents through the target in all
    // directions, a white star, the ground torn up under them
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI + R() * 0.3;
      const ax = Rt.clone().multiplyScalar(Math.cos(a)).addScaledVector(U, Math.sin(a));
      const fwd = F.clone().applyAxisAngle(U, (R() - 0.5) * 1.4);
      this.arc({ c: p.clone().addScaledVector(fwd, -2.2), e1: ax.clone().negate(), e2: fwd, r: 2.8 + R() * 0.8, angle: Math.PI, w: 0.4, dur: 0.55, head: 0.14, grow: 0.25, core: [1.75, 1.78, 1.9], edge: [0.32, 0.36, 0.52], ink: 0.7, sparks: 4, delay: k * 0.012 });
    }
    this.slashLine(p.clone().addScaledVector(F, -3), p.clone().addScaledVector(F, 4.5), 0.3, 0.5);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI + R() * 0.4;
      this.slashDisc(p.clone(), Rt.clone().multiplyScalar(Math.cos(a)).addScaledVector(U, Math.sin(a)), F.clone().applyAxisAngle(U, (R() - 0.5) * 1.2), 5.5, SLASH_PAL.lime, { spin: k % 2 ? 6 : -6, life: 0.5, shards: 12, delay: k * 0.03 });
    }
    this.impactStar(p, 3.4, [1.4, 1.7, 1.2], 0.22);
    this.airBurst(p, F, true, null);
    this.groundShock(new THREE.Vector3(p.x, p.y - 1.2, p.z), 2.4);
    this.windSwirl(new THREE.Vector3(p.x, p.y - 1.2, p.z), 6.5, { life: 1.1 });
    for (let k = 0; k < 50; k++) {
      const u = R() * 2 - 1, aa = R() * 6.283, sq = Math.sqrt(1 - u * u), sp = 8 + R() * 12;
      this.fire.emit(p.x, p.y, p.z, Math.cos(aa) * sq * sp + F.x * 6, u * sp * 0.6 + 2, Math.sin(aa) * sq * sp + F.z * 6, 0.18 + R() * 0.2, 0.06, 0.01, EDGE, STEEL_E, 2.5, -9);
    }
    this.light(p, 26, 14, 0.25, 0xe8eeff);
  },
  // Flash Step: the instant he passes — a hairline glint across them, nothing else yet
  flashMark(p, dir) {
    const side = new THREE.Vector3(-dir.z, 0, dir.x), up = new THREE.Vector3(0, 1, 0);
    const ax = side.clone().multiplyScalar(0.8).addScaledVector(up, (Math.random() - 0.5) * 1.2).normalize();
    this.slashLine(p.clone().addScaledVector(ax, -0.9), p.clone().addScaledVector(ax, 0.9), 0.03, 0.26, [2.4, 2.4, 2.6]);
  },
  // …and a beat later the cut lands: a big X of crescents, a flash, sparks and ink
  flashReveal(p, dir) {
    const F = new THREE.Vector3(dir.x, 0, dir.z).normalize(), Rt = new THREE.Vector3(-F.z, 0, F.x), U = new THREE.Vector3(0, 1, 0);
    for (const [a, w] of [[0.7, 0.3], [-0.7, 0.24]]) {
      const ax = Rt.clone().multiplyScalar(Math.cos(a)).addScaledVector(U, Math.sin(a));
      this.arc({ c: p.clone().addScaledVector(F, -1.3), e1: ax.clone().negate(), e2: F, r: 1.7, angle: Math.PI, w, dur: 0.3, head: 0.2, grow: 0.2, core: [1.7, 1.72, 1.85], edge: [0.35, 0.4, 0.55], ink: 0.65, sparks: 3 });
    }
    this.slashDisc(p.clone(), Rt.clone().multiplyScalar(0.7).addScaledVector(U, 0.7), F, 3.0, SLASH_PAL.lime, { spin: 7, life: 0.32, shards: 10 });
    this.slashDisc(p.clone(), Rt.clone().multiplyScalar(0.7).addScaledVector(U, -0.7), F, 2.6, SLASH_PAL.lime, { spin: -7, life: 0.32, delay: 0.03 });
    this.impactStar(p, 1.8, [1.3, 1.6, 1.1]);
    this.airBurst(p, F, true, null);
    for (let k = 0; k < 30; k++) {
      const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), sp = 6 + R() * 9;
      this.fire.emit(p.x, p.y, p.z, Math.cos(a) * sq * sp + F.x * 5, u * sp * 0.6 + 1, Math.sin(a) * sq * sp + F.z * 5, 0.14 + R() * 0.16, 0.05, 0.01, EDGE, STEEL_E, 2.5, -9);
    }
    this.light(p, 14, 8, 0.12, 0xdfe8ff);
  },
  // Severance: the frozen beat before the release — light gathers into the target, a single
  // hairline across it
  severHold(p, dir) {
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    this.slashLine(p.clone().addScaledVector(side, -2.6), p.clone().addScaledVector(side, 2.6), 0.04, 0.34, [2.6, 2.6, 2.8]);
    for (let k = 0; k < 40; k++) {
      const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), r = 2.4 + R();
      const x = p.x + Math.cos(a) * sq * r, y = p.y + u * r, z = p.z + Math.sin(a) * sq * r;
      this.fire.emit(x, y, z, (p.x - x) * 3.4, (p.y - y) * 3.4, (p.z - z) * 3.4, 0.3, 0.07, 0.02, EDGE, STEEL_E, 0, 0);
    }
  },
  // he reappears where he started: the air snaps shut behind him
  severEnd(from, to) {
    this.slashLine(new THREE.Vector3(from.x, from.y + 1, from.z), new THREE.Vector3(to.x, to.y + 1, to.z), 0.2, 0.3, [1.5, 1.55, 1.7]);
    for (const p of [from, to]) for (let k = 0; k < 12; k++) {
      const a = R() * 6.283;
      this.smoke.emit(p.x, p.y + 0.1, p.z, Math.cos(a) * 3, 0.4 + R() * 0.6, Math.sin(a) * 3, 0.5 + R() * 0.3, 0.35, 1.3, DUST0, DUST1, 2.6, 0.1);
    }
  },

  severStart(o) {
    for (let k = 0; k < 18; k++) {
      const a = R() * 6.283, sp = 3 + R() * 4;
      this.smoke.emit(o.x, o.y + 0.1, o.z, Math.cos(a) * sp, 0.4 + R(), Math.sin(a) * sp, 0.5 + R() * 0.3, 0.35, 1.3, DUST0, DUST1, 2.6, 0.1);
    }
  },
});
