import * as THREE from 'three';

// Retargeting rig for auto-rigged characters.
//
// Every bone in the GLB has an identity rest rotation, but source meshes come in arbitrary poses
// (Pyro: lopsided A-pose; Meteora: a mid-air jump with folded legs). Animations are authored in a
// clean, symmetric "canonical" pose where every bone frame is world-aligned (X = character's left,
// Y = up, Z = forward). For each bone we precompute the world rotation Wc that carries the bind
// bone onto its canonical direction; an authored local rotation A is then applied as
//     local = Wc(parent)^-1 * A * Wc(bone)
// which is exactly "pose the canonical rig, then deform the real mesh".
// Because the bind pose may not be standing, we also run FK on the canonical pose to find how
// high the hips must sit for the soles to touch y = 0.

export const BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L',
  'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R',
  'upperLeg_L', 'lowerLeg_L', 'foot_L', 'toes_L',
  'upperLeg_R', 'lowerLeg_R', 'foot_R', 'toes_R',
  'prop_R', 'cape', // optional: staff held in the right hand, cape secondary motion
];
const OPTIONAL = { prop_R: 'hand_R', cape: 'upperChest' };
export const B = Object.fromEntries(BONES.map((n, i) => [n.replace('_', ''), i]));
export const NB = BONES.length;
export const UPPER_MASK = new Float32Array(NB);
for (const n of ['spine', 'chest', 'upperChest', 'neck', 'head', 'shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L', 'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R', 'prop_R']) UPPER_MASK[BONES.indexOf(n)] = 1;
UPPER_MASK[B.spine] = 0.6;

const D2R = Math.PI / 180;
const dirFromDeg = (out, side, fwd) => {
  // out: degrees away from vertical toward the character's own side, fwd: toward +Z
  const a = out * D2R, f = fwd * D2R;
  return new THREE.Vector3(Math.sin(a) * side, -Math.cos(a) * Math.cos(f), Math.sin(f) * Math.cos(a)).normalize();
};

// canonical (rest-of-animation) directions of the bones that get corrected
const CANON = {
  upperArm_L: () => dirFromDeg(13, 1, 0),
  foreArm_L: () => dirFromDeg(8, 1, 8),
  hand_L: () => dirFromDeg(8, 1, 8),
  upperArm_R: () => dirFromDeg(13, -1, 0),
  foreArm_R: () => dirFromDeg(8, -1, 8),
  hand_R: () => dirFromDeg(8, -1, 8),
  upperLeg_L: () => dirFromDeg(3, 1, 0),
  lowerLeg_L: () => dirFromDeg(2, 1, -1),
  upperLeg_R: () => dirFromDeg(3, -1, 0),
  lowerLeg_R: () => dirFromDeg(2, -1, -1),
  foot_L: () => new THREE.Vector3(0, -0.66, 0.75).normalize(),
  foot_R: () => new THREE.Vector3(0, -0.66, 0.75).normalize(),
  toes_L: () => new THREE.Vector3(0, -0.2, 1).normalize(),
  toes_R: () => new THREE.Vector3(0, -0.2, 1).normalize(),
  prop_R: () => new THREE.Vector3(0, 1, 0.12).normalize(), // staff held upright, a touch forward
};
const CHILD = {
  upperArm_L: 'foreArm_L', foreArm_L: 'hand_L', hand_L: 'hand_L_end',
  upperArm_R: 'foreArm_R', foreArm_R: 'hand_R', hand_R: 'hand_R_end',
  upperLeg_L: 'lowerLeg_L', lowerLeg_L: 'foot_L',
  upperLeg_R: 'lowerLeg_R', lowerLeg_R: 'foot_R',
  foot_L: 'toes_L', foot_R: 'toes_R', toes_L: 'toes_L_end', toes_R: 'toes_R_end',
  prop_R: 'prop_R_end',
};

const _q = new THREE.Quaternion();

