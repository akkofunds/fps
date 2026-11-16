import * as THREE from 'three';

// Cape physics. The cape is skinned to three strands of bones (left / centre / right, 3 segments
// each) hanging from a root bone on the upper chest. Every strand is a small verlet rope in WORLD
// space: it keeps the character's real motion (runs, dashes, jumps, falls, knockback) as inertia,
// gravity pulls it down, air drag lets it stream out behind, and a soft pull toward the draped
// rest shape keeps it reading as a cape instead of a rope. A cylinder around the body axis stops
// it passing through her back and legs. Results are written back as bone rotations.

const STRANDS = ['L', 'C', 'R'];
const G = new THREE.Vector3(0, -9.8, 0);
const side = new THREE.Vector3(), _v = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _l = new THREE.Vector3();
const _pq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _iq = new THREE.Quaternion();
const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4();
const STIFF = [0, 0.035, 0.014, 0.007]; // gentle: gravity and the air do most of the work // pull toward the draped shape per 60 Hz step (none at the pinned top)

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
    const damp = Math.pow(0.988, h * 60);
    const drag = 1 - Math.min(0.5, 3.0 * h); // linear air drag on each point's own velocity
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
          _v.subVectors(p, q).multiplyScalar(damp * drag);
          q.copy(p);
          p.add(_v).addScaledVector(G, h * h);
          // always a little breeze, so the cape never hangs dead still
          const breeze = 1.2 + Math.sin(this.t * 1.7 + k) * 0.8 + Math.sin(this.t * 4.3 + st.seed) * 0.6;
          p.addScaledVector(back, breeze * k * 0.33 * h * h);
          p.addScaledVector(side.set(-back.z, 0, back.x), Math.sin(this.t * 2.9 + st.seed * 2 + k) * 0.7 * k * 0.33 * h * h);
          if (wind > 0) {
            const gust = wind * (9 + Math.sin(this.t * 7.3) * 4 + k * 2);
            p.addScaledVector(back, gust * h * h).y += wind * 3 * h * h;
          }
          // soft shape memory
          p.lerp(st.rest[k], 1 - Math.pow(1 - STIFF[k], h * 60));
        }
      }
      // constraints
      for (let pass = 0; pass < 2; pass++) for (const st of this.strands) {
        for (let k = 0; k < 3; k++) {
          const a = st.p[k], b = st.p[k + 1];
          const L = st.offs[k].length() * scale;
          _d.subVectors(b, a); const len = _d.length() || 1e-6;
          b.copy(a).addScaledVector(_d, L / len);
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
