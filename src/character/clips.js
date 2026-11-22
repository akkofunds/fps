import * as THREE from 'three';
import { compileClip } from './pose.js';

// Keyframed full-body and upper-body clips (degrees / meters, canonical frames — see pose.js).
// Bone keys ending in L/R: values are written for the LEFT side; R keys are mirrored automatically.
// `ik` keys (optional) are root-space ankle targets [x, y, z, footPitch] used instead of FK legs.

const STAND = { L: [0.13, 0, 0.06, 0], R: [-0.13, 0, -0.06, 0] };

// ------------------------------------------------------------------ full body
export const DASH = compileClip([
  { t: 0, hip: [0, -0.04, 0], b: { spine: [4, 0, 0] } },
  { t: 0.05, ease: 'out', hip: [0, -0.16, -0.04], b: {
    hips: [34, 8, 0], spine: [14, -6, 0], chest: [8, -6, 0], neck: [-18, 0, 0], head: [-24, 4, 0],
    upperLegL: [-58, 0, 6], lowerLegL: [72, 0, 0], footL: [18, 0, 0],
    upperLegR: [22, 0, 6], lowerLegR: [64, 0, 0], footR: [42, 0, 0],
    upperArmL: [72, 0, 30], foreArmL: [-14, 0, 0], upperArmR: [78, 0, 28], foreArmR: [-12, 0, 0], handL: [30, 0, 0], handR: [30, 0, 0],
  } },
  { t: 0.24, ease: 'linear', hip: [0, -0.14, -0.04], b: {
    hips: [30, 6, 0], spine: [12, -5, 0], chest: [7, -5, 0], neck: [-16, 0, 0], head: [-22, 3, 0],
    upperLegL: [-52, 0, 6], lowerLegL: [80, 0, 0], footL: [20, 0, 0],
    upperLegR: [16, 0, 6], lowerLegR: [72, 0, 0], footR: [40, 0, 0],
    upperArmL: [52, 0, 26], foreArmL: [-26, 0, 0], upperArmR: [58, 0, 24], foreArmR: [-22, 0, 0],
  } },
  { t: 0.34, ease: 'smooth', hip: [0, -0.05, 0], b: { hips: [6, 0, 0], spine: [6, 0, 0], upperLegL: [-20, 0, 4], lowerLegL: [30, 0, 0], upperLegR: [4, 0, 4], lowerLegR: [24, 0, 0], upperArmL: [10, 0, 12], upperArmR: [10, 0, 12], foreArmL: [-30, 0, 0], foreArmR: [-30, 0, 0] } },
]);

export const DASH_BACK = compileClip([
  { t: 0, hip: [0, -0.03, 0] },
  { t: 0.07, ease: 'out', hip: [0, -0.1, 0.03], b: {
    hips: [-12, 0, 0], spine: [-6, 0, 0], chest: [-4, 0, 0], head: [12, 0, 0],
    upperLegL: [-48, 0, 6], lowerLegL: [52, 0, 0], footL: [-10, 0, 0],
    upperLegR: [-18, 0, 6], lowerLegR: [34, 0, 0], footR: [-6, 0, 0],
    upperArmL: [-38, 0, 34], foreArmL: [-34, 0, 0], upperArmR: [-32, 0, 38], foreArmR: [-30, 0, 0],
  } },
  { t: 0.24, ease: 'linear', hip: [0, -0.09, 0.03], b: {
    hips: [-10, 0, 0], spine: [-5, 0, 0], chest: [-3, 0, 0], head: [10, 0, 0],
    upperLegL: [-42, 0, 6], lowerLegL: [56, 0, 0], footL: [-6, 0, 0],
    upperLegR: [-14, 0, 6], lowerLegR: [40, 0, 0], footR: [-4, 0, 0],
    upperArmL: [-30, 0, 36], foreArmL: [-36, 0, 0], upperArmR: [-26, 0, 40], foreArmR: [-32, 0, 0],
  } },
  { t: 0.34, hip: [0, -0.04, 0], b: { upperLegL: [-14, 0, 4], lowerLegL: [24, 0, 0], upperLegR: [-8, 0, 4], lowerLegR: [20, 0, 0], foreArmL: [-30, 0, 0], foreArmR: [-30, 0, 0] } },
]);

const TUCK = (rx, y, z = 0) => ({
  hips: [rx, 0, 0], spine: [34, 0, 0], chest: [26, 0, 0], upperChest: [12, 0, 0], neck: [28, 0, 0], head: [22, 0, 0],
  upperLegL: [-122, 0, 8], lowerLegL: [142, 0, 0], footL: [30, 0, 0],
  upperLegR: [-118, 0, 8], lowerLegR: [138, 0, 0], footR: [30, 0, 0],
  upperArmL: [-58, 0, 10], foreArmL: [-100, 0, 0], upperArmR: [-62, 0, 12], foreArmR: [-96, 0, 0],
  _hip: [0, y, z],
});
function tuckKey(t, rx, y, z, ease) { const b = TUCK(rx, y, z); const hip = b._hip; delete b._hip; return { t, hip, b, ease }; }

// Landing roll: a curved combat roll over the RIGHT shoulder. The body rolls about a tilted axis
// (diagonally across the back from the right shoulder to the left hip), the hips swing out to the
// right on an arc, and he comes up kneeling on the right knee before driving back into a run.
const SHOULDER_AXIS = new THREE.Vector3(1, 0, 0.5).normalize();
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
function shoulderHips(deg, extra = [0, 0, 0]) {
  _q.setFromAxisAngle(SHOULDER_AXIS, (deg * Math.PI) / 180);
  _e.setFromQuaternion(_q, 'XYZ');
  return [(_e.x * 180) / Math.PI + extra[0], (_e.y * 180) / Math.PI + extra[1], (_e.z * 180) / Math.PI + extra[2]];
}
const SR_TUCK = {
  spine: [30, -8, 6], chest: [22, -6, 4], upperChest: [10, 0, 0], neck: [24, 18, 14], head: [20, 16, 10],
  upperLegL: [-118, 0, 10], lowerLegL: [138, 0, 0], footL: [30, 0, 0],
  upperLegR: [-104, 0, 14], lowerLegR: [126, 0, 0], footR: [26, 0, 0],
  upperArmR: [-70, 0, -24], foreArmR: [-50, 0, 0], upperArmL: [-46, 0, 8], foreArmL: [-110, 0, 0],
};
const srKey = (t, deg, hip, ease) => ({ t, ease, hip, b: { ...SR_TUCK, hips: shoulderHips(deg) } });
const KNEEL_R = { L: [0.15, 0, 0.3, 0], R: [-0.16, 0.03, -0.3, 58] };
// play a clip faster (scale its key times)
const fast = (keys, k = 0.68) => keys.map((x) => ({ ...x, t: x.t * k }));
// Landing roll: the curved right-shoulder combat roll, at its natural (real-life) pace
// Landing roll — from the reference: lunge forward, both hands reach for the ground, the hips go
// over the top with the legs extended up (a piked shoulder roll), roll diagonally across the back,
// fold the legs and come up kneeling on the right knee, then rise into the run. ~0.55 s.
const RL = (b) => b; // (readability)
// in-between key: limbs averaged from two keys, hips rotated to an intermediate angle on the roll
// axis (Euler-interpolating a big rotation would swing the body the wrong way)
function rollMid(k1, k2, t, deg, hip) {
  const b = {};
  for (const key of new Set([...Object.keys(k1.b), ...Object.keys(k2.b)])) {
    if (key === 'hips') continue;
    const x = k1.b[key] || [0, 0, 0], y = k2.b[key] || [0, 0, 0];
    b[key] = [0, 1, 2].map((i) => (x[i] + y[i]) / 2);
  }
  b.hips = shoulderHips(deg);
  return { t, ease: 'linear', hip, b };
}
const ROLL_KEYS = [
  // lunge: long step, torso folds forward, both arms reach ahead and down
  { t: 0, ease: 'out', hip: [0, -0.26, 0.12], b: RL({ hips: [34, -4, -4], spine: [22, -6, -4], chest: [10, -4, 0], neck: [6, 6, 4], head: [2, 6, 4],
    upperLegL: [-78, 0, 6], lowerLegL: [70, 0, 0], footL: [-6, 0, 0], upperLegR: [14, 0, 6], lowerLegR: [40, 0, 0], footR: [30, 0, 0],
    upperArmL: [-96, 0, 18], foreArmL: [-10, 0, 0], upperArmR: [-90, 0, -10], foreArmR: [-14, 0, 0] }) },
  // hands to the ground, chin tucked, the back leg sweeps up
  { t: 0.07, ease: 'linear', hip: [-0.02, -0.2, 0.2], b: RL({ hips: shoulderHips(70), spine: [26, -4, 2], chest: [16, -2, 0], neck: [34, 10, 8], head: [26, 8, 6],
    upperLegL: [-46, 0, 6], lowerLegL: [40, 0, 0], footL: [20, 0, 0], upperLegR: [18, 0, 8], lowerLegR: [10, 0, 0], footR: [40, 0, 0],
    upperArmL: [-150, 0, 26], foreArmL: [-20, 0, 0], upperArmR: [-140, 0, -4], foreArmR: [-24, 0, 0] }) },
  // inverted: hips over the shoulders, legs extended up (pike), arms cushioning
  { t: 0.15, ease: 'linear', hip: [-0.07, -0.29, 0.16], b: RL({ hips: shoulderHips(150), spine: [36, -6, 4], chest: [24, -4, 2], neck: [36, 12, 10], head: [26, 10, 8],
    upperLegL: [-30, 0, 10], lowerLegL: [14, 0, 0], footL: [30, 0, 0], upperLegR: [-20, 0, 12], lowerLegR: [10, 0, 0], footR: [30, 0, 0],
    upperArmL: [-120, 0, 30], foreArmL: [-40, 0, 0], upperArmR: [-110, 0, -10], foreArmR: [-50, 0, 0] }) },
  // over the shoulder onto the back, legs start to fold
  { t: 0.23, ease: 'linear', hip: [-0.11, -0.54, 0.08], b: RL({ hips: shoulderHips(225), spine: [40, -6, 4], chest: [28, -4, 2], neck: [30, 12, 10], head: [22, 10, 8],
    upperLegL: [-80, 0, 10], lowerLegL: [90, 0, 0], footL: [30, 0, 0], upperLegR: [-64, 0, 12], lowerLegR: [70, 0, 0], footR: [30, 0, 0],
    upperArmL: [-70, 0, 20], foreArmL: [-80, 0, 0], upperArmR: [-60, 0, -20], foreArmR: [-70, 0, 0] }) },
  // tucked, rolling up over the hip
  { t: 0.3, ease: 'linear', hip: [-0.09, -0.48, 0.03], b: RL({ hips: shoulderHips(300), spine: [40, -6, 4], chest: [28, -4, 2], neck: [22, 12, 10], head: [14, 10, 8],
    upperLegL: [-124, 0, 8], lowerLegL: [142, 0, 0], footL: [34, 0, 0], upperLegR: [-112, 0, 12], lowerLegR: [134, 0, 0], footR: [30, 0, 0],
    upperArmL: [-40, 0, 30], foreArmL: [-70, 0, 0], upperArmR: [-50, 0, -10], foreArmR: [-70, 0, 0] }) },
  // up on the right knee, left foot planted, left hand touching down, eyes forward
  { t: 0.37, ease: 'out', hip: [-0.02, -0.42, 0.04], ik: KNEEL_R, b: RL({ hips: shoulderHips(360, [20, 0, 0]), spine: [22, 6, 0], chest: [8, 2, 0], neck: [-12, 0, 0], head: [-16, 0, 0],
    upperArmL: [-60, 0, 20], foreArmL: [-20, 0, 0], upperArmR: [-30, 0, 34], foreArmR: [-50, 0, 0] }) },
  { t: 0.44, ease: 'linear', hip: [-0.01, -0.38, 0.04], ik: KNEEL_R, b: RL({ hips: shoulderHips(360, [16, 0, 0]), spine: [18, 4, 0], chest: [6, 0, 0], neck: [-10, 0, 0], head: [-12, 0, 0],
    upperArmL: [-44, 0, 22], foreArmL: [-30, 0, 0], upperArmR: [-24, 0, 30], foreArmR: [-56, 0, 0] }) },
  // rise into the run
  { t: 0.56, ease: 'smooth', hip: [0, -0.06, 0], b: RL({ hips: shoulderHips(360, [8, 0, 0]), spine: [10, 0, 0], chest: [4, 0, 0], upperLegL: [-30, 0, 4], lowerLegL: [44, 0, 0], upperLegR: [-6, 0, 4], lowerLegR: [36, 0, 0], upperArmL: [6, 0, 14], foreArmL: [-50, 0, 0], upperArmR: [-10, 0, 16], foreArmR: [-60, 0, 0] }) },
];
// keys 1..4 are 70 / 150 / 225 / 300 deg: add in-betweens so every step is <= ~40 deg
const [R0, R1, R2, R3, R4, ...RREST] = ROLL_KEYS;
export const ROLL = compileClip([
  R0, R1,
  rollMid(R1, R2, 0.11, 110, [-0.05, -0.26, 0.19]), R2,
  rollMid(R2, R3, 0.19, 188, [-0.09, -0.5, 0.12]), R3,
  rollMid(R3, R4, 0.265, 262, [-0.1, -0.53, 0.05]), R4,
  ...RREST,
]);

// Dive roll (from the reference): sprint lean → a horizontal superman dive with the arms reaching
// and legs extended → hands touch down and the head tucks → roll over the (right) shoulders with the
// knees tucked → land in a crouch → drive up into the run.
const DIVE_AXIS = new THREE.Vector3(1, 0, 0.22).normalize();
function diveHips(deg, extra = [0, 0, 0]) {
  _q.setFromAxisAngle(DIVE_AXIS, (deg * Math.PI) / 180);
  _e.setFromQuaternion(_q, 'XYZ');
  return [(_e.x * 180) / Math.PI + extra[0], (_e.y * 180) / Math.PI + extra[1], (_e.z * 180) / Math.PI + extra[2]];
}
const diveTuck = (deg, extra = {}) => { const b = TUCK(0, 0); delete b._hip; return { ...b, ...extra, hips: diveHips(deg) }; };
export const DIVE_ROLL = compileClip(fast([
  // push off: low sprint lean, arms swung back
  { t: 0, hip: [0, -0.16, 0.04], b: { hips: [24, 0, 0], spine: [16, 0, 0], chest: [6, 0, 0], neck: [-14, 0, 0], head: [-16, 0, 0], upperLegL: [-58, 0, 6], lowerLegL: [80, 0, 0], footL: [-10, 0, 0], upperLegR: [22, 0, 6], lowerLegR: [30, 0, 0], footR: [36, 0, 0], upperArmL: [46, 0, 24], foreArmL: [-20, 0, 0], upperArmR: [50, 0, 22], foreArmR: [-20, 0, 0] } },
  // the dive: body near horizontal, face down, arms reaching forward, legs stretched back together
  { t: 0.1, ease: 'out', hip: [0, -0.02, 0.18], b: { hips: diveHips(76), spine: [4, 0, 0], chest: [2, 0, 0], neck: [-34, 0, 0], head: [-26, 0, 0], upperLegL: [4, 0, 3], lowerLegL: [8, 0, 0], footL: [34, 0, 0], upperLegR: [8, 0, 3], lowerLegR: [12, 0, 0], footR: [34, 0, 0], upperArmL: [-150, 0, 14], foreArmL: [-8, 0, 0], handL: [-10, 0, 0], upperArmR: [-150, 0, 14], foreArmR: [-8, 0, 0], handR: [-10, 0, 0] } },
  { t: 0.18, ease: 'linear', hip: [0, -0.06, 0.16], b: { hips: diveHips(96), spine: [10, 0, 0], chest: [6, 0, 0], neck: [-14, 0, 0], head: [-10, 0, 0], upperLegL: [0, 0, 3], lowerLegL: [12, 0, 0], footL: [30, 0, 0], upperLegR: [4, 0, 3], lowerLegR: [16, 0, 0], footR: [30, 0, 0], upperArmL: [-140, 0, 18], foreArmL: [-24, 0, 0], upperArmR: [-140, 0, 18], foreArmR: [-24, 0, 0] } },
  // hands touch, head tucks, hips come over
  { t: 0.26, ease: 'in', hip: [0, -0.06, 0.08], b: { hips: diveHips(140), spine: [28, 0, 0], chest: [20, 0, 0], neck: [26, 0, 0], head: [22, 0, 0], upperLegL: [-34, 0, 6], lowerLegL: [60, 0, 0], footL: [20, 0, 0], upperLegR: [-26, 0, 6], lowerLegR: [50, 0, 0], footR: [20, 0, 0], upperArmL: [-110, 0, 30], foreArmL: [-70, 0, 0], upperArmR: [-110, 0, 30], foreArmR: [-70, 0, 0] } },
  // over the shoulders, knees tucked
  { t: 0.36, ease: 'linear', hip: [0, -0.26, 0.04], b: diveTuck(218) },
  { t: 0.46, ease: 'linear', hip: [0, -0.34, -0.01], b: diveTuck(300, { upperArmL: [-30, 0, 40], upperArmR: [-30, 0, 40], foreArmL: [-50, 0, 0], foreArmR: [-50, 0, 0] }) },
  // feet down in a crouch, arms forward for balance
  { t: 0.54, ease: 'out', hip: [0, -0.36, 0], b: { hips: diveHips(368), spine: [22, 0, 0], chest: [8, 0, 0], neck: [-12, 0, 0], head: [-14, 0, 0], upperLegL: [-90, 0, 8], lowerLegL: [124, 0, 0], footL: [-30, 0, 0], upperLegR: [-60, 0, 8], lowerLegR: [120, 0, 0], footR: [-50, 0, 0], upperArmL: [-56, 0, 26], foreArmL: [-40, 0, 0], upperArmR: [-50, 0, 28], foreArmR: [-44, 0, 0] } },
  // up into the run
  { t: 0.66, ease: 'smooth', hip: [0, -0.06, 0], b: { hips: diveHips(368, [-4, 0, 0]), spine: [10, 0, 0], chest: [4, 0, 0], upperLegL: [-30, 0, 4], lowerLegL: [44, 0, 0], upperLegR: [-6, 0, 4], lowerLegR: [36, 0, 0], upperArmL: [6, 0, 14], foreArmL: [-50, 0, 0], upperArmR: [-10, 0, 16], foreArmR: [-60, 0, 0] } },
]));

