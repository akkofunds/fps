import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundH, groundNormal, LAKE, PLAY_RADIUS, MAP_SCALE as MS, pathDist, riverDist, CLIFF, terrainNoise as N } from './terrain.js';
import { mulberry32, smoothstep } from './noise.js';
import { windPatch } from './vegetation.js';
import { stylize } from './stylize.js';
import { landmarkFootprints } from './landmarks.js';
import { buildBiomes } from './biomes.js';

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
let LEAF_DETAIL = 2, LEAF_LITE = false;
// painted leaf-cluster texture: dozens of small overlapping leaves in a round clump (white, tinted
// per vertex), alpha-cut — every canopy is built from cards of this round a dark inner hull
let LEAF_TEX = null;
function leafTexture() {
  // a spray of real leaves: twigs fanning out from the bottom, each carrying lobed (oak / maple)
  // leaves with their own colour drift — redder, yellower, a few browned. The outline is ragged and
  // open (light comes through), so a canopy built from these never reads as balls.
  if (LEAF_TEX) return LEAF_TEX;
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry32(77);
  const leaf = (L, W, lobes) => {
    g.beginPath(); g.moveTo(-L / 2, 0);
    const n = lobes * 2;
    for (let k = 1; k <= n; k++) { const u = k / n, x = -L / 2 + u * L, w = W * Math.sin(u * Math.PI) * (k % 2 ? 1 : 0.6); g.quadraticCurveTo(x - L / n * 0.5, -w * 1.15, x, k === n ? 0 : -w); }
    for (let k = n - 1; k >= 0; k--) { const u = k / n, x = -L / 2 + u * L, w = W * Math.sin(u * Math.PI) * (k % 2 ? 1 : 0.6); g.quadraticCurveTo(x + L / n * 0.5, w * 1.15, x, w); }
    g.closePath(); g.fill();
  };
  const paint = (x, y, rot, L) => {
    const shade = 0.6 + r() * 0.4, hue = r();
    const rr = 255 * shade, gg = 255 * shade * (hue < 0.3 ? 0.66 : hue < 0.8 ? 0.9 : 1.0), bb = 255 * shade * (hue < 0.3 ? 0.6 : hue < 0.9 ? 0.78 : 0.55);
    g.save(); g.translate(x, y); g.rotate(rot);
    g.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
    leaf(L, L * (0.36 + r() * 0.12), 2 + Math.floor(r() * 2));
    g.strokeStyle = 'rgba(70,30,8,0.4)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-L / 2 - 5, 0); g.lineTo(L / 2 - 3, 0); g.stroke();
    g.restore();
  };
  const twigs = 7;
  for (let t = 0; t < twigs; t++) {
    let x = S / 2 + (r() - 0.5) * 50, y = S * 0.92, a = -Math.PI / 2 + (t / (twigs - 1) - 0.5) * 2.3 + (r() - 0.5) * 0.3;
    const len = S * (0.5 + r() * 0.32), steps = 13, bend = (r() - 0.5) * 0.08;
    const pts = [];
    g.strokeStyle = 'rgb(66,38,20)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < steps; k++) { a += bend; x += Math.cos(a) * len / steps; y += Math.sin(a) * len / steps; g.lineTo(x, y); pts.push([x, y, a, (k + 1) / steps]); }
    g.stroke();
    pts.forEach(([px, py, pa, u], k) => {
      if (u < 0.2) return;
      const side = k % 2 ? 1 : -1, L = 32 + 30 * Math.sin(u * Math.PI) + r() * 14;
      paint(px + Math.cos(pa + side * 1.57) * L * 0.42, py + Math.sin(pa + side * 1.57) * L * 0.42, pa + side * (0.9 + r() * 0.5), L);
    });
    const [tx, ty, ta] = pts[pts.length - 1];
    for (let k = 0; k < 3; k++) paint(tx + Math.cos(ta) * 16, ty + Math.sin(ta) * 16, ta + (k - 1) * 0.7, 38 + r() * 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  return (LEAF_TEX = t);
}
// bark: deep vertical furrows over rough plates (u runs round the trunk, v up it)
let BARK_TEX = null;
function barkTexture() {
  if (BARK_TEX) return BARK_TEX;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S), r = mulberry32(19);
  const cols = Array.from({ length: 14 }, () => r());
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S * 14, i = Math.floor(u), f = u - i;
    const wob = N.n2(x / 18, y / 60) * 0.35;
    const furrow = Math.pow(Math.abs(Math.sin((f + wob + cols[i] * 0.3) * Math.PI)), 0.45);
    const plate = 0.75 + 0.25 * N.n2(x / 6 + i * 3, y / 22) - (N.n2(x / 3, y / 4) > 0.75 ? 0.15 : 0);
    const v = Math.max(0, Math.min(255, (0.35 + 0.65 * furrow) * plate * 245));
    const k = (y * S + x) * 4; img.data[k] = v; img.data[k + 1] = v * 0.96; img.data[k + 2] = v * 0.9; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(2, 3);
  return (BARK_TEX = t);
}
// one foliage clump: a dark inner hull + leaf cards scattered over its surface, facing outward.
// Each clump shades as its own soft ball (normals bent away from the clump centre, a little away
// from the crown centre too) and carries its own light→shadow gradient: the "cauliflower" canopy of
// painted anime trees, bright yellow-green crowns over deep green undersides.
// autumn palettes (top / middle / underside): flame orange, rust red, gold, and an evergreen
const LEAF_PALS = [
  [new THREE.Color(1.2, 0.6, 0.12), new THREE.Color(0.86, 0.32, 0.05), new THREE.Color(0.26, 0.07, 0.02)],   // orange
  [new THREE.Color(1.25, 0.88, 0.2), new THREE.Color(0.95, 0.56, 0.08), new THREE.Color(0.32, 0.14, 0.03)],  // orange-yellow
  [new THREE.Color(1.1, 0.36, 0.08), new THREE.Color(0.72, 0.15, 0.04), new THREE.Color(0.22, 0.04, 0.02)],  // orange-red
  [new THREE.Color(1.2, 0.72, 0.16), new THREE.Color(0.9, 0.42, 0.06), new THREE.Color(0.28, 0.1, 0.02)],    // amber
];
let LEAF_TOP = LEAF_PALS[0][0], LEAF_MID = LEAF_PALS[0][1], LEAF_BOT = LEAF_PALS[0][2];
function foliage(out, s, x, y, z, sy, seed, ctr = [x, y - s, z], warm = 0) {
  // a cluster of leaf sprays: cards scattered THROUGH a lumpy volume (not wrapped round a ball),
  // each tilted its own way, no solid core — ragged edges and gaps, like a real branch of leaves
  const r = mulberry32(seed);
  const parts = [];
  const n = LEAF_DETAIL >= 2 ? 16 : LEAF_DETAIL >= 1 ? (LEAF_LITE ? 5 : 8) : 3;
  const u = new THREE.Vector3(), d = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1);
  const ax = 0.8 + r() * 0.5, az = 0.8 + r() * 0.5;                       // each cluster its own lumpy shape
  for (let k = 0; k < n; k++) {
    do u.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1); while (u.lengthSq() > 1);
    const px = x + u.x * s * 0.8 * ax, py = y + u.y * s * 0.6 * sy, pz = z + u.z * s * 0.8 * az;
    // facing: mostly away from the crown centre, tilted at random (no two sprays parallel)
    d.set(px - ctr[0], (py - ctr[1]) * 0.6, pz - ctr[2]).normalize().add(new THREE.Vector3(r() * 2 - 1, r() * 1.6 - 0.4, r() * 2 - 1).multiplyScalar(0.9)).normalize();
    const cs = s * (LEAF_DETAIL <= 0 ? 2.0 : 1.05 + r() * 0.6);
    const card = new THREE.PlaneGeometry(cs, cs);
    card.translate(0, cs * 0.2, 0);                                         // the spray grows out from its twig
    q.setFromUnitVectors(Z, d).multiply(new THREE.Quaternion().setFromAxisAngle(Z, r() * 6.283));
    m.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(1, 1, 1));
    card.applyMatrix4(m);
    parts.push(ni(card));
  }
  const hue = (r() - 0.5) * 0.25 + warm;
  const c = new THREE.Color(), a = new THREE.Vector3();
  for (const g of parts) {
    const p = g.attributes.position, nrm = new Float32Array(p.count * 3), col = new Float32Array(p.count * 3);
    const jn = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.6);
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
      // light the whole crown as one mass (sunlit outside, shaded inside/below), a little per spray
      a.set(px - ctr[0], (py - ctr[1]) * 1.2, pz - ctr[2]).normalize().add(jn); a.y += 0.15; a.normalize();
      nrm.set([a.x, a.y, a.z], i * 3);
      const t = Math.min(1, Math.max(0, (py - ctr[1]) / 6 + 0.55));
      if (t > 0.5) c.copy(LEAF_MID).lerp(LEAF_TOP, (t - 0.5) * 2); else c.copy(LEAF_BOT).lerp(LEAF_MID, t * 2);
      c.r *= 1 + hue; c.g *= 1 + hue * 0.3;
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.push(g);
  }
}
// a branch along a smooth curve, thick at the base and thin at the tip
function taperedLimb(pts, r0, r1) {
  const path = new THREE.CatmullRomCurve3(pts);
  const TS = 8, RS = 7, g = new THREE.TubeGeometry(path, TS, 1, RS, false);
  const p = g.attributes.position, c = new THREE.Vector3();
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getY(k), uv.getX(k) * 2);
  for (let i = 0; i <= TS; i++) {
    path.getPointAt(i / TS, c);
    const rr = r0 + (r1 - r0) * (i / TS);
    for (let j = 0; j <= RS; j++) { const k = i * (RS + 1) + j; p.setXYZ(k, c.x + (p.getX(k) - c.x) * rr, c.y + (p.getY(k) - c.y) * rr, c.z + (p.getZ(k) - c.z) * rr); }
  }
  return g;
}
function bigTreeGeometry(seed) {
  // the reference's broadleaf: a stout, slightly bent trunk forking into splayed limbs that hold up
  // a wide dome of separate leaf clumps (gaps between them, sky showing through)
  const r = mulberry32(seed);
  const trunk = [], leaves = [];
  const lean = (r() - 0.5) * 0.5;
  const tg = new THREE.CylinderGeometry(0.36, 0.55, 3.4, 12, 6); tg.translate(0, 1.7, 0);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + Math.sin(y * 0.8 + seed) * 0.12 + lean * y * 0.12); }
  trunk.push(jitter(tg, 0.06, seed));
  const flare = new THREE.CylinderGeometry(0.55, 0.95, 0.6, 12); flare.translate(0, 0.22, 0); trunk.push(jitter(flare, 0.12, seed + 1));
  const top = [lean * 0.4, 3.2, 0];
  const CR = 3.9 + r() * 0.9, CY = 6.6 + r() * 0.6, ctr = [top[0], CY + 0.9, 0];
  const limbs = 5 + Math.floor(r() * 3), tips = [];
  for (let b = 0; b < limbs; b++) {
    const ang = (b / limbs) * 6.28 + r() * 0.7, reach = CR * (0.5 + r() * 0.4), dx = -Math.cos(ang), dz = Math.sin(ang);
    const y0 = top[1] - 0.6 + r() * 0.9;
    const p0 = new THREE.Vector3(top[0] * (y0 / top[1]), y0, 0);
    const p1 = new THREE.Vector3(top[0] + dx * reach * 0.4, y0 + 1.3 + r() * 0.8, dz * reach * 0.4);
    const p2 = new THREE.Vector3(top[0] + dx * reach, CY - 0.4 + r() * 2.2, dz * reach);
    trunk.push(taperedLimb([p0, p1, p2], 0.26 - b * 0.012, 0.06));
    tips.push(p2);
    // two crooked twigs off each limb, reaching up and out into the crown
    for (let t = 0; t < 2; t++) {
      const q0 = p1.clone().lerp(p2, 0.3 + t * 0.35), sd = t ? 1 : -1;
      const q2 = q0.clone().add(new THREE.Vector3(dx * 1.4 + dz * sd * 1.3, 1.1 + r() * 0.9, dz * 1.4 - dx * sd * 1.3));
      trunk.push(taperedLimb([q0, q0.clone().lerp(q2, 0.5).add(new THREE.Vector3((r() - 0.5) * 0.4, 0.2, (r() - 0.5) * 0.4)), q2], 0.08, 0.025));
      tips.push(q2);
    }
  }
  // the crown: many smaller leaf clusters, most at branch ends, an uneven, lumpy oak silhouette
  // with gaps the light comes through (not a dome of balls)
  let k = 0;
  const clump = (x, y, z, s) => foliage(leaves, s, x, y, z, 0.72, seed * 31 + k++, ctr, y > CY + 0.6 ? 0.05 : 0);
  for (const p of tips) clump(p.x + (r() - 0.5) * 0.6, p.y + 0.4 + r() * 0.4, p.z + (r() - 0.5) * 0.6, 1.15 + r() * 0.45);
  // fill the crown: a rounded, slightly lumpy ellipsoid (oaks are as tall in the crown as they are wide)
  const cy = CY + 0.9, v = new THREE.Vector3();
  for (let i = 0; i < 16; i++) {
    do v.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1); while (v.lengthSq() > 1);
    v.multiplyScalar(0.55 + 0.45 * v.length());                     // favour the outer shell
    clump(top[0] + v.x * CR * 0.85, cy + v.y * CR * 0.62, v.z * CR * 0.85, 1.05 + r() * 0.5);
  }
  return { trunk: mergeGeometries(trunk.map((g) => ni(g))), leaves: mergeGeometries(leaves), h: CY + 3.4, big: true };
}

