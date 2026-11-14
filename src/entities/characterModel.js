import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Tactical operator characters. All players/bots in a match share a handful of InstancedMeshes:
//   upper body (rifle pose) · upper body (pistol pose) · glowing team accents · thighs · shins ·
//   one per third-person gun (AK / Glock / Sniper, taken from the real viewmodel GLBs)
// → ~8 draw calls total no matter how many characters. Legs are articulated (hip + knee) so walking
// bends the knees and crouching is a real squat with the feet planted.
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function colorize(g, color) {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  if (geo.attributes.uv1) geo.deleteAttribute('uv1');
  const n = geo.attributes.position.count, col = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function capsule(list, a, b, r, color, radial = 9) {
  const d = new THREE.Vector3().subVectors(b, a); const len = d.length();
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 2, radial);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  list.push(colorize(g, color));
}
function sphere(list, c, r, color, sx = 1, sy = 1, sz = 1, seg = 11, part = 1) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7)), 0, Math.PI * 2, 0, Math.PI * part);
  g.scale(sx, sy, sz); g.translate(c.x, c.y, c.z);
  list.push(colorize(g, color));
}
function rbox(list, w, h, d, c, color, rot = null, rad = 0.018) {
  const g = new RoundedBoxGeometry(w, h, d, 1, Math.min(rad, w / 2.2, h / 2.2, d / 2.2));
  if (rot) g.rotateX(rot[0]).rotateY(rot[1]).rotateZ(rot[2]);
  g.translate(c.x, c.y, c.z);
  list.push(colorize(g, color));
}
function cyl(list, rt, rb, h, c, color, rot = null, seg = 12) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (rot) g.rotateX(rot[0]).rotateY(rot[1]).rotateZ(rot[2]);
  g.translate(c.x, c.y, c.z);
  list.push(colorize(g, color));
}

const SUIT = 0x2c323b, SUIT2 = 0x363e49, VEST = 0x4c5546, VEST2 = 0x3b4337, POUCH = 0x5a6552, BELT = 0x1c1f23,
  GLOVE = 0x17181a, BOOT = 0x2f2722, HELMET = 0x3f464e, MASK = 0x202328, PAD = 0x23272c, SKIN = 0xb78a6d;

export const HIP_Y = 0.92, THIGH = 0.44, SHIN = 0.48; // shin includes the boot (knee → sole)
// where the third-person gun's grip sits (character space, standing)
export const GUN_ANCHOR = { rifle: V(0.11, 1.235, -0.15), pistol: V(0.05, 1.34, -0.43) };

function torso(p) {
  rbox(p, 0.34, 0.18, 0.22, V(0, 0.955, 0), SUIT, null, 0.05);
  rbox(p, 0.36, 0.06, 0.24, V(0, 1.045, 0), BELT, null, 0.02);
  rbox(p, 0.05, 0.04, 0.02, V(0, 1.045, -0.123), 0x5c5f63, null, 0.008);
  cyl(p, 0.15, 0.16, 0.16, V(0, 1.12, 0), SUIT2);
  rbox(p, 0.4, 0.3, 0.23, V(0, 1.33, 0), SUIT, null, 0.06);
  rbox(p, 0.39, 0.33, 0.27, V(0, 1.3, -0.005), VEST, null, 0.035);
  rbox(p, 0.3, 0.028, 0.03, V(0, 1.44, -0.135), VEST2, null, 0.01);
  for (const x of [-0.105, 0, 0.105]) { rbox(p, 0.088, 0.11, 0.05, V(x, 1.19, -0.155), POUCH, null, 0.012); rbox(p, 0.09, 0.025, 0.055, V(x, 1.25, -0.155), VEST2, null, 0.008); }
  rbox(p, 0.06, 0.13, 0.065, V(-0.215, 1.25, -0.02), POUCH, null, 0.012); // radio
  cyl(p, 0.006, 0.006, 0.16, V(-0.22, 1.38, 0.0), BELT); // antenna
  rbox(p, 0.27, 0.3, 0.11, V(0, 1.3, 0.175), VEST2, null, 0.035); // pack
  rbox(p, 0.2, 0.09, 0.03, V(0, 1.22, 0.235), POUCH, null, 0.012);
  sphere(p, V(0.215, 1.43, 0), 0.074, SUIT);
  sphere(p, V(-0.215, 1.43, 0), 0.074, SUIT);
  rbox(p, 0.1, 0.03, 0.2, V(0.2, 1.485, 0), VEST2, [0, 0, -0.35], 0.012); // shoulder straps
  rbox(p, 0.1, 0.03, 0.2, V(-0.2, 1.485, 0), VEST2, [0, 0, 0.35], 0.012);
  cyl(p, 0.055, 0.062, 0.11, V(0, 1.52, 0), MASK);
  // head: balaclava, a sliver of skin around the eyes (covered by goggles), helmet + ear pro
  sphere(p, V(0, 1.635, -0.005), 0.104, MASK, 0.95, 1.1, 1.0);
  rbox(p, 0.15, 0.05, 0.03, V(0, 1.66, -0.088), SKIN, null, 0.012);
  sphere(p, V(0, 1.665, 0.008), 0.126, HELMET, 1.0, 0.92, 1.06, 16, 0.56);
  cyl(p, 0.128, 0.128, 0.02, V(0, 1.66, 0.008), HELMET, null, 16);
  for (const s of [-1, 1]) { cyl(p, 0.042, 0.042, 0.035, V(s * 0.113, 1.64, 0.0), PAD, [0, 0, Math.PI / 2]); }
  rbox(p, 0.045, 0.03, 0.025, V(0, 1.745, -0.105), PAD, null, 0.008); // NVG mount
  rbox(p, 0.06, 0.045, 0.05, V(0, 1.72, 0.12), PAD, null, 0.01); // battery pack
}

