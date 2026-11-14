import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { muzzleTexture } from '../effects/pools.js';
import { WEAPONS } from './weaponDefs.js';
import { setThirdPersonGuns } from '../entities/characterModel.js';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

// First-person viewmodels. The real guns are GLBs in public/models (built by tools/weapons):
// each has a `weapon` root, animatable parts (mag, slide/charge, bolt, trigger), gloved arms,
// marker nodes (muzzle, eject, sight, reddot) and baked clips (draw, fire, reload, inspect, bolt).
// Clips are *scrubbed* from game state (reload/bolt/draw progress) so they never drift from the
// gameplay timers. Until the GLBs arrive (or if they fail) the procedural box models below are used.
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

const MODEL_URLS = { 1: 'models/ak.glb', 2: 'models/glock.glb', 3: 'models/sniper.glb' };
// hip pose of each rig in viewmodel-camera space
const HIP = {
  1: { pos: [0.155, -0.185, -0.41], rot: [0.0, 0.045, 0.0] },
  2: { pos: [0.135, -0.155, -0.34], rot: [0.0, 0.055, 0.0] },
  3: { pos: [0.16, -0.19, -0.42], rot: [0.0, 0.045, 0.0] },
};
// animation-progress events: [clip, t, event]
const EVENTS = {
  1: [['reload', 0.3, 'magout'], ['reload', 0.7, 'magin'], ['reload', 0.855, 'rack'], ['reload', 0.875, 'release'], ['inspect', 0.15, 'cloth'], ['draw', 0.5, 'draw']],
  2: [['reload', 0.18, 'magout'], ['reload', 0.64, 'magin'], ['reload', 0.8, 'rack'], ['reload', 0.83, 'release'], ['inspect', 0.15, 'cloth'], ['draw', 0.5, 'draw']],
  3: [['bolt', 0.24, 'boltup'], ['bolt', 0.43, 'boltback'], ['bolt', 0.6, 'boltfwd'], ['bolt', 0.69, 'boltdown'],
    ['reload', 0.28, 'magout'], ['reload', 0.6, 'magin'], ['reload', 0.75, 'boltup'], ['reload', 0.82, 'boltback'], ['reload', 0.88, 'boltfwd'], ['reload', 0.92, 'boltdown'],
    ['inspect', 0.15, 'cloth'], ['draw', 0.5, 'draw']],
};
const FALLBACK = { 1: buildAK, 2: buildGlock, 3: buildSniper };
const ease = (t) => t * t * (3 - 2 * t);

class Rig {
  constructor(slot, mat) {
    this.slot = slot;
    this.holder = new THREE.Group();
    this.holder.visible = false;
    this.glb = false;
    this.actions = {};
    this.prev = {};
    this.hip = HIP[slot];
    const d = FALLBACK[slot]();
    const mesh = new THREE.Mesh(d.geo, mat);
    mesh.scale.setScalar(0.62);
    mesh.frustumCulled = false;
    this.model = mesh;
    this.holder.add(mesh);
    this.muzzle = new THREE.Object3D(); this.muzzle.position.copy(d.muzzle); mesh.add(this.muzzle);
    this.eject = new THREE.Object3D(); this.eject.position.copy(d.eject); mesh.add(this.eject);
    this.hip = { pos: [d.base.x, d.base.y, d.base.z], rot: [0, 0, 0] };
    this.adsPos = new THREE.Vector3(0, -0.075, -0.3);
  }

