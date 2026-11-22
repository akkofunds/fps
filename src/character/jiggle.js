import * as THREE from 'three';

// Soft-body secondary motion for chest bones (spring–damper, per bone, per axis).
//
// The model carries extra bones the animation rig never touches (see tools/characters/rig_yixuan.py):
//   breast_L / breast_R        pivot joints on the upper chest (source: Skn_*_Chest)
//   breastTip_L / breastTip_R  the main soft mass, children of the pivots (source: Skn_*_Chest_Cj_01)
// Each frame we measure how the bone's anchor point (its rest position, carried along by the
// animated parent) accelerates through the world, and feed the opposite of that acceleration into
// a damped spring in the parent's local frame: the mass lags behind when the body moves, swings
// past, and rings down. A low natural frequency and a light damping ratio give the soft, heavy,
// settling bounce; the tip bones sit on top of the pivots with their own (quicker) spring, so the
// motion follows through instead of moving as one rigid lump. Big velocity changes (a jump take-off,
// a landing) arrive as one huge spike in acceleration: they are converted into a velocity kick and
// squashed through a soft limit, so a hard landing bounces strongly without ever tearing the mesh.

const SPEC = {
  // f: natural frequency per axis (Hz) [side, vertical, front], zeta: damping ratio,
  // gain: how much of the inertial force the mass feels per axis, max: soft travel limit (metres),
  // tilt: radians of rotation per metre of travel (curves the shape as it swings)
  pivot: { f: [3.6, 3.0, 3.4], zeta: 0.16, gain: [0.06, 0.12, 0.08], max: [0.018, 0.036, 0.022], tilt: 5.5 },
  tip: { f: [4.6, 4.0, 4.4], zeta: 0.2, gain: [0.04, 0.07, 0.05], max: [0.012, 0.022, 0.014], tilt: 3.0 },
};
const SUB = 1 / 240;           // integration step (stable for these stiffnesses)
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();

class Spring {
  constructor(bone, spec) {
    this.bone = bone; this.spec = spec;
    this.rest = bone.position.clone();
    this.restQ = bone.quaternion.clone();
    this.p = new THREE.Vector3(); this.v = new THREE.Vector3();
    this.anchor = new THREE.Vector3(); this.prev = null; this.prevVel = new THREE.Vector3();
    this.k = spec.f.map((f) => (2 * Math.PI * f) ** 2);
    this.c = spec.f.map((f) => 2 * spec.zeta * 2 * Math.PI * f);
  }
  // the bone's rest point in world space (where the animated parent carries it)
  _anchor(out) {
    const par = this.bone.parent;
    par.updateWorldMatrix(true, false);
    return out.copy(this.rest).applyMatrix4(par.matrixWorld);
  }
  reset() { this.p.set(0, 0, 0); this.v.set(0, 0, 0); this.prev = null; }
  step(dt, strength) {
    if (dt <= 0) return;
    dt = Math.min(dt, 1 / 20);
    const par = this.bone.parent;
    this._anchor(this.anchor);
    if (!this.prev) { this.prev = this.anchor.clone(); this.prevVel.set(0, 0, 0); this._apply(); return; }
    // a teleport / respawn is not motion: start over instead of reading it as a huge jolt
    if (this.anchor.distanceToSquared(this.prev) > 2.25) { this.prev.copy(this.anchor); this.prevVel.set(0, 0, 0); return; }
    // world velocity and acceleration of the anchor
    const vel = _v.subVectors(this.anchor, this.prev).divideScalar(dt);
    const acc = _s.subVectors(vel, this.prevVel).divideScalar(dt);
    this.prev.copy(this.anchor); this.prevVel.copy(vel);
    // into the parent's local frame (rotation only; unscale)
    par.matrixWorld.decompose(_e._p || (_e._p = new THREE.Vector3()), _q, _e._sc || (_e._sc = new THREE.Vector3()));
    const sc = _e._sc.x || 1;
    _qi.copy(_q).invert();
    acc.applyQuaternion(_qi).divideScalar(sc);
    // the inertial "kick": -acceleration × gain, as a velocity change spread over this frame
    const G = this.spec.gain, k = this.k, c = this.c, max = this.spec.max;
    const kick = [-acc.x * G[0] * strength, -acc.y * G[1] * strength, -acc.z * G[2] * strength];
    let left = dt;
    const p = this.p, v = this.v;
    const ax = ['x', 'y', 'z'];
    while (left > 1e-6) {
      const h = Math.min(SUB, left); left -= h;
      for (let i = 0; i < 3; i++) {
        const a = ax[i];
        // spread the frame's inertial impulse evenly over the substeps
        const f = kick[i] - k[i] * p[a] - c[i] * v[a];
        v[a] += f * h;
        p[a] += v[a] * h;
        // soft travel limit: past ~70% of the range the spring stiffens sharply and sheds velocity
        const m = max[i], ex = Math.abs(p[a]) - m * 0.7;
        if (ex > 0) {
          const sgn = Math.sign(p[a]), lim = m * 0.7 + m * 0.3 * Math.tanh(ex / (m * 0.3));
          if (sgn * v[a] > 0) v[a] *= 0.6;
          p[a] = sgn * lim;
        }
      }
    }
    this._apply();
  }
  _apply() {
    const b = this.bone, p = this.p, t = this.spec.tilt;
    b.position.copy(this.rest).add(p);
    // swing the shape with its travel: up/down pitches it, side to side rolls it a little
    _e.set(-p.y * t + p.z * t * 0.4, 0, p.x * t * 0.6);
    b.quaternion.copy(this.restQ).multiply(_q.setFromEuler(_e));
  }
}

export class JiggleSim {
  static create(model, opts = {}) {
    const names = { breast_L: 'pivot', breast_R: 'pivot', breastTip_L: 'tip', breastTip_R: 'tip' };
    const springs = [];
    model.traverse((o) => { if (o.isBone && names[o.name]) springs.push(new Spring(o, SPEC[names[o.name]])); });
    if (!springs.length) return null;
    // parents first, so a tip always sees its pivot's motion of this frame
    springs.sort((a, b) => (SPEC.tip === a.spec ? 1 : 0) - (SPEC.tip === b.spec ? 1 : 0));
    return new JiggleSim(springs, opts);
  }
  constructor(springs, opts) { this.springs = springs; this.strength = opts.strength ?? 1; }
  reset() { for (const s of this.springs) s.reset(); }
  step(dt) { for (const s of this.springs) s.step(dt, this.strength); }
}
