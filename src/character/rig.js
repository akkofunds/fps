import * as THREE from 'three';

// Retargeting rig for auto-rigged characters.
//
// Every bone in the GLB has an identity rest rotation, but the mesh was modelled in a lopsided
// A-pose (one arm swung back, one leg splayed). Animations are authored in a clean, symmetric
// "canonical" pose where every bone frame is world-aligned (X = character's left, Y = up,
// Z = forward). For each bone we precompute the world rotation Wc that carries the bind-pose
// bone onto its canonical direction; an authored local rotation A is then applied as
//     local = Wc(parent)^-1 * A * Wc(bone)
// which is exactly "pose the canonical rig, then deform the real mesh".

export const BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L',
  'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R',
  'upperLeg_L', 'lowerLeg_L', 'foot_L', 'toes_L',
  'upperLeg_R', 'lowerLeg_R', 'foot_R', 'toes_R',
];
export const B = Object.fromEntries(BONES.map((n, i) => [n.replace('_', ''), i]));
export const NB = BONES.length;
export const UPPER_MASK = new Float32Array(NB);
for (const n of ['spine', 'chest', 'upperChest', 'neck', 'head', 'shoulder_L', 'upperArm_L', 'foreArm_L', 'hand_L', 'shoulder_R', 'upperArm_R', 'foreArm_R', 'hand_R']) UPPER_MASK[BONES.indexOf(n)] = 1;
UPPER_MASK[B.spine] = 0.6;

const D2R = Math.PI / 180;
const dirFromDeg = (out, side, down, fwd) => {
  // out: degrees away from vertical toward the character's own side, fwd: toward +Z
  const a = out * D2R, f = fwd * D2R;
  return new THREE.Vector3(Math.sin(a) * side, -Math.cos(a) * Math.cos(f), Math.sin(f) * Math.cos(a)).normalize();
};

// canonical (rest-of-animation) directions of the limb bones
const CANON = {
  'upperArm_L': () => dirFromDeg(13, 1, 0, 0),
  'foreArm_L': () => dirFromDeg(8, 1, 0, 8),
  'hand_L': () => dirFromDeg(8, 1, 0, 8),
  'upperArm_R': () => dirFromDeg(13, -1, 0, 0),
  'foreArm_R': () => dirFromDeg(8, -1, 0, 8),
  'hand_R': () => dirFromDeg(8, -1, 0, 8),
  'upperLeg_L': () => dirFromDeg(3, 1, 0, 0),
  'lowerLeg_L': () => dirFromDeg(2, 1, 0, -1),
  'upperLeg_R': () => dirFromDeg(3, -1, 0, 0),
  'lowerLeg_R': () => dirFromDeg(2, -1, 0, -1),
};
const CHILD = {
  'upperArm_L': 'foreArm_L', 'foreArm_L': 'hand_L', 'hand_L': 'hand_L_end',
  'upperArm_R': 'foreArm_R', 'foreArm_R': 'hand_R', 'hand_R': 'hand_R_end',
  'upperLeg_L': 'lowerLeg_L', 'lowerLeg_L': 'foot_L',
  'upperLeg_R': 'lowerLeg_R', 'lowerLeg_R': 'foot_R',
};

const _q = new THREE.Quaternion();

export class Rig {
  constructor(root) {
    this.root = root;
    this.bones = [];
    const byName = {};
    root.traverse((o) => { if (o.name) byName[o.name] = o; });
    for (const n of BONES) {
      const b = byName[n];
      if (!b) throw new Error('rig: missing bone ' + n);
      this.bones.push(b);
    }
    this.ends = { head: byName.head_end, handL: byName['hand_L_end'], handR: byName['hand_R_end'] };
    this.bindPos = this.bones.map((b) => b.position.clone());
    // world (root-space) bind positions — rest rotations are identity so a sum of offsets
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const wp = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
    this.restWorld = this.bones.map(wp);
    this.parent = this.bones.map((b) => BONES.indexOf(b.parent && b.parent.name));
    // world corrections
    this.Wc = this.bones.map(() => new THREE.Quaternion());
    BONES.forEach((n, i) => {
      if (CANON[n]) {
        const child = byName[CHILD[n]];
        const d = wp(child).sub(this.restWorld[i]).normalize();
        this.Wc[i].setFromUnitVectors(d, CANON[n]());
      } else if (n.startsWith('foot') || n.startsWith('toes')) {
        // square the boots up: yaw the toe direction onto +Z (the bind pose has them splayed)
        const toes = n.startsWith('foot') ? this.bones[i].children.find((c) => c.name.startsWith('toes')) : byName[n + '_end'];
        const d = wp(toes).sub(this.restWorld[i]); d.y = 0; d.normalize();
        this.Wc[i].setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(d.x, d.z));
      } else this.Wc[i].identity();
    });
    this.WcParentInv = this.parent.map((p) => (p >= 0 ? this.Wc[p].clone().invert() : new THREE.Quaternion()));
    this.hipHeight = this.restWorld[B.hips].y;
    // canonical leg length (hip → ankle) for IK-ish ground adaptations
    this.legLen = this.restWorld[B.upperLegL].distanceTo(this.restWorld[B.lowerLegL]) + this.restWorld[B.lowerLegL].distanceTo(this.restWorld[B.footL]);
    // data for the canonical-space leg IK
    const legs = {};
    for (const s of ['L', 'R']) {
      const hip = this.restWorld[B['upperLeg' + s]], knee = this.restWorld[B['lowerLeg' + s]], ank = this.restWorld[B['foot' + s]];
      legs[s] = {
        hipOff: hip.clone().sub(this.restWorld[B.hips]),
        l1: hip.distanceTo(knee), l2: knee.distanceTo(ank),
        c1: CANON['upperLeg_' + s](), c2: CANON['lowerLeg_' + s](),
      };
    }
    this.legs = legs;
    this.ankleHeight = (this.restWorld[B.footL].y + this.restWorld[B.footR].y) / 2;
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
    h.position.set(this.bindPos[B.hips].x + pose.hip[0], this.bindPos[B.hips].y + pose.hip[1], this.bindPos[B.hips].z + pose.hip[2]);
  }
}
