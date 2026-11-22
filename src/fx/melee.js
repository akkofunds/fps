import * as THREE from 'three';
import { Fx } from './fire.js';
import './arcs.js';
import { SLASH_PAL } from './slashdisc.js';
import { GLOSS } from './glossy.js';

// M1 combo VFX: a trail that follows the striking fist/foot through the swing (frost on Shoto's left
// fist, fire on his right, both spiralling round the kick; blue-white cursed energy for the Sorcerer),
// impact bursts with speed lines and shock rings, and dizzy stars over stunned players.

const R = Math.random;
const C = {
  ice: [[1.3, 2.3, 3.2, 1], [0.4, 0.9, 1.8, 0]],
  fire: [[3.0, 1.2, 0.3, 1], [1.4, 0.2, 0.04, 0]],
  cursed: [[0.6, 1.6, 3.6, 1], [0.1, 0.3, 1.4, 0]],
  white: [[3.2, 3.2, 3.4, 1], [1.2, 1.4, 2.0, 0]],
  ink: [[3.0, 2.2, 0.7, 1], [0.7, 0.35, 0.04, 0]],
};
const DUST0 = [0.42, 0.4, 0.36, 0.5], DUST1 = [0.5, 0.48, 0.45, 0];
// which element a hit uses: Shoto's left fist is frost, his right fist is fire, the kick is both
function elem(style, i, k = 0) {
  if (style === 'chess') return 'white';
  if (style === 'ink') return 'ink';
  if (style === 'cursed') return k % 3 === 0 ? 'white' : 'cursed';
  if (i === 3) return k % 2 ? 'ice' : 'fire';
  return i === 1 ? 'fire' : 'ice';
}

// per element: crescent core / edge colours (HDR so the core blooms)
// (arcs blend normally, so colours clamp at 1: keep the ratios saturated, just past 1 for bloom)
const ARC = {
  ice: [[0.75, 1.3, 1.75], [0.08, 0.45, 1.05]],
  fire: [[1.6, 0.95, 0.3], [1.0, 0.22, 0.02]],
  cursed: [[0.8, 1.2, 1.85], [0.08, 0.28, 1.1]],
  white: [[1.55, 1.58, 1.7], [0.55, 0.6, 0.75]],
};
const UP = new THREE.Vector3(0, 1, 0);