function treeColors(def) {
  colorize(def.trunk, (x, y, z, c) => { c.setRGB(0.34, 0.27, 0.21).multiplyScalar(0.75 + N.n2(y * 4, x * 6 + z * 6) * 0.35); if (N.n2(y * 1.3 + 4, x * 2) > 0.62) c.lerp(new THREE.Color(0.3, 0.27, 0.22), 0.5); });
  return def;
}

function leafMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
  m.alphaToCoverage = true; // soft, anti-aliased leaf edges instead of jagged alpha-test stairs
  // canopy sway: scale the wind by height (position.y in tree space, ~0-9 m)
  m.onBeforeCompile = (sh) => {
    const parent = windPatch;
    void parent;
    sh.uniforms.uTime = treeTime;
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.12; // painted foliage never goes muddy in shade');
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
  // a chunky sedimentary boulder (reference: square-ish stones with flat tops and layered sides):
  // a sphere pushed toward a rounded cube, lumped with noise, terraced into strata, base and top
  // flattened, welded so it shades smooth instead of faceted
  const r = mulberry32(seed);
  const g0 = new THREE.IcosahedronGeometry(1, 4); g0.deleteAttribute('normal'); g0.deleteAttribute('uv');
  const g = mergeVertices(g0, 1e-4);
  const p = g.attributes.position, v = new THREE.Vector3(), cube = new THREE.Vector3();
  const sx = 1.15 + r() * 0.45, sz = 0.85 + r() * 0.35, step = 0.26 + r() * 0.08, o = r() * 10;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const m = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    cube.copy(v).divideScalar(m).multiplyScalar(0.92);
    v.lerp(cube, 0.5);
    v.multiplyScalar(1 + 0.15 * N.n2(v.x * 1.2 + o, v.y * 1.1 + v.z * 0.8) + 0.05 * N.n2(v.x * 3.5, v.z * 3.5 + o));
    // strata: flat ledges with short risers, each layer stepping in a little
    const f = (v.y + 1) / step, fl = Math.floor(f), t = f - fl;
    v.y = (fl + smoothstep(0.62, 1, t)) * step - 1;
    const inset = 1 - 0.05 * Math.abs(N.n2(fl * 3.1 + o, 1.7));
    v.x *= inset; v.z *= inset;
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.25;
    if (v.y > 0.6) v.y = 0.6 + (v.y - 0.6) * 0.3;
    p.setXYZ(i, v.x * sx, v.y * 0.8, v.z * sz);
  }
  g.computeVertexNormals();
  const n = g.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color(), moss = new THREE.Color(0.52, 0.42, 0.16);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = n.getY(i);
    c.setRGB(0.58, 0.55, 0.6).multiplyScalar(0.82 + 0.18 * N.n2(x * 2 + seed, z * 2 + y));
    // darker seams between the layers, warm lichen spots
    c.multiplyScalar(1 - 0.18 * smoothstep(0.55, 0.95, Math.abs(Math.sin(y * Math.PI / (step * 0.8)))));
    c.lerp(new THREE.Color(0.66, 0.6, 0.46), Math.max(0, N.n2(x * 4 + 3, z * 4) - 0.55) * 0.8);
    c.lerp(moss, smoothstep(0.62, 0.9, ny) * (0.55 + 0.25 * N.n2(x * 3, z * 3)));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ---------------------------------------------------------------- assemble
