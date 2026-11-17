import * as THREE from 'three';

// Cape physics. The cape is skinned to three strands of bones (left / centre / right, 3 segments
// each) hanging from a root bone on the upper chest. Every strand is a small verlet rope in WORLD
// space: it keeps the character's real motion (runs, dashes, jumps, falls, knockback) as inertia,
// gravity pulls it down, air drag lets it stream out behind, and a soft pull toward the draped
// rest shape keeps it reading as a cape instead of a rope. A cylinder around the body axis stops
// it passing through her back and legs. Results are written back as bone rotations.

const STRANDS = ['L', 'C', 'R'];
const G = new THREE.Vector3(0, -9.8, 0);
const _a = new THREE.Vector3(), _avg = new THREE.Vector3(), _o = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _l = new THREE.Vector3();
const _pq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _iq = new THREE.Quaternion();
const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4();
// pull toward the draped shape per 60 Hz step (none at the pinned top): a heavy wool cloak, not silk
const STIFF = [0, 0.07, 0.045, 0.03];
const INNER = 0.93;      // internal damping per 60 Hz step (motion relative to her body dies out fast)
const AIR = 1.4;         // air drag per second on the cloth's own velocity (streams out when moving)
const COUPLE = 0.45;     // strands move together as one sheet (no jelly shearing between them)
const BEND = 0.2;       // each segment keeps its parent's direction (no rubbery folding)
const MAX_OFF = [0, 0.24, 0.42, 0.56]; // max distance (m) a joint may stray from the drape

export class CapeSim {
  constructor(model) {
    const by = {};
    model.traverse((o) => { if (o.name) by[o.name] = o; });
    this.root = by.cape || null;
    this.ok = !!this.root && STRANDS.every((s) => by[`cape_${s}0`] && by[`cape_${s}1`] && by[`cape_${s}2`] && by[`cape_${s}2_end`]);
    if (!this.ok) return;
    this.strands = STRANDS.map((s) => {
      const bones = [0, 1, 2].map((k) => by[`cape_${s}${k}`]);
      const offs = [by[`cape_${s}1`].position, by[`cape_${s}2`].position, by[`cape_${s}2_end`].position].map((p) => p.clone());
      return { seed: Math.random() * 6, bones, offs, p: [0, 1, 2, 3].map(() => new THREE.Vector3()), prev: [0, 1, 2, 3].map(() => new THREE.Vector3()), rest: [0, 1, 2, 3].map(() => new THREE.Vector3()), restR: [0, 0, 0, 0], restZ: [0, 0, 0, 0] };
    });
    this.init = false;
    this.wind = 0;
  }

  reset() { this.init = false; }

  // rest (draped) positions of every strand joint for the current body pose, in world space
  _restPose(scale) {
    this.root.updateWorldMatrix(true, false);
    this.root.getWorldQuaternion(_pq);
    for (const st of this.strands) {
      const b0 = st.bones[0];
      for (const b of st.bones) b.quaternion.identity();
      b0.updateWorldMatrix(false, false);
      st.rest[0].setFromMatrixPosition(b0.matrixWorld);
      for (let k = 0; k < 3; k++) st.rest[k + 1].copy(st.offs[k]).multiplyScalar(scale).applyQuaternion(_pq).add(st.rest[k]);
    }
  }

