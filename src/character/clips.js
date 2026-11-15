import { compileClip } from './pose.js';

// Keyframed full-body and upper-body clips (degrees / meters, canonical frames — see pose.js).
// Bone keys ending in L/R: values are written for the LEFT side; R keys are mirrored automatically.
// `ik` keys (optional) are root-space ankle targets [x, y, z, footPitch] used instead of FK legs.

const STAND = { L: [0.13, 0, 0.06, 0], R: [-0.13, 0, -0.06, 0] };

// ------------------------------------------------------------------ full body
export const DASH = compileClip([
  { t: 0, hip: [0, -0.04, 0], b: { spine: [4, 0, 0] } },
  { t: 0.06, ease: 'out', hip: [0, -0.12, -0.04], b: {
    hips: [24, 0, 0], spine: [10, 0, 0], chest: [6, 0, 0], neck: [-14, 0, 0], head: [-18, 0, 0],
    upperLegL: [-58, 0, 6], lowerLegL: [72, 0, 0], footL: [18, 0, 0],
    upperLegR: [22, 0, 6], lowerLegR: [64, 0, 0], footR: [42, 0, 0],
    upperArmL: [58, 0, 24], foreArmL: [-22, 0, 0], upperArmR: [64, 0, 22], foreArmR: [-18, 0, 0],
  } },
  { t: 0.24, ease: 'linear', hip: [0, -0.1, -0.04], b: {
    hips: [20, 0, 0], spine: [9, 0, 0], chest: [5, 0, 0], neck: [-12, 0, 0], head: [-16, 0, 0],
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

// forward roll on landing: the hips orbit a full turn while the body is balled up
export const ROLL = compileClip([
  { t: 0, hip: [0, -0.16, 0], b: { hips: [14, 0, 0], spine: [16, 0, 0], upperLegL: [-50, 0, 6], lowerLegL: [80, 0, 0], footL: [-24, 0, 0], upperLegR: [-30, 0, 6], lowerLegR: [70, 0, 0], footR: [-30, 0, 0], upperArmL: [-40, 0, 14], upperArmR: [-40, 0, 14], foreArmL: [-40, 0, 0], foreArmR: [-40, 0, 0] } },
  tuckKey(0.1, 80, -0.42, 0.08, 'in'),
  tuckKey(0.24, 185, -0.4, 0.04, 'linear'),
  tuckKey(0.38, 290, -0.42, -0.02, 'linear'),
  { t: 0.5, ease: 'out', hip: [0, -0.2, 0], b: { hips: [372, 0, 0], spine: [18, 0, 0], chest: [8, 0, 0], neck: [-6, 0, 0], head: [-8, 0, 0], upperLegL: [-74, 0, 8], lowerLegL: [104, 0, 0], footL: [-26, 0, 0], upperLegR: [-26, 0, 8], lowerLegR: [96, 0, 0], footR: [-58, 0, 0], upperArmL: [-20, 0, 30], foreArmL: [-40, 0, 0], upperArmR: [-10, 0, 34], foreArmR: [-50, 0, 0] } },
  { t: 0.62, hip: [0, -0.06, 0], b: { hips: [364, 0, 0], spine: [6, 0, 0], upperLegL: [-22, 0, 4], lowerLegL: [34, 0, 0], footL: [-10, 0, 0], upperLegR: [-8, 0, 4], lowerLegR: [30, 0, 0], footR: [-18, 0, 0], upperArmL: [0, 0, 16], foreArmL: [-34, 0, 0], upperArmR: [0, 0, 18], foreArmR: [-44, 0, 0] } },
]);

export const ROLL_BACK = compileClip([
  { t: 0, hip: [0, -0.14, 0], b: { hips: [-6, 0, 0], upperLegL: [-40, 0, 6], lowerLegL: [70, 0, 0], upperLegR: [-30, 0, 6], lowerLegR: [60, 0, 0] } },
  tuckKey(0.12, -70, -0.44, -0.08, 'in'),
  tuckKey(0.26, -180, -0.4, -0.04, 'linear'),
  tuckKey(0.4, -290, -0.42, 0.02, 'linear'),
  { t: 0.52, ease: 'out', hip: [0, -0.2, 0], b: { hips: [-360, 0, 0], spine: [16, 0, 0], upperLegL: [-70, 0, 8], lowerLegL: [100, 0, 0], footL: [-28, 0, 0], upperLegR: [-30, 0, 8], lowerLegR: [96, 0, 0], footR: [-50, 0, 0], upperArmL: [-20, 0, 30], foreArmL: [-40, 0, 0], upperArmR: [-10, 0, 34], foreArmR: [-50, 0, 0] } },
  { t: 0.64, hip: [0, -0.06, 0], b: { hips: [-360, 0, 0], spine: [6, 0, 0], upperLegL: [-20, 0, 4], lowerLegL: [32, 0, 0], upperLegR: [-8, 0, 4], lowerLegR: [30, 0, 0], foreArmL: [-34, 0, 0], foreArmR: [-44, 0, 0] } },
]);

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