Object.assign(Fx.prototype, {
  // getP(out) → current fist / foot position; dir: flat strike direction; o: the striker's feet
  punchSwing(getP, dir, style, i, o) {
    const fin = i === 3, dur = fin ? 0.3 : 0.18;
    const p = new THREE.Vector3(), prev = new THREE.Vector3();
    let t = 0, first = true;
    // a thin particle trail riding the fist / foot itself
    this.effects.push({ update: (dt) => {
      t += dt;
      getP(p);
      if (first) { prev.copy(p); first = false; }
      for (let k = 0; k < 3; k++) {
        const u = k / 3, c = C[elem(style, i, k)];
        this.fire.emit(prev.x + (p.x - prev.x) * u, prev.y + (p.y - prev.y) * u, prev.z + (p.z - prev.z) * u, 0, 0, 0, 0.1, fin ? 0.12 : 0.08, 0.01, c[0], c[1], 0, 0);
      }
      prev.copy(p);
      return t < dur;
    } });
    if (!o) return;
    // the crescent of the strike itself, in the plane the limb travels through
    const F = new THREE.Vector3(dir.x, 0, dir.z).normalize(), Rt = new THREE.Vector3(-F.z, 0, F.x);
    const at = (x, y, z) => new THREE.Vector3(o.x, o.y, o.z).addScaledVector(Rt, x).addScaledVector(UP, y).addScaledVector(F, z);
    // glossy ribbons wrapping the body along the limb's path (the reference combo look)
    const pal = GLOSS[style === 'cursed' ? 'cursed' : elem(style, i)];
    const feet = new THREE.Vector3(o.x, o.y, o.z);
    if (i === 0) this.ribbonCombo(feet, F, 'd', pal, 0.9, 0.02);
    else if (i === 1) this.ribbonCombo(feet, F, 'h', pal, 0.9, 0.02);
    else if (i === 2) this.ribbonCombo(feet, F, 'u', pal, 0.95, 0.05);
    else {
      // roundhouse: a heavy wrap; Shoto's is fire over ice
      this.ribbonCombo(feet, F, 'x', pal, 1.05, 0.08);
      if (style === 'ink') this.ribbonCombo(feet, F, 'h', GLOSS.inkDark, 1.2, 0.11);
      else if (style !== 'cursed') this.ribbonCombo(feet, F, 'h', GLOSS.ice, 1.2, 0.11);
      this.windSwirl(at(0, 0, 0.5), 3.0, { life: 0.6 });
    }
    void ARC; void SLASH_PAL;
  },

  punchImpact(p, dir, style, heavy) {
    const el = elem(style, heavy ? 3 : 0);
    // a dome of air-pressure arcs flaring out of the hit (no flat rings)
    this.airBurst(p, dir, heavy, null);   // clean white air arcs (no coloured slash on a punch)
    this.impactStar(p, heavy ? 0.9 : 0.5);
    // dark 4-point stars popping round the hit, and a short spiked flash
    const pal = GLOSS[style === 'cursed' ? 'cursed' : el];
    this.starBurst(p, heavy ? 3 : 2, heavy ? 0.42 : 0.32, pal, heavy ? 1.1 : 0.8);
    if (heavy) this.liquidSlash(p.clone().addScaledVector(UP, -0.3), dir, 0.8, pal, 0.2);
    // sparks of the element, sprayed out the far side
    for (let k = 0; k < (heavy ? 14 : 6); k++) {
      const c = C[elem(style, heavy ? 3 : (k % 3 ? 0 : 1), k)];
      const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), sp = (heavy ? 7 : 4) + R() * (heavy ? 9 : 5);
      this.fire.emit(p.x, p.y, p.z, Math.cos(a) * sq * sp + dir.x * sp, u * sp * 0.6, Math.sin(a) * sq * sp + dir.z * sp, 0.14 + R() * 0.14, heavy ? 0.14 : 0.1, 0.02, c[0], c[1], 5, 0);
    }
    // speed lines straight out of the impact
    for (let k = 0; k < (heavy ? 6 : 3); k++) {
      const a = Math.atan2(dir.z, dir.x) + (R() - 0.5) * 1.2, v = (heavy ? 24 : 15) + R() * 8, y = (R() - 0.5) * 4;
      this.fire.emit(p.x, p.y, p.z, Math.cos(a) * v, y, Math.sin(a) * v, 0.08, 0.07, 0.02, C.white[0], C.white[1], 2, 0);
    }
    // a short white flash at the contact point
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.05, heavy ? 0.5 : 0.25, heavy ? 0.9 : 0.45, C.white[0], C[el][0], 0, 0);
    this.light(p, heavy ? 22 : 9, heavy ? 10 : 5, heavy ? 0.2 : 0.1, style === 'cursed' ? 0x6fb8ff : el === 'fire' ? 0xff7a2a : el === 'ink' ? 0xffc85a : 0x9fd8ff);
    if (heavy) for (let k = 0; k < 12; k++) { const a = R() * 6.283; this.smoke.emit(p.x, p.y - 0.9, p.z, Math.cos(a) * 4 + dir.x * 6, 0.4 + R(), Math.sin(a) * 4 + dir.z * 6, 0.6 + R() * 0.3, 0.4, 1.6, DUST0, DUST1, 2.4, 0.1); }
  },

  // stun-immune (budget spent): faint white glints rising off the body
  immuneGlint(p, t) {
    if (R() > 0.45) return;
    const a = R() * 6.283, r = 0.35 + R() * 0.15;
    this.fire.emit(p.x + Math.cos(a) * r, p.y + 0.2 + R() * 1.5, p.z + Math.sin(a) * r, 0, 1.2 + R(), 0, 0.35, 0.05, 0.02, [2.2, 2.3, 2.6, 0.9], [0.8, 0.9, 1.2, 0], 0, 0);
    void t;
  },

  // dizzy stars circling a stunned player's head (call every frame while stunned)
  stunStars(p, t) {
    for (let k = 0; k < 3; k++) {
      const a = t * 7 + k * 2.094;
      this.fire.emit(p.x + Math.cos(a) * 0.26, p.y + Math.sin(t * 9 + k) * 0.04, p.z + Math.sin(a) * 0.26, 0, 0, 0, 0.06, 0.07, 0.04, [3.2, 2.8, 1.0, 1], [2.0, 1.4, 0.3, 0], 0, 0);
    }
  },
});
