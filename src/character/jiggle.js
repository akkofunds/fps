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
  drag: 0.06,     // share of the wobble lost per 1/60 s: settles in two or three soft bounces
  inertia: 2.4,   // how hard the body's own accelerations throw the mass (its weight)
  maxAng: 0.5,    // soft limit on the simulated swing (radians, ~29°)
  gain: 1.45,     // how much further the hinge turns than the swing (the skin is only partly bound to it)
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
    this.p.subVectors(cur, _T);
    if (this.spec.move) {
      // flesh mode (the thighs): the bone sits inside the mass it carries, so instead of turning it
      // shifts the flesh by the simulated offset, in its parent's frame
      const par = this.bone.parent;
      par.getWorldQuaternion(_q).invert();
      const sc = new THREE.Vector3().setFromMatrixScale(par.matrixWorld).x || 1;
      _d.copy(this.p).applyQuaternion(_q).multiplyScalar(this.spec.gain * Math.max(0, strength) / sc);
      this.bone.position.copy(this.tipPos).add(_d);
      return;
    }
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

// ---------------------------------------------------------------- hair
// Each lock of hair is a chain of joints swung like a rope of spring bones (the classic anime-game
// setup): every joint's tip is a particle with inertia that trails behind when she moves (air drag on
// its absolute speed, so hair streams back as she runs), sags a little under gravity, is pulled back
// toward the styled shape, keeps its length, and is pushed out of her head and torso. Joints are
// solved from the scalp down, each turning to aim at its particle, so the motion travels down the lock.
const HAIR = { stiff: 0.1, drag: 0.1, gravity: 2.2 };
// cloth (the long hanging sleeves, jacket flaps) and dangling ornaments: heavier, hang more, follow less
const CLOTH = { stiff: 0.055, drag: 0.17, gravity: 5.5 };
class HairChain {
  constructor(bones, colliders, spec = HAIR) {
    this.bones = bones; this.col = colliders; this.spec = spec;
    this.restQ = bones.map((b) => b.quaternion.clone());
    // each joint points at the next one; the last one carries on in the same direction, a bit shorter
    this.lever = bones.map((b, k) => (k + 1 < bones.length ? bones[k + 1].position.clone() : bones[k].position.clone().multiplyScalar(0.8)));
    this.cur = null; this.prev = null;
    // stiffer near the scalp, looser toward the ends
    this.k = bones.map((_, k) => spec.stiff * (1.6 - 0.9 * k / Math.max(1, bones.length - 1)));
  }
  reset() { this.cur = null; this.bones.forEach((b, k) => b.quaternion.copy(this.restQ[k])); }
  step(dt) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    const f = dt * 60, keep = Math.pow(1 - this.spec.drag, f), g = this.spec.gravity * dt * dt;
    const first = !this.cur;
    if (first) { this.cur = this.bones.map(() => new THREE.Vector3()); this.prev = this.bones.map(() => new THREE.Vector3()); }
    for (let k = 0; k < this.bones.length; k++) {
      const b = this.bones[k];
      b.quaternion.copy(this.restQ[k]);
      b.updateWorldMatrix(k === 0, false);
      b.getWorldPosition(_P); b.getWorldQuaternion(_Qw);
      _T.copy(this.lever[k]).applyMatrix4(b.matrixWorld);
      const cur = this.cur[k], prev = this.prev[k];
      if (first || cur.distanceToSquared(_T) > 1) {
        cur.copy(_T); prev.copy(_T);
        // collide only with the spheres this joint's styled position sits outside of
        this.use = this.use || [];
        this.use[k] = this.col.map((c) => c.bone.localToWorld(_tg.copy(c.off)).distanceTo(_T) > c.r + 0.012);
      }
      const pull = 1 - Math.pow(1 - this.k[k], f);
      _v.subVectors(cur, prev).multiplyScalar(keep);
      prev.copy(cur);
      cur.add(_v).addScaledVector(_d.subVectors(_T, cur), pull);
      cur.y -= g;
      const L = _a.subVectors(_T, _P).length();
      for (let it = 0; it < 2; it++) {
        _b.subVectors(cur, _P).setLength(L); cur.addVectors(_P, _b);
        for (let ci = 0; ci < this.col.length; ci++) {   // keep out of her head and body
          if (!this.use[k][ci]) continue;
          const c = this.col[ci];
          c.bone.localToWorld(_tg.copy(c.off));
          _d.subVectors(cur, _tg); const r = c.r + 0.012, d2 = _d.lengthSq();
          if (d2 < r * r && d2 > 1e-10) cur.copy(_tg).addScaledVector(_d, r / Math.sqrt(d2));
        }
      }
      _a.normalize(); _b.subVectors(cur, _P).normalize();
      _q.setFromUnitVectors(_a, _b);
      _qi.copy(_Qw).invert();
      b.quaternion.copy(this.restQ[k]).multiply(_qi.multiply(_q).multiply(_Qw));
      b.updateWorldMatrix(false, false);
    }
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
    // the thighs: a firm, quick little spring on each (the flesh settling after every footfall)
    for (const side of ['L', 'R']) {
      let th = null; model.traverse((o) => { if (o.isBone && o.name === 'thigh_' + side) th = o; });
      if (!th) continue;
      model.updateMatrixWorld(true);
      const mInv = new THREE.Matrix4().copy(model.matrixWorld).invert();
      const hm = new THREE.Matrix4().multiplyMatrices(mInv, th.matrixWorld);
      const lv = new THREE.Vector3(0, -0.05, 0.07);
      const lever = lv.clone().transformDirection(new THREE.Matrix4().copy(hm).invert()).multiplyScalar(lv.length() / (new THREE.Vector3().setFromMatrixScale(hm).x || 1));
      springs.push(new SpringBone(th, th, { ...SPEC, stiff: 0.08, drag: 0.11, inertia: 2.2, maxAng: 0.35, gain: 0.6, lever, move: true }));
    }
    // hair chains: hair<lock><n>, with her head and torso as colliders
    const byName = {}; model.traverse((o) => { if (o.isBone) byName[o.name] = o; });
    const chains = [];
    if (byName.head) {
      const col = [
        { bone: byName.head, off: new THREE.Vector3(0, 0.09, 0.01), r: 0.1 },
        byName.neck && { bone: byName.neck, off: new THREE.Vector3(0, 0.02, 0), r: 0.06 },
        byName.upperChest && { bone: byName.upperChest, off: new THREE.Vector3(0, 0.0, -0.01), r: 0.13 },
        byName.chest && { bone: byName.chest, off: new THREE.Vector3(0, -0.04, -0.01), r: 0.12 },
        byName.hips && { bone: byName.hips, off: new THREE.Vector3(0, 0.02, -0.02), r: 0.14 },
      ].filter(Boolean);
      // the legs too, for the hanging sleeves and the jacket flaps
      for (const sd of ['L', 'R']) if (byName['upperLeg_' + sd]) col.push({ bone: byName['upperLeg_' + sd], off: new THREE.Vector3(0, -0.2, 0.01), r: 0.085 });
      const groups = {};
      for (const n in byName) { const m = /^((?:hair|cloth)[A-Z]+)(\d+)$/.exec(n); if (m) (groups[m[1]] = groups[m[1]] || [])[+m[2] - 1] = byName[n]; }
      for (const g in groups) chains.push(new HairChain(groups[g].filter(Boolean), col, g.startsWith('cloth') ? CLOTH : HAIR));
    }
    if (!springs.length && !chains.length) return null;
    const sim = new JiggleSim(springs, opts); sim.chains = chains;
    return sim;
  }
  constructor(springs, opts) { this.springs = springs; this.chains = []; this.strength = opts.strength ?? 1; }
  reset() { for (const s of this.springs) s.reset(); for (const c of this.chains) c.reset(); }
  step(dt) { for (const s of this.springs) s.step(dt, this.strength); for (const c of this.chains) c.step(dt); }
}
