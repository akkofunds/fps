import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Rig, B } from './rig.js';
import { Animator } from './animator.js';

// Loads a rigged mage GLB once and hands out independent instances (own skeleton + animator).
const cache = new Map();

export function loadMageModel(url) {
  if (!cache.has(url)) {
    cache.set(url, new Promise((resolve, reject) => {
      new GLTFLoader().load(url, (g) => {
        prepareMaterials(g.scene);
        resolve(g.scene);
      }, undefined, reject);
    }));
  }
  return cache.get(url);
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
      if (map) { map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; }
      o.material = new THREE.MeshLambertMaterial({
        map, emissiveMap: map, emissive: new THREE.Color(0.62, 0.6, 0.6), side: THREE.DoubleSide,
      });
      o.material.name = m.name;
      o.castShadow = true;
    }
    o.frustumCulled = false;
  });
}

export class MageInstance {
  constructor(template, opts = {}) {
    this.root = new THREE.Group();
    this.model = skeletonClone(template);
    this.root.add(this.model);
    this.rig = new Rig(this.model);
    this.anim = new Animator(this.rig, opts);
    this.meshes = [];
    this.model.traverse((o) => { if (o.isMesh) { this.meshes.push(o); o.receiveShadow = false; } });
    this.handR = this.rig.bones[B.handR];
    this.handL = this.rig.bones[B.handL];
    this.head = this.rig.bones[B.head];
    this.chest = this.rig.bones[B.upperChest];
    this._tint = 0;
  }

  // flash the body (hit feedback) / fade
  setFlash(v) {
    if (v === this._tint) return;
    this._tint = v;
    for (const m of this.meshes) if (!m.userData.outline) m.material.emissive.setRGB(0.62 + v * 1.4, 0.6 + v * 0.35, 0.6 + v * 0.2);
  }

  setVisible(v) { this.root.visible = v; }

  // own (non-shared) materials so per-player flashes don't leak
  uniqueMaterials() {
    for (const m of this.meshes) m.material = m.material.clone();
    return this;
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