function arm(p, sh, el, ha) {
  capsule(p, sh, el, 0.056, SUIT);
  sphere(p, el, 0.05, PAD);
  capsule(p, el, ha, 0.048, SUIT2);
  capsule(p, ha.clone().lerp(el, 0.22), ha.clone().lerp(el, 0.12), 0.053, BELT, 8); // glove cuff
  sphere(p, ha, 0.047, GLOVE, 1, 0.85, 1.25);
}

export function buildUpper(pose) {
  const p = [];
  torso(p);
  if (pose === 'pistol') {
    arm(p, V(0.215, 1.42, 0), V(0.17, 1.32, -0.22), V(0.05, 1.335, -0.42));
    arm(p, V(-0.215, 1.42, 0), V(-0.15, 1.31, -0.24), V(0.015, 1.325, -0.415));
  } else {
    arm(p, V(0.215, 1.42, 0), V(0.275, 1.2, -0.06), V(0.115, 1.225, -0.15));
    arm(p, V(-0.215, 1.42, 0), V(-0.1, 1.19, -0.26), V(0.09, 1.24, -0.44));
  }
  return mergeGeometries(p, false);
}

export function buildAccent() {
  const p = [];
  rbox(p, 0.19, 0.046, 0.05, V(0, 1.662, -0.09), 0xffffff, null, 0.012); // goggles
  for (const s of [-1, 1]) rbox(p, 0.03, 0.07, 0.075, V(s * 0.272, 1.39, -0.01), 0xffffff, [0, 0, s * -0.25], 0.01); // shoulder patches
  rbox(p, 0.24, 0.018, 0.012, V(0, 1.405, -0.142), 0xffffff, null, 0.005); // vest light strip
  rbox(p, 0.2, 0.018, 0.012, V(0, 1.4, 0.232), 0xffffff, null, 0.005); // pack light strip
  rbox(p, 0.11, 0.012, 0.02, V(0, 1.735, 0.12), 0xffffff, null, 0.004); // helmet strobe
  return mergeGeometries(p, false);
}

// thigh: hip joint at origin, knee at (0,-THIGH,0)
export function buildThigh() {
  const p = [];
  capsule(p, V(0, 0, 0), V(0, -THIGH, 0), 0.079, SUIT);
  rbox(p, 0.05, 0.12, 0.06, V(0.07, -0.2, 0.0), POUCH, null, 0.012); // thigh pouch
  rbox(p, 0.11, 0.12, 0.05, V(0, -THIGH, -0.065), PAD, null, 0.02); // knee pad
  return mergeGeometries(p, false);
}
// shin: knee at origin, sole at (0,-SHIN,0)
export function buildShin() {
  const p = [];
  capsule(p, V(0, 0, 0), V(0, -0.37, 0), 0.064, SUIT);
  cyl(p, 0.068, 0.07, 0.1, V(0, -0.37, 0.0), BOOT);
  rbox(p, 0.115, 0.1, 0.26, V(0, -0.425, -0.045), BOOT, null, 0.03);
  rbox(p, 0.12, 0.025, 0.27, V(0, -0.468, -0.045), 0x16130f, null, 0.01); // sole
  return mergeGeometries(p, false);
}