  step(dt, opts = {}) {
    if (!this.ok || dt <= 0) return;
    this.root.updateWorldMatrix(true, false);
    const scale = _v.setFromMatrixScale(this.root.matrixWorld).x;
    this._restPose(scale);
    _inv.copy(this.root.matrixWorld).invert();
    // first frame / teleport (respawn, blink): snap to the drape
    const jump = this.init ? this.strands[1].p[0].distanceTo(this.strands[1].rest[0]) : Infinity;
    if (jump > 2.5) {
      for (const st of this.strands) for (let k = 0; k < 4; k++) {
        st.p[k].copy(st.rest[k]); st.prev[k].copy(st.rest[k]);
        _l.copy(st.rest[k]).applyMatrix4(_inv);
        st.restR[k] = Math.hypot(_l.x, _l.z); st.restZ[k] = _l.z;
      }
      this.init = true;
    }
    const wind = (opts.wind || 0) + this.wind;
    const n = Math.min(4, Math.max(1, Math.ceil(dt / (1 / 60))));
    const h = Math.min(dt, 0.1) / n;
    const inner = Math.pow(INNER, h * 60);
    const drag = 1 - Math.min(0.5, AIR * h);
    // how far the body moved this frame (per substep): internal damping works relative to it
    this.prevAnchor = this.prevAnchor || this.strands[1].rest[0].clone();
    const anchorV = _a.subVectors(this.strands[1].rest[0], this.prevAnchor).divideScalar(n);
    if (anchorV.length() > 1) anchorV.set(0, 0, 0); // teleport
    this.prevAnchor.copy(this.strands[1].rest[0]);
    // backward in the chest frame (the cape's local -z points away from her back)
    const back = _r.set(0, 0, -1).applyQuaternion(this.root.getWorldQuaternion(_q)).setY(0).normalize();
    for (let it = 0; it < n; it++) {
      this.t = (this.t || 0) + h;
      for (const st of this.strands) {
        st.p[0].copy(st.rest[0]); st.prev[0].copy(st.rest[0]);
        for (let k = 1; k < 4; k++) {
          const p = st.p[k], q = st.prev[k];
          // inertia with air drag: when she runs the cape streams out behind, when she falls it
          // billows up, when she lands it swings down past rest and settles
          _v.subVectors(p, q);
          // velocity relative to her body is damped hard (one soft swing, no wobble), the
          // absolute velocity feels the air
          _v.sub(anchorV).multiplyScalar(inner).add(anchorV).multiplyScalar(drag);
          q.copy(p);
          p.add(_v).addScaledVector(G, h * h);
          // a faint, slow breeze so it is never perfectly dead still
          const breeze = 0.5 + Math.sin(this.t * 0.9 + k * 0.4) * 0.3;
          p.addScaledVector(back, breeze * k * 0.3 * h * h);
          if (wind > 0) {
            const gust = wind * (9 + Math.sin(this.t * 7.3) * 4 + k * 2);
            p.addScaledVector(back, gust * h * h).y += wind * 3 * h * h;
          }
          // soft shape memory
          p.lerp(st.rest[k], 1 - Math.pow(1 - STIFF[k], h * 60));
        }
      }
      // the three strands are one sheet: pull each joint's offset from the drape toward the
      // sheet's average offset, and cap how far it can stray
      for (let k = 1; k < 4; k++) {
        _avg.set(0, 0, 0);
        for (const st of this.strands) _avg.add(_o.subVectors(st.p[k], st.rest[k]));
        _avg.divideScalar(this.strands.length);
        for (const st of this.strands) {
          _o.subVectors(st.p[k], st.rest[k]).lerp(_avg, COUPLE);
          const L = _o.length();
          if (L > MAX_OFF[k]) _o.multiplyScalar(MAX_OFF[k] / L);
          st.p[k].copy(st.rest[k]).add(_o);
        }
      }
      // constraints
      for (let pass = 0; pass < 2; pass++) for (const st of this.strands) {
        for (let k = 0; k < 3; k++) {
          const a = st.p[k], b = st.p[k + 1];
          const L = st.offs[k].length() * scale;
          _d.subVectors(b, a); const len = _d.length() || 1e-6;
          _d.divideScalar(len);
          // bending stiffness: lean toward the direction of the segment above
          if (k > 0) { _o.subVectors(st.p[k], st.p[k - 1]).normalize(); _d.lerp(_o, BEND).normalize(); }
          b.copy(a).addScaledVector(_d, L);
        }
        // stay outside the body: a vertical cylinder around the chest axis (+ never in front of
        // her back for the centre strand)
        for (let k = 1; k < 4; k++) {
          const p = st.p[k];
          _l.copy(p).applyMatrix4(_inv);
          const r = Math.hypot(_l.x, _l.z), minR = st.restR[k] * 0.82;
          if (r < minR) { const s = minR / Math.max(r, 1e-4); _l.x *= s; _l.z *= s; if (r < 1e-4) _l.z = -minR; }
          if (st === this.strands[1] && _l.z > st.restZ[k] * 0.4) _l.z = st.restZ[k] * 0.4;
          if (_l.y > -0.02 * k) _l.y = -0.02 * k; // never flips up over the shoulders
          p.copy(_l).applyMatrix4(this.root.matrixWorld);
        }
      }
    }
    // write back: aim each segment at the next simulated joint
    for (const st of this.strands) {
      for (let k = 0; k < 3; k++) {
        const b = st.bones[k];
        b.parent.getWorldQuaternion(_pq);
        _r.copy(st.offs[k]).applyQuaternion(_pq).normalize();          // rest direction (local rot = identity)
        _d.subVectors(st.p[k + 1], st.p[k]).normalize();               // simulated direction
        _q.setFromUnitVectors(_r, _d);
        _iq.copy(_pq).invert();
        b.quaternion.copy(_iq).multiply(_q).multiply(_pq);
        b.updateMatrix();
        b.matrixWorld.multiplyMatrices(b.parent.matrixWorld, b.matrix);
      }
    }
    void _m;
  }
}