export const ROLL_BACK = compileClip(fast([
  { t: 0, hip: [0, -0.16, -0.02], b: { hips: [-8, 0, 0], spine: [12, 0, 0], upperLegL: [-44, 0, 6], lowerLegL: [76, 0, 0], upperLegR: [-30, 0, 6], lowerLegR: [64, 0, 0], upperArmL: [-40, 0, 20], upperArmR: [-40, 0, 20], foreArmL: [-60, 0, 0], foreArmR: [-60, 0, 0] } },
  tuckKey(0.09, -80, -0.38, -0.08, 'in'),
  tuckKey(0.19, -185, -0.22, -0.04, 'linear'),
  tuckKey(0.3, -290, -0.36, 0.02, 'linear'),
  { t: 0.4, ease: 'out', hip: [0, -0.2, 0], b: { hips: [-360, 0, 0], spine: [16, 0, 0], upperLegL: [-70, 0, 8], lowerLegL: [100, 0, 0], footL: [-28, 0, 0], upperLegR: [-30, 0, 8], lowerLegR: [96, 0, 0], footR: [-50, 0, 0], upperArmL: [-20, 0, 30], foreArmL: [-40, 0, 0], upperArmR: [-10, 0, 34], foreArmR: [-50, 0, 0] } },
  { t: 0.5, hip: [0, -0.06, 0], b: { hips: [-360, 0, 0], spine: [6, 0, 0], upperLegL: [-20, 0, 4], lowerLegL: [32, 0, 0], upperLegR: [-8, 0, 4], lowerLegR: [30, 0, 0], foreArmL: [-34, 0, 0], foreArmR: [-44, 0, 0] } },
], 1));

// C — Firewall: wind up and slam the right palm into the ground
export const SLAM = compileClip([
  { t: 0, hip: [0, -0.04, 0], ik: STAND },
  { t: 0.16, ease: 'out', hip: [0, -0.02, -0.02], ik: { L: [0.15, 0, 0.12, 0], R: [-0.14, 0, -0.1, 0] }, b: {
    spine: [-6, 12, 0], chest: [-6, 10, 0], head: [6, -14, 0],
    upperArmR: [-150, 0, 18], foreArmR: [-30, 0, 0], handR: [-20, 0, 0],
    upperArmL: [-26, 0, 30], foreArmL: [-50, 0, 0],
  } },
  { t: 0.28, ease: 'in', hip: [0, -0.4, 0.06], ik: { L: [0.17, 0, 0.36, -8], R: [-0.15, 0.02, -0.28, 40] }, b: {
    hips: [12, 0, 0], spine: [26, -6, 0], chest: [16, -6, 0], neck: [-14, 0, 0], head: [-20, 4, 0],
    upperArmR: [-62, 0, -6], foreArmR: [-6, 0, 0], handR: [-58, 0, 0],
    upperArmL: [8, 0, 48], foreArmL: [-24, 0, 0],
  } },
  { t: 0.46, ease: 'linear', hip: [0, -0.37, 0.05], ik: { L: [0.17, 0, 0.36, -8], R: [-0.15, 0.02, -0.28, 40] }, b: {
    hips: [10, 0, 0], spine: [22, -6, 0], chest: [14, -6, 0], neck: [-12, 0, 0], head: [-18, 4, 0],
    upperArmR: [-58, 0, -6], foreArmR: [-8, 0, 0], handR: [-55, 0, 0],
    upperArmL: [6, 0, 46], foreArmL: [-26, 0, 0],
  } },
  { t: 0.72, ease: 'smooth', hip: [0, -0.05, 0], ik: STAND, b: { spine: [4, 0, 0], upperArmL: [-6, 0, 10], foreArmL: [-30, 0, 0], upperArmR: [-14, 0, 14], foreArmR: [-60, 0, 0] } },
]);

// V — Flame Leap: crouch, then a superhero launch (legs tucked, fists trailing flames)
export const LEAP = compileClip([
  { t: 0, hip: [0, -0.04, 0], ik: STAND },
  { t: 0.11, ease: 'out', hip: [0, -0.3, 0.02], ik: { L: [0.16, 0, 0.12, -6], R: [-0.16, 0, -0.1, -6] }, b: {
    hips: [14, 0, 0], spine: [22, 0, 0], chest: [10, 0, 0], neck: [-16, 0, 0], head: [-14, 0, 0],
    upperArmL: [38, 0, 24], foreArmL: [-28, 0, 0], upperArmR: [42, 0, 22], foreArmR: [-26, 0, 0],
  } },
  { t: 0.2, ease: 'out', hip: [0, 0.02, 0], b: {
    hips: [-6, 0, 0], spine: [-10, 0, 0], chest: [-6, 0, 0], head: [-6, 0, 0],
    upperLegL: [-82, 0, 10], lowerLegL: [116, 0, 0], footL: [34, 0, 0],
    upperLegR: [-24, 0, 6], lowerLegR: [96, 0, 0], footR: [40, 0, 0],
    upperArmL: [26, 0, 40], foreArmL: [-8, 0, 0], handL: [20, 0, 0],
    upperArmR: [28, 0, 38], foreArmR: [-10, 0, 0], handR: [20, 0, 0],
  } },
  { t: 0.5, ease: 'linear', hip: [0, 0, 0], b: {
    hips: [-4, 0, 0], spine: [-6, 0, 0], chest: [-4, 0, 0],
    upperLegL: [-70, 0, 10], lowerLegL: [104, 0, 0], footL: [30, 0, 0],
    upperLegR: [-20, 0, 6], lowerLegR: [86, 0, 0], footR: [36, 0, 0],
    upperArmL: [20, 0, 44], foreArmL: [-14, 0, 0], upperArmR: [22, 0, 42], foreArmR: [-14, 0, 0],
  } },
]);

export const DEATH = compileClip([
  { t: 0, hip: [0, -0.04, 0] },
  { t: 0.16, ease: 'out', hip: [0, -0.1, -0.05], b: {
    hips: [-8, 0, 0], spine: [-16, 0, 6], chest: [-12, 0, 4], neck: [-10, 0, 0], head: [-18, 8, 0],
    upperLegL: [-18, 0, 6], lowerLegL: [34, 0, 0], upperLegR: [-4, 0, 6], lowerLegR: [40, 0, 0], footR: [-10, 0, 0],
    upperArmL: [-46, 0, 44], foreArmL: [-50, 0, 0], upperArmR: [-30, 0, 52], foreArmR: [-40, 0, 0],
  } },
  { t: 0.42, ease: 'in', hip: [0, -0.48, -0.28], b: {
    hips: [-52, 0, 4], spine: [-6, 0, 4], chest: [-4, 0, 0], head: [-8, 12, 0],
    upperLegL: [-62, 0, 10], lowerLegL: [80, 0, 0], footL: [20, 0, 0], upperLegR: [-40, 0, 12], lowerLegR: [62, 0, 0], footR: [10, 0, 0],
    upperArmL: [-70, 0, 70], foreArmL: [-30, 0, 0], upperArmR: [-60, 0, 66], foreArmR: [-26, 0, 0],
  } },
  { t: 0.66, ease: 'out', hip: [0, -0.74, -0.46], b: {
    hips: [-88, 0, 6], spine: [2, 0, 4], chest: [2, 0, 0], neck: [6, 0, 0], head: [10, 24, 0],
    upperLegL: [-22, 0, 14], lowerLegL: [36, 0, 0], footL: [30, 0, 0], upperLegR: [-48, 0, 8], lowerLegR: [70, 0, 0], footR: [20, 0, 0],
    upperArmL: [-110, 0, 78], foreArmL: [-14, 0, 0], upperArmR: [-96, 0, 64], foreArmR: [-40, 0, 0],
  } },
  { t: 0.82, ease: 'smooth', hip: [0, -0.76, -0.47], b: {
    hips: [-90, 0, 6], spine: [0, 0, 4], chest: [0, 0, 0], neck: [4, 0, 0], head: [8, 26, 0],
    upperLegL: [-16, 0, 14], lowerLegL: [26, 0, 0], footL: [34, 0, 0], upperLegR: [-40, 0, 8], lowerLegR: [62, 0, 0], footR: [24, 0, 0],
    upperArmL: [-112, 0, 80], foreArmL: [-10, 0, 0], upperArmR: [-100, 0, 66], foreArmR: [-36, 0, 0],
  } },
]);

// ------------------------------------------------------------------ upper body casts (masked)
const GUARD = { spine: [2, 0, 0], upperArmL: [-8, 0, 12], foreArmL: [-40, 0, 0], upperArmR: [-14, 0, 16], foreArmR: [-70, 0, 0] };
function mirror(b) {
  const o = {};
  for (const [k, v] of Object.entries(b)) {
    if (/L$/.test(k)) o[k.slice(0, -1) + 'R'] = v;
    else if (/R$/.test(k) && k !== 'upperChestR') o[k.slice(0, -1) + 'L'] = v;
    else o[k] = [v[0], -v[1], -v[2]];
  }
  return o;
}
function boltKeys(side) {
  const thrust = {
    spine: [4, 8, 0], chest: [2, 16, 0], upperChest: [0, 8, 0], neck: [0, -14, 0], head: [0, -16, 0],
    upperArmR: [-86, 0, -10], foreArmR: [-6, 0, 0], handR: [-12, 0, 0],
    upperArmL: [14, 0, 14], foreArmL: [-112, 0, 0],
  };
  const follow = {
    spine: [3, 6, 0], chest: [2, 12, 0], upperChest: [0, 6, 0], neck: [0, -10, 0], head: [0, -12, 0],
    upperArmR: [-80, 0, -8], foreArmR: [-14, 0, 0], handR: [-8, 0, 0],
    upperArmL: [10, 0, 14], foreArmL: [-104, 0, 0],
  };
  const keys = [
    { t: 0, b: GUARD },
    { t: 0.06, ease: 'out', b: thrust },
    { t: 0.13, ease: 'linear', b: follow },
    { t: 0.36, ease: 'smooth', b: GUARD },
  ];
  return compileClip(side === 'R' ? keys : keys.map((k) => ({ ...k, b: mirror(k.b) })));
}
export const BOLT_R = boltKeys('R');
export const BOLT_L = boltKeys('L');

export const ORB = compileClip([
  { t: 0, b: GUARD },
  { t: 0.17, ease: 'out', b: {
    spine: [4, -14, 0], chest: [2, -20, 0], upperChest: [0, -8, 0], neck: [0, 18, 0], head: [0, 20, 0],
    upperArmR: [-6, 0, 20], foreArmR: [-104, 0, 0], handR: [-30, 0, 0],
    upperArmL: [-52, 0, -32], foreArmL: [-84, 0, 0], handL: [-20, 0, 0],
  } },
  { t: 0.26, ease: 'out', b: {
    spine: [8, 4, 0], chest: [4, 6, 0], upperChest: [2, 2, 0], neck: [0, -6, 0], head: [0, -6, 0],
    upperArmR: [-84, 0, -14], foreArmR: [-6, 0, 0], handR: [-30, 0, 0],
    upperArmL: [-84, 0, -14], foreArmL: [-6, 0, 0], handL: [-30, 0, 0],
  } },
  { t: 0.38, ease: 'linear', b: {
    spine: [7, 3, 0], chest: [3, 5, 0], neck: [0, -5, 0], head: [0, -5, 0],
    upperArmR: [-80, 0, -12], foreArmR: [-12, 0, 0], handR: [-24, 0, 0],
    upperArmL: [-80, 0, -12], foreArmL: [-12, 0, 0], handL: [-24, 0, 0],
  } },
  { t: 0.66, ease: 'smooth', b: GUARD },
]);

// X — Meteor: raise a fist to the sky, then drag the meteor down onto the target
export const ULT = compileClip([
  { t: 0, b: GUARD },
  { t: 0.32, ease: 'out', b: {
    spine: [-10, 8, 0], chest: [-8, 8, 0], upperChest: [-4, 4, 0], neck: [-12, -6, 0], head: [-16, -8, 0],
    upperArmR: [-172, 0, -4], foreArmR: [-14, 0, 0], handR: [-10, 0, 0],
    upperArmL: [-20, 0, 52], foreArmL: [-40, 0, 0],
  } },
  { t: 0.44, ease: 'linear', b: {
    spine: [-12, 8, 0], chest: [-9, 8, 0], upperChest: [-4, 4, 0], neck: [-12, -6, 0], head: [-16, -8, 0],
    upperArmR: [-176, 0, -4], foreArmR: [-10, 0, 0], handR: [-8, 0, 0],
    upperArmL: [-22, 0, 54], foreArmL: [-38, 0, 0],
  } },
  { t: 0.56, ease: 'in', b: {
    spine: [14, 14, 0], chest: [10, 14, 0], upperChest: [4, 6, 0], neck: [-8, -14, 0], head: [-6, -14, 0],
    upperArmR: [-64, 0, -6], foreArmR: [-4, 0, 0], handR: [-30, 0, 0],
    upperArmL: [16, 0, 30], foreArmL: [-70, 0, 0],
  } },
  { t: 0.72, ease: 'linear', b: {
    spine: [12, 12, 0], chest: [8, 12, 0], upperChest: [4, 6, 0], neck: [-8, -12, 0], head: [-6, -12, 0],
    upperArmR: [-62, 0, -6], foreArmR: [-8, 0, 0], handR: [-28, 0, 0],
    upperArmL: [14, 0, 30], foreArmL: [-70, 0, 0],
  } },
  { t: 1.0, ease: 'smooth', b: GUARD },
]);

// lobby: hold a flame up in the right palm and admire it
export const SHOWCASE = compileClip([
  { t: 0, b: { spine: [0, -6, 0], chest: [0, -8, 0], neck: [6, 10, 0], head: [10, 16, 0], upperArmR: [-28, 0, 22], foreArmR: [-112, 0, 0], handR: [24, 0, 0], upperArmL: [-4, 0, 9], foreArmL: [-18, 0, 0] } },
]);

// ================================================================== METEORA (staff caster)
// prop_R is the staff in her right hand. In the hand's canonical frame the staff points UP when the
// arm hangs; with the arm thrust forward, propR [180,0,0] points the staff along the arm.
const SGUARD = { spine: [2, 0, 0], upperArmL: [-10, 0, 14], foreArmL: [-34, 0, 0], upperArmR: [-14, 0, 14], foreArmR: [-62, 0, 0], propR: [76, 0, -14] };

export const M_BOLT = compileClip([
  { t: 0, b: SGUARD },
  { t: 0.08, ease: 'out', b: {
    spine: [3, 10, 0], chest: [2, 12, 0], upperChest: [0, 6, 0], neck: [0, -12, 0], head: [0, -12, 0],
    upperArmR: [-84, 0, 4], foreArmR: [-4, 0, 0], handR: [0, 0, 0], propR: [178, 0, 0],
    upperArmL: [-36, 0, 34], foreArmL: [-70, 0, 0], handL: [-20, 0, 0],
  } },
  { t: 0.18, ease: 'linear', b: {
    spine: [2, 8, 0], chest: [2, 10, 0], upperChest: [0, 5, 0], neck: [0, -10, 0], head: [0, -10, 0],
    upperArmR: [-80, 0, 4], foreArmR: [-8, 0, 0], propR: [174, 0, 0],
    upperArmL: [-30, 0, 32], foreArmL: [-64, 0, 0],
  } },
  { t: 0.5, ease: 'smooth', b: SGUARD },
]);

