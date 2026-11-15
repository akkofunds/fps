import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundH, PLAZA, HILL, LAKE, PLAY_RADIUS, pathDist, terrainNoise as N } from './terrain.js';
import { mulberry32 } from './noise.js';
import { windPatch } from './vegetation.js';

// Ruins (stone plaza, broken pillars, watchtower, arches, walls), trees, rocks and logs.
// Everything is merged / instanced and registers simple colliders in the CollisionWorld.

const rnd = mulberry32(1234);
const ni = (g) => (g.index ? g.toNonIndexed() : g);
const R = (a, b) => a + rnd() * (b - a);

function colorize(g, fn) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), col); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
function jitter(g, amt, seed = 1) {
  const r = mulberry32(seed);
  const p = g.attributes.position;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let o = map.get(k); if (!o) map.set(k, o = [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt]);
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  return g;
}
const stoneCol = (base) => (x, y, z, c) => {
  const n = N.n2(x * 1.3 + z * 0.7, y * 1.7 - z * 0.3);
  c.setRGB(base[0] * 1.08, base[1] * 1.0, base[2] * 0.86).multiplyScalar(0.86 + n * 0.12);
  // moss creeping up from the ground
  const moss = Math.max(0, 0.5 - y * 0.35 + N.n2(x * 0.8, z * 0.8) * 0.35);
  c.lerp(new THREE.Color(0.3, 0.42, 0.18), Math.min(0.75, moss));
};

// weathered stone blocks: mortar lines + speckle, tiling
function stoneTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#d8d2c4'; g.fillRect(0, 0, S, S);
  const r = mulberry32(31);
  for (let i = 0; i < 2600; i++) { const v = 150 + r() * 90; g.fillStyle = `rgba(${v},${v - 6},${v - 16},${0.25 + r() * 0.3})`; g.fillRect(r() * S, r() * S, 1 + r() * 4, 1 + r() * 4); }
  g.strokeStyle = 'rgba(70,64,55,0.55)'; g.lineWidth = 2.5;
  const rows = 4;
  for (let y = 0; y < rows; y++) {
    const yy = (y / rows) * S;
    g.beginPath(); g.moveTo(0, yy); g.lineTo(S, yy); g.stroke();
    const off = (y % 2) * S / 4;
    for (let x = 0; x < 2; x++) { const xx = off + (x * S) / 2; g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx, yy + S / rows); g.stroke(); }
  }
  for (let i = 0; i < 14; i++) { g.strokeStyle = 'rgba(60,55,48,0.35)'; g.lineWidth = 1; g.beginPath(); let x = r() * S, y = r() * S; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 30; y += r() * 16; g.lineTo(x, y); } g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

class Builder {
  constructor(world) { this.world = world; this.stone = []; this.avoid = []; }
  // geometry in world space with per-vertex stone color
  addStone(geo, tint = [0.62, 0.6, 0.55]) {
    const g = colorize(ni(geo), stoneCol(tint));
    // triplanar-ish UVs from world position + face normal (1 texture tile ≈ 1.6 m)
    g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      let u, v;
      if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
      uv[i * 2] = u / 1.6; uv[i * 2 + 1] = v / 1.6;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.stone.push(g);
  }
  box(x, y, z, sx, sy, sz, rot = 0, tint, collide = true) {
    const g = jitter(new THREE.BoxGeometry(sx, sy, sz, Math.max(1, Math.round(sx)), Math.max(1, Math.round(sy)), Math.max(1, Math.round(sz))), 0.05, Math.floor(x * 13 + z * 7));
    g.rotateY(rot); g.translate(x, y + sy / 2, z);
    this.addStone(g, tint);
    if (collide) this.world.addBox(x, z, sx / 2, sz / 2, -rot, y, y + sy);
    this.avoid.push({ x, z, r: Math.max(sx, sz) * 0.55 });
  }
  pillar(x, z, h, r = 0.55, base = groundH(x, z)) {
    const g = jitter(new THREE.CylinderGeometry(r * 0.92, r, h, 10, Math.max(2, Math.round(h))), 0.04, Math.floor(x * 31 + z));
    // broken top: push a few top verts down
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > h / 2 - 0.01) p.setY(i, p.getY(i) - rnd() * 0.35);
    g.translate(x, base + h / 2, z);
    this.addStone(g, [0.72, 0.69, 0.62]);
    const plinth = new THREE.BoxGeometry(r * 2.6, 0.35, r * 2.6); plinth.translate(x, base + 0.17, z);
    this.addStone(plinth, [0.6, 0.58, 0.52]);
    this.world.addCyl(x, z, r * 1.05, base - 0.5, base + h - 0.15);
    this.avoid.push({ x, z, r: r * 1.6 });
  }
  finish() {
    const g = mergeGeometries(this.stone, false);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: stoneTexture() }));
    m.castShadow = true; m.receiveShadow = true; m.name = 'ruins';
    return m;
  }
}

