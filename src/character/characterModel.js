import * as THREE from 'three';
import { CapeSim } from './cape.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Rig, B } from './rig.js';
import { Animator } from './animator.js';
import { MeshoptSimplifier } from 'meshoptimizer/meshopt_simplifier.module.js';

// Loads a rigged mage GLB once and hands out independent instances (own skeleton + animator).
const cache = new Map();

export function loadMageModel(url) {
  if (!/^(\/|https?:)/.test(url)) url = (import.meta.env.BASE_URL || '/') + url;
  // cache-bust with the models' content hash (a stale cached model would pair old meshes with new code)
  if (typeof __MODELS_VER__ !== 'undefined' && !url.includes('?')) url += '?v=' + __MODELS_VER__;
  if (!cache.has(url)) {
    cache.set(url, new Promise((resolve, reject) => {
      new GLTFLoader().load(url, async (g) => {
        prepareMaterials(g.scene);
        try { await buildLods(g.scene); } catch (e) { console.warn('LOD build failed', e); }
        resolve(g.scene);
      }, undefined, reject);
    }));
  }
  return cache.get(url);
}

// Low-poly LOD per mesh (meshoptimizer keeps the original vertices, only the index buffer changes,
// so skinning attributes stay valid). Shared by every instance; swapped in by distance / on Low.
const LOD = new WeakMap();
async function buildLods(root) {
  await MeshoptSimplifier.ready;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry.index) return;
    const g = o.geometry;
    const idx = new Uint32Array(g.index.array);
    if (idx.length < 3000) return;
    const pos = g.attributes.position;
    const P = pos.array instanceof Float32Array && pos.itemSize === 3 && !pos.isInterleavedBufferAttribute ? pos.array : Float32Array.from({ length: pos.count * 3 }, (_, i) => pos.getComponent(Math.floor(i / 3), i % 3));
    const ratio = /hair|outline|stroke/i.test(o.name) ? 0.22 : 0.3;
    const [lo] = MeshoptSimplifier.simplify(idx, P, 3, Math.floor((idx.length * ratio) / 3) * 3, 0.03, ['LockBorder']);
    if (!lo.length || lo.length > idx.length * 0.85) return;
    const lg = new THREE.BufferGeometry();
    for (const [k, v] of Object.entries(g.attributes)) lg.setAttribute(k, v);
    lg.setIndex(new THREE.BufferAttribute(lo, 1));
    lg.boundingSphere = g.boundingSphere; lg.boundingBox = g.boundingBox;
    LOD.set(g, lg);
  });
}

function prepareMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (/outline/i.test(o.name) || /outline/i.test(m.name)) {
      // inverted-hull ink outline; keep it unlit
      o.material = new THREE.MeshBasicMaterial({ color: 0x0a0505 });
      o.castShadow = false;
      o.userData.outline = true;
    } else {
      // painted anime textures: mostly self-lit, with a touch of scene light so they sit in the world
      const map = m.map;
      if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 16; map.generateMipmaps = true; map.minFilter = THREE.LinearMipmapLinearFilter; }
      o.material = new THREE.MeshLambertMaterial({
        // keep each model's own sidedness (Shoto ships a built-in inner ink shell that must stay culled)
        map, emissiveMap: map, emissive: new THREE.Color(0.62, 0.6, 0.6), side: m.side,
      });
      o.material.name = m.name;
      rimLight(o.material);
      o.castShadow = true;
    }
    o.frustumCulled = false;
  });
}

