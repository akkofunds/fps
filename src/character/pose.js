import * as THREE from 'three';
import { NB, B } from './rig.js';

// Pose = canonical local rotations (quaternions, world-aligned bone frames) + hips offset.
// Angles in this file are DEGREES. Axes: +X = character's left, +Y = up, +Z = forward.
//   X rotation: limbs pointing down swing BACK for +, spine leans FORWARD for +
//   Y rotation: + turns toward the character's left
//   Z rotation: + raises the LEFT arm outward / leans the spine to the character's right
// Side helpers take values for the LEFT side and mirror them (x, -y, -z) for the right.

const D2R = Math.PI / 180;

export class Pose {
  constructor() { this.q = new Float32Array(NB * 4); this.hip = [0, 0, 0]; this.reset(); }
  reset() { const q = this.q; for (let i = 0; i < NB; i++) { q[i * 4] = q[i * 4 + 1] = q[i * 4 + 2] = 0; q[i * 4 + 3] = 1; } this.hip[0] = this.hip[1] = this.hip[2] = 0; return this; }
  copy(p) { this.q.set(p.q); this.hip[0] = p.hip[0]; this.hip[1] = p.hip[1]; this.hip[2] = p.hip[2]; return this; }
}

// write Euler XYZ (degrees) into slot i
export function setE(p, i, x, y, z) {
  const hx = x * D2R * 0.5, hy = y * D2R * 0.5, hz = z * D2R * 0.5;
  const c1 = Math.cos(hx), c2 = Math.cos(hy), c3 = Math.cos(hz), s1 = Math.sin(hx), s2 = Math.sin(hy), s3 = Math.sin(hz);
  const q = p.q, o = i * 4;
  q[o] = s1 * c2 * c3 + c1 * s2 * s3;
  q[o + 1] = c1 * s2 * c3 - s1 * c2 * s3;
  q[o + 2] = c1 * c2 * s3 + s1 * s2 * c3;
  q[o + 3] = c1 * c2 * c3 - s1 * s2 * s3;
}
// side-mirrored: side = 1 (left) or -1 (right)
export function setS(p, i, side, x, y, z) { setE(p, i, x, y * side, z * side); }

const _a = new THREE.Quaternion(), _b = new THREE.Quaternion(), _e = new THREE.Euler();
export function getQ(p, i, out) { const o = i * 4; return out.set(p.q[o], p.q[o + 1], p.q[o + 2], p.q[o + 3]); }
export function putQ(p, i, q) { const o = i * 4; p.q[o] = q.x; p.q[o + 1] = q.y; p.q[o + 2] = q.z; p.q[o + 3] = q.w; }

// pre-multiply an extra rotation (in the parent frame) onto slot i
export function addE(p, i, x, y, z) {
  if (!x && !y && !z) return;
  _e.set(x * D2R, y * D2R, z * D2R, 'XYZ');
  _a.setFromEuler(_e);
  getQ(p, i, _b);
  _a.multiply(_b);
  putQ(p, i, _a);
}