// ---------------------------------------------------------------- trees
function oakGeometry(seed) {
  const r = mulberry32(seed);
  const trunk = [], leaves = [];
  const tg = new THREE.CylinderGeometry(0.22, 0.38, 3.2, 7, 3); tg.translate(0, 1.6, 0);
  trunk.push(jitter(tg, 0.08, seed));
  for (let b = 0; b < 3; b++) {
    const bg = new THREE.CylinderGeometry(0.07, 0.15, 1.8, 5); bg.translate(0, 0.9, 0);
    bg.rotateZ((r() - 0.5) * 1.6); bg.rotateY(r() * 6.28); bg.translate(0, 2.4 + r() * 0.6, 0);
    trunk.push(bg);
  }
  const blobs = 7;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * 6.28 + r(), d = i === 0 ? 0 : 1.1 + r() * 0.9;
    const s = i === 0 ? 2.0 : 1.2 + r() * 0.7;
    const lg = jitter(new THREE.IcosahedronGeometry(s, 2), 0.28, seed + i);
    lg.scale(1, 0.78, 1);
    lg.translate(Math.cos(a) * d, 3.9 + r() * 1.3 + (i === 0 ? 0.9 : 0), Math.sin(a) * d);
    leaves.push(lg);
  }
  return { trunk: mergeGeometries(trunk.map((g) => ni(g))), leaves: mergeGeometries(leaves.map((g) => ni(g))), h: 6.5 };
}
function pineGeometry(seed) {
  const r = mulberry32(seed);
  const tg = new THREE.CylinderGeometry(0.14, 0.3, 2.4, 6); tg.translate(0, 1.2, 0);
  const leaves = [];
  let y = 1.6, w = 2.3;
  for (let i = 0; i < 5; i++) {
    const cg = jitter(new THREE.ConeGeometry(w, 2.2, 8, 1), 0.2, seed + i);
    cg.rotateY(r() * 3); cg.translate(0, y + 1.1, 0);
    leaves.push(cg); y += 1.25; w *= 0.78;
  }
  return { trunk: ni(tg), leaves: mergeGeometries(leaves.map((g) => ni(g))), h: 8.5 };
}
function birchGeometry(seed) {
  const r = mulberry32(seed);
  const tg = jitter(new THREE.CylinderGeometry(0.12, 0.2, 4.6, 6, 4), 0.05, seed); tg.translate(0, 2.3, 0);
  const leaves = [];
  for (let i = 0; i < 5; i++) {
    const lg = jitter(new THREE.IcosahedronGeometry(0.9 + r() * 0.5, 1), 0.25, seed + i);
    lg.scale(1, 1.25, 1); lg.translate((r() - 0.5) * 1.6, 4 + r() * 1.8, (r() - 0.5) * 1.6);
    leaves.push(lg);
  }
  return { trunk: ni(tg), leaves: mergeGeometries(leaves.map((g) => ni(g))), h: 6.5, birch: true };
}

