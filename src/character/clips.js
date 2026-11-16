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
    spine: [-8, -6, 0], chest: [-8, -6, 0], neck: [-10, 0, 0], head: [-14, 0, 0],
    upperArmR: [-168, 0, -8], foreArmR: [-8, 0, 0], propR: [180, 0, 0],
    upperArmL: [-20, 0, 46], foreArmL: [-50, 0, 0],
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

// X — Crimson Nova: brace, both hands raise the staff to the sky for the long incantation…
const NOVA_UP = {
  hips: [-6, 0, 0], spine: [-10, 0, 0], chest: [-8, 0, 0], upperChest: [-4, 0, 0], neck: [-12, 0, 0], head: [-22, 0, 0],
  upperArmR: [-168, 0, -14], foreArmR: [-14, 0, 0], propR: [180, 0, 0],
  upperArmL: [-160, 0, -28], foreArmL: [-34, 0, 0], handL: [0, 0, 0],
};
const NOVA_UP2 = { ...NOVA_UP, spine: [-12, 0, 0], head: [-26, 0, 0], upperArmR: [-172, 0, -12], upperArmL: [-164, 0, -26] };
const WIDE = { L: [0.2, 0, 0.12, 0], R: [-0.2, 0, -0.1, 0] };
export const M_NOVA = compileClip([
  { t: 0, hip: [0, -0.03, 0], ik: STAND, b: SGUARD },
  { t: 0.5, ease: 'out', hip: [0, -0.08, -0.02], ik: WIDE, b: NOVA_UP },
  { t: 2.0, ease: 'smooth', hip: [0, -0.1, -0.03], ik: WIDE, b: { ...NOVA_UP2, spine: [-14, 6, 0], head: [-28, 4, 0] } },
  { t: 3.8, ease: 'smooth', hip: [0, -0.09, -0.03], ik: WIDE, b: { ...NOVA_UP, spine: [-12, -6, 0], head: [-24, -4, 0] } },
  { t: 5.7, ease: 'smooth', hip: [0, -0.12, -0.04], ik: WIDE, b: { ...NOVA_UP2, spine: [-18, 0, 0], chest: [-12, 0, 0], head: [-32, 0, 0] } },
  // …then hurls it forward at the target
  { t: 6.3, ease: 'in', hip: [0, -0.16, 0.05], ik: { L: [0.2, 0, 0.26, -6], R: [-0.2, 0, -0.18, 16] }, b: {
    hips: [10, 0, 0], spine: [16, 0, 0], chest: [10, 0, 0], neck: [-12, 0, 0], head: [-14, 0, 0],
    upperArmR: [-88, 0, -12], foreArmR: [-4, 0, 0], propR: [180, 0, 0],
    upperArmL: [-84, 0, -18], foreArmL: [-10, 0, 0],
  } },
  { t: 6.7, ease: 'linear', hip: [0, -0.16, 0.05], ik: { L: [0.2, 0, 0.26, -6], R: [-0.2, 0, -0.18, 16] }, b: {
    hips: [9, 0, 0], spine: [15, 0, 0], chest: [10, 0, 0], neck: [-12, 0, 0], head: [-14, 0, 0],
    upperArmR: [-86, 0, -12], foreArmR: [-6, 0, 0], propR: [180, 0, 0],
    upperArmL: [-80, 0, -18], foreArmL: [-12, 0, 0],
  } },
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

// double jump: a tucked front flip with the arms swept up
export const DOUBLE_JUMP = compileClip([
  { t: 0, hip: [0, 0.02, 0], b: { hips: [-6, 0, 0], upperLegL: [-40, 0, 6], lowerLegL: [60, 0, 0], upperLegR: [-10, 0, 6], lowerLegR: [40, 0, 0], upperArmL: [-150, 0, 30], upperArmR: [-150, 0, 30], foreArmL: [-20, 0, 0], foreArmR: [-20, 0, 0] } },
  tuckKey(0.12, 120, 0.1, 0, 'out'),
  tuckKey(0.26, 250, 0.08, 0, 'linear'),
  { t: 0.42, ease: 'out', hip: [0, 0.02, 0], b: { hips: [362, 0, 0], spine: [6, 0, 0], upperLegL: [-50, 0, 8], lowerLegL: [70, 0, 0], footL: [20, 0, 0], upperLegR: [-20, 0, 8], lowerLegR: [50, 0, 0], footR: [24, 0, 0], upperArmL: [-30, 0, 50], foreArmL: [-30, 0, 0], upperArmR: [-26, 0, 54], foreArmR: [-30, 0, 0] } },
  { t: 0.55, hip: [0, 0.02, 0], b: { hips: [360, 0, 0], spine: [2, 0, 0], upperLegL: [-34, 0, 8], lowerLegL: [44, 0, 0], upperLegR: [-12, 0, 8], lowerLegR: [30, 0, 0], upperArmL: [-14, 0, 52], foreArmL: [-28, 0, 0], upperArmR: [-8, 0, 56], foreArmR: [-30, 0, 0] } },
]);