// anime-style rim light: a warm fresnel edge that separates characters from the background
function rimLight(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimF = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += uRim * rimF;`);
    sh.uniforms.uRim = { value: new THREE.Color(0.55, 0.42, 0.32) };
  };
  mat.customProgramCacheKey = () => 'mage-rim';
}

export class MageInstance {
  constructor(template, opts = {}) {
    this.root = new THREE.Group();
    this.model = skeletonClone(template);
    this.root.add(this.model);
    this.rig = new Rig(this.model);
    this.anim = new Animator(this.rig, opts);
    this.meshes = [];
    this.model.traverse((o) => { if (o.isMesh) { this.meshes.push(o); o.receiveShadow = false; if (o.userData.outline && opts.outlines === false) o.visible = false; } });
    this.baseGeo = this.meshes.map((m) => m.geometry);
    this.lod = false;
    if (opts.lowPoly) this.setLod(true);
    this.handR = this.rig.bones[B.handR];
    this.handL = this.rig.bones[B.handL];
    this.head = this.rig.bones[B.head];
    this.chest = this.rig.bones[B.upperChest];
    this._tint = 0;
    this.cape = new CapeSim(this.model);
    if (!this.cape.ok) this.cape = null;
  }

  // secondary motion (cape physics) — call after the root is placed and the pose is applied
  stepCape(dt) { if (this.cape && this.root.visible) this.cape.step(dt, { wind: this.anim.windBoost || 0 }); }

  // flash the body (hit feedback) / fade
  setFlash(v) {
    if (v === this._tint) return;
    this._tint = v;
    for (const m of this.meshes) if (!m.userData.outline) m.material.emissive.setRGB(0.62 + v * 1.4, 0.6 + v * 0.35, 0.6 + v * 0.2);
  }

  setVisible(v) { this.root.visible = v; }

  // swap to the simplified meshes (far away, or always on Low)
  setLod(on) {
    if (on === this.lod) return;
    this.lod = on;
    this.meshes.forEach((m, i) => { const b = this.baseGeo[i]; m.geometry = on ? (LOD.get(b) || b) : b; });
    if (this.xray) for (const x of this.xray) x.geometry = x.userData.src.geometry;
  }

  // Enemy highlight (Valorant-style): red ink outline + a red silhouette that shows only where the
  // body is hidden behind something (walls, trees, grass), so you never have to hunt for players.
  setEnemy(on) {
    this.enemy = on;
    for (const m of this.meshes) if (m.userData.outline) { m.material = m.material.clone(); m.material.color.set(on ? 0xff2a36 : 0x0a0505); m.visible = true; }
    if (!on || this.xray) return;
    // Draw order does the trick: world (renderOrder 0) → silhouette (1, only where the world is in
    // FRONT of the body, additive) → the character itself (2) on top. Because the body isn't in the
    // depth buffer yet when the silhouette draws, overlapping limbs never tint themselves.
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.06, 0.1), transparent: false, blending: THREE.AdditiveBlending, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false });
    this.xray = [];
    for (const m of this.meshes) m.renderOrder = 2;
    for (const m of this.meshes) {
      if (m.userData.outline || !m.isSkinnedMesh) continue;
      const x = new THREE.SkinnedMesh(m.geometry, mat);
      x.bind(m.skeleton, m.bindMatrix);
      x.frustumCulled = false; x.renderOrder = 1; x.userData.src = m;
      m.add(x);
      this.xray.push(x);
    }
  }

  // own (non-shared) materials so per-player flashes don't leak
  uniqueMaterials() {
    for (const m of this.meshes) {
      const src = m.material;
      m.material = src.clone();
      m.material.onBeforeCompile = src.onBeforeCompile;
      m.material.customProgramCacheKey = src.customProgramCacheKey;
    }
    return this;
  }

  // tip of the staff (orb end) — falls back to the right palm for mages without a staff
  staffTip(out) {
    if (!this.rig.hasProp || !this.rig.ends.prop) return this.palmWorld('R', out);
    return this.rig.ends.prop.getWorldPosition(out);
  }

  handWorld(side, out) { return (side === 'L' ? this.handL : this.handR).getWorldPosition(out); }
  palmWorld(side, out) {
    const end = side === 'L' ? this.rig.ends.handL : this.rig.ends.handR;
    const h = side === 'L' ? this.handL : this.handR;
    const a = h.getWorldPosition(new THREE.Vector3());
    end.getWorldPosition(out);
    return out.lerp(a, 0.45);
  }
}