export class Rig {
  constructor(root) {
    this.root = root;
    this.bones = [];
    const byName = {};
    root.traverse((o) => { if (o.name) byName[o.name] = o; });
    for (const n of BONES) {
      let b = byName[n];
      if (!b && OPTIONAL[n]) { b = new THREE.Bone(); b.name = n; byName[OPTIONAL[n]].add(b); b.userData.dummy = true; }
      if (!b) throw new Error('rig: missing bone ' + n);
      this.bones.push(b);
    }
    this.hasProp = !this.bones[B.propR].userData.dummy;
    this.hasCape = !this.bones[B.cape].userData.dummy;
    this.ends = { head: byName.head_end, handL: byName.hand_L_end, handR: byName.hand_R_end, prop: byName.prop_R_end || null };
    this.bindPos = this.bones.map((b) => b.position.clone());
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const wp = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
    this.restWorld = this.bones.map(wp);
    this.parent = this.bones.map((b) => BONES.indexOf(b.parent && b.parent.name));
    // world corrections: minimal arc from the bind direction to the canonical one
    this.Wc = this.bones.map(() => new THREE.Quaternion());
    BONES.forEach((n, i) => {
      if (!CANON[n] || this.bones[i].userData.dummy) return;
      const child = byName[CHILD[n]];
      if (!child) return;
      const d = wp(child).sub(this.restWorld[i]);
      if (n.startsWith('foot') || n.startsWith('toes')) {
        // keep the sole roughly level: correct yaw fully, pitch toward the canonical slope
        const c = CANON[n]();
        this.Wc[i].setFromUnitVectors(d.normalize(), c);
      } else this.Wc[i].setFromUnitVectors(d.normalize(), CANON[n]());
    });
    this.WcParentInv = this.parent.map((p) => (p >= 0 ? this.Wc[p].clone().invert() : new THREE.Quaternion()));

    // ---- canonical FK (all A = identity): where every joint sits when standing straight
    this.canon = this.bones.map(() => new THREE.Vector3());
    const Wact = this.bones.map(() => new THREE.Quaternion());
    for (let i = 0; i < NB; i++) {
      const p = this.parent[i];
      if (p < 0) { this.canon[i].copy(this.restWorld[i]); Wact[i].copy(this.Wc[i]); continue; }
      const off = this.restWorld[i].clone().sub(this.restWorld[p]);
      this.canon[i].copy(off.applyQuaternion(Wact[p])).add(this.canon[p]);
      Wact[i].copy(this.Wc[i]);
    }
    // toe tips in canonical pose → sole height
    const soleY = Math.min(this.canon[B.toesL].y, this.canon[B.toesR].y) - 0.036;
    this.lift = new THREE.Vector3(0, -soleY, 0);
    for (const c of this.canon) c.add(this.lift);
    this.restHips = this.canon[B.hips].clone();
    this.hipHeight = this.restHips.y;
    this.ankleHeight = (this.canon[B.footL].y + this.canon[B.footR].y) / 2;
    const legs = {};
    for (const s of ['L', 'R']) {
      const hip = this.canon[B['upperLeg' + s]], knee = this.canon[B['lowerLeg' + s]], ank = this.canon[B['foot' + s]];
      legs[s] = {
        hipOff: hip.clone().sub(this.restHips),
        l1: hip.distanceTo(knee), l2: knee.distanceTo(ank),
        c1: CANON['upperLeg_' + s](), c2: CANON['lowerLeg_' + s](),
      };
    }
    this.legs = legs;
    this.legLen = legs.L.l1 + legs.L.l2;
    this.height = this.canon[B.head].y + (this.ends.head ? this.ends.head.position.length() : 0.2);
  }

  // pose: { q: Float32Array(NB*4) canonical local rotations, hip: [x,y,z] offset in root space }
  apply(pose) {
    const q = pose.q;
    for (let i = 0; i < NB; i++) {
      const b = this.bones[i];
      _q.set(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]);
      b.quaternion.copy(this.WcParentInv[i]).multiply(_q).multiply(this.Wc[i]);
    }
    const h = this.bones[B.hips];
    h.position.set(this.bindPos[B.hips].x + this.lift.x + pose.hip[0], this.bindPos[B.hips].y + this.lift.y + pose.hip[1], this.bindPos[B.hips].z + this.lift.z + pose.hip[2]);
  }
}
