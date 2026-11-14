import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { muzzleTexture } from '../effects/pools.js';

// First-person viewmodels: each gun (with gloved hands + sleeves) is ONE merged
// vertex-colored mesh. Rendered in a separate scene/camera after the world so it never clips.
const _c = new THREE.Color();
function add(list, geo, x, y, z, color, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3); _c.set(color);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  list.push(g);
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const C = (r, l, s = 8) => new THREE.CylinderGeometry(r, r, l, s).rotateX(Math.PI / 2);

const GLOVE = 0x2b2a28, SLEEVE = 0x3e4b5c, SKIN = 0xc8987a, METAL = 0x2a2d31, METAL2 = 0x3c4046, WOOD = 0x8f5a2e, WOOD2 = 0x6f4322;

function hands(p, rightZ, leftX, leftY, leftZ) {
  // right hand on the grip + forearm going back-down-right
  add(p, B(0.06, 0.075, 0.09), 0.0, -0.06, rightZ, GLOVE);
  add(p, B(0.08, 0.08, 0.32), 0.04, -0.1, rightZ + 0.2, SLEEVE, 0.35, 0.12);
  // left hand forward on the handguard
  add(p, B(0.07, 0.06, 0.1), leftX, leftY, leftZ, GLOVE);
  add(p, B(0.08, 0.08, 0.34), leftX - 0.08, leftY - 0.07, leftZ + 0.18, SLEEVE, 0.3, -0.5);
}

function buildAK() {
  const p = [];
  add(p, B(0.05, 0.075, 0.36), 0, 0, -0.1, METAL); // receiver
  add(p, B(0.052, 0.025, 0.3), 0, 0.045, -0.12, METAL2); // dust cover
  add(p, B(0.045, 0.085, 0.24), 0, -0.012, 0.19, WOOD); // stock
  add(p, B(0.04, 0.05, 0.12), 0, -0.05, 0.3, WOOD2);
  add(p, B(0.03, 0.08, 0.04), 0, -0.07, 0.04, WOOD2, -0.35); // grip
  add(p, B(0.055, 0.06, 0.18), 0, 0.005, -0.35, WOOD); // handguard
  add(p, C(0.011, 0.36), 0, 0.015, -0.6, METAL); // barrel
  add(p, C(0.008, 0.2), 0, 0.045, -0.5, METAL2); // gas tube
  add(p, B(0.008, 0.035, 0.012), 0, 0.045, -0.76, METAL); // front sight
  add(p, B(0.034, 0.1, 0.05), 0, -0.085, -0.17, METAL, 0.25); // mag top
  add(p, B(0.034, 0.09, 0.05), 0, -0.165, -0.2, METAL, 0.55); // mag curve
  hands(p, 0.04, -0.01, -0.035, -0.37);
  return { geo: mergeGeometries(p, false), muzzle: new THREE.Vector3(0, 0.015, -0.8), base: new THREE.Vector3(0.16, -0.16, -0.3), eject: new THREE.Vector3(0.03, 0.03, -0.08) };
}

function buildGlock() {
  const p = [];
  add(p, B(0.034, 0.035, 0.19), 0, 0.02, -0.07, METAL2); // slide
  add(p, B(0.032, 0.03, 0.17), 0, -0.01, -0.06, METAL); // frame
  add(p, B(0.03, 0.1, 0.045), 0, -0.065, 0.0, METAL, -0.25); // grip
  add(p, C(0.006, 0.02), 0, 0.02, -0.17, 0x111111);
  add(p, B(0.006, 0.012, 0.01), 0, 0.044, -0.15, METAL);
  add(p, B(0.012, 0.012, 0.012), 0, 0.044, 0.01, METAL);
  add(p, B(0.008, 0.02, 0.03), 0, -0.035, -0.06, METAL); // trigger guard
  add(p, B(0.06, 0.07, 0.09), 0.0, -0.06, 0.02, GLOVE);
  add(p, B(0.08, 0.08, 0.32), 0.04, -0.1, 0.22, SLEEVE, 0.35, 0.12);
  add(p, B(0.05, 0.06, 0.08), -0.035, -0.07, 0.01, GLOVE, 0, 0, 0.3);
  add(p, B(0.08, 0.08, 0.32), -0.11, -0.13, 0.2, SLEEVE, 0.35, -0.5);
  return { geo: mergeGeometries(p, false), muzzle: new THREE.Vector3(0, 0.02, -0.18), base: new THREE.Vector3(0.12, -0.13, -0.27), eject: new THREE.Vector3(0.02, 0.04, -0.05) };
}

