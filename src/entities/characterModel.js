import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Low-poly soldier built from boxes. Every character in a match shares 3 InstancedMeshes
// (body, legs, team accents) → 3 draw calls total no matter how many players/bots.
const _c = new THREE.Color();

function part(list, w, h, d, x, y, z, color, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  list.push(g);
}

const SKIN = 0xc8987a, PANTS = 0x2b3038, JACKET = 0x48566a, VEST = 0x616b78, DARK = 0x1a1d22, WOOD = 0x8a5a33, METAL = 0x2d3035;

export function buildBodyGeometry() {
  const p = [];
  part(p, 0.42, 0.2, 0.26, 0, 0.92, 0, PANTS);
  part(p, 0.48, 0.52, 0.27, 0, 1.25, 0, JACKET);
  part(p, 0.5, 0.36, 0.32, 0, 1.24, 0, VEST);
  part(p, 0.14, 0.1, 0.24, 0.12, 1.08, -0.15, DARK); // pouch
  part(p, 0.12, 0.1, 0.12, 0, 1.53, 0, SKIN);
  part(p, 0.26, 0.28, 0.26, 0, 1.68, 0, SKIN);
  part(p, 0.29, 0.11, 0.29, 0, 1.84, 0.01, DARK);
  part(p, 0.13, 0.13, 0.34, 0.28, 1.34, -0.1, JACKET, 0.5);
  part(p, 0.11, 0.11, 0.3, 0.2, 1.22, -0.33, JACKET, 0.15);
  part(p, 0.13, 0.13, 0.34, -0.28, 1.34, -0.12, JACKET, 0.7);
  part(p, 0.11, 0.11, 0.36, -0.12, 1.26, -0.43, JACKET, 0.1);
  part(p, 0.09, 0.09, 0.09, 0.13, 1.21, -0.5, SKIN);
  part(p, 0.09, 0.09, 0.09, 0.02, 1.27, -0.64, SKIN);
  // AK-47 held at the hip/shoulder line
  part(p, 0.065, 0.1, 0.42, 0.07, 1.29, -0.48, METAL);
  part(p, 0.055, 0.11, 0.26, 0.07, 1.27, -0.15, WOOD);
  part(p, 0.07, 0.075, 0.22, 0.07, 1.29, -0.77, WOOD);
  part(p, 0.028, 0.028, 0.34, 0.07, 1.31, -1.02, METAL);
  part(p, 0.05, 0.2, 0.08, 0.07, 1.16, -0.53, METAL, -0.3);
  part(p, 0.012, 0.05, 0.012, 0.07, 1.36, -1.13, METAL);
  return mergeGeometries(p, false);
}

export function buildLegGeometry() {
  const p = [];
  part(p, 0.17, 0.86, 0.2, 0, -0.43, 0, PANTS);
  part(p, 0.19, 0.12, 0.28, 0, -0.84, -0.04, DARK);
  part(p, 0.18, 0.12, 0.21, 0, -0.42, -0.02, 0x22262c); // knee pad
  return mergeGeometries(p, false);
}

export function buildAccentGeometry() {
  const p = [];
  part(p, 0.27, 0.06, 0.03, 0, 1.71, -0.135, 0xffffff); // visor
  part(p, 0.15, 0.06, 0.22, 0.3, 1.48, 0, 0xffffff);
  part(p, 0.15, 0.06, 0.22, -0.3, 1.48, 0, 0xffffff);
  part(p, 0.505, 0.06, 0.325, 0, 1.36, 0, 0xffffff); // vest stripe
  return mergeGeometries(p, false);
}

let shared = null;
export function sharedGeometries() {
  if (!shared) shared = { body: buildBodyGeometry(), leg: buildLegGeometry(), accent: buildAccentGeometry() };
  return shared;
}

