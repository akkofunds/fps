import * as THREE from 'three';
import { Fx } from './fire.js';

// M1 combo VFX: a trail that follows the striking fist/foot through the swing (frost on Shoto's left
// fist, fire on his right, both spiralling round the kick; blue-white cursed energy for the Sorcerer),
// impact bursts with speed lines and shock rings, and dizzy stars over stunned players.

const R = Math.random;
const C = {
  ice: [[1.3, 2.3, 3.2, 1], [0.4, 0.9, 1.8, 0]],
  fire: [[3.0, 1.2, 0.3, 1], [1.4, 0.2, 0.04, 0]],
  cursed: [[0.6, 1.6, 3.6, 1], [0.1, 0.3, 1.4, 0]],
  white: [[3.2, 3.2, 3.4, 1], [1.2, 1.4, 2.0, 0]],
};
const DUST0 = [0.42, 0.4, 0.36, 0.5], DUST1 = [0.5, 0.48, 0.45, 0];
// which element a hit uses: Shoto's left fist is frost, his right fist is fire, the kick is both
function elem(style, i, k = 0) {
  if (style === 'cursed') return k % 3 === 0 ? 'white' : 'cursed';
  if (i === 3) return k % 2 ? 'ice' : 'fire';
  return i === 1 ? 'fire' : 'ice';
}

Object.assign(Fx.prototype, {
  // getP(out) → current fist / foot position; dir: flat strike direction
  punchSwing(getP, dir, style, i) {
    const dur = i === 3 ? 0.3 : 0.18;
    const p = new THREE.Vector3(), prev = new THREE.Vector3();
    let t = 0, first = true;
    this.effects.push({ update: (dt) => {
      t += dt;
      getP(p);
      if (first) { prev.copy(p); first = false; }
      // a ribbon of particles along the path the fist took this frame
      const n = i === 3 ? 6 : 4;
      for (let k = 0; k < n; k++) {
        const u = k / n, c = C[elem(style, i, k)];
        this.fire.emit(prev.x + (p.x - prev.x) * u, prev.y + (p.y - prev.y) * u, prev.z + (p.z - prev.z) * u, (R() - 0.5) * 0.6, (R() - 0.5) * 0.6 + (c === C.fire ? 0.6 : 0), (R() - 0.5) * 0.6, 0.14 + R() * 0.1, i === 3 ? 0.22 : 0.15, 0.02, c[0], c[1], 3, c === C.fire ? 1 : -0.5);
      }
      prev.copy(p);
      return t < dur;
    } });
    // a crescent "smear" of light across the front at the strike
    const c = C[elem(style, i)];
    setTimeout(() => {
      getP(p);
      const side = new THREE.Vector3(-dir.z, 0, dir.x), arc = i === 2 ? 1.3 : i === 3 ? 1.6 : 0.7;
      for (let k = 0; k < 14; k++) {
        const a = (k / 13 - 0.5) * arc;
        const x = p.x + side.x * Math.sin(a) * 0.6 + dir.x * Math.cos(a) * 0.35, z = p.z + side.z * Math.sin(a) * 0.6 + dir.z * Math.cos(a) * 0.35;
        this.fire.emit(x, p.y + (i === 3 ? Math.sin(a) * 0.4 : 0), z, dir.x * 3, 0, dir.z * 3, 0.12, 0.16, 0.03, c[0], c[1], 6, 0);
      }
    }, (i === 3 ? 0.15 : 0.06) * 1000);
  },

  punchImpact(p, dir, style, heavy) {
    const n = heavy ? 60 : 26, el = elem(style, heavy ? 3 : 0);
    for (let k = 0; k < n; k++) {
      const c = C[elem(style, heavy ? 3 : (k % 3 ? 0 : 1), k)];
      const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), sp = (heavy ? 7 : 4) + R() * (heavy ? 9 : 5);
      // biased along the strike so the burst sprays out of the far side
      this.fire.emit(p.x, p.y, p.z, Math.cos(a) * sq * sp + dir.x * sp * 0.8, u * sp * 0.7, Math.sin(a) * sq * sp + dir.z * sp * 0.8, 0.16 + R() * 0.16, heavy ? 0.24 : 0.16, 0.03, c[0], c[1], 5, 0);
    }
    // speed lines: long thin streaks shooting straight out of the impact
    for (let k = 0; k < (heavy ? 14 : 7); k++) {
      const a = Math.atan2(dir.z, dir.x) + (R() - 0.5) * 1.6, v = (heavy ? 22 : 14) + R() * 8, y = (R() - 0.5) * 5;
      this.fire.emit(p.x, p.y, p.z, Math.cos(a) * v, y, Math.sin(a) * v, 0.09, 0.09, 0.02, C.white[0], C.white[1], 2, 0);
    }
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.08, heavy ? 1.6 : 0.8, heavy ? 2.6 : 1.3, C.white[0], C[el][0], 0, 0);
    this.ring(p, heavy ? 3.2 : 1.4, heavy ? 0.32 : 0.2, new THREE.Color(...C[el][0].slice(0, 3)));
    this.light(p, heavy ? 22 : 9, heavy ? 10 : 5, heavy ? 0.2 : 0.1, style === 'cursed' ? 0x6fb8ff : el === 'fire' ? 0xff7a2a : 0x9fd8ff);
    if (heavy) {
      this.ring(p, 1.8, 0.24, new THREE.Color(3.2, 3.2, 3.4));
      for (let k = 0; k < 10; k++) { const a = R() * 6.283; this.smoke.emit(p.x, p.y - 0.8, p.z, Math.cos(a) * 4 + dir.x * 5, 0.5 + R(), Math.sin(a) * 4 + dir.z * 5, 0.6 + R() * 0.3, 0.4, 1.4, DUST0, DUST1, 2.4, 0.1); }
    }
  },

  // dizzy stars circling a stunned player's head (call every frame while stunned)
  stunStars(p, t) {
    for (let k = 0; k < 3; k++) {
      const a = t * 7 + k * 2.094;
      this.fire.emit(p.x + Math.cos(a) * 0.26, p.y + Math.sin(t * 9 + k) * 0.04, p.z + Math.sin(a) * 0.26, 0, 0, 0, 0.06, 0.07, 0.04, [3.2, 2.8, 1.0, 1], [2.0, 1.4, 0.3, 0], 0, 0);
    }
  },
});