function buildSniper() {
  const p = [];
  add(p, B(0.055, 0.075, 0.42), 0, 0, -0.1, 0x3d4a3a); // receiver/chassis (olive)
  add(p, B(0.05, 0.1, 0.3), 0, -0.02, 0.25, 0x34402f); // stock
  add(p, B(0.045, 0.04, 0.1), 0, 0.05, 0.3, 0x2c3628); // cheek rest
  add(p, B(0.03, 0.08, 0.04), 0, -0.07, 0.05, 0x2c3628, -0.35);
  add(p, C(0.014, 0.6), 0, 0.012, -0.6, METAL); // barrel
  add(p, C(0.022, 0.08), 0, 0.012, -0.92, METAL2); // muzzle brake
  add(p, C(0.026, 0.3, 10), 0, 0.085, -0.1, 0x1c1e21); // scope tube
  add(p, C(0.034, 0.06, 10), 0, 0.085, -0.27, 0x1c1e21);
  add(p, C(0.032, 0.05, 10), 0, 0.085, 0.07, 0x1c1e21);
  add(p, B(0.02, 0.04, 0.03), 0, 0.05, -0.18, METAL); add(p, B(0.02, 0.04, 0.03), 0, 0.05, 0.0, METAL);
  add(p, B(0.06, 0.012, 0.012), 0.04, 0.02, 0.02, METAL2); // bolt handle
  add(p, B(0.02, 0.02, 0.02), 0.072, 0.02, 0.02, METAL);
  add(p, B(0.03, 0.08, 0.07), 0, -0.07, -0.12, METAL); // mag
  hands(p, 0.06, -0.01, -0.04, -0.33);
  return { geo: mergeGeometries(p, false), muzzle: new THREE.Vector3(0, 0.012, -0.96), base: new THREE.Vector3(0.15, -0.16, -0.3), eject: new THREE.Vector3(0.03, 0.03, 0.0) };
}