  setGLB(gltf, envMap) {
    this.holder.remove(this.model);
    const root = gltf.scene;
    this.meshes = [];
    root.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;
        const m = o.material;
        if (m && m.isMeshStandardMaterial) { m.envMap = envMap; m.envMapIntensity = 0.85; }
        // cheap twin for low-end GPUs: same albedo, no normal/roughness/env lookups
        const lo = new THREE.MeshLambertMaterial({ map: m.map || null, color: m.color, transparent: m.transparent, opacity: m.opacity, side: m.side });
        this.meshes.push({ o, hi: m, lo });
      }
    });
    this.model = root;
    this.holder.add(root);
    this.weapon = root.getObjectByName('weapon');
    this.muzzle = root.getObjectByName('muzzle');
    this.eject = root.getObjectByName('eject');
    this.sight = root.getObjectByName('sight');
    this.slide = root.getObjectByName('slide');
    this.slideBindZ = this.slide ? this.slide.position.z : 0;
    const ex = (this.weapon && this.weapon.userData) || {};
    this.eyeRelief = ex.eyeRelief || 0.12;
    // ADS: put the sight marker on the view axis, eyeRelief in front of the camera
    const s = this.sight.position;
    this.adsPos = new THREE.Vector3(-s.x, -s.y, -this.eyeRelief - s.z);
    this.hip = HIP[this.slot];
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      this.actions[clip.name] = { a, dur: clip.duration, on: false };
    }
    const dot = root.getObjectByName('reddot');
    if (dot) {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,90,90,1)'); gr.addColorStop(0.35, 'rgba(255,30,40,0.95)'); gr.addColorStop(1, 'rgba(255,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      this.dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true }));
      this.dot.scale.set(0.014, 0.014, 1);
      this.dot.position.set(0, 0, -0.6);
      this.dot.renderOrder = 20;
      dot.add(this.dot);
    }
    this.glb = true;
  }

  setQuality(low) { if (this.meshes) for (const r of this.meshes) r.o.material = low ? r.lo : r.hi; }

  // scrub clips from gameplay state; returns events crossed this frame
  animate(st, onEvent) {
    if (!this.glb) return;
    const want = this._want || (this._want = {});
    for (const k in want) delete want[k];
    if (st.reloadP >= 0) want.reload = Math.min(1, st.reloadP);
    else if (st.boltP >= 0 && this.actions.bolt) want.bolt = Math.min(1, st.boltP);
    else if (st.drawP < 1) want.draw = st.drawP;
    else if (st.inspectP >= 0) want.inspect = Math.min(1, st.inspectP);
    const fa = this.actions.fire;
    if (fa && st.fireAge >= 0 && st.fireAge < fa.dur && st.reloadP < 0) want.fire = st.fireAge / fa.dur;
    for (const [name, rec] of Object.entries(this.actions)) {
      const t = want[name];
      if (t === undefined) {
        if (rec.on) { rec.a.stop(); rec.on = false; }
        this.prev[name] = -1;
        continue;
      }
      if (!rec.on) { rec.a.reset(); rec.a.play(); rec.a.paused = true; rec.on = true; }
      rec.a.time = t * rec.dur;
      // progress events (sounds, shell ejection)
      const p = this.prev[name] === undefined ? -1 : this.prev[name];
      for (const ev of EVENTS[this.slot]) if (ev[0] === name && p < ev[1] && t >= ev[1]) onEvent(ev[2], this);
      this.prev[name] = t;
    }
    this.mixer.update(0);
    // Glock slide lock after the last round (held until the reload's slide release)
    if (this.slide && st.slideLocked && (st.reloadP < 0 || st.reloadP < 0.8)) this.slide.position.z = this.slideBindZ + 0.034;
    if (this.dot) this.dot.visible = st.ads > 0.55;
  }
}

