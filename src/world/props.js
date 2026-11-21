import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundH, groundNormal, LAKE, PLAY_RADIUS, MAP_SCALE as MS, pathDist, riverDist, CLIFF, terrainNoise as N } from './terrain.js';
import { mulberry32 } from './noise.js';
import { windPatch } from './vegetation.js';
import { stylize } from './stylize.js';
import { landmarkFootprints } from './landmarks.js';
import { buildBiomes, petalCarpet } from './biomes.js';

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
  c.setRGB(base[0] * 1.04, base[1] * 1.03, base[2] * 1.0).multiplyScalar(0.92 + n * 0.12);
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
    const m = new THREE.Mesh(g, stylize(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: stoneTexture() }), { wrap: 0.3, band: 0.14 }));
    m.castShadow = true; m.receiveShadow = true; m.name = 'ruins';
    return m;
  }
}

// ---------------------------------------------------------------- trees
let LEAF_DETAIL = 2;
function oakGeometry(seed) {
  // a broad, characterful oak: a thick trunk that forks into 4 limbs, each carrying its own cloud of
  // foliage, plus a crown cluster — reads as a real tree silhouette instead of a lollipop
  const r = mulberry32(seed);
  const trunk = [], leaves = [];
  const tg = new THREE.CylinderGeometry(0.26, 0.46, 3.0, 8, 3); tg.translate(0, 1.5, 0);
  trunk.push(jitter(tg, 0.08, seed));
  const root = new THREE.CylinderGeometry(0.46, 0.75, 0.5, 8); root.translate(0, 0.2, 0); trunk.push(jitter(root, 0.1, seed + 1));
  const tips = [];
  const limbs = 4;
  for (let b = 0; b < limbs; b++) {
    const ang = (b / limbs) * 6.28 + r() * 0.8, tilt = 0.55 + r() * 0.35, len = 2.2 + r() * 0.8;
    const bg = new THREE.CylinderGeometry(0.1, 0.2, len, 6); bg.translate(0, len / 2, 0);
    const by = 2.6 + r() * 0.4;
    bg.rotateZ(tilt); bg.rotateY(ang); bg.translate(0, by, 0);
    trunk.push(bg);
    // (0, len, 0) rotated by Z(tilt) then Y(ang)
    tips.push([-Math.sin(tilt) * len * Math.cos(ang), by + Math.cos(tilt) * len, Math.sin(tilt) * len * Math.sin(ang), 1]);
  }
  tips.push([0, 5.6, 0, 1.3]);
  tips.forEach(([tx, ty, tz, k], ci) => {
    const nb = ci === tips.length - 1 ? 6 : 5;
    for (let i = 0; i < nb; i++) {
      const s = (i === 0 ? 1.55 : 1.0 + r() * 0.6) * k;
      const lg = jitter(new THREE.IcosahedronGeometry(s, i === 0 ? LEAF_DETAIL : Math.max(0, LEAF_DETAIL - 1)), 0.14, seed + ci * 10 + i);
      lg.scale(1, 0.9, 1);
      const a = r() * 6.28, d = i === 0 ? 0 : 0.8 + r() * 0.7;
      lg.translate(tx + Math.cos(a) * d, ty + 0.3 + (r() - 0.25) * 1.1, tz + Math.sin(a) * d);
      leaves.push(lg);
    }
  });
  return { trunk: mergeGeometries(trunk.map((g) => ni(g))), leaves: mergeGeometries(leaves.map((g) => ni(g))), h: 7 };
}
function sakuraGeometry(seed) {
  // cherry blossom: a dark, leaning, gnarled trunk splitting into wide spreading limbs under a
  // broad flat-topped cloud of pink
  const r = mulberry32(seed);
  const trunk = [], leaves = [];
  const tg = new THREE.CylinderGeometry(0.2, 0.36, 2.6, 7, 4); tg.translate(0, 1.3, 0);
  const p = tg.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.sin(y * 1.3 + seed) * 0.22); }
  trunk.push(jitter(tg, 0.05, seed));
  const tips = [];
  for (let b = 0; b < 5; b++) {
    const ang = (b / 5) * 6.28 + r() * 0.6, tilt = 0.9 + r() * 0.35, len = 2.4 + r() * 1.2;
    const bg = new THREE.CylinderGeometry(0.06, 0.15, len, 5); bg.translate(0, len / 2, 0);
    bg.rotateZ(tilt); bg.rotateY(ang); bg.translate(0, 2.3, 0);
    trunk.push(bg);
    tips.push([-Math.sin(tilt) * len * Math.cos(ang), 2.3 + Math.cos(tilt) * len, Math.sin(tilt) * len * Math.sin(ang)]);
  }
  tips.push([0, 4.4, 0]);
  tips.forEach(([tx, ty, tz], ci) => {
    for (let i = 0; i < 6; i++) {
      const s = (i === 0 ? 1.25 : 0.75 + r() * 0.55);
      const lg = jitter(new THREE.IcosahedronGeometry(s, Math.max(1, LEAF_DETAIL - 1)), 0.16, seed + ci * 7 + i);
      lg.scale(1.1, 0.95, 1.1);
      const a = r() * 6.28, d = i === 0 ? 0 : 0.6 + r() * 0.8;
      lg.translate(tx + Math.cos(a) * d, ty + 0.5 + (r() - 0.3) * 0.9, tz + Math.sin(a) * d);
      leaves.push(lg);
    }
  });
  return { trunk: mergeGeometries(trunk.map((g) => ni(g))), leaves: mergeGeometries(leaves.map((g) => ni(g))), h: 5.6, sakura: true };
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
    else if (def.sakura) c.setRGB(0.24, 0.16, 0.15).multiplyScalar(0.85 + N.n2(y * 3, x * 5) * 0.2);
    else c.setRGB(0.36, 0.25, 0.16).multiplyScalar(0.85 + N.n2(y * 3, x * 5) * 0.15);
  });
  const top = kind === 'pine' ? new THREE.Color(0.2, 0.42, 0.24) : kind === 'birch' ? new THREE.Color(0.62, 0.78, 0.24) : kind === 'sakura' ? new THREE.Color(1.0, 0.86, 0.92) : new THREE.Color(0.44, 0.74, 0.2);
  const bot = kind === 'pine' ? new THREE.Color(0.06, 0.2, 0.12) : kind === 'birch' ? new THREE.Color(0.24, 0.4, 0.1) : kind === 'sakura' ? new THREE.Color(0.9, 0.56, 0.7) : new THREE.Color(0.1, 0.32, 0.1);
  colorize(def.leaves, (x, y, z, c) => {
    const t = Math.min(1, Math.max(0, (y - 2.5) / (def.h - 2.5)));
    c.copy(bot).lerp(top, Math.pow(t, 0.8));
    // per-cluster hue drift (some clusters warmer/yellower) so canopies are not one flat green
    if (!def.sakura && kind !== 'pine') c.lerp(new THREE.Color(0.66, 0.78, 0.22), Math.max(0, N.n2(x * 0.6 + 7, z * 0.6 - 3) - 0.35) * 0.5);
    c.multiplyScalar(0.9 + N.n2(x * 1.5 + y, z * 1.5) * 0.14);
  });
  def.trunk.computeVertexNormals(); def.leaves.computeVertexNormals();
  canopyNormals(def.leaves, kind === 'pine' ? 0.35 : 0.9, def.sakura ? 0.75 : 0.12);
  return def;
}

