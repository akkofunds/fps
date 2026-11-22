import * as THREE from 'three';

// Soft-body secondary motion for the chest, done the way anime action games do it: a spring bone.
//
// The model carries extra bones the animation rig never touches (see tools/characters/rig_yixuan.py):
//   breast_L / breast_R        a hinge on the upper chest (source: Skn_*_Chest)
//   breastTip_L / breastTip_R  the centre of the soft mass, a child of the hinge (source: Skn_*_Chest_Cj_01)
//
// Each side is one weighted point (the tip) hanging off its hinge. Every frame the animation carries
// the hinge somewhere new; the point lags behind with its own inertia (Verlet), is pulled back toward
// where the pose wants it by a spring, loses some speed to drag, and is kept at its fixed distance
// from the hinge. The hinge then ROTATES to aim at the point, so the shape swings and settles about
// its root instead of sliding around: a soft follow-through on every step, a heavier swing and one or
// two settling bounces on a landing or a dash, never a rubbery jelly wobble. The swing angle is soft-
// limited so a big hit can never fold the mesh.

const SPEC = {
  stiff: 0.045,   // share of the gap to the posed position closed per 1/60 s: a soft ~2.8 Hz swing
  drag: 0.06,     // share of the wobble lost per 1/60 s: a landing rings 3-4 times, each smaller
  inertia: 2.6,   // how hard the body's own accelerations throw the mass (its weight)
  maxAng: 0.55,   // soft limit on the simulated swing (radians, ~32°)
  gain: 1.5,      // how much further the hinge turns than the swing (the skin is only partly bound to it)
  lever: new THREE.Vector3(0, -0.045, 0.112),   // hinge → centre of the mass, in model space (metres; +z = her front)
};
// the two sides are not quite identical, so they drift a little apart while staying attached
const SIDE = { L: { stiff: 1.0, drag: 1.0 }, R: { stiff: 0.88, drag: 1.15 } };
const SUB = 1 / 120;
const _P = new THREE.Vector3(), _T = new THREE.Vector3(), _Qw = new THREE.Quaternion(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _tm = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _ax = new THREE.Vector3(), _tg = new THREE.Vector3(), _pv = new THREE.Vector3(), _v = new THREE.Vector3();

class SpringBone {
  constructor(hinge, tip, spec) {
    this.bone = hinge; this.tip = tip; this.spec = spec;
    this.restQ = hinge.quaternion.clone();
    this.tipPos = tip.position.clone(); this.tipQ = tip.quaternion.clone();
    // the lever: from the hinge to the centre of the soft mass. The source rig puts its "tip" bone
    // almost on top of the hinge (3-4 mm), far too short to swing on, so the lever is set in the
    // model's own space (forward and a little down, where the mass really is) and carried into the
    // hinge's frame
    this.lever = spec.lever.clone();
    this.cur = null; this.prev = new THREE.Vector3(); this.lastT = new THREE.Vector3(); this.lastP = new THREE.Vector3();
    this.lastD = new THREE.Vector3(); this.warm = false;
    this.p = new THREE.Vector3();   // where the mass is relative to where the pose puts it (metres, world axes)
  }
  // the hinge back in its posed rotation: where it is, where the tip would be if rigid, its world rotation
  _posed() {
    const b = this.bone;
    b.quaternion.copy(this.restQ);
    this.tip.position.copy(this.tipPos); this.tip.quaternion.copy(this.tipQ);
    b.updateWorldMatrix(true, false);
    b.getWorldPosition(_P);
    _T.copy(this.lever).applyMatrix4(b.matrixWorld);
    b.getWorldQuaternion(_Qw);
  }
  _apply() { this.bone.quaternion.copy(this.restQ); this.tip.position.copy(this.tipPos); this.p.set(0, 0, 0); }
  reset() { this.cur = null; this._apply(); }
  step(dt, strength) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    this._posed();
    if (!this.cur || _T.distanceToSquared(this.lastT) > 1) {   // first frame, or a teleport / respawn
      this.cur = _T.clone(); this.prev.copy(_T); this.lastT.copy(_T); this.lastP.copy(_P); this.p.set(0, 0, 0);
      this.lastD.set(0, 0, 0); this.warm = false;
      return;
    }
    const { stiff, drag, maxAng, inertia } = this.spec;
    const n = Math.max(1, Math.ceil(dt / SUB)), h = dt / n;
    const keep = Math.pow(1 - drag, h * 60), pull = 1 - Math.pow(1 - stiff, h * 60);
    const cur = this.cur;
    for (let i = 1; i <= n; i++) {
      // the pose moves smoothly across the frame
      const u = i / n;
      _tm.lerpVectors(this.lastT, _T, (i - 1) / n);
      _tg.lerpVectors(this.lastT, _T, u); _pv.lerpVectors(this.lastP, _P, u);
      // inertia: the mass keeps its velocity; drag only eats the part that differs from the body's
      // own motion (the wobble), never the steady motion of running or flying along
      _d.subVectors(_tg, _tm);                                    // how far the body moved this substep
      _v.subVectors(cur, this.prev).sub(_d).multiplyScalar(keep).add(_d);
      // weight: the body's change of speed throws the mass the other way, harder than bare inertia
      _ax.subVectors(_d, this.lastD); this.lastD.copy(_d);
      if (this.warm) _v.addScaledVector(_ax, -(inertia - 1)); else this.warm = true;
      this.prev.copy(cur);
      cur.add(_v).addScaledVector(_d.subVectors(_tg, cur), pull);
      // the mass stays its own distance from the hinge…
      const L = _a.subVectors(_tg, _pv).length();
      _b.subVectors(cur, _pv);
      if (_b.lengthSq() < 1e-12) _b.copy(_a);
      _b.setLength(L);
      // …and swings no further than the soft limit
      _a.normalize();
      const ang = _a.angleTo(_d.copy(_b).normalize());
      if (ang > 1e-5) {
        const lim = maxAng * Math.tanh(ang / maxAng);
        if (lim < ang) { _ax.crossVectors(_a, _d).normalize(); _b.copy(_a).applyAxisAngle(_ax, lim).multiplyScalar(L); }
      }
      cur.addVectors(_pv, _b);
    }
    this.lastT.copy(_T); this.lastP.copy(_P);
    // turn the hinge so the mass sits where the simulation put it
    _a.subVectors(_T, _P).normalize(); _b.subVectors(cur, _P).normalize();
    _q.setFromUnitVectors(_a, _b);
    // the skin only follows these bones partway (about 40% on average, the rest stays on the upper
    // chest), so the hinge turns further than the simulated swing for the flesh to show all of it
    const w = Math.min(1, Math.max(-1, _q.w)), ang = 2 * Math.acos(w), sn = Math.sqrt(1 - w * w);
    if (sn > 1e-6) { _ax.set(_q.x / sn, _q.y / sn, _q.z / sn); _q.setFromAxisAngle(_ax, ang * this.spec.gain * Math.max(0, strength)); }
    // world-space turn → the hinge's own frame
    _qi.copy(_Qw).invert();
    this.bone.quaternion.copy(this.restQ).multiply(_qi.multiply(_q).multiply(_Qw));
    this.p.subVectors(cur, _T);
  }
}