export const TEAM_COLORS = [0xff4655, 0x4fb3ff, 0xffc94f, 0x7cff8a, 0xc77dff, 0xff8a3d, 0x3dfff2, 0xff6fd2];

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class CharacterRenderer {
  constructor(scene, max = 16) {
    const g = sharedGeometries();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const amat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x000000 });
    this.body = new THREE.InstancedMesh(g.body, mat, max);
    this.legs = new THREE.InstancedMesh(g.leg, mat, max * 2);
    this.accent = new THREE.InstancedMesh(g.accent, amat, max);
    for (const m of [this.body, this.legs, this.accent]) {
      m.frustumCulled = false; // positions change every frame; skip bounds recompute
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.max = max;
    for (let i = 0; i < max; i++) { this.hide(i); this.accent.setColorAt(i, _c.set(0xffffff)); this.body.setColorAt(i, _c.set(0xffffff)); }
    this.accent.instanceColor.needsUpdate = true; this.body.instanceColor.needsUpdate = true;
    this.scene = scene;
  }

  setColor(slot, color, flash = 0) {
    _c.set(color);
    this.accent.setColorAt(slot, _c);
    _c.setRGB(1, 1 - flash * 0.6, 1 - flash * 0.6);
    this.body.setColorAt(slot, _c);
    this.accent.instanceColor.needsUpdate = true;
    this.body.instanceColor.needsUpdate = true;
  }

  hide(slot) {
    this.body.setMatrixAt(slot, ZERO); this.accent.setMatrixAt(slot, ZERO);
    this.legs.setMatrixAt(slot * 2, ZERO); this.legs.setMatrixAt(slot * 2 + 1, ZERO);
    this._dirty = true;
  }

  // crouch 0..1, walk phase (rad), walkAmt 0..1, fall 0..1 (death), pitch (rad, small torso lean)
  set(slot, x, y, z, yaw, crouch, phase, walkAmt, fall, pitch = 0) {
    const drop = 0.5 * crouch;
    const fallAng = -fall * 1.45;
    // root: translate → yaw → fall rotation about feet
    _e.set(fallAng, yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(1, 1, 1);
    _m.compose(_p, _q, _s); // root
    // body: lowered by crouch, slight lean with pitch
    _m2.makeTranslation(0, -drop, 0);
    const lean = Math.max(-0.35, Math.min(0.35, pitch * 0.35));
    if (lean) { _rx.makeRotationX(lean); _m2.multiply(_tmpPivot(_rx)); }
    const bodyM = _mb.multiplyMatrices(_m, _m2);
    this.body.setMatrixAt(slot, bodyM);
    this.accent.setMatrixAt(slot, bodyM);
    // legs pivot at hips
    const hipY = 0.9 - drop;
    const legScale = hipY / 0.9;
    for (let k = 0; k < 2; k++) {
      const side = k ? 1 : -1;
      const swing = Math.sin(phase + k * Math.PI) * 0.65 * walkAmt - crouch * 0.35;
      _e.set(swing, 0, 0, 'XYZ');
      _q.setFromEuler(_e);
      _p.set(side * 0.11, hipY, crouch * -0.08);
      _s.set(1, legScale, 1);
      _ml.compose(_p, _q, _s);
      _ml.premultiply(_m);
      this.legs.setMatrixAt(slot * 2 + k, _ml);
    }
    this._dirty = true;
  }

  flush() {
    if (!this._dirty) return;
    this.body.instanceMatrix.needsUpdate = true;
    this.legs.instanceMatrix.needsUpdate = true;
    this.accent.instanceMatrix.needsUpdate = true;
    this._dirty = false;
  }

  dispose() {
    for (const m of [this.body, this.legs, this.accent]) { this.scene.remove(m); m.material.dispose(); m.dispose(); }
  }
}
const _mb = new THREE.Matrix4(), _ml = new THREE.Matrix4(), _rx = new THREE.Matrix4();
const _pv = new THREE.Matrix4(), _pv2 = new THREE.Matrix4();
// rotate about the hip (y=0.9) instead of the feet
function _tmpPivot(r) { _pv.makeTranslation(0, 0.9, 0); _pv.multiply(r); _pv2.makeTranslation(0, -0.9, 0); return _pv.multiply(_pv2); }

// Standalone (non-instanced) character for the lobby showcase.
export function buildShowcaseCharacter(accentColor = 0xff4655) {
  const g = sharedGeometries();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g.body, mat));
  const am = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: accentColor, emissive: accentColor, emissiveIntensity: 0.25 });
  const acc = new THREE.Mesh(g.accent, am);
  group.add(acc);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(g.leg, mat);
    leg.position.set(side * 0.11, 0.9, 0);
    group.add(leg);
  }
  group.userData.accentMat = am;
  return group;
}