// E — Starfall: sweep the staff over her head, then point it down at the target
export const M_RAISE = compileClip([
  { t: 0, b: SGUARD },
  { t: 0.22, ease: 'out', b: {
    spine: [-6, -6, 0], chest: [-6, -6, 0], neck: [-8, 0, 0], head: [-12, 0, 0],
    upperArmR: [-118, 0, 8], foreArmR: [-40, 0, 0], propR: [150, 0, 0],
    upperArmL: [-80, 0, 10], foreArmL: [-60, 0, 0],
  } },
  { t: 0.38, ease: 'in', b: {
    spine: [10, 8, 0], chest: [6, 10, 0], neck: [-6, -8, 0], head: [-4, -8, 0],
    upperArmR: [-74, 0, -10], foreArmR: [-4, 0, 0], propR: [180, 0, 0],
    upperArmL: [10, 0, 34], foreArmL: [-60, 0, 0],
  } },
  { t: 0.5, ease: 'linear', b: {
    spine: [9, 7, 0], chest: [5, 9, 0], neck: [-6, -8, 0], head: [-4, -8, 0],
    upperArmR: [-72, 0, -10], foreArmR: [-6, 0, 0], propR: [178, 0, 0],
    upperArmL: [8, 0, 34], foreArmL: [-60, 0, 0],
  } },
  { t: 0.8, ease: 'smooth', b: SGUARD },
]);

// C — Blast Sigil: drive the staff butt into the ground in front of her
export const M_PLANT = compileClip([
  { t: 0, hip: [0, -0.03, 0], ik: STAND, b: SGUARD },
  { t: 0.18, ease: 'out', hip: [0, -0.02, 0], ik: STAND, b: {
    spine: [-4, 0, 0], upperArmR: [-120, 0, -6], foreArmR: [-20, 0, 0], propR: [190, 0, 0],
    upperArmL: [-60, 0, -18], foreArmL: [-70, 0, 0],
  } },
  { t: 0.32, ease: 'in', hip: [0, -0.24, 0.03], ik: { L: [0.13, 0, 0.18, -6], R: [-0.13, 0, -0.14, 20] }, b: {
    hips: [8, 0, 0], spine: [20, 0, 0], chest: [8, 0, 0], neck: [-10, 0, 0], head: [-12, 0, 0],
    upperArmR: [-52, 0, -8], foreArmR: [-14, 0, 0], propR: [205, 0, 0],
    upperArmL: [-44, 0, -24], foreArmL: [-40, 0, 0],
  } },
  { t: 0.5, ease: 'linear', hip: [0, -0.22, 0.03], ik: { L: [0.13, 0, 0.18, -6], R: [-0.13, 0, -0.14, 20] }, b: {
    hips: [7, 0, 0], spine: [18, 0, 0], chest: [8, 0, 0], neck: [-10, 0, 0], head: [-12, 0, 0],
    upperArmR: [-50, 0, -8], foreArmR: [-14, 0, 0], propR: [205, 0, 0],
    upperArmL: [-42, 0, -24], foreArmL: [-40, 0, 0],
  } },
  { t: 0.78, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: SGUARD },
]);

// V — Blink: a quick spin of the staff as she vanishes
export const M_BLINK = compileClip([
  { t: 0, b: SGUARD },
  { t: 0.1, ease: 'out', b: { spine: [6, 20, 0], chest: [4, 20, 0], upperArmR: [-100, 0, 30], foreArmR: [-20, 0, 0], propR: [120, 0, 60], upperArmL: [-40, 0, 50], foreArmL: [-30, 0, 0] } },
  { t: 0.22, ease: 'linear', b: { spine: [4, -14, 0], chest: [2, -14, 0], upperArmR: [-90, 0, -40], foreArmR: [-10, 0, 0], propR: [170, 0, -40], upperArmL: [-20, 0, 40], foreArmL: [-40, 0, 0] } },
  { t: 0.45, ease: 'smooth', b: SGUARD },
]);

// X — Crimson Nova. Both hands on the staff the whole time (the animator's grip IK puts her left
// hand on the shaft under the right), held perfectly upright while she chants, raised high for the
// climax, then levelled at the target with both hands for the release.
const NOVA_HOLD = {
  hips: [0, 0, 0], spine: [1, 0, 0], chest: [-1, 0, 0], upperChest: [0, 0, 0], neck: [-2, 0, 0], head: [-5, 0, 0],
  upperArmR: [-56, 0, 10], foreArmR: [-70, 0, 0], handR: [0, 0, 0],
  upperArmL: [-40, 0, 10], foreArmL: [-60, 0, 0],
};
const NOVA_HIGH = {
  hips: [0, 0, 0], spine: [-3, 0, 0], chest: [-3, 0, 0], upperChest: [-2, 0, 0], neck: [-4, 0, 0], head: [-10, 0, 0],
  upperArmR: [-104, 0, 6], foreArmR: [-50, 0, 0], handR: [0, 0, 0],
  upperArmL: [-80, 0, 10], foreArmL: [-60, 0, 0],
};
const NOVA_AIM = {
  hips: [5, 0, 0], spine: [7, 0, 0], chest: [4, 0, 0], neck: [-6, 0, 0], head: [-8, 0, 0],
  upperArmR: [-98, 0, 4], foreArmR: [-6, 0, 0], handR: [0, 0, 0], propR: [186, 0, 0],
  upperArmL: [-70, 0, 20], foreArmL: [-40, 0, 0],
};
const WIDE = { L: [0.2, 0, 0.12, 0], R: [-0.2, 0, -0.1, 0] };
const LUNGE = { L: [0.2, 0, 0.3, -6], R: [-0.2, 0, -0.2, 14] };
export const M_NOVA = compileClip([
  { t: 0, hip: [0, -0.03, 0], ik: STAND, b: SGUARD },
  // plant the staff and chant
  { t: 0.22, ease: 'out', hip: [0, -0.06, 0], ik: WIDE, b: NOVA_HOLD },
  { t: 0.8, ease: 'smooth', hip: [0, -0.07, 0], ik: WIDE, b: { ...NOVA_HOLD, spine: [1, 3, 0], head: [-6, 4, 0] } },
  // raise it high as the last seals open
  { t: 1.35, ease: 'smooth', hip: [0, -0.06, 0], ik: WIDE, b: NOVA_HIGH },
  { t: 1.7, ease: 'smooth', hip: [0, -0.05, 0], ik: WIDE, b: { ...NOVA_HIGH, upperArmR: [-110, 0, 6], head: [-12, 0, 0] } },
  // …then level it at the target and let go
  { t: 1.95, ease: 'in', hip: [0, -0.15, 0.05], ik: LUNGE, b: NOVA_AIM },
  { t: 2.5, ease: 'linear', hip: [0, -0.15, 0.05], ik: LUNGE, b: { ...NOVA_AIM, spine: [6, 0, 0] } },
]);

// …and the price: she collapses face-down, completely spent, then struggles back up
export const M_EXHAUSTED = compileClip([
  { t: 0, hip: [0, -0.16, 0.05], b: { hips: [9, 0, 0], spine: [15, 0, 0], upperArmR: [-86, 0, -12], propR: [180, 0, 0], upperArmL: [-80, 0, -18] } },
  { t: 0.35, ease: 'in', hip: [0, -0.45, 0.12], b: {
    hips: [30, 0, 0], spine: [24, 0, 0], chest: [10, 0, 0], neck: [10, 0, 0], head: [16, 0, 0],
    upperLegL: [-70, 0, 6], lowerLegL: [110, 0, 0], upperLegR: [-62, 0, 6], lowerLegR: [104, 0, 0], footL: [30, 0, 0], footR: [30, 0, 0],
    upperArmR: [-40, 0, 20], foreArmR: [-20, 0, 0], propR: [60, 0, 40], upperArmL: [-36, 0, 22], foreArmL: [-30, 0, 0],
  } },
  { t: 0.7, ease: 'in', hip: [0, -0.74, 0.5], b: {
    hips: [86, 0, 4], spine: [4, 0, 0], chest: [2, 0, 0], neck: [-30, 0, 0], head: [-34, 16, 0],
    upperLegL: [-4, 0, 6], lowerLegL: [12, 0, 0], footL: [40, 0, 0], upperLegR: [-8, 0, 10], lowerLegR: [30, 0, 0], footR: [40, 0, 0],
    upperArmR: [-160, 0, 40], foreArmR: [-10, 0, 0], propR: [100, 0, 30], upperArmL: [-150, 0, 50], foreArmL: [-20, 0, 0],
  } },
  { t: 0.85, ease: 'out', hip: [0, -0.77, 0.52], b: {
    hips: [90, 0, 4], spine: [2, 0, 0], neck: [-32, 0, 0], head: [-36, 18, 0],
    upperLegL: [-2, 0, 6], lowerLegL: [8, 0, 0], footL: [42, 0, 0], upperLegR: [-6, 0, 10], lowerLegR: [24, 0, 0], footR: [42, 0, 0],
    upperArmR: [-164, 0, 42], foreArmR: [-8, 0, 0], propR: [100, 0, 30], upperArmL: [-154, 0, 52], foreArmL: [-18, 0, 0],
  } },
  { t: 2.6, ease: 'linear', hip: [0, -0.76, 0.52], b: {
    hips: [89, 0, 4], spine: [3, 0, 0], neck: [-30, 0, 0], head: [-32, 20, 0],
    upperLegL: [-2, 0, 6], lowerLegL: [10, 0, 0], footL: [42, 0, 0], upperLegR: [-6, 0, 10], lowerLegR: [26, 0, 0], footR: [42, 0, 0],
    upperArmR: [-160, 0, 40], foreArmR: [-12, 0, 0], propR: [100, 0, 30], upperArmL: [-150, 0, 50], foreArmL: [-22, 0, 0],
  } },
  // push up onto hands and knees…
  { t: 3.0, ease: 'smooth', hip: [0, -0.5, 0.2], b: {
    hips: [60, 0, 0], spine: [16, 0, 0], chest: [6, 0, 0], neck: [-20, 0, 0], head: [-24, 0, 0],
    upperLegL: [-80, 0, 6], lowerLegL: [120, 0, 0], upperLegR: [-70, 0, 6], lowerLegR: [116, 0, 0], footL: [30, 0, 0], footR: [30, 0, 0],
    upperArmR: [-60, 0, 10], foreArmR: [-10, 0, 0], propR: [80, 0, 0], upperArmL: [-60, 0, 14], foreArmL: [-10, 0, 0],
  } },
  // …and stand
  { t: 3.4, ease: 'smooth', hip: [0, -0.06, 0], b: { spine: [6, 0, 0], upperArmR: [-14, 0, 14], foreArmR: [-62, 0, 0], propR: [76, 0, -14], upperArmL: [-10, 0, 14], foreArmL: [-34, 0, 0] } },
]);

export const M_SHOWCASE = compileClip([
  { t: 0, b: { spine: [0, -4, 0], chest: [0, -6, 0], neck: [4, 8, 0], head: [6, 12, 0], upperArmR: [-22, 0, 18], foreArmR: [-58, 0, 0], propR: [80, 0, -18], upperArmL: [-40, 0, 20], foreArmL: [-118, 0, 0], handL: [10, 0, 0] } },
]);

// ================================================================== polish clips (both mages)
// Meteora — second hit of her staff combo: a backhand sweep from her left to her right
export const M_BOLT2 = compileClip([
  { t: 0, b: SGUARD },
  { t: 0.09, ease: 'out', b: {
    spine: [2, -14, 0], chest: [0, -14, 0], upperChest: [0, -6, 0], neck: [0, 10, 0], head: [0, 12, 0],
    upperArmR: [-74, 0, -38], foreArmR: [-34, 0, 0], handR: [0, 0, 0], propR: [150, 0, 40],
    upperArmL: [-24, 0, 30], foreArmL: [-60, 0, 0],
  } },
  { t: 0.2, ease: 'out', b: {
    spine: [3, 12, 0], chest: [2, 14, 0], upperChest: [0, 6, 0], neck: [0, -10, 0], head: [0, -10, 0],
    upperArmR: [-84, 0, 18], foreArmR: [-6, 0, 0], propR: [178, 0, -20],
    upperArmL: [-12, 0, 48], foreArmL: [-40, 0, 0],
  } },
  { t: 0.3, ease: 'linear', b: {
    spine: [2, 10, 0], chest: [2, 12, 0], neck: [0, -8, 0], head: [0, -8, 0],
    upperArmR: [-80, 0, 20], foreArmR: [-10, 0, 0], propR: [174, 0, -22],
    upperArmL: [-10, 0, 46], foreArmL: [-42, 0, 0],
  } },
  { t: 0.6, ease: 'smooth', b: SGUARD },
]);

// Pyro idle fidget: rolls his neck, then punches a fist into his palm twice
const FIST_PALM = { spine: [4, 0, 0], chest: [2, 0, 0], neck: [6, 0, 0], head: [10, 0, 0], upperArmR: [-46, 0, -22], foreArmR: [-86, 0, 0], handR: [0, 0, 0], upperArmL: [-42, 0, -26], foreArmL: [-94, 0, 0], handL: [-14, 0, 0] };
const FIST_HIT = { ...FIST_PALM, spine: [7, 0, 0], upperArmR: [-52, 0, -26], foreArmR: [-74, 0, 0] };
export const FIDGET_P = compileClip([
  { t: 0, b: GUARD },
  { t: 0.4, ease: 'smooth', b: { spine: [1, 0, 0], neck: [2, 0, 14], head: [4, 6, 14], upperArmL: [-2, 0, 8], foreArmL: [-22, 0, 0], upperArmR: [-2, 0, 8], foreArmR: [-24, 0, 0] } },
  { t: 0.85, ease: 'smooth', b: { spine: [1, 0, 0], neck: [10, 0, 0], head: [12, 0, 0], upperArmL: [-2, 0, 8], foreArmL: [-22, 0, 0], upperArmR: [-2, 0, 8], foreArmR: [-24, 0, 0] } },
  { t: 1.25, ease: 'smooth', b: { spine: [1, 0, 0], neck: [2, 0, -14], head: [4, -6, -14], upperArmL: [-2, 0, 8], foreArmL: [-22, 0, 0], upperArmR: [-2, 0, 8], foreArmR: [-24, 0, 0] } },
  { t: 1.65, ease: 'smooth', b: FIST_PALM },
  { t: 1.78, ease: 'in', b: FIST_HIT },
  { t: 1.92, ease: 'out', b: FIST_PALM },
  { t: 2.05, ease: 'in', b: FIST_HIT },
  { t: 2.3, ease: 'linear', b: FIST_HIT },
  { t: 2.8, ease: 'smooth', b: GUARD },
]);

// Meteora idle fidget: twirls the staff end over end, catches it, then fixes her hat
const TWIRL = (x) => ({ spine: [2, -4, 0], chest: [0, -6, 0], head: [-4, 10, 0], upperArmR: [-56, 0, 12], foreArmR: [-56, 0, 0], handR: [0, 0, 0], propR: [x, 0, -10], upperArmL: [-10, 0, 16], foreArmL: [-34, 0, 0] });
export const FIDGET_M = compileClip([
  { t: 0, b: SGUARD },
  { t: 0.3, ease: 'out', b: TWIRL(76) },
  { t: 0.5, ease: 'linear', b: TWIRL(196) },
  { t: 0.7, ease: 'linear', b: TWIRL(316) },
  { t: 0.9, ease: 'linear', b: TWIRL(436) },
  { t: 1.1, ease: 'out', b: TWIRL(530) },
  { t: 1.35, ease: 'smooth', b: { ...SGUARD, propR: [436, 0, -14] } },
  { t: 1.75, ease: 'smooth', b: { spine: [0, 0, 0], neck: [-4, 0, 4], head: [-8, -6, 8], upperArmR: [-14, 0, 14], foreArmR: [-62, 0, 0], propR: [436, 0, -14], upperArmL: [-148, 0, 22], foreArmL: [-112, 0, 0], handL: [20, 0, 0] } },
  { t: 2.05, ease: 'linear', b: { spine: [0, 0, 0], neck: [-4, 0, 6], head: [-6, -4, 10], upperArmR: [-14, 0, 14], foreArmR: [-62, 0, 0], propR: [436, 0, -14], upperArmL: [-150, 0, 18], foreArmL: [-108, 0, 0], handL: [26, 0, 0] } },
  { t: 2.6, ease: 'smooth', b: { ...SGUARD, propR: [436, 0, -14] } },
]);