export class Viewmodels {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x555048, 1.3));
    const dl = new THREE.DirectionalLight(0xffffff, 1.0); dl.position.set(0.4, 1, 0.3); this.scene.add(dl);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.root = new THREE.Group();
    this.camera.add(this.root);
    this.scene.add(this.camera);
    this.models = [null];
    for (const fn of [buildAK, buildGlock, buildSniper]) {
      const d = fn();
      const mesh = new THREE.Mesh(d.geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.scale.setScalar(0.62);
      this.root.add(mesh);
      this.models.push({ mesh, ...d });
    }
    // muzzle flash (additive quad)
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({
      map: muzzleTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.flash.visible = false;
    this.root.add(this.flash);
    this.flashT = 0;
    // pooled shell casings
    this.shells = new THREE.InstancedMesh(new THREE.BoxGeometry(0.009, 0.009, 0.03), new THREE.MeshLambertMaterial({ color: 0xd9a94a, emissive: 0x3a2a08 }), 12);
    this.shells.frustumCulled = false;
    this.shellState = [];
    for (let i = 0; i < 12; i++) this.shellState.push({ t: -1, p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0 });
    this.nextShell = 0;
    this.scene.add(this.shells);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(1, 1, 1);
    this.hideShells();
    // animation state
    this.cur = 1;
    this.swayX = 0; this.swayY = 0; this.kickZ = 0; this.kickR = 0; this.bobT = 0; this.drawT = 1; this.dip = 0;
    this.reloadT = -1; this.boltT = -1; this.inspect = 0;
  }

  hideShells() { const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < 12; i++) this.shells.setMatrixAt(i, z); this.shells.instanceMatrix.needsUpdate = true; }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  select(slot) {
    for (let i = 1; i < this.models.length; i++) this.models[i].mesh.visible = i === slot;
    this.cur = slot; this.drawT = 0; this.reloadT = -1; this.boltT = -1;
  }

  fire(kickScale = 1) {
    const m = this.models[this.cur];
    this.kickZ += m.base ? 0.05 * kickScale : 0; this.kickR += 0.09 * kickScale;
    this.flashT = 0.045;
    this.flash.position.copy(m.muzzle).multiplyScalar(0.62).add(m.mesh.position);
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.6; this.flash.scale.set(s, s, s);
    if (this.cur !== 3) this.ejectShell();
  }

  ejectShell() {
    const m = this.models[this.cur];
    const st = this.shellState[this.nextShell]; this.nextShell = (this.nextShell + 1) % 12;
    st.t = 0.6; st.p.copy(m.eject).multiplyScalar(0.62).add(m.mesh.position);
    st.v.set(0.9 + Math.random() * 0.4, 1.1 + Math.random() * 0.4, 0.2 + Math.random() * 0.2);
    st.r = Math.random() * 6;
  }

  // dt, look delta (px), speed 0..1, onGround, reload progress (0..1 or -1), bolt progress, visible
  update(dt, lookDX, lookDY, moveAmt, onGround, reloadP, boltP, visible, crouchAmt) {
    const m = this.models[this.cur];
    this.root.visible = visible;
    // sway (lag behind look), spring back
    this.swayX += (-lookDX * 0.00028 - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (lookDY * 0.00028 - this.swayY) * Math.min(1, dt * 9);
    this.swayX = Math.max(-0.05, Math.min(0.05, this.swayX));
    this.swayY = Math.max(-0.05, Math.min(0.05, this.swayY));
    // bob
    if (onGround && moveAmt > 0.05) this.bobT += dt * (6 + moveAmt * 6); else this.bobT += dt * 1.2;
    const bobA = onGround ? moveAmt * 0.012 + 0.0015 : 0.0015;
    const bx = Math.sin(this.bobT) * bobA, by = -Math.abs(Math.cos(this.bobT)) * bobA;
    // recoil recovery
    this.kickZ -= this.kickZ * Math.min(1, dt * 14); this.kickR -= this.kickR * Math.min(1, dt * 12);
    this.dip -= this.dip * Math.min(1, dt * 8);
    // draw
    if (this.drawT < 1) this.drawT = Math.min(1, this.drawT + dt * 3.2);
    const draw = 1 - this.drawT; const drawE = draw * draw;
    let ry = 0, rz = 0, rx = 0, oy = 0, oz = 0, ox = 0;
    if (reloadP >= 0) {
      const k = Math.sin(Math.min(1, reloadP) * Math.PI);
      oy -= k * 0.12; rz += k * 0.55; rx += k * 0.25;
    }
    if (boltP >= 0) {
      const k = Math.sin(Math.min(1, boltP) * Math.PI);
      rz += k * 0.22; ry += k * 0.1; oy -= k * 0.02;
    }
    ox -= crouchAmt * 0.015;
    m.mesh.position.set(m.base.x + this.swayX + bx + ox, m.base.y + this.swayY + by + oy - drawE * 0.35 - this.dip, m.base.z + this.kickZ + oz);
    m.mesh.rotation.set(this.kickR + rx + drawE * 0.8, ry - this.swayX * 2, rz);
    // flash
    if (this.flashT > 0) { this.flashT -= dt; this.flash.visible = visible; this.flash.position.copy(m.muzzle).multiplyScalar(0.62).applyEuler(m.mesh.rotation).add(m.mesh.position); }
    else this.flash.visible = false;
    // shells
    let anyShell = false;
    for (let i = 0; i < 12; i++) {
      const st = this.shellState[i];
      if (st.t < 0) continue;
      anyShell = true;
      st.t -= dt;
      if (st.t < 0) { this._m.makeScale(0, 0, 0); this.shells.setMatrixAt(i, this._m); continue; }
      st.v.y -= 6 * dt;
      st.p.addScaledVector(st.v, dt);
      st.r += dt * 18;
      this._e.set(st.r, st.r * 0.7, 0);
      this._q.setFromEuler(this._e);
      this._m.compose(st.p, this._q, this._s);
      this.shells.setMatrixAt(i, this._m);
    }
    if (anyShell) this.shells.instanceMatrix.needsUpdate = true;
    this.shells.visible = visible;
  }
}
