import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundH, PATH, PLAZA, LAKE, WATER_Y, terrainNoise as N } from './terrain.js';
import { mulberry32 } from './noise.js';
import { stylize } from './stylize.js';

// Hero landmarks that give the meadow a sense of place:
//  - the Elder Blossom: a huge ancient tree with a pink-white canopy above the lake
//  - crimson banners hanging from the tallest plaza pillars, rippling in the wind
//  - lantern posts along the dirt trail (warm emissive glass that blooms)
// Everything is merged per material: 4 draw calls in total.

export const ELDER = { x: -17, z: 49, r: 1.5 };
// waterfall cliff on the far shore of the lake
export const FALLS = { x: -44.2, z: 32.2, w: 11, d: 6, h: 13 };
const LANTERN_T = [0.1, 0.2, 0.3, 0.42, 0.56, 0.68, 0.8, 0.9];
const PILLARS = [0, 3, 5, 7]; // indices of the tall plaza pillars (see props.js)
const PILLAR_H = [4.6, 1.4, 3.2, 5.2, 2.1, 4.0, 1.0, 3.6];

const colorize = (g, fn) => {
  g = g.index ? g.toNonIndexed() : g;
  const p = g.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), col); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
};
const jitter = (g, amt, seed) => {
  const r = mulberry32(seed), p = g.attributes.position, map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let o = map.get(k); if (!o) map.set(k, o = [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt]);
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  return g;
};

// position along the trail polyline (t in 0..1 by segment count)
function pathPoint(t) {
  const n = PATH.length - 1, f = t * n, i = Math.min(n - 1, Math.floor(f)), u = f - i;
  const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1];
  return [ax + (bx - ax) * u, az + (bz - az) * u, Math.atan2(bx - ax, bz - az)];
}

export function landmarkFootprints() {
  const out = [{ x: ELDER.x, z: ELDER.z, r: 6 }, { x: FALLS.x, z: FALLS.z, r: 9 }];
  for (const t of LANTERN_T) { const [x, z, a] = pathPoint(t); out.push({ x: x + Math.cos(a) * 2.2, z: z - Math.sin(a) * 2.2, r: 0.8 }); }
  return out;
}