// respawn: rises from one knee with the arms sweeping out as the power returns
const KNEEL = { L: [0.14, 0, 0.3, 0], R: [-0.14, 0.02, -0.34, 55] };
const KNEEL_B = {
  hips: [8, 0, 0], spine: [26, 0, 0], chest: [12, 0, 0], neck: [18, 0, 0], head: [16, 0, 0],
  upperArmL: [-30, 0, 8], foreArmL: [-60, 0, 0], handL: [-10, 0, 0], upperArmR: [-6, 0, 10], foreArmR: [-20, 0, 0],
};
export const RESPAWN = compileClip([
  { t: 0, hip: [0, -0.48, -0.02], ik: KNEEL, b: KNEEL_B },
  { t: 0.3, ease: 'linear', hip: [0, -0.46, -0.02], ik: KNEEL, b: { ...KNEEL_B, spine: [24, 0, 0], head: [10, 0, 0] } },
  { t: 0.65, ease: 'out', hip: [0, -0.1, 0], ik: STAND, b: {
    hips: [-4, 0, 0], spine: [-8, 0, 0], chest: [-6, 0, 0], neck: [-8, 0, 0], head: [-10, 0, 0],
    upperArmL: [-14, 0, 62], foreArmL: [-18, 0, 0], handL: [-20, 0, 0], upperArmR: [-14, 0, 62], foreArmR: [-18, 0, 0], handR: [-20, 0, 0],
  } },
  { t: 1.05, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: GUARD },
]);

// ================================================================== Pyro: Fire Force kit
// E — Devil's Foot: a flying front kick, right leg spearing forward, flames streaming off the foot
const KICK_AIR = {
  hips: [-26, 0, 0], spine: [-4, 0, 0], chest: [6, 0, 0], neck: [10, 0, 0], head: [16, 0, 0],
  upperLegR: [-100, 0, 4], lowerLegR: [6, 0, 0], footR: [-28, 0, 0],
  upperLegL: [-58, 0, 6], lowerLegL: [118, 0, 0], footL: [30, 0, 0],
  upperArmL: [-36, 0, 48], foreArmL: [-64, 0, 0], upperArmR: [24, 0, 34], foreArmR: [-40, 0, 0],
};
export const KICK_CLIP = compileClip([
  { t: 0, hip: [0, -0.06, 0], b: { hips: [10, 0, 0], spine: [12, 0, 0], upperLegL: [-30, 0, 4], lowerLegL: [50, 0, 0], upperLegR: [-20, 0, 4], lowerLegR: [46, 0, 0], upperArmL: [-30, 0, 30], upperArmR: [-20, 0, 30], foreArmL: [-60, 0, 0], foreArmR: [-60, 0, 0] } },
  { t: 0.08, ease: 'out', hip: [0, 0.12, 0.05], b: KICK_AIR },
  { t: 0.3, ease: 'linear', hip: [0, 0.1, 0.05], b: { ...KICK_AIR, hips: [-24, 0, 0], upperLegR: [-96, 0, 4] } },
  { t: 0.42, ease: 'smooth', hip: [0, -0.1, 0], b: { hips: [8, 0, 0], spine: [8, 0, 0], upperLegL: [-36, 0, 6], lowerLegL: [60, 0, 0], footL: [-10, 0, 0], upperLegR: [-30, 0, 6], lowerLegR: [56, 0, 0], footR: [-10, 0, 0], upperArmL: [-20, 0, 34], foreArmL: [-50, 0, 0], upperArmR: [-14, 0, 30], foreArmR: [-60, 0, 0] } },
  { t: 0.56, ease: 'smooth', hip: [0, -0.03, 0], b: { spine: [3, 0, 0], upperArmL: [-8, 0, 12], foreArmL: [-40, 0, 0], upperArmR: [-14, 0, 16], foreArmR: [-70, 0, 0] } },
]);

// V — Infernal Step: knee up, both arms raised… then STOMP into a wide crouch, palms driving down
const STOMP_LOW = {
  hips: [12, 0, 0], spine: [20, 0, 0], chest: [8, 0, 0], neck: [-14, 0, 0], head: [-16, 0, 0],
  upperArmL: [-26, 0, 64], foreArmL: [-24, 0, 0], handL: [-40, 0, 0], upperArmR: [-26, 0, 64], foreArmR: [-24, 0, 0], handR: [-40, 0, 0],
};
const STOMP_WIDE = { L: [0.24, 0, 0.1, 0], R: [-0.24, 0, -0.08, 0] };
export const STOMP_CLIP = compileClip([
  { t: 0, hip: [0, -0.03, 0], ik: STAND, b: { spine: [2, 0, 0] } },
  { t: 0.13, ease: 'out', hip: [0, 0.02, 0], ik: { L: [0.13, 0, 0.04, 0], R: [-0.13, 0.42, 0.12, -10] }, b: {
    spine: [-8, 0, 0], chest: [-6, 0, 0], head: [-6, 0, 0],
    upperArmL: [-150, 0, 34], foreArmL: [-30, 0, 0], upperArmR: [-150, 0, 34], foreArmR: [-30, 0, 0],
  } },
  { t: 0.21, ease: 'in', hip: [0, -0.3, 0.02], ik: STOMP_WIDE, b: STOMP_LOW },
  { t: 0.42, ease: 'linear', hip: [0, -0.28, 0.02], ik: STOMP_WIDE, b: { ...STOMP_LOW, spine: [18, 0, 0] } },
  { t: 0.68, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: { spine: [3, 0, 0], upperArmL: [-8, 0, 12], foreArmL: [-40, 0, 0], upperArmR: [-14, 0, 16], foreArmR: [-70, 0, 0] } },
]);

// X — Adolla Burst: sink into a wide stance gathering flame at the hip, then thrust both palms
const ADOLLA_CHARGE = {
  hips: [4, -18, 0], spine: [6, -16, 0], chest: [4, -14, 0], neck: [0, 22, 0], head: [-4, 24, 0],
  upperArmR: [10, 0, 22], foreArmR: [-108, 0, 0], handR: [20, 0, 0],
  upperArmL: [-34, 0, -40], foreArmL: [-100, 0, 0], handL: [20, 0, 0],
};
const ADOLLA_FIRE = {
  hips: [8, 6, 0], spine: [12, 4, 0], chest: [6, 2, 0], neck: [-12, 0, 0], head: [-12, -4, 0],
  upperArmR: [-86, 0, -10], foreArmR: [-4, 0, 0], handR: [-50, 0, 0],
  upperArmL: [-86, 0, -10], foreArmL: [-4, 0, 0], handL: [-50, 0, 0],
};
const BRACE = { L: [0.22, 0, 0.26, -4], R: [-0.22, 0, -0.24, 18] };
export const ADOLLA_CLIP = compileClip([
  { t: 0, hip: [0, -0.03, 0], ik: STAND, b: { spine: [2, 0, 0] } },
  { t: 0.3, ease: 'out', hip: [0, -0.18, -0.02], ik: BRACE, b: ADOLLA_CHARGE },
  { t: 0.72, ease: 'linear', hip: [0, -0.2, -0.03], ik: BRACE, b: { ...ADOLLA_CHARGE, spine: [8, -18, 0] } },
  { t: 0.8, ease: 'out', hip: [0, -0.22, 0.05], ik: BRACE, b: ADOLLA_FIRE },
  { t: 1.2, ease: 'linear', hip: [0, -0.24, 0.02], ik: BRACE, b: { ...ADOLLA_FIRE, spine: [10, 4, 0] } },
  { t: 1.65, ease: 'linear', hip: [0, -0.22, 0.03], ik: BRACE, b: { ...ADOLLA_FIRE, spine: [11, 3, 0] } },
  { t: 2.0, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: { spine: [3, 0, 0], upperArmL: [-8, 0, 12], foreArmL: [-40, 0, 0], upperArmR: [-14, 0, 16], foreArmR: [-70, 0, 0] } },
]);

// C — Rapid Ignition: short snapping jabs (much quicker than the Ember Fists punches)
function jabKeys(side) {
  const out = { spine: [3, 6, 0], chest: [2, 12, 0], neck: [0, -10, 0], head: [0, -12, 0], upperArmR: [-84, 0, -6], foreArmR: [-4, 0, 0], handR: [-30, 0, 0], upperArmL: [12, 0, 16], foreArmL: [-108, 0, 0] };
  const keys = [{ t: 0, b: GUARD }, { t: 0.04, ease: 'out', b: out }, { t: 0.09, ease: 'linear', b: out }, { t: 0.22, ease: 'smooth', b: GUARD }];
  return compileClip(side === 'R' ? keys : keys.map((k) => ({ ...k, b: mirror(k.b) })));
}
export const JAB_R = jabKeys('R');
export const JAB_L = jabKeys('L');

// double jump: an upright corkscrew: knees snap up, arms pull in tight for a full 360° spin,
// then everything opens out again for the fall
// double jump: an air-step, no spin — gather the knees, then kick down hard off the air (one leg
// driving straight down, the other knee up), arms swinging up to pull the body after it, then settle
export const DOUBLE_JUMP = compileClip([
  { t: 0, hip: [0, 0.01, 0], b: { spine: [4, 0, 0], upperLegL: [-30, 0, 5], lowerLegL: [44, 0, 0], upperLegR: [-14, 0, 5], lowerLegR: [34, 0, 0], upperArmL: [-14, 0, 24], foreArmL: [-30, 0, 0], upperArmR: [-14, 0, 24], foreArmR: [-30, 0, 0] } },
  // gather: knees come up, arms swing down and back (loading the second jump)
  { t: 0.08, ease: 'out', hip: [0, 0.05, 0], b: {
    spine: [10, 0, 0], chest: [4, 0, 0], neck: [-5, 0, 0], head: [-6, 0, 0],
    upperLegL: [-62, 0, 6], lowerLegL: [88, 0, 0], footL: [20, 0, 0], upperLegR: [-50, 0, 6], lowerLegR: [82, 0, 0], footR: [20, 0, 0],
    upperArmL: [22, 0, 14], foreArmL: [-28, 0, 0], upperArmR: [22, 0, 14], foreArmR: [-28, 0, 0],
  } },
  // drive: one leg pushes down hard, the other knee stays up; arms swing forward to shoulder height
  { t: 0.2, ease: 'out', hip: [0, 0.06, 0], b: {
    spine: [-2, 0, 0], chest: [-2, 0, 0], neck: [-3, 0, 0], head: [-5, 0, 0],
    upperLegL: [-54, 0, 5], lowerLegL: [76, 0, 0], footL: [16, 0, 0], upperLegR: [8, 0, 4], lowerLegR: [16, 0, 0], footR: [30, 0, 0],
    upperArmL: [-62, 0, 16], foreArmL: [-34, 0, 0], upperArmR: [-58, 0, 16], foreArmR: [-38, 0, 0],
  } },
  // settle into the airborne pose
  { t: 0.42, ease: 'smooth', hip: [0, 0.02, 0], b: {
    spine: [2, 0, 0], upperLegL: [-34, 0, 6], lowerLegL: [48, 0, 0], footL: [12, 0, 0], upperLegR: [-12, 0, 6], lowerLegR: [34, 0, 0], footR: [14, 0, 0],
    upperArmL: [-20, 0, 26], foreArmL: [-34, 0, 0], upperArmR: [-18, 0, 28], foreArmR: [-36, 0, 0],
  } },
]);

// ================================================================== Shoto: frost & flame
// E — Flashfreeze Heatwave (Todoroki-style): the right knee comes up and STOMPS — the ice is born
// at his right foot and races along the ground — then, braced in a wide stance, the left fist
// drives forward and the heatwave rolls out of it.
const FZ_KNEE = { L: [0.14, 0, 0.04, 0], R: [-0.15, 0.36, 0.16, -14] };
const FZ_STANCE = { L: [0.26, 0, -0.06, 0], R: [-0.24, 0, 0.3, -4] };
const FZ_COIL = { hips: [-4, 10, 0], spine: [-6, 8, 0], chest: [-2, 6, 0], neck: [-4, -10, 0], head: [-6, -10, 0], upperArmR: [-24, 0, 26], foreArmR: [-112, 0, 0], upperArmL: [-20, 0, 22], foreArmL: [-118, 0, 0] };
const FZ_STOMP = { hips: [8, -14, 0], spine: [12, -10, 0], chest: [6, -8, 0], neck: [-8, 14, 0], head: [-10, 16, 0], upperArmR: [-22, 0, 50], foreArmR: [-30, 0, 0], handR: [-30, 0, 0], upperArmL: [-14, 0, 22], foreArmL: [-118, 0, 0] };
const FZ_PUNCH = { hips: [6, 18, 0], spine: [8, 20, 0], chest: [4, 16, 0], neck: [-6, -24, 0], head: [-8, -26, 0], upperArmL: [-88, 0, -6], foreArmL: [-2, 0, 0], handL: [-10, 0, 0], upperArmR: [-20, 0, 30], foreArmR: [-100, 0, 0] };
export const FREEZE_STOMP = compileClip([
  { t: 0, hip: [0, -0.03, 0], ik: STAND, b: GUARD },
  { t: 0.12, ease: 'out', hip: [0, 0.01, 0], ik: FZ_KNEE, b: FZ_COIL },
  { t: 0.2, ease: 'in', hip: [0, -0.2, 0.04], ik: FZ_STANCE, b: FZ_STOMP },
  { t: 0.62, ease: 'linear', hip: [0, -0.18, 0.04], ik: FZ_STANCE, b: { ...FZ_STOMP, spine: [10, -12, 0] } },
  { t: 0.76, ease: 'in', hip: [0, -0.2, 0.06], ik: FZ_STANCE, b: { ...FZ_STOMP, upperArmL: [-10, 0, 20], foreArmL: [-130, 0, 0], hips: [6, -18, 0], spine: [8, -18, 0] } },
  { t: 0.88, ease: 'out', hip: [0, -0.2, 0.1], ik: FZ_STANCE, b: FZ_PUNCH },
  { t: 1.05, ease: 'linear', hip: [0, -0.19, 0.1], ik: FZ_STANCE, b: { ...FZ_PUNCH, spine: [7, 18, 0] } },
  { t: 1.35, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: GUARD },
]);
// kept for remote clients on older builds
export const FREEZE_CAST = compileClip([{ t: 0, b: GUARD }, { t: 0.3, b: GUARD }]);

// C — Hellfire Lance: left arm locked straight at the target, right hand bracing the wrist
const LANCE_AIM = { spine: [2, -24, 0], chest: [2, -20, 0], upperChest: [0, -8, 0], neck: [0, 26, 0], head: [-2, 26, 0], upperArmL: [-88, 0, -4], foreArmL: [0, 0, 0], handL: [-4, 0, 0], upperArmR: [-62, 0, -48], foreArmR: [-62, 0, 0], handR: [0, 0, 0] };
export const LANCE_CLIP = compileClip([
  { t: 0, b: GUARD },
  { t: 0.1, ease: 'out', b: LANCE_AIM },
  { t: 0.36, ease: 'linear', b: { ...LANCE_AIM, spine: [2, -25, 0] } },
  { t: 0.42, ease: 'out', b: { ...LANCE_AIM, spine: [-4, -24, 0], chest: [-4, -20, 0], upperArmL: [-100, 0, -4], foreArmL: [-10, 0, 0] } },
  { t: 0.7, ease: 'smooth', b: GUARD },
]);