export class JiggleSim {
  static create(model, opts = {}) {
    const springs = [];
    for (const side of ['L', 'R']) {
      let hinge = null, tip = null;
      model.traverse((o) => { if (o.isBone && o.name === 'breast_' + side) hinge = o; if (o.isBone && o.name === 'breastTip_' + side) tip = o; });
      if (!hinge || !tip) continue;
      // the model-space lever, expressed in the hinge's own frame (rotation and scale)
      model.updateMatrixWorld(true);
      const mInv = new THREE.Matrix4().copy(model.matrixWorld).invert();
      const hm = new THREE.Matrix4().multiplyMatrices(mInv, hinge.matrixWorld);   // hinge in model space
      const lever = SPEC.lever.clone().transformDirection(new THREE.Matrix4().copy(hm).invert());
      const sc = new THREE.Vector3().setFromMatrixScale(hm).x || 1;
      lever.multiplyScalar(SPEC.lever.length() / sc);
      const k = SIDE[side];
      springs.push(new SpringBone(hinge, tip, { ...SPEC, stiff: SPEC.stiff * k.stiff, drag: SPEC.drag * k.drag, ...(opts.spec || {}), lever }));
    }
    if (!springs.length) return null;
    return new JiggleSim(springs, opts);
  }
  constructor(springs, opts) { this.springs = springs; this.strength = opts.strength ?? 1; }
  reset() { for (const s of this.springs) s.reset(); }
  step(dt) { for (const s of this.springs) s.step(dt, this.strength); }
}