// "fluffy" stylized canopies: bend the faceted leaf normals toward the direction from the canopy
// center, so each tree shades like one soft, round volume (light side / shadow side) instead of a
// pile of facets. Pines keep more of their own normals so the tiers still read.
function canopyNormals(g, k, upBias = 0.12) {
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  const ext = g.boundingBox.getSize(new THREE.Vector3());
  const p = g.attributes.position, n = g.attributes.normal, v = new THREE.Vector3(), f = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set((p.getX(i) - c.x) / ext.x, (p.getY(i) - c.y) / ext.y * 0.8 + upBias, (p.getZ(i) - c.z) / ext.z).normalize();
    f.set(n.getX(i), n.getY(i), n.getZ(i));
    f.lerp(v, k).normalize();
    n.setXYZ(i, f.x, f.y, f.z);
  }
  n.needsUpdate = true;
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
  // smooth, rounded grey boulder (reference: soft weathered stones half sunk in the grass)
  const g = new THREE.IcosahedronGeometry(1, 2); // 320 tris (detail 3 = 1280): same silhouette at game range
  const r = mulberry32(seed), p = g.attributes.position, v = new THREE.Vector3();
  const o = [r() * 10, r() * 10, r() * 10];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.18 * N.n2(v.x * 1.4 + o[0], v.y * 1.4 + v.z * 0.9 + o[1]) + 0.07 * N.n2(v.x * 4 + o[2], v.z * 4);
    v.multiplyScalar(k); if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.4; // flatter base
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.scale(1.2, 0.66, 0.95);
  colorize(g, (x, y, z, c) => {
    c.setRGB(0.45, 0.46, 0.46).multiplyScalar(0.84 + N.n2(x * 2 + seed, z * 2 + y) * 0.16);
    if (y > 0.3 + N.n2(x * 3, z * 3) * 0.15) c.lerp(new THREE.Color(0.36, 0.52, 0.2), 0.45); // moss on top
  });
  g.computeVertexNormals();
  return g.index ? g.toNonIndexed() : g;
}