// simple placeholders until the GLB guns are loaded
function fallbackGun(slot) {
  const p = [];
  if (slot === 2) { rbox(p, 0.03, 0.035, 0.19, V(0, 0.03, -0.07), 0x2a2d31); rbox(p, 0.028, 0.1, 0.045, V(0, -0.02, 0.0), 0x1d1f22, [-0.25, 0, 0]); cyl(p, 0.016, 0.016, 0.16, V(0, 0.03, -0.24), 0x222222, [Math.PI / 2, 0, 0]); }
  else if (slot === 3) { rbox(p, 0.05, 0.08, 0.5, V(0, 0.04, -0.05), 0x3d4a3a); cyl(p, 0.012, 0.012, 0.6, V(0, 0.07, -0.6), 0x222222, [Math.PI / 2, 0, 0]); cyl(p, 0.025, 0.025, 0.32, V(0, 0.14, -0.1), 0x1c1e21, [Math.PI / 2, 0, 0]); }
  else { rbox(p, 0.05, 0.08, 0.4, V(0, 0.08, -0.12), 0x2a2d31); rbox(p, 0.045, 0.085, 0.26, V(0, 0.06, 0.2), 0x8f5a2e); rbox(p, 0.05, 0.06, 0.18, V(0, 0.08, -0.36), 0x8f5a2e); cyl(p, 0.011, 0.011, 0.3, V(0, 0.09, -0.55), 0x222222, [Math.PI / 2, 0, 0]); rbox(p, 0.035, 0.18, 0.06, V(0, -0.04, -0.1), 0x2a2d31, [-0.35, 0, 0]); }
  return { geometry: mergeGeometries(p, false), material: new THREE.MeshLambertMaterial({ vertexColors: true }) };
}

// ---- third-person gun registry (filled from the viewmodel GLBs once they load) ----
const TP = { 1: null, 2: null, 3: null };
const listeners = new Set();
export function setThirdPersonGuns(guns) { Object.assign(TP, guns); for (const fn of listeners) fn(); }
function tpGun(slot) { return TP[slot] || (TP['fb' + slot] || (TP['fb' + slot] = fallbackGun(slot))); }

let shared = null;
export function sharedGeometries() {
  if (!shared) shared = { rifle: buildUpper('rifle'), pistol: buildUpper('pistol'), accent: buildAccent(), thigh: buildThigh(), shin: buildShin() };
  return shared;
}

export const TEAM_COLORS = [0xff4655, 0x4fb3ff, 0xffc94f, 0x7cff8a, 0xc77dff, 0xff8a3d, 0x3dfff2, 0xff6fd2];

// leg kinematics shared by the instanced renderer and the lobby showcase
export function legPose(crouch, phase, walk, out) {
  const c = crouch, wa = walk;
  for (let k = 0; k < 2; k++) {
    const ph = phase + k * Math.PI;
    const th = 1.22 * c + Math.sin(ph) * 0.55 * wa * (1 - 0.5 * c);
    const kn = -(0.06 + 2.3 * c) - Math.max(0, Math.sin(ph + 1.7)) * 0.95 * wa * (1 - 0.4 * c);
    out[k * 2] = th; out[k * 2 + 1] = kn;
  }
  const h0 = THIGH * Math.cos(out[0]) + SHIN * Math.cos(out[0] + out[1]);
  const h1 = THIGH * Math.cos(out[2]) + SHIN * Math.cos(out[2] + out[3]);
  out[4] = Math.max(h0, h1); // hip height (the planted leg carries the body)
  return out;
}