// V — Cryo-Jet Blitz: a low skating glide, arms thrown back with fire jets…
const SKATE = {
  hips: [26, 0, 0], spine: [18, 0, 0], chest: [8, 0, 0], neck: [-18, 0, 0], head: [-22, 0, 0],
  upperLegL: [-60, 0, 4], lowerLegL: [80, 0, 0], footL: [-18, 0, 0], upperLegR: [26, 0, 10], lowerLegR: [18, 0, 0], footR: [30, 0, 0],
  upperArmL: [62, 0, 30], foreArmL: [-10, 0, 0], handL: [40, 0, 0], upperArmR: [66, 0, 28], foreArmR: [-10, 0, 0], handR: [40, 0, 0],
};
export const SKATE_CLIP = compileClip([
  { t: 0, hip: [0, -0.1, 0], b: { hips: [14, 0, 0], spine: [10, 0, 0], upperLegL: [-30, 0, 4], lowerLegL: [50, 0, 0], upperLegR: [-10, 0, 4], lowerLegR: [40, 0, 0] } },
  { t: 0.08, ease: 'out', hip: [0, -0.3, 0], b: SKATE },
  { t: 0.62, ease: 'linear', hip: [0, -0.3, 0], b: { ...SKATE, hips: [24, 4, 0], spine: [17, -4, 0] } },
]);
// …then a dual-element uppercut that rises out of the crouch
export const UPPERCUT_CLIP = compileClip([
  { t: 0, hip: [0, -0.3, 0], b: { hips: [20, 0, 0], spine: [16, 0, 0], upperLegL: [-50, 0, 4], lowerLegL: [80, 0, 0], upperLegR: [-10, 0, 8], lowerLegR: [50, 0, 0], upperArmR: [20, 0, 20], foreArmR: [-110, 0, 0], upperArmL: [-30, 0, 30], foreArmL: [-60, 0, 0] } },
  { t: 0.1, ease: 'out', hip: [0, 0.06, 0.04], b: { hips: [-6, 12, 0], spine: [-12, 16, 0], chest: [-8, 10, 0], neck: [-10, -10, 0], head: [-14, -10, 0], upperLegL: [-30, 0, 4], lowerLegL: [30, 0, 0], upperLegR: [6, 0, 6], lowerLegR: [40, 0, 0], footR: [40, 0, 0], upperArmR: [-170, 0, -6], foreArmR: [-30, 0, 0], handR: [-10, 0, 0], upperArmL: [20, 0, 40], foreArmL: [-50, 0, 0] } },
  { t: 0.26, ease: 'linear', hip: [0, 0.04, 0.03], b: { hips: [-4, 10, 0], spine: [-10, 14, 0], chest: [-6, 8, 0], neck: [-8, -8, 0], head: [-12, -8, 0], upperLegL: [-26, 0, 4], lowerLegL: [26, 0, 0], upperLegR: [4, 0, 6], lowerLegR: [36, 0, 0], footR: [36, 0, 0], upperArmR: [-166, 0, -6], foreArmR: [-34, 0, 0], upperArmL: [16, 0, 40], foreArmL: [-50, 0, 0] } },
  { t: 0.5, ease: 'smooth', hip: [0, -0.03, 0], b: GUARD },
]);

// X — Absolute Zero-Burn: slam the right palm to the ground (glacier), rise with arms spread while the
// air superheats (left hand burning), then clap both hands together overhead and smash them down
const ZB_LOW = { L: [0.24, 0, 0.3, 0], R: [-0.22, 0.03, -0.3, 50] };
const ZB_WIDE = { L: [0.22, 0, 0.12, 0], R: [-0.22, 0, -0.1, 0] };
const ZB_SPREAD = { spine: [-8, 0, 0], chest: [-6, 0, 0], neck: [-8, 0, 0], head: [-14, 0, 0], upperArmL: [-40, 0, 80], foreArmL: [-10, 0, 0], handL: [-20, 0, 0], upperArmR: [-40, 0, 80], foreArmR: [-10, 0, 0], handR: [-20, 0, 0] };
export const ZEROBURN_CLIP = compileClip([
  { t: 0, hip: [0, -0.03, 0], ik: STAND, b: GUARD },
  // the glacier starts at his right foot: knee up, STOMP…
  { t: 0.14, ease: 'out', hip: [0, 0.01, 0], ik: FZ_KNEE, b: FZ_COIL },
  { t: 0.24, ease: 'in', hip: [0, -0.22, 0.04], ik: FZ_STANCE, b: FZ_STOMP },
  { t: 0.5, ease: 'linear', hip: [0, -0.24, 0.04], ik: FZ_STANCE, b: { ...FZ_STOMP, spine: [14, -10, 0] } },
  // …then drops low, palm to the ice, as it floods outward
  { t: 0.66, ease: 'in', hip: [0, -0.46, 0.04], ik: ZB_LOW, b: { hips: [14, 0, 0], spine: [26, 0, 0], chest: [10, 0, 0], neck: [-14, 0, 0], head: [-16, 0, 0], upperArmR: [-40, 0, 10], foreArmR: [-10, 0, 0], handR: [-60, 0, 0], upperArmL: [-10, 0, 40], foreArmL: [-60, 0, 0] } },
  { t: 0.95, ease: 'linear', hip: [0, -0.44, 0.04], ik: ZB_LOW, b: { hips: [13, 0, 0], spine: [24, 0, 0], chest: [10, 0, 0], neck: [-14, 0, 0], head: [-16, 0, 0], upperArmR: [-40, 0, 10], foreArmR: [-10, 0, 0], handR: [-60, 0, 0], upperArmL: [-10, 0, 40], foreArmL: [-60, 0, 0] } },
  { t: 1.25, ease: 'smooth', hip: [0, -0.08, 0], ik: ZB_WIDE, b: ZB_SPREAD },
  { t: 2.0, ease: 'linear', hip: [0, -0.06, 0], ik: ZB_WIDE, b: { ...ZB_SPREAD, spine: [-10, 0, 0], head: [-18, 0, 0] } },
  { t: 2.22, ease: 'out', hip: [0, 0.0, 0], ik: ZB_WIDE, b: { spine: [-12, 0, 0], chest: [-8, 0, 0], head: [-20, 0, 0], upperArmL: [-172, 0, -14], foreArmL: [-20, 0, 0], upperArmR: [-172, 0, -14], foreArmR: [-20, 0, 0] } },
  { t: 2.35, ease: 'in', hip: [0, -0.32, 0.05], ik: ZB_WIDE, b: { hips: [12, 0, 0], spine: [24, 0, 0], chest: [10, 0, 0], neck: [-12, 0, 0], head: [-14, 0, 0], upperArmL: [-74, 0, -30], foreArmL: [-10, 0, 0], upperArmR: [-74, 0, -30], foreArmR: [-10, 0, 0] } },
  { t: 2.75, ease: 'linear', hip: [0, -0.3, 0.05], ik: ZB_WIDE, b: { hips: [11, 0, 0], spine: [22, 0, 0], chest: [10, 0, 0], neck: [-12, 0, 0], head: [-14, 0, 0], upperArmL: [-72, 0, -30], foreArmL: [-12, 0, 0], upperArmR: [-72, 0, -30], foreArmR: [-12, 0, 0] } },
  { t: 3.0, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: GUARD },
]);

// C — Scarlet Ray: plant the stance, staff leveled at the target with both hands, channel… then fire
const RAY_AIM = {
  hips: [4, -10, 0], spine: [6, -8, 0], chest: [3, -6, 0], neck: [-4, 10, 0], head: [-6, 12, 0],
  upperArmR: [-82, 0, -4], foreArmR: [-6, 0, 0], handR: [0, 0, 0], propR: [178, 0, 0],
  upperArmL: [-74, 0, -40], foreArmL: [-28, 0, 0], handL: [-20, 0, 0],
};
const RAY_BRACE = { L: [0.2, 0, 0.24, -4], R: [-0.2, 0, -0.2, 16] };
export const M_RAY = compileClip([
  { t: 0, hip: [0, -0.03, 0], ik: STAND, b: SGUARD },
  { t: 0.25, ease: 'out', hip: [0, -0.12, 0], ik: RAY_BRACE, b: RAY_AIM },
  { t: 1.3, ease: 'linear', hip: [0, -0.13, 0], ik: RAY_BRACE, b: { ...RAY_AIM, spine: [7, -9, 0] } },
  { t: 1.38, ease: 'out', hip: [0, -0.1, -0.06], ik: RAY_BRACE, b: { ...RAY_AIM, spine: [-2, -8, 0], chest: [-3, -6, 0], upperArmR: [-90, 0, -4], upperArmL: [-82, 0, -40] } },
  { t: 1.8, ease: 'linear', hip: [0, -0.1, -0.05], ik: RAY_BRACE, b: { ...RAY_AIM, spine: [0, -8, 0] } },
  { t: 2.1, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: SGUARD },
]);


// ================================================================== SPRINT CYCLE (Genshin reference)
// One full stride, t in [0, 1): t = 0 the LEFT foot strikes in front, t = 0.5 the right. Hand-keyed
// from the reference: heavy forward lean with the head up, the stance leg drives all the way back
// (straight) at toe-off while the other knee drives up high, the trailing heel kicks right up behind,
// elbows bent ~90 deg pumping hard opposite the legs. `hip` here is ADDITIVE height (bob).
const SPR_TORSO = { hips: [17, 0, 0], spine: [7, 0, 0], chest: [4, 0, 0], upperChest: [0, 0, 0], neck: [-9, 0, 0], head: [-12, 0, 0] };
const SPR_HALF = [
  // contact: left heel strikes ahead, right heel rising behind; right arm forward, left back
  { t: 0, hip: [0, -0.005, 0], b: { ...SPR_TORSO, hips: [17, 5, 2], chest: [4, -7, 0],
    upperLegL: [-40, 0, 2], lowerLegL: [16, 0, 0], footL: [-10, 0, 0], upperLegR: [24, 0, 2], lowerLegR: [78, 0, 0], footR: [34, 0, 0],
    upperArmR: [-44, 0, 10], foreArmR: [-96, 0, 0], handR: [-10, 0, 0], upperArmL: [40, 0, 12], foreArmL: [-62, 0, 0], handL: [-10, 0, 0] } },
  // down: left leg under the body, right heel tucked up toward the seat as the knee swings through
  { t: 0.11, hip: [0, -0.03, 0], b: { ...SPR_TORSO, hips: [18, 2, 1], chest: [4, -3, 0],
    upperLegL: [-12, 0, 2], lowerLegL: [40, 0, 0], footL: [6, 0, 0], upperLegR: [-14, 0, 2], lowerLegR: [128, 0, 0], footR: [42, 0, 0],
    upperArmR: [-16, 0, 10], foreArmR: [-98, 0, 0], handR: [-10, 0, 0], upperArmL: [14, 0, 12], foreArmL: [-80, 0, 0], handL: [-10, 0, 0] } },
  // toe-off: left leg driven straight back, right knee high; arms at full swing the other way
  { t: 0.23, hip: [0, 0.035, 0], b: { ...SPR_TORSO, hips: [17, -5, -2], chest: [4, 7, 0],
    upperLegL: [32, 0, 2], lowerLegL: [14, 0, 0], footL: [48, 0, 0], upperLegR: [-80, 0, 2], lowerLegR: [104, 0, 0], footR: [24, 0, 0],
    upperArmR: [42, 0, 12], foreArmR: [-58, 0, 0], handR: [-10, 0, 0], upperArmL: [-52, 0, 10], foreArmL: [-100, 0, 0], handL: [-10, 0, 0] } },
  // flight: left heel lifts behind, right leg reaching forward for the next strike
  { t: 0.37, hip: [0, 0.045, 0], b: { ...SPR_TORSO, hips: [17, -3, -1], chest: [4, 5, 0],
    upperLegL: [24, 0, 2], lowerLegL: [72, 0, 0], footL: [36, 0, 0], upperLegR: [-56, 0, 2], lowerLegR: [40, 0, 0], footR: [2, 0, 0],
    upperArmR: [34, 0, 12], foreArmR: [-62, 0, 0], handR: [-10, 0, 0], upperArmL: [-46, 0, 10], foreArmL: [-98, 0, 0], handL: [-10, 0, 0] } },
];
export const SPRINT = compileClip([
  ...SPR_HALF,
  ...SPR_HALF.map((k) => ({ t: k.t + 0.5, hip: k.hip, b: mirror(k.b) })),
  { t: 1, hip: SPR_HALF[0].hip, b: SPR_HALF[0].b },
]);

// ================================================================== Sorcerer (Limitless)
// E — Lapse: Blue: the left hand reaches out, palm open toward the point where Blue appears
const BLUE_REACH = {
  spine: [2, -10, 0], chest: [0, -12, 0], upperChest: [0, -4, 0], neck: [0, 12, 0], head: [-2, 14, 0],
  upperArmL: [-84, 0, 4], foreArmL: [-8, 0, 0], handL: [-38, 0, 0],
  upperArmR: [6, 0, 14], foreArmR: [-38, 0, 0],
};
export const G_BLUE = compileClip([
  { t: 0, b: GUARD },
  // the hand gathers in at the chest…
  { t: 0.05, ease: 'out', b: { spine: [3, 6, 0], chest: [2, 6, 0], neck: [0, -4, 0], head: [-2, -4, 0], upperArmL: [-44, 0, -16], foreArmL: [-118, 0, 0], handL: [10, 0, 0], upperArmR: [-4, 0, 14], foreArmR: [-50, 0, 0] } },
  // …and shoots out open-palmed, a little past the line, then settles
  { t: 0.11, ease: 'in', b: { ...BLUE_REACH, chest: [0, -15, 0], upperArmL: [-88, 0, 6], foreArmL: [-2, 0, 0] } },
  { t: 0.17, ease: 'out', b: BLUE_REACH },
  // the hand closes and draws back a hand's width: dragging space toward the point
  { t: 0.36, ease: 'smooth', b: { ...BLUE_REACH, chest: [0, -10, 0], upperArmL: [-76, 0, 2], foreArmL: [-34, 0, 0], handL: [-10, 0, 0] } },
  { t: 0.6, ease: 'smooth', b: GUARD },
]);
// C — Reversal: Red: the right hand draws back while Red condenses at the fingertip, then thrusts,
// and the blast kicks the arm and shoulders back
const RED_DRAW = {
  spine: [0, -12, 0], chest: [-2, -16, 0], upperChest: [0, -6, 0], neck: [0, 14, 0], head: [0, 18, 0],
  upperArmR: [-46, 0, 46], foreArmR: [-104, 0, 0], handR: [10, 0, 0],
  upperArmL: [-30, 0, 10], foreArmL: [-80, 0, 0],
};
const RED_FIRE = {
  spine: [4, 10, 0], chest: [2, 16, 0], upperChest: [0, 8, 0], neck: [0, -14, 0], head: [0, -16, 0],
  upperArmR: [-88, 0, -6], foreArmR: [-4, 0, 0], handR: [-6, 0, 0],
  upperArmL: [12, 0, 14], foreArmL: [-100, 0, 0],
};
export const G_RED = compileClip([
  { t: 0, b: GUARD },
  { t: 0.16, ease: 'out', b: RED_DRAW },
  { t: 0.33, ease: 'linear', b: { ...RED_DRAW, chest: [-3, -19, 0], upperArmR: [-48, 0, 50], foreArmR: [-110, 0, 0], handR: [14, 0, 0] } },
  { t: 0.38, ease: 'in', b: { ...RED_FIRE, chest: [3, 20, 0], upperArmR: [-90, 0, -8], foreArmR: [0, 0, 0] } },
  // recoil: the blast kicks the hand up and rocks the shoulders back
  { t: 0.44, ease: 'out', b: { ...RED_FIRE, spine: [-2, 9, 0], chest: [-4, 14, 0], head: [-6, -14, 0], upperArmR: [-97, 0, -4], foreArmR: [-12, 0, 0], handR: [-18, 0, 0] } },
  { t: 0.58, ease: 'smooth', b: { ...RED_FIRE, upperArmR: [-84, 0, -4], foreArmR: [-10, 0, 0] } },
  { t: 0.8, ease: 'smooth', b: GUARD },
]);
// V — Hollow Purple (after the reference animation): arms open wide — Blue in the left hand, Red in
// the right — the hands sweep together in front of the chest to merge them, then a planted stance
// and the right hand drives forward to release the imaginary mass
const HP_WIDE = { L: [0.22, 0, 0.1, 0], R: [-0.22, 0, -0.1, 0] };
const HP_LUNGE = { L: [0.21, 0, 0.32, -6], R: [-0.21, 0, -0.22, 16] };
const HP_OPEN = { spine: [-2, 0, 0], chest: [-2, 0, 0], neck: [-4, 0, 0], head: [-6, 0, 0], upperArmL: [-24, 0, 78], foreArmL: [-26, 0, 0], handL: [-30, 0, 0], upperArmR: [-24, 0, 78], foreArmR: [-26, 0, 0], handR: [-30, 0, 0] };
const HP_MERGE = { spine: [4, 0, 0], chest: [2, 0, 0], neck: [-2, 0, 0], head: [2, 0, 0], upperArmL: [-58, 0, -12], foreArmL: [-74, 0, 0], handL: [0, 0, 0], upperArmR: [-58, 0, -12], foreArmR: [-74, 0, 0], handR: [0, 0, 0] };
const HP_FIRE = { hips: [6, 0, 0], spine: [6, 8, 0], chest: [3, 12, 0], neck: [-4, -10, 0], head: [-6, -12, 0], upperArmR: [-90, 0, -4], foreArmR: [-2, 0, 0], handR: [-4, 0, 0], upperArmL: [-36, 0, 16], foreArmL: [-96, 0, 0] };
export const G_PURPLE = compileClip([
  { t: 0, hip: [0, -0.03, 0], ik: STAND, b: GUARD },
  { t: 0.22, ease: 'out', hip: [0, -0.06, 0], ik: HP_WIDE, b: HP_OPEN },
  { t: 0.6, ease: 'linear', hip: [0, -0.07, 0], ik: HP_WIDE, b: { ...HP_OPEN, upperArmL: [-30, 0, 76], upperArmR: [-30, 0, 76], head: [-8, 0, 0] } },
  { t: 0.95, ease: 'in', hip: [0, -0.08, 0], ik: HP_WIDE, b: HP_MERGE },
  { t: 1.18, ease: 'linear', hip: [0, -0.09, 0], ik: HP_WIDE, b: { ...HP_MERGE, spine: [5, 0, 0] } },
  { t: 1.3, ease: 'out', hip: [0, -0.15, 0.05], ik: HP_LUNGE, b: HP_FIRE },
  { t: 1.6, ease: 'linear', hip: [0, -0.15, 0.05], ik: HP_LUNGE, b: { ...HP_FIRE, spine: [7, 7, 0] } },
  { t: 1.95, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: GUARD },
]);
// X — Domain Expansion: right hand raised in front of the face (the sign), head bowed a touch,
// perfectly still… then the domain opens
const DE_SIGN = { spine: [-2, 0, 0], chest: [-2, 0, 0], neck: [2, 0, 0], head: [5, 0, 0], upperArmR: [-40, 0, -30], foreArmR: [-128, 0, 0], handR: [4, 0, 0], upperArmL: [-4, 0, 9], foreArmL: [-18, 0, 0] };
export const G_DOMAIN = compileClip([
  { t: 0, hip: [0, -0.03, 0], ik: STAND, b: GUARD },
  { t: 0.3, ease: 'out', hip: [0, -0.03, 0], ik: STAND, b: DE_SIGN },
  { t: 1.2, ease: 'linear', hip: [0, -0.03, 0], ik: STAND, b: { ...DE_SIGN, head: [7, 0, 0] } },
  { t: 1.35, ease: 'out', hip: [0, -0.02, 0], ik: STAND, b: { ...DE_SIGN, head: [-3, 0, 0], spine: [-4, 0, 0] } },
  { t: 5.3, ease: 'linear', hip: [0, -0.02, 0], ik: STAND, b: { ...DE_SIGN, head: [-3, 0, 0], spine: [-4, 0, 0] } },
  { t: 5.8, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: GUARD },
]);