// out = lerp(a, b, w) per bone (nlerp along the shortest path), optional per-bone mask
export function blend(out, a, b, w, mask = null) {
  if (w <= 0) { if (out !== a) out.copy(a); return out; }
  const qa = a.q, qb = b.q, qo = out.q;
  for (let i = 0; i < NB; i++) {
    const ww = mask ? w * mask[i] : w;
    const o = i * 4;
    if (ww <= 0) { qo[o] = qa[o]; qo[o + 1] = qa[o + 1]; qo[o + 2] = qa[o + 2]; qo[o + 3] = qa[o + 3]; continue; }
    let bx = qb[o], by = qb[o + 1], bz = qb[o + 2], bw = qb[o + 3];
    if (qa[o] * bx + qa[o + 1] * by + qa[o + 2] * bz + qa[o + 3] * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
    const x = qa[o] + (bx - qa[o]) * ww, y = qa[o + 1] + (by - qa[o + 1]) * ww, z = qa[o + 2] + (bz - qa[o + 2]) * ww, ww2 = qa[o + 3] + (bw - qa[o + 3]) * ww;
    const l = 1 / Math.hypot(x, y, z, ww2);
    qo[o] = x * l; qo[o + 1] = y * l; qo[o + 2] = z * l; qo[o + 3] = ww2 * l;
  }
  const hw = mask ? w * (mask[B.hips] || 0) : w;
  for (let k = 0; k < 3; k++) out.hip[k] = a.hip[k] + (b.hip[k] - a.hip[k]) * hw;
  return out;
}

// ---------------------------------------------------------------- keyframed clips
// keys: [{ t, hip:[x,y,z], b:{ boneKey: [x,y,z] }, s:{ sideKey: [x,y,z] } }]
// sideKey = 'upperArm' | 'foreArm' | 'hand' | 'shoulder' | 'upperLeg' | 'lowerLeg' | 'foot' | 'toes'
//   with suffix L / R  (e.g. upperArmL) — R values are given as left-side values and mirrored.
const BONE_KEYS = Object.keys(B);
export function compileClip(keys) {
  // flatten every key to an array of NB*3 euler values + hip
  const frames = keys.map((k) => {
    const e = new Float32Array(NB * 3);
    if (k.b) for (const [name, v] of Object.entries(k.b)) {
      const i = B[name]; if (i === undefined) throw new Error('clip bone ' + name);
      const side = /[a-z]R$/.test(name) ? -1 : 1;
      e[i * 3] = v[0]; e[i * 3 + 1] = v[1] * side; e[i * 3 + 2] = v[2] * side;
    }
    return { t: k.t, e, hip: k.hip || [0, 0, 0], ease: k.ease || 'smooth', ik: k.ik || null };
  });
  // carry IK targets through keys without them (weight 0) so they can fade
  let last = null;
  for (const f of frames) { if (f.ik) last = f.ik; f.ikW = f.ik ? 1 : 0; }
  for (let i = frames.length - 1; i >= 0; i--) { if (frames[i].ik) last = frames[i].ik; else frames[i].ik = last; }
  return { frames, duration: frames[frames.length - 1].t, hasIK: !!last };
}
const easeF = {
  smooth: (u) => u * u * (3 - 2 * u),
  linear: (u) => u,
  out: (u) => 1 - (1 - u) * (1 - u),
  in: (u) => u * u,
  outBack: (u) => { const c = 1.6; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; },
};
export function sampleClip(clip, t, out) {
  const f = clip.frames;
  let k = 0;
  while (k < f.length - 2 && t > f[k + 1].t) k++;
  const a = f[k], b = f[Math.min(k + 1, f.length - 1)];
  let u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
  u = Math.min(1, Math.max(0, u));
  u = easeF[b.ease](u);
  for (let i = 0; i < NB; i++) {
    const o = i * 3;
    setE(out, i, a.e[o] + (b.e[o] - a.e[o]) * u, a.e[o + 1] + (b.e[o + 1] - a.e[o + 1]) * u, a.e[o + 2] + (b.e[o + 2] - a.e[o + 2]) * u);
  }
  for (let k2 = 0; k2 < 3; k2++) out.hip[k2] = a.hip[k2] + (b.hip[k2] - a.hip[k2]) * u;
  if (clip.hasIK) {
    out.ikW = a.ikW + (b.ikW - a.ikW) * u;
    if (!out.ik) out.ik = { L: [0, 0, 0, 0], R: [0, 0, 0, 0] };
    for (const s of ['L', 'R']) for (let j = 0; j < 4; j++) out.ik[s][j] = a.ik[s][j] + (b.ik[s][j] - a.ik[s][j]) * u;
  } else out.ikW = 0;
  return out;
}
export { BONE_KEYS };

// ---------------------------------------------------------------- two-bone leg IK (canonical space)
const _v = new THREE.Vector3(), _hip = new THREE.Vector3(), _n = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();
const _hq = new THREE.Quaternion(), _hqi = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _fq = new THREE.Quaternion();
const POLE = new THREE.Vector3();
// target: ankle position in root space; footYaw/footPitch/footRoll: desired world foot orientation (deg)
export function legIK(p, rig, side, target, footPitch = 0, footYaw = 0, footRoll = 0, kneeOut = 6) {
  const L = rig.legs[side];
  const hipsBase = rig.restHips;
  getQ(p, B.hips, _hq); _hqi.copy(_hq).invert();
  // hip joint in root space
  _hip.copy(L.hipOff).applyQuaternion(_hq).add(hipsBase); _hip.x += p.hip[0]; _hip.y += p.hip[1]; _hip.z += p.hip[2];
  // target in hips frame
  _v.copy(target).sub(_hip).applyQuaternion(_hqi);
  let d = _v.length();
  const maxD = (L.l1 + L.l2) * 0.999;
  if (d > maxD) { _v.multiplyScalar(maxD / d); d = maxD; }
  if (d < 0.08) { _v.set(0, -0.08, 0); d = 0.08; }
  const vn = _t1.copy(_v).divideScalar(d);
  const a1 = Math.acos(Math.min(1, Math.max(-1, (L.l1 * L.l1 + d * d - L.l2 * L.l2) / (2 * L.l1 * d))));
  // knee points forward (+ a little outward)
  const sgn = side === 'L' ? 1 : -1;
  const ko = kneeOut * D2R;
  POLE.set(Math.sin(ko) * sgn + Math.sin(footYaw * D2R) * 0.6, 0, Math.cos(ko));
  _n.copy(POLE).addScaledVector(vn, -POLE.dot(vn));
  if (_n.lengthSq() < 1e-6) _n.set(0, 0, 1); _n.normalize();
  const thighDir = _t2.copy(vn).multiplyScalar(Math.cos(a1)).addScaledVector(_n, Math.sin(a1));
  _q1.setFromUnitVectors(L.c1, thighDir);
  // shin
  const shin = _v.addScaledVector(thighDir, -L.l1).normalize().applyQuaternion(_q3.copy(_q1).invert());
  _q2.setFromUnitVectors(L.c2, shin);
  const ti = B['upperLeg' + side], ki = B['lowerLeg' + side], fi = B['foot' + side];
  putQ(p, ti, _q1); putQ(p, ki, _q2);
  // foot: world orientation = desired; local = (hips*thigh*shin)^-1 * desired
  _e.set(footPitch * D2R, footYaw * D2R, footRoll * D2R, 'YXZ');
  _fq.setFromEuler(_e);
  _q3.copy(_hq).multiply(_q1).multiply(_q2).invert().multiply(_fq);
  putQ(p, fi, _q3);
}