// ---------------------------------------------------------------- assemble
export function buildProps(world, quality = 'high', Q = {}) {
  LEAF_DETAIL = Q.leafDetail || 2;
  const root = new THREE.Group(); root.name = 'props';
  const B = new Builder(world);

  // the valley has no ruins: open meadow, trees, boulders (reference board)
  root.userData.altar = null;
  B.avoid.push(...landmarkFootprints());

  // ---------------- trees
  // spatial hash over B.avoid (thousands of entries on the big map; grass asks ~10^5 times)
  const AG = 8, grid = new Map();
  let indexed = 0;
  const cellKey = (i, j) => (i + 4096) * 8192 + (j + 4096);
  const index = () => {
    for (; indexed < B.avoid.length; indexed++) {
      const a = B.avoid[indexed];
      const i0 = Math.floor((a.x - a.r) / AG), i1 = Math.floor((a.x + a.r) / AG), j0 = Math.floor((a.z - a.r) / AG), j1 = Math.floor((a.z + a.r) / AG);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = cellKey(i, j); let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(a); }
    }
  };
  const avoidFn = (x, z) => {
    if (indexed < B.avoid.length) index();
    const c = grid.get(cellKey(Math.floor(x / AG), Math.floor(z / AG)));
    if (c) for (const a of c) if ((x - a.x) ** 2 + (z - a.z) ** 2 < a.r * a.r) return true;
    return false;
  };
  // landmarks first, so trees and undergrowth keep clear of them
  const biomes = buildBiomes(B, world, Q);
  root.add(biomes);
  const kinds = { oak: [oakGeometry(11), oakGeometry(23)], pine: [pineGeometry(5), pineGeometry(8)], birch: [birchGeometry(3)], sakura: [sakuraGeometry(61), sakuraGeometry(67)] };
  for (const [k, defs] of Object.entries(kinds)) defs.forEach((d) => treeColors(d, k));
  // the forest on the hills is far away: a coarser canopy (1/4 the triangles) is indistinguishable
  LEAF_DETAIL = 1;
  const kindsFar = { oak: [oakGeometry(11), oakGeometry(23)], pine: kinds.pine, birch: kinds.birch, sakura: kinds.sakura };
  kindsFar.oak.forEach((d) => treeColors(d, 'oak'));
  // beyond ~170 m a tree is a few pixels: 20-face blobs (smoothed normals keep them round)
  LEAF_DETAIL = 0;
  const kindsVeryFar = { oak: [oakGeometry(11), oakGeometry(23)], pine: kinds.pine, birch: kinds.birch, sakura: kinds.sakura };
  kindsVeryFar.oak.forEach((d) => treeColors(d, 'oak'));
  const placements = [];
  const trunkMat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { wrap: 0.4 });
  const leafMat = stylize(leafMaterial(), { wrap: 0.55, translucency: 0.25, band: 0.16 });
  const nrmT = new THREE.Vector3();
  const tryTree = (x, z, kind, scale, collide) => {
    if (riverDist(x, z) < 7 || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 4) return false;
    if (groundNormal(x, z, nrmT).y < 0.9) return false;                  // not on (or at the lip of) a cliff
    if (groundNormal(x + 2.5, z, nrmT).y < 0.75 || groundNormal(x - 2.5, z, nrmT).y < 0.75 || groundNormal(x, z + 2.5, nrmT).y < 0.75 || groundNormal(x, z - 2.5, nrmT).y < 0.75) return false;
    if (pathDist(x, z) < 2.5) return false;
    if (avoidFn(x, z)) return false;
    for (const p of placements) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (collide ? 30 : 12)) return false;
    placements.push({ x, z, kind, scale, v: Math.floor(rnd() * kinds[kind].length), rot: rnd() * 6.28 });
    if (collide) world.addCyl(x, z, (kind === 'birch' ? 0.22 : kind === 'pine' ? 0.32 : kind === 'sakura' ? 0.3 : 0.46) * scale, groundH(x, z) - 1, groundH(x, z) + 3.2 * scale);
    B.avoid.push({ x, z, r: 0.8 * scale });
    return true;
  };
  // the meadow is open (reference): a few big lone oaks and small clumps near its edges for cover
  const lone = [[58, 34, 1.6], [-62, 22, 1.4], [30, 62, 1.5], [-30, -38, 1.3], [44, -30, 1.35], [-10, 70, 1.3], [70, 6, 1.25], [-74, 44, 1.4]];
  for (const [x, z, sc] of lone) tryTree(x * MS, z * MS, 'oak', sc, true);
  const clumps = [...[[-46, 52], [62, 52], [-58, -16], [20, -44]].map(([x, z]) => [x * MS, z * MS]), [-90, 70], [100, 90], [-120, -30], [70, -100], [140, 20], [-20, 150], [-150, 110], [30, 110]];
  for (const [gx, gz] of clumps) for (let i = 0, t = 0; i < 4 && t < 50; t++) if (tryTree(gx + R(-10, 10), gz + R(-10, 10), rnd() < 0.85 ? 'oak' : 'birch', R(0.85, 1.2), true)) i++;
  // sakura groves (with a carpet of fallen petals) and two pine woods
  const groves = [{ x: -70, z: -78, r: 16 }, { x: 125, z: 98, r: 18 }, { x: -58, z: 160, r: 16 }, { x: 70, z: -112, r: 12 }];
  const groveSpots = [];
  for (const gv of groves) {
    let n = 0;
    for (let t = 0; t < 90 && n < 11; t++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * gv.r; if (tryTree(gv.x + Math.cos(a) * d, gv.z + Math.sin(a) * d, 'sakura', R(0.95, 1.35), true)) n++; }
    if (n) groveSpots.push({ x: gv.x, z: gv.z, r: gv.r + 4 });
  }
  if (groveSpots.length) root.add(petalCarpet(groveSpots));
  root.userData.groves = groveSpots;
  for (const [wx, wz, wr, wn] of [[-162, 96, 26, 22], [188, 18, 22, 18]]) for (let n = 0, t = 0; t < 200 && n < wn; t++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * wr; if (tryTree(wx + Math.cos(a) * d, wz + Math.sin(a) * d, 'pine', R(0.9, 1.4), true)) n++; }
  for (let i = 0, t = 0; i < 46 && t < 1600; t++) {
    const a = rnd() * 6.28, r = R(40, PLAY_RADIUS - 6);
    if (tryTree(Math.cos(a) * r, Math.sin(a) * r, rnd() < 0.8 ? 'oak' : 'birch', R(0.8, 1.15), true)) i++;
  }
  // trees dotting the cliff tops and the plateaus beyond (dense near the edge, like the reference)
  const scenery = (Q.scenery || 300) * 2.4 * 1.9;
  for (let i = 0, t = 0; i < scenery && t < scenery * 10; t++) {
    const a = rnd() * 6.28, r = 62 * MS + Math.pow(rnd(), 1.7) * 300;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (groundH(x, z) < CLIFF.t1 - 1.5 && r < 150 * MS) continue;               // inside the basin: handled above
    if (N.fbm(x / 30, z / 30, 2) < -0.2) continue;
    if (tryTree(x, z, rnd() < 0.9 ? 'oak' : 'birch', R(1.0, 1.6), false)) i++;
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  // arena trees cast shadows; the forest on the surrounding hills doesn't (it's outside the shadow
  // camera anyway, but splitting them keeps the shadow pass from even considering them)
  for (const [kind, defs] of Object.entries(kinds)) defs.forEach((defNear, v) => {
    const all = placements.filter((p) => p.kind === kind && p.v === v);
    // near: the trees down in the basin, where you fight (full canopy detail, cast shadows); the
    // cliff rims and the forest beyond: 8 angular sectors x 2 rings so most of it frustum-culls,
    // coarse canopies, no shadows (they are outside the shadow camera's area anyway)
    const inBasin = (p) => Math.hypot(p.x, p.z) < PLAY_RADIUS + 14 && groundH(p.x, p.z) < CLIFF.t1 - 1.5;
    const groups = [all.filter(inBasin)];
    const sector = (p) => Math.floor(((Math.atan2(p.z, p.x) + Math.PI) / (Math.PI * 2)) * 8) % 8;
    for (let ring = 0; ring < 2; ring++) for (let k = 0; k < 8; k++) groups.push(all.filter((p) => !inBasin(p) && (Math.hypot(p.x, p.z) < 170 * MS) === (ring === 0) && sector(p) === k));
    groups.forEach((list, gi) => {
      const near = gi === 0;
      const def = near ? defNear : gi <= 8 ? kindsFar[kind][v] : kindsVeryFar[kind][v];
      if (!list.length) return;
      const tm = new THREE.InstancedMesh(def.trunk, trunkMat, list.length);
      const lm = new THREE.InstancedMesh(def.leaves, leafMat, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        m4.compose(new THREE.Vector3(p.x, groundH(p.x, p.z) - 0.15, p.z), q, new THREE.Vector3(p.scale, p.scale * R(0.9, 1.15), p.scale));
        tm.setMatrixAt(i, m4); lm.setMatrixAt(i, m4);
      });
      for (const m of [tm, lm]) { m.castShadow = near; m.receiveShadow = near; m.computeBoundingSphere(); root.add(m); }
    });
  });

  // ---------------- rocks
  const rockDefs = [rockGeometry(1), rockGeometry(2), rockGeometry(3)];
  const rockMat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true }), { wrap: 0.4, band: 0.1 });
  const rocks = rockDefs.map(() => []);
  const addRock = (x, z, s, collide) => {
    if (avoidFn(x, z) || pathDist(x, z) < 1.5) return;
    const y = groundH(x, z);
    rocks[Math.floor(rnd() * rocks.length)].push({ x, y: y - s * 0.18, z, s, rot: rnd() * 6.28, sy: R(0.7, 1.2) });
    if (collide) world.addSphere(x, y - s * 0.25, z, s * 0.82);
    B.avoid.push({ x, z, r: s * 1.05 });
  };
  const okRock = (x, z) => riverDist(x, z) > 5 && groundNormal(x, z, nrmT).y > 0.85;
  // grey boulders scattered over the meadow (reference)
  for (let i = 0, t = 0; i < 150 && t < 3000; t++) { const a = rnd() * 6.28, r = R(10, PLAY_RADIUS - 4), x = Math.cos(a) * r, z = Math.sin(a) * r; if (okRock(x, z)) { addRock(x, z, R(0.5, 1.4), true); i++; } }
  // big cover boulders, each with a smaller one at its foot
  const boulders = [[-24, 6], [14, -26], [34, 10], [-10, 28], [-40, -26], [56, 20], [10, 56], [-58, 14], [36, -52], [-20, 56], [64, -40], [-66, 34]];
  for (const [bx, bz] of boulders) { const x = bx * MS, z = bz * MS; if (!okRock(x, z)) continue; addRock(x, z, R(1.6, 2.4), true); addRock(x + R(-2.6, 2.6), z + R(-2.6, 2.6), R(0.5, 0.9), true); }
  // rubble at the foot of the cliffs
  // extra cover boulders spread over the (bigger) meadow
  for (let i = 0, t = 0; i < 40 && t < 1500; t++) { const a = rnd() * 6.28, r = R(30, PLAY_RADIUS - 12), x = Math.cos(a) * r, z = Math.sin(a) * r; if (okRock(x, z)) { addRock(x, z, R(1.5, 2.5), true); addRock(x + R(-2.6, 2.6), z + R(-2.6, 2.6), R(0.5, 0.9), true); i++; } }
  for (let i = 0, t = 0; i < 160 && t < 6000; t++) {
    const a = rnd() * 6.28, r = R(55 * MS, 140 * MS), x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h0 = groundH(x, z);
    if (h0 > 2 || !okRock(x, z) || groundH(x + Math.cos(a) * 3, z + Math.sin(a) * 3) < h0 + 3) continue;
    addRock(x, z, R(0.8, 2.2), r < PLAY_RADIUS + 12); i++;
  }
  // river stones
  for (let i = 0, t = 0; i < 110 && t < 5000; t++) {
    const a = rnd() * 6.28, r = R(20, 160 * MS), x = Math.cos(a) * r, z = Math.sin(a) * r;
    const d = riverDist(x, z); if (d < 4.5 || d > 7.5) continue;
    addRock(x, z, R(0.35, 0.8), false); i++;
  }
  rockDefs.forEach((g, k) => [true, false].forEach((nearSet) => {
    const list = rocks[k].filter((p) => (Math.hypot(p.x, p.z) < PLAY_RADIUS) === nearSet);
    if (!list.length) return;
    const im = new THREE.InstancedMesh(g, rockMat, list.length);
    list.forEach((p, i) => { q.setFromAxisAngle(up, p.rot); m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s * p.sy, p.s)); im.setMatrixAt(i, m4); });
    // only the boulders where you fight cast shadows (rubble at the cliffs / river stones don't)
    im.castShadow = nearSet; im.receiveShadow = true; im.computeBoundingSphere();
    root.add(im);
  }));

  if (B.stone.length) root.add(B.finish());
  root.userData.avoid = avoidFn;
  // anchors for undergrowth: trees inside/near the arena, rocks and ruin walls
  root.userData.anchors = [
    ...placements.filter((p) => Math.hypot(p.x, p.z) < PLAY_RADIUS + 25).map((p) => ({ x: p.x, z: p.z })),
    ...rocks.flat().filter((p) => Math.hypot(p.x, p.z) < PLAY_RADIUS + 10).map((p) => ({ x: p.x, z: p.z })),
  ];
  return root;
}