export function buildProps(world, quality = 'high', Q = {}) {
  LEAF_DETAIL = Q.leafDetail || 2; LEAF_LITE = quality === 'low';
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
  // one species, the reference's big broadleaf, in three variants and three canopy LODs
  const SEEDS = [11, 23, 37, 53];
  const variants = () => SEEDS.map((sd, i) => { [LEAF_TOP, LEAF_MID, LEAF_BOT] = LEAF_PALS[i]; return treeColors(bigTreeGeometry(sd)); });
  const kinds = { oak: variants() };
  LEAF_DETAIL = LEAF_LITE ? 0 : 1; const kindsFar = { oak: variants() }; // on the rims: fewer leaf cards (none on Low)
  LEAF_DETAIL = 0; const kindsVeryFar = { oak: variants() };    // far plateaus: a ball per clump
  const placements = [];
  const trunkMat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true, map: barkTexture() }), { wrap: 0.35, band: 0.03 });
  const leafMat = stylize(leafMaterial(), { wrap: 0.35, translucency: 0.8, band: 0.03 });
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTexture(), alphaTest: 0.5 });
  const nrmT = new THREE.Vector3();
  // keep the reference shot clear: looking up the river from the south-east bank toward the falls,
  // the bridge, the stone circle and the arches with the sun over them
  const HV = { x: -150, z: -10, a: -0.71 };
  const inHeroView = (x, z) => { const dx = x - HV.x, dz = z - HV.z, d = Math.hypot(dx, dz); let da = Math.atan2(dz, dx) - HV.a; da = Math.atan2(Math.sin(da), Math.cos(da)); return d > 12 && d < 150 && Math.abs(da) < 0.62; };
  let hero = false;
  const tryTree = (x, z, kind, scale, collide, gap = 12) => {
    if (riverDist(x, z) < 6 + scale * 2 || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 6) return false;
    if (groundNormal(x, z, nrmT).y < 0.9) return false;                  // not on (or at the lip of) a cliff
    if (groundNormal(x + 2.5, z, nrmT).y < 0.75 || groundNormal(x - 2.5, z, nrmT).y < 0.75 || groundNormal(x, z + 2.5, nrmT).y < 0.75 || groundNormal(x, z - 2.5, nrmT).y < 0.75) return false;
    if (pathDist(x, z) < 3.5) return false;
    if (avoidFn(x, z)) return false;
    if (!hero && inHeroView(x, z)) return false;
    for (const p of placements) if ((p.x - x) ** 2 + (p.z - z) ** 2 < gap * gap) return false;
    placements.push({ x, z, kind, scale, v: Math.floor(rnd() * kinds[kind].length), rot: rnd() * 6.28 });
    if (collide) world.addCyl(x, z, 0.5 * scale, groundH(x, z) - 1, groundH(x, z) + 3.4 * scale);
    B.avoid.push({ x, z, r: 1.1 * scale });
    return true;
  };
  // few, big, characterful trees (reference): two framing the river view, lone giants on the meadow,
  // small stands of two or three near its edge
  hero = true;
  for (const [x, z, sc] of [[-153, -19, 2.1], [-128, 4, 1.7], [-60, -128, 1.9], [-12, -96, 1.7]]) tryTree(x, z, 'oak', sc, true);
  hero = false;
  const lone = [[58, 34, 1.9], [-62, 22, 1.7], [30, 62, 1.8], [-30, -38, 1.6], [44, -30, 1.7], [-10, 70, 1.6], [70, 6, 1.6], [-74, 44, 1.8]];
  for (const [x, z, sc] of lone) tryTree(x * MS, z * MS, 'oak', sc, true);
  const stands = [...[[-46, 52], [62, 52], [-58, -16], [20, -44]].map(([x, z]) => [x * MS, z * MS]), [-90, 70], [100, 90], [70, -100], [140, 20], [-20, 150]];
  for (const [gx, gz] of stands) for (let i = 0, t = 0; i < 2 + (t % 2) && t < 40; t++) if (tryTree(gx + R(-12, 12), gz + R(-12, 12), 'oak', R(1.3, 1.8), true, 10)) i++;
  for (let i = 0, t = 0; i < 12 && t < 1200; t++) {
    const a = rnd() * 6.28, r = R(50, PLAY_RADIUS - 8);
    if (tryTree(Math.cos(a) * r, Math.sin(a) * r, 'oak', R(1.4, 1.9), true, 22)) i++;
  }
  // falling leaves drift down round the trees in the valley (ambient.js)
  root.userData.groves = placements.filter((p) => Math.hypot(p.x, p.z) < PLAY_RADIUS).slice(0, quality === 'low' ? 6 : 28).map((p) => ({ x: p.x, z: p.z, r: 3.5 * p.scale }));
  // groves along the cliff tops and the plateaus beyond (in clumps, with open ground between)
  const scenery = Math.round((Q.scenery || 230) * 0.6);
  for (let i = 0, t = 0; i < scenery && t < scenery * 30; t++) {
    const a = rnd() * 6.28, r = 62 * MS + Math.pow(rnd(), 1.4) * 120;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (groundH(x, z) < CLIFF.t1 - 1.5 && r < 150 * MS) continue;               // inside the basin: handled above
    if (N.fbm(x / 40, z / 40, 2) < 0.05) continue;
    if (tryTree(x, z, 'oak', R(1.5, 2.3), false, 8)) i++;
  }
  // groves out on the far plateaus past the rim (the reference's forested distance); planted on the
  // far-land surface from sky.js, drawn with the cheapest canopy
  const farTrees = [];
  if (Q.farGround && quality !== 'low') {
    const nFar = Math.round((Q.scenery || 230) * 1.2);
    for (let i = 0, t = 0; i < nFar && t < nFar * 20; t++) {
      const a = rnd() * 6.28, r = R(275, 470), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (N.fbm(x / 60 + 9, z / 60, 2) < 0.0) continue;
      const y = Q.farGround(x, z);
      if (y < 4) continue;
      farTrees.push({ x, y: y - 0.3, z, scale: R(1.6, 2.6), v: Math.floor(rnd() * SEEDS.length), rot: rnd() * 6.28 }); i++;
    }
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
      lm.customDepthMaterial = leafDepth; // leaf-shaped shadows, not square cards
      for (const m of [tm, lm]) { m.castShadow = near; m.receiveShadow = near; m.computeBoundingSphere(); root.add(m); }
    });
  });

  kindsVeryFar.oak.forEach((def, v) => {
    const list = farTrees.filter((p) => p.v === v);
    if (!list.length) return;
    const tm = new THREE.InstancedMesh(def.trunk, trunkMat, list.length), lm = new THREE.InstancedMesh(def.leaves, leafMat, list.length);
    list.forEach((p, i) => { q.setFromAxisAngle(up, p.rot); m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale)); tm.setMatrixAt(i, m4); lm.setMatrixAt(i, m4); });
    for (const m of [tm, lm]) { m.computeBoundingSphere(); root.add(m); }
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
  for (let i = 0, t = 0; i < 45 && t < 3000; t++) { const a = rnd() * 6.28, r = R(10, PLAY_RADIUS - 4), x = Math.cos(a) * r, z = Math.sin(a) * r; if (okRock(x, z)) { addRock(x, z, R(0.5, 1.4), true); i++; } }
  // big cover boulders, each with a smaller one at its foot
  const boulders = [[-24, 6], [14, -26], [34, 10], [-10, 28], [-40, -26], [56, 20], [10, 56], [-58, 14], [36, -52], [-20, 56], [64, -40], [-66, 34]];
  for (const [bx, bz] of boulders) { const x = bx * MS, z = bz * MS; if (!okRock(x, z)) continue; addRock(x, z, R(1.6, 2.4), true); addRock(x + R(-2.6, 2.6), z + R(-2.6, 2.6), R(0.5, 0.9), true); }
  // rubble at the foot of the cliffs
  // extra cover boulders spread over the (bigger) meadow
  for (let i = 0, t = 0; i < 20 && t < 1500; t++) { const a = rnd() * 6.28, r = R(30, PLAY_RADIUS - 12), x = Math.cos(a) * r, z = Math.sin(a) * r; if (okRock(x, z)) { addRock(x, z, R(1.5, 2.5), true); addRock(x + R(-2.6, 2.6), z + R(-2.6, 2.6), R(0.5, 0.9), true); i++; } }
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