function treeColors(def, kind) {
  colorize(def.trunk, (x, y, z, c) => {
    if (def.birch) { c.setRGB(0.88, 0.86, 0.8); if (N.n2(y * 4, x * 8 + z * 8) > 0.45) c.setRGB(0.18, 0.17, 0.15); }
    else c.setRGB(0.36, 0.25, 0.16).multiplyScalar(0.85 + N.n2(y * 3, x * 5) * 0.15);
  });
  const top = kind === 'pine' ? new THREE.Color(0.2, 0.42, 0.24) : kind === 'birch' ? new THREE.Color(0.58, 0.72, 0.22) : new THREE.Color(0.36, 0.6, 0.16);
  const bot = kind === 'pine' ? new THREE.Color(0.06, 0.2, 0.12) : kind === 'birch' ? new THREE.Color(0.24, 0.4, 0.1) : new THREE.Color(0.1, 0.27, 0.07);
  colorize(def.leaves, (x, y, z, c) => {
    const t = Math.min(1, Math.max(0, (y - 2.5) / (def.h - 2.5)));
    c.copy(bot).lerp(top, Math.pow(t, 0.8));
    c.multiplyScalar(0.9 + N.n2(x * 1.5 + y, z * 1.5) * 0.14);
  });
  def.trunk.computeVertexNormals(); def.leaves.computeVertexNormals();
  return def;
}

function leafMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  // canopy sway: scale the wind by height (position.y in tree space, ~0-9 m)
  m.onBeforeCompile = (sh) => {
    const parent = windPatch;
    void parent;
    sh.uniforms.uTime = treeTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 troot = instanceMatrix[3].xyz;
        #else
          vec3 troot = vec3(0.0);
        #endif
        float sway = max(0.0, position.y - 2.0) * 0.022;
        float ph = uTime * 0.9 + troot.x * 0.1 + troot.z * 0.13;
        transformed.x += sin(ph) * sway + sin(uTime * 2.3 + position.y + troot.z) * 0.04 * sway * 8.0;
        transformed.z += cos(ph * 0.8) * sway * 0.6;`);
  };
  return m;
}
export const treeTime = { value: 0 };

// ---------------------------------------------------------------- rocks
function rockGeometry(seed) {
  const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.45, seed);
  g.scale(1, 0.62, 0.85);
  const ng = ni(g);
  colorize(ng, (x, y, z, c) => {
    c.setRGB(0.56, 0.52, 0.45).multiplyScalar(0.82 + N.n2(x * 2 + seed, z * 2) * 0.18);
    if (y > 0.25 + N.n2(x * 3, z * 3) * 0.2) c.lerp(new THREE.Color(0.33, 0.47, 0.17), 0.65);
  });
  ng.computeVertexNormals();
  return ng;
}

// ---------------------------------------------------------------- assemble
export function buildProps(world, quality = 'high') {
  const root = new THREE.Group(); root.name = 'props';
  const B = new Builder(world);
  const plazaY = groundH(0, 0);

  // stone plaza: two-step circular floor
  const floor = jitter(new THREE.CylinderGeometry(PLAZA.r, PLAZA.r + 0.3, 0.6, 40, 1), 0.04, 9);
  floor.translate(0, plazaY - 0.05, 0);
  B.addStone(floor, [0.66, 0.63, 0.56]);
  world.addCyl(0, 0, PLAZA.r + 0.1, plazaY - 2, plazaY + 0.25);
  const inner = new THREE.CylinderGeometry(3.4, 3.6, 0.4, 24); inner.translate(0, plazaY + 0.4, 0);
  B.addStone(inner, [0.7, 0.66, 0.6]);
  world.addCyl(0, 0, 3.6, plazaY, plazaY + 0.6);
  // central fire altar
  B.box(0, plazaY + 0.6, 0, 1.6, 0.9, 1.6, 0.4, [0.46, 0.42, 0.4]);
  // broken pillar ring
  const pillarHeights = [4.6, 1.4, 3.2, 5.2, 2.1, 4.0, 1.0, 3.6];
  pillarHeights.forEach((h, i) => {
    const a = (i / pillarHeights.length) * Math.PI * 2 + 0.2;
    B.pillar(Math.cos(a) * 8.2, Math.sin(a) * 8.2, h, 0.55, plazaY + 0.2);
  });
  // a toppled pillar lying across the plaza edge
  {
    const g = jitter(new THREE.CylinderGeometry(0.5, 0.5, 4.2, 10, 3), 0.04, 77);
    g.rotateZ(Math.PI / 2); g.rotateY(0.6); g.translate(-6.4, plazaY + 0.7, -5.2);
    B.addStone(g, [0.72, 0.69, 0.62]);
    world.addBox(-6.4, -5.2, 2.1, 0.5, -0.6, plazaY + 0.2, plazaY + 1.2);
  }
  root.userData.altar = new THREE.Vector3(0, plazaY + 1.5, 0);

  // watchtower on the hill
  {
    const tx = HILL.x, tz = HILL.z, ty = groundH(tx, tz) - 0.4, rot = 0.35;
    const c = Math.cos(rot), s = Math.sin(rot);
    const at = (lx, lz) => [tx + lx * c + lz * s, tz - lx * s + lz * c];
    const wall = (lx, lz, len, h, along) => {
      const [x, z] = at(lx, lz);
      B.box(x, ty, z, along ? len : 0.7, h, along ? 0.7 : len, rot, [0.6, 0.57, 0.5]);
    };
    wall(0, -3, 6.7, 5.4, true); // back
    wall(-3, 0.2, 5.0, 3.6, false); // left (taller)
    wall(3, 0.6, 4.2, 1.5, false); // right (climbable)
    wall(-2.1, 3, 2.4, 2.6, true); // front pieces with a doorway
    wall(2.3, 3, 1.6, 1.1, true);
    // rubble + floor slab inside
    const [fx, fz] = at(0, 0);
    B.box(fx, ty, fz, 5.2, 0.55, 5.2, rot, [0.55, 0.52, 0.46]);
    for (let i = 0; i < 6; i++) { const [x, z] = at(R(-5, 5), R(4, 6.5)); B.box(x, groundH(x, z) - 0.2, z, R(0.5, 1.1), R(0.4, 0.8), R(0.5, 1), R(0, 3), [0.58, 0.55, 0.48]); }
    root.userData.tower = new THREE.Vector3(fx, ty + 6, fz);
  }

  // stone arches
  const arch = (x, z, rot) => {
    const y = groundH(x, z) - 0.2, c = Math.cos(rot), s = Math.sin(rot);
    for (const side of [-1, 1]) B.box(x + side * 1.9 * c, y, z - side * 1.9 * s, 0.9, 4.2, 0.9, rot, [0.66, 0.62, 0.55]);
    const top = jitter(new THREE.BoxGeometry(5, 0.8, 1.0, 5, 1, 1), 0.06, 3); top.rotateY(rot); top.translate(x, y + 4.6, z);
    B.addStone(top, [0.64, 0.6, 0.54]);
    world.addBox(x, z, 2.5, 0.5, -rot, y + 4.2, y + 5.0);
  };
  arch(-20, -31, 0.9);
  arch(24, 31, -0.5);
  arch(-44, 2, 1.5);

  // old walls for cover
  const walls = [[-14, 14, 0.3, 5, 1.3], [16, -6, 1.2, 4.5, 1.1], [-34, -16, 2.0, 6, 1.6], [40, 4, 0.2, 5.5, 1.2], [6, 30, 1.7, 4, 1.0], [-6, -40, 0.4, 5, 1.4], [46, -38, 2.4, 4, 1.2], [-50, 26, 1.0, 4.5, 1.1], [22, 46, 2.6, 3.5, 0.9], [-24, 44, 0.8, 4, 1.2]];
  for (const [x, z, rot, len, h] of walls) {
    const y = groundH(x, z) - 0.25;
    const segs = 3;
    for (let i = 0; i < segs; i++) {
      const t = (i - (segs - 1) / 2) * len / segs;
      const hh = h * (0.6 + rnd() * 0.5) + 0.25;
      B.box(x + Math.cos(rot) * t, y, z - Math.sin(rot) * t, len / segs + 0.02, hh, 0.65, rot, [0.6, 0.58, 0.52]);
    }
  }
  const ruins = B.finish();
  root.add(ruins);

  // ---------------- trees
  const avoidFn = (x, z) => {
    for (const a of B.avoid) if ((x - a.x) ** 2 + (z - a.z) ** 2 < a.r * a.r) return true;
    return false;
  };
  const kinds = { oak: [oakGeometry(11), oakGeometry(23)], pine: [pineGeometry(5), pineGeometry(8)], birch: [birchGeometry(3)] };
  for (const [k, defs] of Object.entries(kinds)) defs.forEach((d) => treeColors(d, k));
  const placements = [];
  const trunkMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const leafMat = leafMaterial();
  const tryTree = (x, z, kind, scale, collide) => {
    if (Math.hypot(x, z) < PLAZA.r + 3) return false;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 1.5) return false;
    if (pathDist(x, z) < 2.5) return false;
    if (Math.hypot(x - HILL.x, z - HILL.z) < 7.5) return false;
    if (avoidFn(x, z)) return false;
    for (const p of placements) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (collide ? 30 : 12)) return false;
    placements.push({ x, z, kind, scale, v: Math.floor(rnd() * kinds[kind].length), rot: rnd() * 6.28 });
    if (collide) world.addCyl(x, z, (kind === 'birch' ? 0.22 : kind === 'pine' ? 0.32 : 0.42) * scale, groundH(x, z) - 1, groundH(x, z) + 3.2 * scale);
    B.avoid.push({ x, z, r: 0.8 * scale });
    return true;
  };
  // groves inside the arena (cover)
  const groves = [[-40, -36], [42, 24], [-12, 38], [52, -10], [-52, -6], [14, -46], [-30, 46], [36, 46], [-46, 40]];
  for (const [gx, gz] of groves) {
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0, t = 0; i < n && t < 40; t++) {
      const kind = rnd() < 0.5 ? 'oak' : rnd() < 0.6 ? 'birch' : 'pine';
      if (tryTree(gx + R(-7, 7), gz + R(-7, 7), kind, R(0.85, 1.25), true)) i++;
    }
  }
  for (let i = 0, t = 0; i < 14 && t < 300; t++) {
    const a = rnd() * 6.28, r = R(16, PLAY_RADIUS - 4);
    if (tryTree(Math.cos(a) * r, Math.sin(a) * r, rnd() < 0.6 ? 'oak' : 'birch', R(0.8, 1.2), true)) i++;
  }
  // forest on the surrounding hills (scenery)
  const scenery = quality === 'low' ? 160 : quality === 'medium' ? 280 : 420;
  for (let i = 0, t = 0; i < scenery && t < scenery * 8; t++) {
    const a = rnd() * 6.28, r = R(PLAY_RADIUS + 2, 230);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (N.fbm(x / 40, z / 40, 2) < -0.15) continue;
    if (tryTree(x, z, rnd() < 0.55 ? 'pine' : rnd() < 0.7 ? 'oak' : 'birch', R(1.0, 1.6), r < PLAY_RADIUS + 12)) i++;
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const [kind, defs] of Object.entries(kinds)) defs.forEach((def, v) => {
    const list = placements.filter((p) => p.kind === kind && p.v === v);
    if (!list.length) return;
    const tm = new THREE.InstancedMesh(def.trunk, trunkMat, list.length);
    const lm = new THREE.InstancedMesh(def.leaves, leafMat, list.length);
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      m4.compose(new THREE.Vector3(p.x, groundH(p.x, p.z) - 0.15, p.z), q, new THREE.Vector3(p.scale, p.scale * R(0.9, 1.15), p.scale));
      tm.setMatrixAt(i, m4); lm.setMatrixAt(i, m4);
    });
    for (const m of [tm, lm]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); root.add(m); }
  });

  // ---------------- rocks
  const rockDefs = [rockGeometry(1), rockGeometry(2), rockGeometry(3)];
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const rocks = rockDefs.map(() => []);
  const addRock = (x, z, s, collide) => {
    if (Math.hypot(x, z) < PLAZA.r + 1.5 || avoidFn(x, z) || pathDist(x, z) < 1.5) return;
    const y = groundH(x, z);
    rocks[Math.floor(rnd() * rocks.length)].push({ x, y: y - s * 0.18, z, s, rot: rnd() * 6.28, sy: R(0.7, 1.2) });
    if (collide) world.addSphere(x, y - s * 0.25, z, s * 0.82);
    B.avoid.push({ x, z, r: s * 1.05 });
  };
  for (let i = 0; i < 26; i++) { const a = rnd() * 6.28, r = R(12, PLAY_RADIUS - 2); addRock(Math.cos(a) * r, Math.sin(a) * r, R(0.6, 1.6), true); }
  // big cover boulders
  const boulders = [[-22, 4], [12, -24], [28, 8], [-8, 22], [-36, -28], [50, 18], [8, 52], [-56, 12], [30, -48], [-18, -52]];
  for (const [x, z] of boulders) { addRock(x, z, R(1.6, 2.3), true); addRock(x + R(-2.5, 2.5), z + R(-2.5, 2.5), R(0.5, 0.9), true); }
  for (let i = 0; i < 18; i++) { const a = rnd() * 6.28; addRock(LAKE.x + Math.cos(a) * (LAKE.r + R(-1, 2)), LAKE.z + Math.sin(a) * (LAKE.r + R(-1, 2)), R(0.3, 0.8), true); }
  for (let i = 0; i < 60; i++) { const a = rnd() * 6.28, r = R(PLAY_RADIUS + 4, 160); addRock(Math.cos(a) * r, Math.sin(a) * r, R(1.5, 4.5), false); }
  rockDefs.forEach((g, k) => {
    const list = rocks[k];
    if (!list.length) return;
    const im = new THREE.InstancedMesh(g, rockMat, list.length);
    list.forEach((p, i) => { q.setFromAxisAngle(up, p.rot); m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s * p.sy, p.s)); im.setMatrixAt(i, m4); });
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
    root.add(im);
  });

  // ---------------- fallen logs (cover)
  const logs = [[-26, -8, 0.4, 4.2], [20, 20, 1.9, 3.6], [36, -12, 0.9, 4], [-10, -24, 2.2, 3.8], [-42, 18, 1.2, 3.4]];
  const logGeo = [];
  for (const [x, z, rot, len] of logs) {
    const y = groundH(x, z);
    const g = jitter(new THREE.CylinderGeometry(0.42, 0.48, len, 9, 3), 0.05, Math.floor(x * 3));
    g.rotateZ(Math.PI / 2); g.rotateY(rot); g.translate(x, y + 0.32, z);
    logGeo.push(colorize(ni(g), (px, py, pz, c) => { c.setRGB(0.38, 0.27, 0.17).multiplyScalar(0.85 + N.n2(px * 3, pz * 3) * 0.15); if (py > y + 0.62) c.lerp(new THREE.Color(0.3, 0.44, 0.16), 0.5); }));
    world.addBox(x, z, len / 2, 0.45, -rot, y - 0.3, y + 0.78);
    B.avoid.push({ x, z, r: len * 0.5 });
  }
  const lg = mergeGeometries(logGeo); lg.computeVertexNormals();
  const logMesh = new THREE.Mesh(lg, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  logMesh.castShadow = true; logMesh.receiveShadow = true;
  root.add(logMesh);

  root.userData.avoid = avoidFn;
  // anchors for undergrowth: trees inside/near the arena, rocks and ruin walls
  root.userData.anchors = [
    ...placements.filter((p) => Math.hypot(p.x, p.z) < PLAY_RADIUS + 25).map((p) => ({ x: p.x, z: p.z })),
    ...rocks.flat().filter((p) => Math.hypot(p.x, p.z) < PLAY_RADIUS + 10).map((p) => ({ x: p.x, z: p.z })),
  ];
  return root;
}