// ================================================================== M1 melee combo (battlegrounds-style)
// fighting stance: left foot forward, knees soft, fists up at the chin
const FIGHT = { L: [0.15, 0, 0.17, -12], R: [-0.15, 0, -0.15, 22] };
const FIGHT_STEP = { L: [0.15, 0, 0.3, -12], R: [-0.15, 0, -0.1, 22] };
const FGUARD = {
  hips: [4, 8, 0], spine: [6, -4, 0], chest: [3, -4, 0], neck: [-2, 4, 0], head: [-6, 6, 0],
  upperArmL: [-42, 0, -14], foreArmL: [-116, 0, 0], handL: [-12, 0, 0],
  upperArmR: [-34, 0, -10], foreArmR: [-124, 0, 0], handR: [-12, 0, 0],
};
// Every strike: a short load (weight and fist draw back a hair), a snap out that overshoots past
// the line of the punch, a recoil, and only then the return to guard: anticipation → impact →
// follow-through. Impact frames line up with M1.hits[].at in game/melee.js.
// 1 — left jab: snaps straight out, shoulder rolls through, the body stays square
const JAB = {
  hips: [8, -14, 0], spine: [13, -18, 0], chest: [8, -24, 0], upperChest: [0, -10, 0], neck: [2, 20, 0], head: [-4, 24, 0],
  upperArmL: [-106, 0, 27], foreArmL: [0, 0, 0], handL: [-6, 0, 0],
  upperArmR: [-40, 0, -10], foreArmR: [-128, 0, 0], handR: [-10, 0, 0],
};
export const M1_A = compileClip([
  { t: 0, hip: [0, -0.06, 0], ik: FIGHT, b: FGUARD },
  { t: 0.025, ease: 'out', hip: [0, -0.08, -0.01], ik: FIGHT, b: { ...FGUARD, hips: [5, 12, 0], chest: [4, 2, 0], upperArmL: [-46, 0, -18], foreArmL: [-124, 0, 0] } },
  { t: 0.06, ease: 'in', hip: [0, -0.09, 0.07], ik: FIGHT_STEP, b: JAB },
  { t: 0.1, ease: 'out', hip: [0, -0.09, 0.06], ik: FIGHT_STEP, b: { ...JAB, chest: [7, -21, 0], upperArmL: [-100, 0, 24], foreArmL: [-12, 0, 0] } },
  { t: 0.17, ease: 'smooth', hip: [0, -0.08, 0.04], ik: FIGHT_STEP, b: { ...FGUARD, hips: [5, -2, 0], upperArmL: [-60, 0, 2], foreArmL: [-90, 0, 0] } },
  { t: 0.32, ease: 'smooth', hip: [0, -0.06, 0], ik: FIGHT, b: FGUARD },
]);
// 2 — right cross: load the back hip, then the hips and back foot turn the whole body into it
const CROSS = {
  hips: [12, 32, 0], spine: [15, 24, 0], chest: [9, 30, 0], upperChest: [0, 13, 0], neck: [2, -28, 0], head: [-4, -32, 0],
  upperArmR: [-94, 0, 36], foreArmR: [0, 0, 0], handR: [-6, 0, 0],
  upperArmL: [-44, 0, -12], foreArmL: [-122, 0, 0], handL: [-10, 0, 0],
};
const CROSS_STEP = { L: [0.15, 0, 0.36, -12], R: [-0.15, 0.06, -0.04, 58] };
export const M1_B = compileClip([
  { t: 0, hip: [0, -0.06, 0], ik: FIGHT, b: { ...FGUARD, hips: [4, -6, 0], chest: [3, -10, 0] } },
  { t: 0.03, ease: 'out', hip: [0, -0.1, -0.02], ik: FIGHT, b: { ...FGUARD, hips: [4, -12, 0], spine: [6, -10, 0], chest: [3, -14, 0], upperArmR: [-28, 0, -8], foreArmR: [-132, 0, 0] } },
  { t: 0.07, ease: 'in', hip: [0, -0.1, 0.09], ik: CROSS_STEP, b: CROSS },
  { t: 0.11, ease: 'out', hip: [0, -0.1, 0.08], ik: CROSS_STEP, b: { ...CROSS, chest: [6, 20, 0], upperArmR: [-88, 0, 30], foreArmR: [-12, 0, 0] } },
  { t: 0.2, ease: 'smooth', hip: [0, -0.08, 0.04], ik: CROSS_STEP, b: { ...FGUARD, hips: [6, 10, 0], chest: [4, 8, 0], upperArmR: [-58, 0, 6], foreArmR: [-96, 0, 0] } },
  { t: 0.36, ease: 'smooth', hip: [0, -0.06, 0], ik: FIGHT, b: FGUARD },
]);
// 3 — left hook: sink and wind the torso back, then whip the bent arm round on a flat arc and
// let the shoulders carry on past the target
const HOOK_WIND = {
  hips: [8, 22, 0], spine: [10, 24, 0], chest: [4, 28, 0], neck: [0, -22, 0], head: [-4, -24, 0],
  upperArmL: [-54, 0, 72], foreArmL: [-96, 0, 0], handL: [-6, 0, 0],
  upperArmR: [-36, 0, -8], foreArmR: [-124, 0, 0],
};
const HOOK = {
  hips: [12, -28, 0], spine: [15, -30, 0], chest: [9, -34, 0], upperChest: [0, -12, 0], neck: [2, 32, 0], head: [-4, 34, 0],
  upperArmL: [-88, 0, 16], foreArmL: [-92, 0, 0], handL: [0, 0, 0],
  upperArmR: [-38, 0, -8], foreArmR: [-122, 0, 0],
};
const HOOK_PIVOT = { L: [0.15, 0, 0.3, -30], R: [-0.15, 0, -0.1, 22] };
export const M1_C = compileClip([
  { t: 0, hip: [0, -0.06, 0], ik: FIGHT, b: FGUARD },
  { t: 0.075, ease: 'out', hip: [0, -0.12, -0.01], ik: FIGHT, b: HOOK_WIND },
  { t: 0.12, ease: 'in', hip: [0, -0.12, 0.07], ik: HOOK_PIVOT, b: HOOK },
  { t: 0.17, ease: 'out', hip: [0, -0.12, 0.07], ik: HOOK_PIVOT, b: { ...HOOK, hips: [12, -38, 0], chest: [9, -44, 0], upperArmL: [-80, 0, 2], foreArmL: [-102, 0, 0] } },
  { t: 0.27, ease: 'smooth', hip: [0, -0.09, 0.04], ik: HOOK_PIVOT, b: { ...FGUARD, hips: [6, -12, 0], chest: [4, -14, 0] } },
  { t: 0.44, ease: 'smooth', hip: [0, -0.06, 0], ik: FIGHT, b: FGUARD },
]);
// 4 — finisher: spinning roundhouse. Pivot on the lead foot, chamber the right knee high, hips
// turn over and the shin whips through at chest height, then the leg recoils and plants
const RH_CHAMBER = {
  hips: [0, 40, -10], spine: [-2, -14, 8], chest: [-2, -14, 4], neck: [0, -8, 0], head: [-4, -10, 4],
  upperLegR: [-92, 0, 40], lowerLegR: [124, 0, 0], footR: [24, 0, 0],
  upperLegL: [-8, 0, 2], lowerLegL: [18, 0, 0], footL: [-8, 0, 0],
  upperArmL: [-60, 0, -6], foreArmL: [-112, 0, 0], upperArmR: [-20, 0, 40], foreArmR: [-80, 0, 0],
};
const RH_KICK = {
  hips: [-8, 84, -48], spine: [2, -26, 18], chest: [2, -24, 14], upperChest: [0, -10, 0], neck: [0, -16, 12], head: [-4, -18, 14],
  upperLegR: [-106, 0, 64], lowerLegR: [2, 0, 0], footR: [-30, 0, 0],
  upperLegL: [-6, 0, 2], lowerLegL: [14, 0, 0], footL: [-6, 0, 0],
  upperArmL: [-50, 0, -16], foreArmL: [-104, 0, 0], upperArmR: [-6, 0, 58], foreArmR: [-34, 0, 0],
};
export const M1_D = compileClip([
  { t: 0, hip: [0, -0.06, 0], b: { ...FGUARD, upperLegL: [-18, 0, 4], lowerLegL: [30, 0, 0], upperLegR: [-6, 0, 4], lowerLegR: [26, 0, 0] } },
  { t: 0.04, ease: 'out', hip: [0, -0.1, 0], b: { ...FGUARD, hips: [4, -10, 0], chest: [3, -12, 0], upperLegL: [-22, 0, 4], lowerLegL: [40, 0, 0], upperLegR: [-10, 0, 4], lowerLegR: [36, 0, 0] } },
  { t: 0.1, ease: 'out', hip: [0, 0.0, 0.03], b: RH_CHAMBER },
  { t: 0.16, ease: 'in', hip: [0, 0.07, 0.08], b: RH_KICK },
  { t: 0.24, ease: 'out', hip: [0, 0.02, 0.06], b: { ...RH_KICK, hips: [-6, 86, -42], upperLegR: [-94, 0, 58], lowerLegR: [14, 0, 0] } },
  { t: 0.36, ease: 'smooth', hip: [0, -0.04, 0.04], b: { ...RH_CHAMBER, hips: [0, 60, -6], upperLegR: [-60, 0, 20], lowerLegR: [100, 0, 0] } },
  { t: 0.52, ease: 'smooth', hip: [0, -0.08, 0.02], b: { ...FGUARD, hips: [6, 20, 0], upperLegL: [-20, 0, 4], lowerLegL: [36, 0, 0], upperLegR: [-14, 0, 4], lowerLegR: [34, 0, 0] } },
  { t: 0.7, ease: 'smooth', hip: [0, -0.04, 0], ik: STAND, b: GUARD },
]);

// ================================================================== hit reactions (getting comboed)
// stagger: the head snaps off the punch, the torso folds back, the knees give and a foot steps
// back to catch the weight, then a dazed sway until the stun wears off. A / B alternate sides so a
// string of hits rocks the victim left-right-left.
const STAG_HIT = {
  hips: [-8, 10, 4], spine: [-16, 10, -8], chest: [-10, 8, -6], upperChest: [-4, 0, 0], neck: [-10, 12, -6], head: [-20, 22, -12],
  upperArmL: [-22, 0, 46], foreArmL: [-58, 0, 0], handL: [-20, 0, 0], upperArmR: [-8, 0, 30], foreArmR: [-40, 0, 0], handR: [-14, 0, 0],
};
const STAG_DAZE = {
  hips: [4, 4, 2], spine: [10, 4, -2], chest: [6, 2, -2], neck: [6, 4, 0], head: [10, 8, -4],
  upperArmL: [-16, 0, 14], foreArmL: [-40, 0, 0], upperArmR: [-14, 0, 12], foreArmR: [-44, 0, 0],
};
const STAG_FEET = { L: [0.14, 0, 0.06, -6], R: [-0.15, 0, -0.2, 16] };
const stagger = (b) => compileClip([
  { t: 0, hip: [0, -0.03, 0], ik: STAND, b: GUARD },
  { t: 0.035, ease: 'out', hip: [0, -0.06, -0.08], ik: STAG_FEET, b: b(STAG_HIT) },
  { t: 0.16, ease: 'out', hip: [0, -0.12, -0.1], ik: STAG_FEET, b: b({ ...STAG_HIT, spine: [-6, 6, -4], head: [-6, 14, -8] }) },
  { t: 0.34, ease: 'smooth', hip: [0, -0.1, -0.06], ik: STAG_FEET, b: b(STAG_DAZE) },
  { t: 0.56, ease: 'smooth', hip: [0, -0.05, -0.02], ik: STAND, b: GUARD },
]);
export const STAGGER_A = stagger((b) => b);
export const STAGGER_B = stagger(mirror);
// launched by a finisher: bent in half round the impact, arms and legs flung forward, then the
// body opens out and arches back as it flies
const LAUNCH_HIT = {
  hips: [22, 0, 0], spine: [26, 0, 0], chest: [14, 0, 0], neck: [14, 0, 0], head: [10, 0, 0],
  upperArmL: [-70, 0, 30], foreArmL: [-30, 0, 0], upperArmR: [-74, 0, 26], foreArmR: [-34, 0, 0],
  upperLegL: [-56, 0, 8], lowerLegL: [46, 0, 0], upperLegR: [-48, 0, 6], lowerLegR: [40, 0, 0],
};
const LAUNCH_ARCH = {
  hips: [-24, 0, 6], spine: [-20, 0, 4], chest: [-12, 0, 0], neck: [-14, 0, 0], head: [-22, 0, 0],
  upperArmL: [-150, 0, 40], foreArmL: [-20, 0, 0], upperArmR: [-140, 0, 46], foreArmR: [-28, 0, 0],
  upperLegL: [6, 0, 8], lowerLegL: [50, 0, 0], footL: [30, 0, 0], upperLegR: [14, 0, 6], lowerLegR: [70, 0, 0], footR: [30, 0, 0],
};
export const LAUNCHED = compileClip([
  { t: 0, hip: [0, -0.03, 0], b: GUARD },
  { t: 0.05, ease: 'out', hip: [0, 0, -0.12], b: LAUNCH_HIT },
  { t: 0.22, ease: 'linear', hip: [0, 0, -0.1], b: { ...LAUNCH_HIT, spine: [20, 0, 0] } },
  { t: 0.5, ease: 'smooth', hip: [0, 0, 0], b: LAUNCH_ARCH },
  { t: 0.85, ease: 'linear', hip: [0, 0, 0], b: { ...LAUNCH_ARCH, upperArmL: [-130, 0, 50], upperArmR: [-124, 0, 52] } },
]);