const _root = new THREE.Matrix4(), _up = new THREE.Matrix4(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _legs = new Float32Array(5);

export class CharacterRenderer {
  constructor(scene, max = 16) {
    const g = sharedGeometries();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const amat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }); // team lights stay vivid at range
    const mk = (geo, m, n) => { const im = new THREE.InstancedMesh(geo, m, n); im.frustumCulled = false; im.count = 0; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(im); return im; };
    this.rifle = mk(g.rifle, mat, max);
    this.pistol = mk(g.pistol, mat, max);
    this.accent = mk(g.accent, amat, max);
    this.thigh = mk(g.thigh, mat, max * 2);
    this.shin = mk(g.shin, mat, max * 2);
    this.guns = [null];
    for (let s = 1; s <= 3; s++) { const t = tpGun(s); this.guns.push(mk(t.geometry, t.material, max)); }
    this.all = [this.rifle, this.pistol, this.accent, this.thigh, this.shin, this.guns[1], this.guns[2], this.guns[3]];
    for (const im of [this.rifle, this.pistol, this.accent]) { im.setColorAt(0, _c.set(0xffffff)); im.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    this.max = max; this.scene = scene;
    this.n = { rifle: 0, pistol: 0, legs: 0, g1: 0, g2: 0, g3: 0, acc: 0 };
    this._onGuns = () => { for (let s = 1; s <= 3; s++) { const t = tpGun(s); this.guns[s].geometry = t.geometry; this.guns[s].material = t.material; } };
    listeners.add(this._onGuns);
  }

  // Instances are packed every frame (only visible characters are drawn — hidden slots cost nothing).
  begin() { const n = this.n; n.rifle = n.pistol = n.legs = n.g1 = n.g2 = n.g3 = n.acc = 0; }

  // crouch 0..1, walk phase (rad), walkAmt 0..1, fall 0..1 (death), pitch (rad), weapon 1..3, team color, hit flash 0..1
  add(x, y, z, yaw, crouch, phase, walkAmt, fall, pitch, weapon, color, flash = 0) {
    const n = this.n;
    if (n.acc >= this.max) return;
    const legs = legPose(crouch, phase, fall > 0 ? 0 : walkAmt, _legs);
    const drop = HIP_Y - legs[4];
    _e.set(-fall * 1.45, yaw, 0, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z);
    _root.compose(_p, _q, _s);
    const lean = Math.max(-0.35, Math.min(0.35, pitch * 0.35)) - 0.14 * crouch;
    _up.copy(_root).multiply(_m.makeTranslation(0, -drop + HIP_Y, 0)).multiply(_m2.makeRotationX(lean)).multiply(_m.makeTranslation(0, -HIP_Y, 0));
    const pistol = weapon === 2;
    const body = pistol ? this.pistol : this.rifle, bi = pistol ? n.pistol++ : n.rifle++;
    body.setMatrixAt(bi, _up);
    _c.setRGB(1, 1 - flash * 0.6, 1 - flash * 0.6); body.setColorAt(bi, _c);
    this.accent.setMatrixAt(n.acc, _up); this.accent.setColorAt(n.acc, _c.set(color)); n.acc++;
    const a = pistol ? GUN_ANCHOR.pistol : GUN_ANCHOR.rifle;
    const gk = 'g' + weapon, gun = this.guns[weapon];
    if (gun) {
      _m2.copy(_up).multiply(_m.makeTranslation(a.x, a.y, a.z)).multiply(_m.makeRotationX(pistol ? 0 : -0.04));
      gun.setMatrixAt(n[gk]++, _m2);
    }
    for (let k = 0; k < 2; k++) {
      const side = k ? 1 : -1;
      _m2.copy(_root).multiply(_m.makeTranslation(side * 0.1, legs[4], 0)).multiply(_m.makeRotationX(legs[k * 2]));
      this.thigh.setMatrixAt(n.legs, _m2);
      _m2.multiply(_m.makeTranslation(0, -THIGH, 0)).multiply(_m.makeRotationX(legs[k * 2 + 1]));
      this.shin.setMatrixAt(n.legs, _m2);
      n.legs++;
    }
  }

  end() {
    const n = this.n;
    this.rifle.count = n.rifle; this.pistol.count = n.pistol; this.accent.count = n.acc;
    this.thigh.count = n.legs; this.shin.count = n.legs;
    this.guns[1].count = n.g1; this.guns[2].count = n.g2; this.guns[3].count = n.g3;
    for (const im of this.all) if (im.count) im.instanceMatrix.needsUpdate = true;
    for (const im of [this.rifle, this.pistol, this.accent]) if (im.count && im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  dispose() {
    listeners.delete(this._onGuns);
    for (const im of this.all) { this.scene.remove(im); im.dispose(); }
  }
}

// Non-instanced character for the lobby showcase (same meshes, posed once; gun swaps in when loaded).
export function buildShowcaseCharacter(accentColor = 0xff4655) {
  const g = sharedGeometries();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const group = new THREE.Group();
  const upper = new THREE.Mesh(g.rifle, mat);
  group.add(upper);
  const am = new THREE.MeshBasicMaterial({ vertexColors: true, color: accentColor });
  upper.add(new THREE.Mesh(g.accent, am));
  const legs = legPose(0, 0, 0, new Float32Array(5));
  for (let k = 0; k < 2; k++) {
    const side = k ? 1 : -1;
    const th = new THREE.Mesh(g.thigh, mat); th.position.set(side * 0.1, legs[4], 0); th.rotation.set(0.04 * side, 0, side * 0.04);
    const sh = new THREE.Mesh(g.shin, mat); sh.position.set(0, -THIGH, 0); sh.rotation.x = -0.06;
    th.add(sh); group.add(th);
  }
  const gun = new THREE.Mesh(tpGun(1).geometry, tpGun(1).material);
  gun.position.copy(GUN_ANCHOR.rifle); gun.rotation.x = -0.04;
  upper.add(gun);
  const swap = () => { const t = tpGun(1); gun.geometry = t.geometry; gun.material = t.material; };
  listeners.add(swap);
  group.userData.accentMat = am;
  return group;
}