export function buildLandmarks(world, Q = {}) {
  const root = new THREE.Group(); root.name = 'landmarks';
  const rnd = mulberry32(4242);

  // ---------------------------------------------------------------- Elder Blossom
  const wood = [], bloom = [];
  const gy = groundH(ELDER.x, ELDER.z) - 0.3;
  // twisting trunk from stacked, offset segments
  let px = 0, pz = 0;
  for (let i = 0; i < 6; i++) {
    const y0 = i * 1.7, r0 = 1.45 - i * 0.16, r1 = 1.3 - i * 0.16;
    const g = new THREE.CylinderGeometry(r1, r0, 1.9, 11, 2);
    const nx = px + (rnd() - 0.5) * 0.5, nz = pz + (rnd() - 0.5) * 0.5;
    g.translate(nx, y0 + 0.95, nz); px = nx; pz = nz;
    wood.push(jitter(g, 0.18, 10 + i));
  }
  // roots
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.4;
    const g = new THREE.CylinderGeometry(0.12, 0.42, 2.6, 6); g.translate(0, 1.3, 0); g.rotateZ(1.15); g.rotateY(-a); g.translate(Math.cos(a) * 0.9, 0.1, Math.sin(a) * 0.9);
    wood.push(g);
  }
  // branches + blossom clouds
  const crowns = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.5, len = 3.6 + rnd() * 2.2, tilt = 0.75 + rnd() * 0.35;
    const g = new THREE.CylinderGeometry(0.16, 0.5, len, 7); g.translate(0, len / 2, 0); g.rotateZ(tilt); g.rotateY(-a);
    const by = 7.4 + rnd() * 2.2;
    g.translate(px, by, pz);
    wood.push(jitter(g, 0.08, 40 + i));
    const ex = px + Math.cos(a) * Math.sin(tilt) * len, ez = pz + Math.sin(a) * Math.sin(tilt) * len, ey = by + Math.cos(tilt) * len;
    crowns.push([ex, ey, ez]);
  }
  crowns.push([px, 12.4, pz], [px + 1.5, 13.2, pz - 1.2], [px - 1.6, 12.8, pz + 1.4]);
  for (const [cx, cy, cz] of crowns) {
    for (let k = 0; k < 3; k++) {
      const s = 2.2 + rnd() * 1.4;
      const g = jitter(new THREE.IcosahedronGeometry(s, Q.leafDetail >= 2 ? 2 : 1), 0.4, Math.floor(cx * 31 + k * 7 + cz));
      g.scale(1, 0.72, 1);
      g.translate(cx + (rnd() - 0.5) * 2.4, cy + (rnd() - 0.4) * 1.4, cz + (rnd() - 0.5) * 2.4);
      bloom.push(g);
    }
  }
  const woodG = mergeGeometries(wood.map((g) => colorize(g, (x, y, z, c) => c.setRGB(0.32, 0.22, 0.17).multiplyScalar(0.8 + N.n2(x * 2 + y, z * 2) * 0.25))));
  woodG.computeVertexNormals(); woodG.translate(ELDER.x, gy, ELDER.z);
  const bloomG = mergeGeometries(bloom.map((g) => colorize(g, (x, y, z, c) => {
    const k = Math.min(1, Math.max(0, (y - 8) / 7));
    c.setRGB(0.86, 0.46, 0.6).lerp(new THREE.Color(1.0, 0.86, 0.92), k);
    c.multiplyScalar(0.88 + N.n2(x * 1.3 + y, z * 1.3) * 0.18);
  })));
  bloomG.computeVertexNormals();
  // fluffy canopy normals (from the crown center)
  {
    bloomG.computeBoundingBox();
    const ctr = bloomG.boundingBox.getCenter(new THREE.Vector3()), p = bloomG.attributes.position, n = bloomG.attributes.normal, v = new THREE.Vector3(), f = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.set(p.getX(i) - ctr.x, (p.getY(i) - ctr.y) * 1.4 + 1, p.getZ(i) - ctr.z).normalize(); f.set(n.getX(i), n.getY(i), n.getZ(i)).lerp(v, 0.75).normalize(); n.setXYZ(i, f.x, f.y, f.z); }
  }
  bloomG.translate(ELDER.x, gy, ELDER.z);
  const woodMat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { wrap: 0.4 });
  const bloomMat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(0.12, 0.04, 0.07) }), { wrap: 0.7, translucency: 0.35, band: 0.14 });
  const treeW = new THREE.Mesh(woodG, woodMat); treeW.castShadow = true; treeW.receiveShadow = true;
  const treeB = new THREE.Mesh(bloomG, bloomMat); treeB.castShadow = true; treeB.receiveShadow = true;
  root.add(treeW, treeB);
  world.addCyl(ELDER.x, ELDER.z, ELDER.r, gy - 1, gy + 9);

  // ---------------------------------------------------------------- banners on the plaza pillars
  const plazaY = groundH(0, 0) + 0.2;
  const cloth = [], poles = [];
  for (const i of PILLARS) {
    const a = (i / PILLAR_H.length) * Math.PI * 2 + 0.2;
    const x = Math.cos(a) * 8.2, z = Math.sin(a) * 8.2, top = plazaY + PILLAR_H[i] - 0.3;
    const facing = Math.atan2(-x, -z); // banner faces the plaza center
    const bar = new THREE.BoxGeometry(1.5, 0.08, 0.08); bar.rotateY(facing); bar.translate(x - Math.sin(facing) * 0.62, top, z - Math.cos(facing) * 0.62);
    poles.push(bar);
    const g = new THREE.PlaneGeometry(1.1, 2.6, 4, 12); g.translate(0, -1.3, 0);
    // vertex colors: crimson cloth with gold border and an emblem stripe
    const p = g.attributes.position, c = new Float32Array(p.count * 3), sw = new Float32Array(p.count);
    for (let k = 0; k < p.count; k++) {
      const u = p.getX(k) / 1.1 + 0.5, v = -p.getY(k) / 2.6;
      const border = u < 0.1 || u > 0.9 || v > 0.92;
      const stripe = v > 0.3 && v < 0.4;
      const col = border || stripe ? [0.95, 0.68, 0.22] : [0.62, 0.06, 0.08];
      c[k * 3] = col[0]; c[k * 3 + 1] = col[1]; c[k * 3 + 2] = col[2];
      sw[k] = v; // sway weight: top is fixed
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
    g.rotateY(facing); g.translate(x - Math.sin(facing) * 0.62, top, z - Math.cos(facing) * 0.62);
    cloth.push(g);
  }
  const clothMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const uTime = { value: 0 };
  clothMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float sway; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float w = sway * sway;
        float ph = uTime * 2.2 + position.y * 2.4 + position.x * 0.3;
        transformed.x += sin(ph) * 0.16 * w + sin(uTime * 0.7 + position.z) * 0.12 * w;
        transformed.z += cos(ph * 0.9) * 0.14 * w;`);
  };
  stylize(clothMat, { wrap: 0.6, translucency: 0.5 });
  const clothMesh = new THREE.Mesh(mergeGeometries(cloth), clothMat);
  clothMesh.castShadow = true;
  root.add(clothMesh);

  // ---------------------------------------------------------------- lantern posts along the trail
  const glass = [];
  for (const t of LANTERN_T) {
    const [x0, z0, a] = pathPoint(t);
    const x = x0 + Math.cos(a) * 2.2, z = z0 - Math.sin(a) * 2.2;
    if (Math.hypot(x, z) < PLAZA.r + 2) continue;
    const y = groundH(x, z) - 0.1;
    const post = new THREE.CylinderGeometry(0.07, 0.1, 2.4, 6); post.translate(x, y + 1.2, z); poles.push(post);
    const arm = new THREE.BoxGeometry(0.6, 0.06, 0.06); arm.translate(x + 0.25, y + 2.3, z); poles.push(arm);
    const cap = new THREE.ConeGeometry(0.22, 0.2, 6); cap.translate(x + 0.5, y + 2.2, z); poles.push(cap);
    const lamp = new THREE.CylinderGeometry(0.15, 0.13, 0.32, 6); lamp.translate(x + 0.5, y + 1.95, z); glass.push(lamp);
    world.addCyl(x, z, 0.14, y, y + 2.4);
  }
  const poleG = mergeGeometries(poles.map((g) => colorize(g, (px2, py, pz2, c) => c.setRGB(0.24, 0.16, 0.11))));
  poleG.computeVertexNormals();
  root.add(new THREE.Mesh(poleG, stylize(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { wrap: 0.4 })));
  if (glass.length) {
    const lampMesh = new THREE.Mesh(mergeGeometries(glass), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.5, 0.6) }));
    root.add(lampMesh);
  }

  // ---------------------------------------------------------------- waterfall cliff
  const fall = buildFalls(world);
  root.add(fall.group);

  root.userData.update = (t) => { uTime.value = t; fall.update(t); };
  return root;
}

function buildFalls(world) {
  const g = new THREE.Group(); g.name = 'falls';
  const rnd = mulberry32(777);
  const toLake = new THREE.Vector2(LAKE.x - FALLS.x, LAKE.z - FALLS.z).normalize();
  const yaw = Math.atan2(toLake.x, toLake.y); // local +z faces the lake
  const base = groundH(FALLS.x, FALLS.z) - 1.5;
  const rocks = [];
  // stacked, jittered boulders form a mossy cliff with a notch at the top where the water spills
  for (let i = 0; i < 26; i++) {
    const lx = (rnd() - 0.5) * FALLS.w, lz = -rnd() * FALLS.d, ly = rnd() * FALLS.h * 0.85;
    const s = 2.2 + rnd() * 2.4 - ly * 0.06;
    const r = jitter(new THREE.IcosahedronGeometry(s, 1), s * 0.35, 900 + i);
    r.scale(1.2, 1, 1); r.translate(Math.abs(lx) < 1.6 && ly > FALLS.h * 0.6 ? lx * 2.2 : lx, ly + s * 0.4, lz);
    rocks.push(r);
  }
  const rg = mergeGeometries(rocks.map((r) => colorize(r, (x, y, z, c) => {
    c.setRGB(0.5, 0.5, 0.48).multiplyScalar(0.75 + N.n2(x * 0.6 + y * 0.3, z * 0.6) * 0.25);
    if (N.n2(x * 0.4, z * 0.4 + y * 0.2) > 0.1 + y * 0.02) c.lerp(new THREE.Color(0.24, 0.42, 0.14), 0.7); // moss
  })));
  rg.computeVertexNormals();
  const cliff = new THREE.Mesh(rg, stylize(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { wrap: 0.35, band: 0.12 }));
  cliff.castShadow = true; cliff.receiveShadow = true;
  g.add(cliff);
  // the falling water: a curved ribbon with racing streaks
  // where the water lands (local +z toward the lake): on the water, or on the shore if it is dry
  const landZ = 3.6;
  const lx = FALLS.x + toLake.x * landZ, lzw = FALLS.z + toLake.y * landZ;
  const landY = Math.max(WATER_Y, groundH(lx, lzw)) - base;
  const H = FALLS.h + 1.2 - landY;
  const ribbon = new THREE.PlaneGeometry(3.4, 1, 6, 24);
  const p = ribbon.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = 0.5 - p.getY(i); // 0 top → 1 bottom
    p.setXYZ(i, p.getX(i) * (1 + v * 0.35), FALLS.h + 1.2 - v * H, 1.4 + Math.sin(v * Math.PI * 0.5) * 2.2 - (1 - v) * 0.6);
  }
  ribbon.computeVertexNormals();
  const uT = { value: 0 };
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uT },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float uT; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        float v = 1.0 - vUv.y;
        float s = n2(vec2(vUv.x * 14.0, v * 6.0 - uT * 4.5)) * 0.6 + n2(vec2(vUv.x * 30.0, v * 12.0 - uT * 7.0)) * 0.4;
        vec3 col = mix(vec3(0.35, 0.62, 0.72), vec3(0.95, 0.98, 1.0), smoothstep(0.35, 0.8, s));
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        float a = edge * (0.55 + 0.4 * s) * smoothstep(1.0, 0.92, v);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const water = new THREE.Mesh(ribbon, waterMat);
  g.add(water);
  // foam and mist where it lands
  const foamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uT },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float uT; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p);
        float n = n2(p * 6.0 + vec2(0.0, -uT * 1.5)) * 0.6 + n2(vec2(atan(p.y, p.x) * 3.0, r * 8.0 - uT * 2.5)) * 0.4;
        float a = smoothstep(1.0, 0.2, r) * smoothstep(0.35, 0.7, n) * 0.85;
        gl_FragColor = vec4(vec3(0.95, 0.98, 1.0), a);
      }`,
  });
  const foam = new THREE.Mesh(new THREE.CircleGeometry(3.6, 32), foamMat);
  foam.rotation.x = -Math.PI / 2; foam.position.set(0, landY + 0.08, landZ);
  g.add(foam);
  const mistTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const mists = [];
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: 0.35 }));
    sp.position.set((rnd() - 0.5) * 3, landY + 1 + rnd() * 1.5, landZ + (rnd() - 0.5) * 2);
    sp.scale.setScalar(3 + rnd() * 2); sp.userData.ph = rnd() * 6;
    mists.push(sp); g.add(sp);
  }
  g.position.set(FALLS.x, base, FALLS.z); g.rotation.y = yaw;
  world.addBox(FALLS.x - toLake.x * 2.5, FALLS.z - toLake.y * 2.5, FALLS.w / 2, FALLS.d / 2 + 1, -yaw, base, base + FALLS.h + 2);
  return {
    group: g,
    update: (t) => {
      uT.value = t;
      for (const m of mists) { const k = 0.5 + 0.5 * Math.sin(t * 0.8 + m.userData.ph); m.material.opacity = 0.22 + k * 0.2; m.scale.setScalar(3 + k * 1.6); }
    },
  };
}