// ================================================================== Kine Slayer (spear in the right hand, sword grip:
// the blade comes out of the thumb side of the fist)
// stance: low and loose, weight forward, the spear held low by the right hip, left hand open in front
const KS_FEET = { L: [0.16, 0, 0.2, -14], R: [-0.16, 0, -0.16, 24] };
const KS_STEP = { L: [0.16, 0, 0.36, -14], R: [-0.16, 0, -0.1, 24] };
const KS_GUARD = {
  hips: [6, 10, 0], spine: [10, -4, 0], chest: [4, -6, 0], neck: [-4, 4, 0], head: [-8, 6, 0],
  upperArmL: [-46, 0, -6], foreArmL: [-84, 0, 0], handL: [-6, 0, 0],
  upperArmR: [-10, 0, 22], foreArmR: [-62, 0, 0], handR: [0, 0, 0],
};
// A: forehand diagonal (high right → low left)
const KS_A_WIND = { ...KS_GUARD, hips: [4, -10, 0], spine: [4, -14, 0], chest: [0, -18, 0], neck: [0, 14, 0], head: [-6, 16, 0], upperArmR: [-140, 0, 44], foreArmR: [-70, 0, 0], handR: [20, 0, 0] };
const KS_A_CUT = { ...KS_GUARD, hips: [10, 18, 0], spine: [16, 18, 0], chest: [8, 22, 0], neck: [0, -18, 0], head: [-8, -20, 0], upperArmR: [-62, 0, -34], foreArmR: [-12, 0, 0], handR: [-30, 0, 0], upperArmL: [-20, 0, 30], foreArmL: [-50, 0, 0] };
export const KS_A = compileClip([
  { t: 0, hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
  { t: 0.05, ease: 'out', hip: [0, -0.09, -0.02], ik: KS_FEET, b: KS_A_WIND },
  { t: 0.085, ease: 'in', hip: [0, -0.12, 0.08], ik: KS_STEP, b: KS_A_CUT },
  { t: 0.16, ease: 'out', hip: [0, -0.13, 0.08], ik: KS_STEP, b: { ...KS_A_CUT, chest: [9, 28, 0], upperArmR: [-46, 0, -44], foreArmR: [-18, 0, 0] } },
  { t: 0.36, ease: 'smooth', hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
]);
// B: backhand, flat across (left → right)
const KS_B_WIND = { ...KS_GUARD, hips: [6, 18, 0], spine: [8, 18, 0], chest: [4, 24, 0], neck: [0, -18, 0], head: [-6, -20, 0], upperArmR: [-80, 0, -48], foreArmR: [-112, 0, 0], handR: [10, 0, 0], upperArmL: [-30, 0, 20], foreArmL: [-60, 0, 0] };
const KS_B_CUT = { ...KS_GUARD, hips: [8, -16, 0], spine: [10, -18, 0], chest: [6, -24, 0], neck: [0, 20, 0], head: [-8, 22, 0], upperArmR: [-92, 0, 56], foreArmR: [-6, 0, 0], handR: [0, 45, 0], upperArmL: [-40, 0, -10], foreArmL: [-90, 0, 0] };
export const KS_B = compileClip([
  { t: 0, hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
  { t: 0.05, ease: 'out', hip: [0, -0.1, 0], ik: KS_FEET, b: KS_B_WIND },
  { t: 0.085, ease: 'in', hip: [0, -0.12, 0.07], ik: KS_STEP, b: KS_B_CUT },
  { t: 0.15, ease: 'out', hip: [0, -0.12, 0.07], ik: KS_STEP, b: { ...KS_B_CUT, chest: [6, -30, 0], upperArmR: [-88, 0, 72] } },
  { t: 0.36, ease: 'smooth', hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
]);
// C: rising cut from low left up past the right shoulder, the body rising with it
const KS_C_WIND = { ...KS_GUARD, hips: [12, 16, 0], spine: [20, 16, 0], chest: [8, 20, 0], neck: [-10, -16, 0], head: [-14, -18, 0], upperArmR: [-26, 0, -40], foreArmR: [-40, 0, 0], handR: [20, 0, 0] };
const KS_C_CUT = { ...KS_GUARD, hips: [-2, -14, 0], spine: [-6, -16, 0], chest: [-4, -20, 0], neck: [6, 16, 0], head: [2, 18, 0], upperArmR: [-158, 0, 30], foreArmR: [-8, 0, 0], handR: [-20, 0, 0], upperArmL: [-10, 0, 40], foreArmL: [-40, 0, 0] };
export const KS_C = compileClip([
  { t: 0, hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
  { t: 0.06, ease: 'out', hip: [0, -0.2, 0], ik: KS_FEET, b: KS_C_WIND },
  { t: 0.1, ease: 'in', hip: [0, -0.04, 0.06], ik: KS_STEP, b: KS_C_CUT },
  { t: 0.18, ease: 'out', hip: [0, -0.02, 0.06], ik: KS_STEP, b: { ...KS_C_CUT, upperArmR: [-168, 0, 36] } },
  { t: 0.42, ease: 'smooth', hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
]);
// D (finisher) / Inverted Spear: a deep lunging thrust, the wrist bent so the blade points straight ahead
const KS_LUNGE = { L: [0.16, 0, 0.62, -10], R: [-0.16, 0, -0.32, 30] };
const KS_D_WIND = { ...KS_GUARD, hips: [4, -14, 0], spine: [6, -14, 0], chest: [2, -18, 0], neck: [0, 14, 0], head: [-6, 16, 0], upperArmR: [16, 0, 20], foreArmR: [-110, 0, 0], handR: [0, 50, 0] };
const KS_D_THRUST = { hips: [14, 22, 0], spine: [16, 16, 0], chest: [8, 20, 0], upperChest: [0, 8, 0], neck: [-12, -20, 0], head: [-14, -22, 0], upperArmR: [-86, 0, 2], foreArmR: [-2, 0, 0], handR: [0, -80, 0], upperArmL: [20, 0, 30], foreArmL: [-30, 0, 0] };
export const KS_D = compileClip([
  { t: 0, hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
  { t: 0.07, ease: 'out', hip: [0, -0.12, -0.04], ik: KS_FEET, b: KS_D_WIND },
  { t: 0.13, ease: 'in', hip: [0, -0.26, 0.22], ik: KS_LUNGE, b: KS_D_THRUST },
  { t: 0.26, ease: 'linear', hip: [0, -0.26, 0.22], ik: KS_LUNGE, b: { ...KS_D_THRUST, spine: [18, 15, 0] } },
  { t: 0.56, ease: 'smooth', hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
]);
export const KS_THRUST = compileClip([
  { t: 0, hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
  { t: 0.11, ease: 'out', hip: [0, -0.14, -0.06], ik: KS_FEET, b: KS_D_WIND },
  { t: 0.17, ease: 'in', hip: [0, -0.28, 0.24], ik: KS_LUNGE, b: KS_D_THRUST },
  { t: 0.42, ease: 'linear', hip: [0, -0.28, 0.24], ik: KS_LUNGE, b: { ...KS_D_THRUST, spine: [19, 15, 0] } },
  { t: 0.7, ease: 'smooth', hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
]);
// Flash Step: bent almost flat over the ground, spear trailing low behind
const KS_RUSH = {
  hips: [34, 0, 0], spine: [20, 0, 0], chest: [8, 0, 0], neck: [-24, 0, 0], head: [-26, 0, 0],
  upperArmR: [50, 0, 26], foreArmR: [-24, 0, 0], handR: [0, 0, 0], upperArmL: [46, 0, 24], foreArmL: [-20, 0, 0],
  upperLegL: [-66, 0, 4], lowerLegL: [60, 0, 0], upperLegR: [10, 0, 4], lowerLegR: [70, 0, 0], footR: [30, 0, 0],
};
export const KS_FLASH = compileClip([
  { t: 0, hip: [0, -0.1, 0], b: KS_RUSH },
  { t: 0.2, ease: 'linear', hip: [0, -0.12, 0], b: { ...KS_RUSH, hips: [36, 0, 0] } },
  { t: 0.42, ease: 'smooth', hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
]);
// Skyfall: crouch and spring, knees up through the climb
const KS_TUCK = {
  hips: [-10, 0, 0], spine: [6, 0, 0], chest: [4, 0, 0], neck: [-6, 0, 0], head: [-10, 0, 0],
  upperLegL: [-80, 0, 6], lowerLegL: [110, 0, 0], footL: [20, 0, 0], upperLegR: [-60, 0, 6], lowerLegR: [120, 0, 0], footR: [20, 0, 0],
  upperArmR: [-120, 0, 30], foreArmR: [-40, 0, 0], upperArmL: [-60, 0, 40], foreArmL: [-50, 0, 0],
};
export const KS_LEAP = compileClip([
  { t: 0, hip: [0, -0.3, 0], ik: { L: [0.2, 0, 0.12, 0], R: [-0.2, 0, -0.1, 10] }, b: { ...KS_GUARD, hips: [20, 0, 0], spine: [20, 0, 0], upperArmR: [30, 0, 30], upperArmL: [30, 0, 30] } },
  { t: 0.1, ease: 'out', hip: [0, 0.05, 0], b: { hips: [-6, 0, 0], spine: [-4, 0, 0], upperLegL: [-10, 0, 4], lowerLegL: [10, 0, 0], upperLegR: [6, 0, 4], lowerLegR: [20, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0], upperArmR: [-150, 0, 20], upperArmL: [-140, 0, 24] } },
  { t: 0.32, ease: 'smooth', hip: [0, 0.05, 0], b: KS_TUCK },
  { t: 0.6, ease: 'linear', hip: [0, 0.05, 0], b: KS_TUCK },
]);
// the dive: pitched forward spear-first, legs together behind
const KS_DIVE_POSE = {
  hips: [62, 0, 0], spine: [12, 0, 0], chest: [6, 0, 0], neck: [-26, 0, 0], head: [-30, 0, 0],
  upperArmR: [-150, 0, 6], foreArmR: [-10, 0, 0], handR: [0, 80, 0], upperArmL: [-40, 0, 40], foreArmL: [-60, 0, 0],
  upperLegL: [-4, 0, 2], lowerLegL: [24, 0, 0], footL: [40, 0, 0], upperLegR: [10, 0, 2], lowerLegR: [40, 0, 0], footR: [40, 0, 0],
};
export const KS_DIVE = compileClip([
  { t: 0, hip: [0, 0.05, 0], b: KS_TUCK },
  { t: 0.14, ease: 'out', hip: [0, 0.1, 0], b: KS_DIVE_POSE },
  { t: 1.5, ease: 'linear', hip: [0, 0.1, 0], b: KS_DIVE_POSE },
]);
// landing: driven into a deep crouch, spear stabbed into the ground in front
const KS_LAND_POSE = {
  hips: [26, 0, 0], spine: [26, 0, 0], chest: [10, 0, 0], neck: [-24, 0, 0], head: [-24, 0, 0],
  upperArmR: [-56, 0, 6], foreArmR: [-10, 0, 0], handR: [0, 84, 0], upperArmL: [-20, 0, 50], foreArmL: [-30, 0, 0],
};
const KS_WIDE = { L: [0.26, 0, 0.18, -10], R: [-0.26, 0, -0.22, 20] };
export const KS_LAND = compileClip([
  { t: 0, hip: [0, -0.42, 0], ik: KS_WIDE, b: KS_LAND_POSE },
  { t: 0.3, ease: 'linear', hip: [0, -0.4, 0], ik: KS_WIDE, b: { ...KS_LAND_POSE, spine: [24, 0, 0] } },
  { t: 0.62, ease: 'smooth', hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
]);

// ---- Kine Slayer v2
// E — Spear Throw (upper body): turn the shoulder back, then hurl it overhand and follow through
const KS_UPPER_GUARD = { spine: [6, -4, 0], chest: [4, -6, 0], upperArmL: [-46, 0, -6], foreArmL: [-84, 0, 0], upperArmR: [-10, 0, 22], foreArmR: [-62, 0, 0] };
export const KS_THROW = compileClip([
  { t: 0, b: KS_UPPER_GUARD },
  { t: 0.14, ease: 'out', b: { spine: [-4, -18, 0], chest: [-6, -26, 0], neck: [0, 18, 0], head: [-4, 22, 0], upperArmR: [28, 0, 52], foreArmR: [-96, 0, 0], handR: [0, 70, 0], upperArmL: [-80, 0, 18], foreArmL: [-20, 0, 0] } },
  { t: 0.2, ease: 'in', b: { spine: [12, 14, 0], chest: [8, 22, 0], neck: [0, -16, 0], head: [-6, -18, 0], upperArmR: [-150, 0, 12], foreArmR: [-6, 0, 0], handR: [0, 80, 0], upperArmL: [10, 0, 30], foreArmL: [-40, 0, 0] } },
  { t: 0.32, ease: 'out', b: { spine: [18, 20, 0], chest: [10, 26, 0], upperArmR: [-58, 0, -32], foreArmR: [-14, 0, 0], handR: [0, 30, 0], upperArmL: [14, 0, 30], foreArmL: [-40, 0, 0] } },
  { t: 0.6, ease: 'smooth', b: { spine: [4, 0, 0], upperArmR: [-8, 0, 14], foreArmR: [-30, 0, 0], upperArmL: [-30, 0, -4], foreArmL: [-70, 0, 0] } },
]);
// E again — the catch: open hand out front, the spear smacks into it, back to guard
export const KS_CATCH = compileClip([
  { t: 0, b: { upperArmR: [-8, 0, 14], foreArmR: [-30, 0, 0] } },
  { t: 0.1, ease: 'out', b: { spine: [2, 8, 0], chest: [2, 10, 0], upperArmR: [-82, 0, 26], foreArmR: [-8, 0, 0], handR: [-20, 0, 0] } },
  { t: 0.2, ease: 'out', b: { spine: [-4, 12, 0], chest: [-4, 14, 0], upperArmR: [-62, 0, 34], foreArmR: [-50, 0, 0], handR: [10, 0, 0] } },
  { t: 0.45, ease: 'smooth', b: KS_UPPER_GUARD },
]);
// V — Severing Whirlwind: spear held straight out, the whole body spinning on the spot
const KS_SPIN = { spine: [8, 0, 0], chest: [4, 0, 0], neck: [-6, 0, 0], head: [-8, 0, 0], upperArmR: [-90, 0, 74], foreArmR: [-4, 0, 0], handR: [0, 80, 0], upperArmL: [-40, 0, 64], foreArmL: [-30, 0, 0],
  upperLegL: [-26, 0, 10], lowerLegL: [40, 0, 0], upperLegR: [-14, 0, 10], lowerLegR: [34, 0, 0] };
export const KS_WHIRL = compileClip([
  { t: 0, hip: [0, -0.08, 0], b: { ...KS_SPIN, hips: [6, 0, 0] } },
  ...Array.from({ length: 9 }, (_, i) => ({ t: 0.07 + i * 0.125, ease: 'linear', hip: [0, -0.16, 0], b: { ...KS_SPIN, hips: [6, -120 * (i + 1), 0] } })),
  { t: 1.3, ease: 'smooth', hip: [0, -0.06, 0], b: { hips: [6, -1080, 0], spine: [10, -4, 0], upperArmR: [-10, 0, 22], foreArmR: [-62, 0, 0], upperArmL: [-46, 0, -6], foreArmL: [-84, 0, 0] } },
]);
// X — Heavenly Severance: sink into a deep crouch with the spear drawn far back… a huge flat cut
// across the whole field, then up overhead and a vertical one down the same line
const KS_SV_WIND = { hips: [22, -40, 0], spine: [24, -22, 0], chest: [10, -20, 0], neck: [-12, 26, 0], head: [-14, 30, 0], upperArmR: [24, 0, 46], foreArmR: [-56, 0, 0], handR: [0, 70, 0], upperArmL: [-60, 0, 30], foreArmL: [-40, 0, 0] };
const KS_SV_FLAT = { hips: [8, 44, 0], spine: [12, 30, 0], chest: [8, 40, 0], neck: [0, -40, 0], head: [-6, -44, 0], upperArmR: [-94, 0, 74], foreArmR: [-4, 0, 0], handR: [0, 40, 0], upperArmL: [-30, 0, 40], foreArmL: [-40, 0, 0] };
const KS_SV_UP = { hips: [-6, 10, 0], spine: [-10, 8, 0], chest: [-6, 8, 0], upperArmR: [-172, 0, 12], foreArmR: [-10, 0, 0], handR: [0, 30, 0], upperArmL: [-150, 0, 20], foreArmL: [-20, 0, 0] };
const KS_SV_DOWN = { hips: [24, 6, 0], spine: [30, 4, 0], chest: [10, 4, 0], neck: [-18, 0, 0], head: [-20, 0, 0], upperArmR: [-50, 0, -6], foreArmR: [-8, 0, 0], handR: [0, 80, 0], upperArmL: [-40, 0, 20], foreArmL: [-20, 0, 0] };
const KS_SV_FEET = { L: [0.28, 0, 0.3, -20], R: [-0.28, 0, -0.32, 30] };
export const KS_SEVER = compileClip([
  { t: 0, hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
  { t: 0.22, ease: 'out', hip: [0, -0.4, -0.06], ik: KS_SV_FEET, b: KS_SV_WIND },
  { t: 0.6, ease: 'linear', hip: [0, -0.42, -0.08], ik: KS_SV_FEET, b: { ...KS_SV_WIND, spine: [26, -24, 0] } },
  { t: 0.68, ease: 'in', hip: [0, -0.3, 0.12], ik: KS_SV_FEET, b: KS_SV_FLAT },
  { t: 0.84, ease: 'out', hip: [0, -0.18, 0.08], ik: KS_SV_FEET, b: KS_SV_UP },
  { t: 1.05, ease: 'in', hip: [0, -0.38, 0.12], ik: KS_SV_FEET, b: KS_SV_DOWN },
  { t: 1.3, ease: 'linear', hip: [0, -0.38, 0.12], ik: KS_SV_FEET, b: { ...KS_SV_DOWN, spine: [28, 4, 0] } },
  { t: 1.7, ease: 'smooth', hip: [0, -0.08, 0], ik: KS_FEET, b: KS_GUARD },
]);

// ================================================================== THE MANIPULATOR
// the reference pose: chin resting on the right fist, the left forearm folded across the body
// under the right elbow, head tilted a touch, perfectly still
const MN_THINK = { spine: [6, 0, 0], chest: [4, 0, 0], neck: [3, 0, 0], head: [4, 6, 4], upperArmR: [-50, -55, -14], foreArmR: [-148, 0, 0], handR: [30, 0, 0], upperArmL: [-18, -70, 18], foreArmL: [-96, 0, 0], handL: [0, -10, 0] };
export const MN_CHIN = compileClip([
  { t: 0, hip: [0, -0.02, 0], ik: STAND, b: GUARD },
  { t: 0.55, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: MN_THINK },
  { t: 3.2, ease: 'linear', hip: [0, -0.03, 0], ik: STAND, b: { ...MN_THINK, head: [11, 3, 3] } },
  { t: 6.2, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: { ...MN_THINK, head: [8, 7, 5] } },
]);
// …then he reaches out and moves his queen on the little board: fingers close on her at h4, she is
// lifted a touch and carried along the diagonal to e7, released, and the fist goes back to his chin.
// (The board is laid out from where these two poses put his fingertips: see MN_GRIP in fx/chess.js.)
const MN_PICK = { spine: [10, 0, 0], neck: [6, 0, 0], head: [20, 0, 0], upperArmR: [-24, 0, -14], foreArmR: [-70, 0, 0], handR: [30, 0, 0], upperArmL: [-6, 0, 10], foreArmL: [-30, 0, 0] };
const MN_DROP = { spine: [12, 2, 0], chest: [4, 2, 0], neck: [6, 0, 0], head: [20, 0, 0], upperArmR: [-68, 0, -27], foreArmR: [-10, 0, 0], handR: [30, 0, 0], upperArmL: [-6, 0, 10], foreArmL: [-30, 0, 0] };
export const MN_PLACE = compileClip([
  { t: 0, hip: [0, -0.03, 0], ik: STAND, b: MN_THINK },
  { t: 0.4, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: MN_PICK },
  { t: 0.5, ease: 'linear', hip: [0, -0.03, 0], ik: STAND, b: MN_PICK },
  { t: 0.6, ease: 'out', hip: [0, -0.03, 0], ik: STAND, b: { ...MN_PICK, upperArmR: [-34, 0, -17], foreArmR: [-62, 0, 0] } },
  { t: 0.8, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: MN_DROP },
  { t: 0.95, ease: 'linear', hip: [0, -0.03, 0], ik: STAND, b: MN_DROP },
  { t: 1.5, ease: 'smooth', hip: [0, -0.03, 0], ik: STAND, b: MN_THINK },
  { t: 2.4, ease: 'linear', hip: [0, -0.03, 0], ik: STAND, b: { ...MN_THINK, head: [6, 8, 4] } },
]);
// commanding a piece: the right arm sweeps forward, two fingers pointing at the square
export const MN_CMD = compileClip([
  { t: 0, b: { upperArmR: [-14, 0, 16], foreArmR: [-70, 0, 0] } },
  { t: 0.12, ease: 'out', b: { spine: [2, -10, 0], chest: [0, -14, 0], neck: [0, 10, 0], head: [-2, 12, 0], upperArmR: [-86, 0, -6], foreArmR: [-6, 0, 0], handR: [-6, 0, 0], upperArmL: [-6, 0, 10], foreArmL: [-24, 0, 0] } },
  { t: 0.42, ease: 'linear', b: { spine: [2, -10, 0], chest: [0, -14, 0], neck: [0, 10, 0], head: [-2, 12, 0], upperArmR: [-84, 0, -4], foreArmR: [-8, 0, 0], handR: [-6, 0, 0], upperArmL: [-6, 0, 10], foreArmL: [-24, 0, 0] } },
  { t: 0.7, ease: 'smooth', b: { upperArmR: [-8, 0, 12], foreArmR: [-24, 0, 0] } },
]);
// the queen: the right palm raised up and open, as if lifting her onto the board
export const MN_RAISE = compileClip([
  { t: 0, b: { upperArmR: [-14, 0, 16], foreArmR: [-70, 0, 0] } },
  { t: 0.18, ease: 'out', b: { spine: [-4, -6, 0], chest: [-4, -8, 0], head: [-10, 6, 0], upperArmR: [-128, 0, -4], foreArmR: [-12, 0, 0], handR: [-30, 0, 0], upperArmL: [-4, 0, 14], foreArmL: [-20, 0, 0] } },
  { t: 0.55, ease: 'linear', b: { spine: [-4, -6, 0], chest: [-4, -8, 0], head: [-10, 6, 0], upperArmR: [-132, 0, -4], foreArmR: [-10, 0, 0], handR: [-30, 0, 0], upperArmL: [-4, 0, 14], foreArmL: [-20, 0, 0] } },
  { t: 0.85, ease: 'smooth', b: { upperArmR: [-8, 0, 12], foreArmR: [-24, 0, 0] } },
]);

// ================================================================== THE MANIPULATOR — M1
// No wasted motion: the left hand stays in his pocket the whole time, the right does everything.
// Small loads, explosive snaps that overshoot the line, quick recoils. Impact frames line up with
// MANIP_M1.hits[].at in game/manipulator.js (0.05, 0.06, 0.1, 0.15).
const MN_POCKET = { upperArmL: [14, 0, -10], foreArmL: [-56, 0, 0], handL: [10, 0, 0] };
const MN_STANCE = { hips: [3, 8, 0], spine: [4, -3, 0], chest: [2, -5, 0], neck: [0, 3, 0], head: [-2, 5, 0], upperArmR: [-28, 0, -6], foreArmR: [-104, 0, 0], handR: [-8, 0, 0], ...MN_POCKET };
const MN_FEET = { L: [0.14, 0, 0.12, -10], R: [-0.14, 0, -0.12, 24] };
const MN_STEP = { L: [0.14, 0, 0.27, -10], R: [-0.14, 0.03, -0.06, 44] };
// 1 — right straight: a hair of load, then the hip and shoulder snap the fist out along the centre line
const MN_STR = { hips: [8, 26, 0], spine: [11, 18, 0], chest: [7, 24, 0], upperChest: [0, 10, 0], neck: [1, -22, 0], head: [-3, -24, 0], upperArmR: [-97, 0, 33], foreArmR: [0, 0, 0], handR: [-8, 0, 0], ...MN_POCKET };
export const MN_A = compileClip([
  { t: 0, hip: [0, -0.04, 0], ik: MN_FEET, b: MN_STANCE },
  // load: shoulders turn away, the fist cocks back by the cheek
  { t: 0.06, ease: 'out', hip: [0, -0.09, -0.05], ik: MN_FEET, b: { ...MN_STANCE, hips: [4, -18, 0], spine: [5, -12, 0], chest: [3, -26, 0], neck: [0, 10, 0], head: [-2, 20, 0], upperArmR: [-22, 0, -28], foreArmR: [-132, 0, 0], handR: [-12, 0, 0] } },
  // snap: hip, shoulder and fist arrive together on the centre line
  { t: 0.09, ease: 'in', hip: [0, -0.09, 0.14], ik: MN_STEP, b: { ...MN_STR, hips: [8, 30, 0], spine: [11, 22, 0], chest: [8, 34, 0], upperArmR: [-98, 0, 34], foreArmR: [0, 0, 0] } },
  { t: 0.14, ease: 'out', hip: [0, -0.09, 0.15], ik: MN_STEP, b: { ...MN_STR, hips: [8, 34, 0], spine: [11, 24, 0], chest: [9, 40, 0], upperArmR: [-96, 0, 38], foreArmR: [0, 0, 0] } },
  // recoil: the fist comes straight back to guard
  { t: 0.22, ease: 'smooth', hip: [0, -0.06, 0.06], ik: MN_STEP, b: { ...MN_STANCE, hips: [6, 18, 0], chest: [4, 14, 0], upperArmR: [-50, 0, 6], foreArmR: [-110, 0, 0] } },
  { t: 0.36, ease: 'smooth', hip: [0, -0.04, 0], ik: MN_FEET, b: MN_STANCE },
]);
// 2 — turning elbow: wind the shoulders back, then the elbow whips across at jaw height
const MN_ELB = { hips: [10, 36, 0], spine: [12, 28, 0], chest: [8, 36, 0], upperChest: [0, 12, 0], neck: [1, -30, 0], head: [-4, -32, 0], upperArmR: [-88, 0, 72], foreArmR: [-150, 0, 0], handR: [0, 0, 0], ...MN_POCKET };
export const MN_B = compileClip([
  { t: 0, hip: [0, -0.04, 0], ik: MN_FEET, b: MN_STANCE },
  // wind: the shoulders coil the other way, elbow drawn back high
  { t: 0.06, ease: 'out', hip: [0, -0.08, -0.03], ik: MN_FEET, b: { ...MN_STANCE, hips: [4, -20, 0], spine: [6, -14, 0], chest: [3, -28, 0], head: [-3, 18, 0], upperArmR: [-58, 0, -40], foreArmR: [-140, 0, 0] } },
  // the elbow whips across at jaw height, the whole torso turning through it
  { t: 0.1, ease: 'in', hip: [0, -0.08, 0.1], ik: MN_STEP, b: { ...MN_ELB, hips: [10, 46, 0], chest: [8, 48, 0], upperArmR: [-86, 0, 84] } },
  { t: 0.15, ease: 'out', hip: [0, -0.08, 0.11], ik: MN_STEP, b: { ...MN_ELB, hips: [10, 58, 0], spine: [12, 36, 0], chest: [8, 60, 0], upperArmR: [-80, 0, 92] } },
  { t: 0.25, ease: 'smooth', hip: [0, -0.06, 0.05], ik: MN_STEP, b: { ...MN_STANCE, hips: [6, 22, 0], chest: [4, 18, 0] } },
  { t: 0.4, ease: 'smooth', hip: [0, -0.04, 0], ik: MN_FEET, b: MN_STANCE },
]);
// 3 — low roundhouse: chamber the right knee, the hips turn over and the shin cuts across at thigh height
const MN_LEGS = { upperLegL: [-14, 0, 4], lowerLegL: [26, 0, 0], footL: [-8, 0, 0], upperLegR: [-6, 0, 4], lowerLegR: [22, 0, 0], footR: [-6, 0, 0] };
const MN_KCH = { hips: [2, 34, -8], spine: [0, -12, 6], chest: [0, -12, 4], neck: [0, -8, 0], head: [-4, -10, 4], upperLegR: [-64, 0, 30], lowerLegR: [104, 0, 0], footR: [22, 0, 0], upperLegL: [-10, 0, 2], lowerLegL: [20, 0, 0], footL: [-8, 0, 0], upperArmR: [-40, 0, 20], foreArmR: [-90, 0, 0], ...MN_POCKET };
const MN_KICK = { hips: [-4, 76, -34], spine: [4, -22, 12], chest: [2, -20, 10], upperChest: [0, -8, 0], neck: [0, -14, 8], head: [-4, -16, 10], upperLegR: [-44, 0, 70], lowerLegR: [6, 0, 0], footR: [-24, 0, 0], upperLegL: [-6, 0, 2], lowerLegL: [14, 0, 0], footL: [-6, 0, 0], upperArmR: [-12, 0, 52], foreArmR: [-40, 0, 0], ...MN_POCKET };
export const MN_C = compileClip([
  { t: 0, hip: [0, -0.04, 0], b: { ...MN_STANCE, ...MN_LEGS } },
  // chamber: the knee comes up high and turned in, the body leans away to counterweight
  { t: 0.07, ease: 'out', hip: [0, -0.02, 0.02], b: { ...MN_KCH, upperLegR: [-80, 0, 34], lowerLegR: [118, 0, 0], spine: [0, -16, 8] } },
  // the hips turn over and the shin cuts through at thigh height
  { t: 0.14, ease: 'in', hip: [0, -0.06, 0.09], b: MN_KICK },
  { t: 0.2, ease: 'out', hip: [0, -0.06, 0.09], b: { ...MN_KICK, hips: [-4, 100, -38], upperLegR: [-38, 0, 84] } },
  { t: 0.34, ease: 'smooth', hip: [0, -0.04, 0.05], b: MN_KCH },
  { t: 0.5, ease: 'smooth', hip: [0, -0.04, 0], b: { ...MN_STANCE, ...MN_LEGS } },
]);
// 4 — finisher: sink and chamber the palm at the hip, then a long step and the whole body drives one
// open palm through the target's centre; the left fist pulls back to the hip (hikite) for power
const MN_PALM = { hips: [16, 34, 0], spine: [18, 24, 0], chest: [10, 30, 0], upperChest: [0, 10, 0], neck: [0, -26, 0], head: [-6, -28, 0], upperArmR: [-100, 0, 30], foreArmR: [0, 0, 0], handR: [-34, 0, 0], upperArmL: [34, 0, -14], foreArmL: [-96, 0, 0], handL: [0, 0, 0] };
const MN_LUNGE = { L: [0.15, 0, 0.5, -10], R: [-0.15, 0.04, -0.14, 52] };
export const MN_D = compileClip([
  { t: 0, hip: [0, -0.04, 0], ik: MN_FEET, b: MN_STANCE },
  // sink deep and chamber the palm at the hip, shoulders turned right away
  { t: 0.12, ease: 'out', hip: [0, -0.19, -0.06], ik: MN_FEET, b: { ...MN_STANCE, hips: [12, -28, 0], spine: [9, -18, 0], chest: [4, -26, 0], head: [-4, 16, 0], upperArmR: [-14, 0, -22], foreArmR: [-126, 0, 0], handR: [-34, 0, 0] } },
  // a long step and the whole body drives the open palm through the centre
  { t: 0.2, ease: 'in', hip: [0, -0.18, 0.26], ik: MN_LUNGE, b: MN_PALM },
  { t: 0.3, ease: 'linear', hip: [0, -0.18, 0.27], ik: MN_LUNGE, b: { ...MN_PALM, chest: [10, 38, 0], upperArmR: [-98, 0, 27] } },
  { t: 0.48, ease: 'smooth', hip: [0, -0.1, 0.12], ik: MN_LUNGE, b: { ...MN_STANCE, hips: [8, 18, 0], chest: [6, 16, 0] } },
  { t: 0.7, ease: 'smooth', hip: [0, -0.04, 0], ik: MN_FEET, b: MN_STANCE },
]);

// ================================================================== Inkweaver: Endless Talisman Suppression
// she lifts off the Tai Chi array and hangs in the air on her wings (the reference art): her right leg
// hangs long with the toe pointed, the left knee drawn up with the foot tucked behind the right shin,
// arms loose and a little out from her sides with open hands, head tipped gently to her left
const ASCEND = {
  hips: [-4, 0, 3], spine: [-3, 0, -2], chest: [-2, 0, 0], neck: [2, 0, 3], head: [6, 4, 8],
  upperLegL: [-62, -6, 7], lowerLegL: [120, 0, 0], footL: [42, 0, 0],
  upperLegR: [4, -2, -4], lowerLegR: [6, 0, 0], footR: [50, 0, 0],
  upperArmL: [-4, 0, 17], foreArmL: [-34, 0, 0], handL: [8, 0, -18],
  upperArmR: [-4, 0, 17], foreArmR: [-34, 0, 0], handR: [8, 0, -18],
};
export const INK_ASCEND = compileClip([
  { t: 0, hip: [0, -0.03, 0], ik: STAND, b: { spine: [2, 0, 0], upperArmL: [-10, 0, 14], upperArmR: [-10, 0, 14] } },
  { t: 0.45, ease: 'smooth', hip: [0, -0.06, 0], ik: STAND, b: { spine: [4, 0, 0], head: [-4, 0, 0], upperArmL: [-14, 0, 22], foreArmL: [-30, 0, 0], upperArmR: [-14, 0, 22], foreArmR: [-30, 0, 0] } },
  { t: 1.3, ease: 'smooth', hip: [0, 0, 0], b: ASCEND },
  { t: 3.4, ease: 'smooth', hip: [0, 0.02, 0], b: { ...ASCEND, head: [5, 3, 9], upperArmL: [-3, 0, 19], upperArmR: [-3, 0, 19] } },
  { t: 6.0, ease: 'smooth', hip: [0, 0, 0], b: { ...ASCEND, head: [7, 5, 7] } },
  { t: 10.4, ease: 'smooth', hip: [0, 0.01, 0], b: ASCEND },
]);