// Third-person gun for other players: the viewmodel GLB without arms, baked into one geometry.
// Single-material guns keep their texture (Lambert); multi-material ones (Glock) get vertex colors
// averaged from each material's texture → always one draw call per gun type.
function avgTextureColor(mat) {
  const out = new THREE.Color().copy(mat.color || new THREE.Color(1, 1, 1));
  const img = mat.map && mat.map.image;
  if (!img) return out;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4; const t = new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
    return out.multiply(t);
  } catch { return out; }
}
function floatGeometry(src, withUv) {
  const g = new THREE.BufferGeometry();
  for (const name of withUv ? ['position', 'normal', 'uv'] : ['position', 'normal']) {
    const a = src.attributes[name]; if (!a) continue;
    const n = a.count, size = a.itemSize, arr = new Float32Array(n * size);
    for (let i = 0; i < n; i++) { arr[i * size] = a.getX(i); if (size > 1) arr[i * size + 1] = a.getY(i); if (size > 2) arr[i * size + 2] = a.getZ(i); }
    g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  if (src.index) g.setIndex(Array.from(src.index.array));
  return g;
}
function thirdPersonGun(rig) {
  const weapon = rig.weapon;
  rig.model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(weapon.matrixWorld).invert();
  const parts = [];
  weapon.traverse((o) => {
    if (!o.isMesh || o === rig.dot) return;
    for (let p = o; p && p !== weapon; p = p.parent) if (p.name === 'arm_L' || p.name === 'arm_R') return;
    const m = o.material.isMeshStandardMaterial || o.material.isMeshLambertMaterial ? o.material : null;
    if (!m || (m.transparent && m.opacity < 0.9) || m.name.includes('glass')) return;
    parts.push({ o, m: rig.meshes ? (rig.meshes.find((r) => r.o === o) || { hi: m }).hi : m });
  });
  const mats = new Set(parts.map((p) => p.m));
  const single = mats.size === 1;
  const geos = parts.map(({ o, m }) => {
    const g = floatGeometry(o.geometry, single);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!single) {
      const c = avgTextureColor(m), n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    return g;
  });
  const geometry = mergeGeometries(geos, false);
  // decimate: other players' guns are small on screen, ~2.5k triangles is plenty
  try {
    if (MeshoptSimplifier.supported) {
      const idx = new Uint32Array(geometry.index.array);
      const target = Math.min(idx.length, 7500);
      if (target < idx.length) {
        const [res] = MeshoptSimplifier.simplify(idx, geometry.attributes.position.array, 3, target, 0.012, single ? ['Prune'] : ['Prune', 'Permissive']);
        if (res.length >= 300) geometry.setIndex(new THREE.BufferAttribute(res, 1));
      }
    }
  } catch (e) { console.warn('simplify', e); }
  geometry.computeBoundingSphere();
  const m0 = parts[0].m;
  const material = single ? new THREE.MeshLambertMaterial({ map: m0.map, color: m0.color }) : new THREE.MeshLambertMaterial({ vertexColors: true });
  return { geometry, material };
}

export class Viewmodels {
  constructor(renderer) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4540, 1.15));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(0.5, 1, 0.4); this.scene.add(dl);
    try {
      const pm = new THREE.PMREMGenerator(renderer);
      this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
    } catch { this.env = null; }
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.scene.add(this.camera);
    this.rigs = [null];
    for (let s = 1; s <= 3; s++) { const r = new Rig(s, mat); this.rigs.push(r); this.camera.add(r.holder); }
    // muzzle flash (additive quad, positioned at the muzzle marker)
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({
      map: muzzleTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.flash.visible = false;
    this.flash.renderOrder = 15;
    this.scene.add(this.flash);
    this.flashT = 0;
    // pooled shell casings (viewmodel space)
    this.shells = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.03, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd4a447, metalness: 0.9, roughness: 0.35, envMap: this.env }), 12);
    this.shells.frustumCulled = false;
    this.shellState = [];
    for (let i = 0; i < 12; i++) this.shellState.push({ t: -1, p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0 });
    this.nextShell = 0;
    this.scene.add(this.shells);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(1, 1, 1);
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this.hideShells();
    this.cur = 1;
    this.swayX = 0; this.swayY = 0; this.kickZ = 0; this.kickR = 0; this.kickY = 0; this.bobT = 0; this.dip = 0;
    this.lastFire = -10;
    this.onEvent = null; // (name) => void  (sounds)
    this.loaded = 0;
    this.select(1);
  }

  // Load the GLB weapons (meshopt-compressed, WebP textures). Safe to call once; failures keep the fallback.
  load() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const jobs = Object.entries(MODEL_URLS).map(([slot, url]) => new Promise((res) => {
      loader.load(new URL(url, document.baseURI).href, (g) => {
        try { this.rigs[slot].setGLB(g, this.env); this.loaded++; } catch (e) { console.warn('viewmodel', url, e); }
        res();
      }, undefined, (e) => { console.warn('viewmodel load failed', url, e); res(); });
    }));
    return Promise.all(jobs).then(() => {
      this.select(this.cur, true); this.setQuality(this.low);
      return MeshoptSimplifier.ready.catch(() => null).then(() => {
        const tp = {};
        for (let s = 1; s <= 3; s++) { try { if (this.rigs[s].glb) tp[s] = thirdPersonGun(this.rigs[s]); } catch (e) { console.warn('tp gun', s, e); } }
        setThirdPersonGuns(tp);
      });
    });
  }

  // low = Lambert materials on the guns (auto when render scale is 50%)
  setQuality(low) { this.low = !!low; for (let i = 1; i < this.rigs.length; i++) this.rigs[i].setQuality(this.low); }

  // screen-space (NDC) position of the current muzzle; false if unavailable
  muzzleNDC(out) {
    const r = this.rigs[this.cur];
    if (!r || !r.muzzle || !r.holder.visible) return false;
    r.muzzle.getWorldPosition(out);
    out.project(this.camera);
    return Math.abs(out.x) < 1.5 && Math.abs(out.y) < 1.5;
  }

  hideShells() { const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < 12; i++) this.shells.setMatrixAt(i, z); this.shells.instanceMatrix.needsUpdate = true; }
  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  select(slot, keep) {
    for (let i = 1; i < this.rigs.length; i++) this.rigs[i].holder.visible = i === slot;
    this.cur = slot;
    if (!keep) { this.lastFire = -10; }
  }

  // called for every shot
  fire(kickScale = 1, now = performance.now() / 1000) {
    this.kickZ += 0.045 * kickScale; this.kickR += 0.085 * kickScale; this.kickY += (Math.random() - 0.5) * 0.02 * kickScale;
    this.flashT = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.6; this.flash.scale.set(s, s, s);
    this.lastFire = now;
    if (this.cur !== 3) this.ejectShell();
  }

  ejectShell() {
    const r = this.rigs[this.cur];
    const st = this.shellState[this.nextShell]; this.nextShell = (this.nextShell + 1) % 12;
    r.holder.updateWorldMatrix(true, true);
    r.eject.getWorldPosition(st.p);
    st.t = 0.7;
    st.v.set(0.9 + Math.random() * 0.4, 1.0 + Math.random() * 0.5, 0.25 + Math.random() * 0.2);
    st.r = Math.random() * 6;
  }

  // st: {lookDX, lookDY, move, onGround, crouch, ads(0..1 eased), reloadP, boltP, drawP, inspectP, slideLocked, visible, now}
  update(dt, st) {
    const r = this.rigs[this.cur];
    const e = st.ads;
    const visible = st.visible;
    r.holder.visible = visible;
    // sway (lags behind look), much smaller when aiming
    const swayK = 1 - 0.8 * e;
    this.swayX += (-st.lookDX * 0.00026 * swayK - this.swayX) * Math.min(1, dt * 9);
    this.swayY += (st.lookDY * 0.00026 * swayK - this.swayY) * Math.min(1, dt * 9);
    this.swayX = Math.max(-0.045, Math.min(0.045, this.swayX));
    this.swayY = Math.max(-0.045, Math.min(0.045, this.swayY));
    // walk bob
    if (st.onGround && st.move > 0.05) this.bobT += dt * (6 + st.move * 6); else this.bobT += dt * 1.2;
    const bobA = (st.onGround ? st.move * 0.011 + 0.0015 : 0.0015) * (1 - 0.85 * e);
    const bx = Math.sin(this.bobT) * bobA, by = -Math.abs(Math.cos(this.bobT)) * bobA;
    // recoil recovery
    this.kickZ -= this.kickZ * Math.min(1, dt * 14); this.kickR -= this.kickR * Math.min(1, dt * 12); this.kickY -= this.kickY * Math.min(1, dt * 12);
    this.dip -= this.dip * Math.min(1, dt * 8);
    // pose: hip ↔ ADS
    const hp = r.hip.pos, hr = r.hip.rot, ap = r.adsPos;
    const crouchOff = -0.012 * st.crouch * (1 - e);
    let ox = 0, oy = 0, rz = 0, rx = 0;
    if (!r.glb) { // fallback procedural reload/bolt
      if (st.reloadP >= 0) { const k = Math.sin(Math.min(1, st.reloadP) * Math.PI); oy -= k * 0.12; rz += k * 0.55; rx += k * 0.25; }
      if (st.boltP >= 0) { const k = Math.sin(Math.min(1, st.boltP) * Math.PI); rz += k * 0.22; }
      if (st.drawP < 1) { const d = 1 - st.drawP; oy -= d * d * 0.35; rx += d * d * 0.8; }
    }
    r.holder.position.set(
      hp[0] + (ap.x - hp[0]) * e + this.swayX + bx + ox + crouchOff,
      hp[1] + (ap.y - hp[1]) * e + this.swayY + by + oy - this.dip,
      hp[2] + (ap.z - hp[2]) * e + this.kickZ * (1 - 0.35 * e),
    );
    r.holder.rotation.set(
      hr[0] * (1 - e) + this.kickR * (1 - 0.55 * e) + rx,
      hr[1] * (1 - e) - this.swayX * 2 * swayK + this.kickY,
      hr[2] * (1 - e) + rz,
    );
    r.animate(st, (ev, rig) => {
      if (ev === 'boltback' && rig.slot === 3) this.ejectShell();
      if (this.onEvent) this.onEvent(ev);
    });
    // flash at the muzzle marker
    r.holder.updateWorldMatrix(true, true);
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = visible;
      r.muzzle.getWorldPosition(this.flash.position);
    } else this.flash.visible = false;
    // shells
    let anyShell = false;
    for (let i = 0; i < 12; i++) {
      const s = this.shellState[i];
      if (s.t < 0) continue;
      anyShell = true;
      s.t -= dt;
      if (s.t < 0) { this._m.makeScale(0, 0, 0); this.shells.setMatrixAt(i, this._m); continue; }
      s.v.y -= 6 * dt;
      s.p.addScaledVector(s.v, dt);
      s.r += dt * 18;
      this._e.set(s.r, s.r * 0.7, 0);
      this._q.setFromEuler(this._e);
      this._m.compose(s.p, this._q, this._s);
      this.shells.setMatrixAt(i, this._m);
    }
    if (anyShell) this.shells.instanceMatrix.needsUpdate = true;
    this.shells.visible = visible;
  }
}
