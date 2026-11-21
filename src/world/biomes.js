import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundH, pathDist, riverDist, LAKE, PATH, PATH2, WATER_Y, MESA, terrainNoise as N } from './terrain.js';
import { mulberry32, smoothstep } from './noise.js';
import { stylize } from './stylize.js';
import { spireGeometry } from './scenery.js';

// Points of interest inside the valley, so every direction has something to run to:
//   - the Sunken Colonnade: a ring of weathered pillars round a low altar in the centre
//   - ruin sites: standing arches, broken walls, fallen columns, a roofless watchtower
//   - karst spires rising out of the meadow near the cliffs, and a natural stone arch
//   - arched stone bridges where the trails cross the river
//   - stone lanterns along the trails
//   - pink petal carpets under the sakura groves
// Stone goes through the props Builder (merged, textured, collision registered); the rest are
// merged / instanced meshes with their own colliders.

const rnd = mulberry32(4242);
const R = (a, b) => a + rnd() * (b - a);
const ni = (g) => (g.index ? g.toNonIndexed() : g);

function maxGround(x, z, r) {
  let hi = -1e9, lo = 1e9;
  for (let i = 0; i < 16; i++) for (const k of [0.35, 0.7, 1]) { const a = (i / 16) * Math.PI * 2, h = groundH(x + Math.cos(a) * r * k, z + Math.sin(a) * r * k); hi = Math.max(hi, h); lo = Math.min(lo, h); }
  return [lo, Math.max(hi, groundH(x, z))];
}

// ---------------------------------------------------------------- ruins
function colonnade(B, world, cx, cz) {
  const RAD = 15;
  const [lo, hi] = maxGround(cx, cz, RAD);
  const top = hi + 0.25;
  // a sunken circular floor of big slabs, with a step ring round it
  const floor = new THREE.CylinderGeometry(RAD, RAD + 0.4, top - lo + 1.2, 36, 1); floor.translate(cx, (top + lo - 1.2) / 2, cz);
  B.addStone(floor, [0.7, 0.67, 0.6]);
  const step = new THREE.CylinderGeometry(RAD + 1.6, RAD + 2, 0.4, 36, 1); step.translate(cx, top - 0.55, cz);
  B.addStone(step, [0.6, 0.58, 0.52]);
  world.addCyl(cx, cz, RAD, lo - 1.2, top);
  world.addCyl(cx, cz, RAD + 1.8, lo - 1.2, top - 0.35);
  B.avoid.push({ x: cx, z: cz, r: RAD + 3 });
  // the ring of pillars: tall ones carry lintels, others have fallen to stumps
  const n = 14, H = [7.5, 7.5, 3.2, 7.5, 5.1, 7.5, 7.5, 2.1, 7.5, 6, 7.5, 7.5, 3.8, 7.5];
  const pos = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.11, x = cx + Math.cos(a) * (RAD - 1.4), z = cz + Math.sin(a) * (RAD - 1.4);
    if (pathDist(x, z) < 2.2) { pos.push(null); continue; }
    B.pillar(x, z, H[i], 0.62, top);
    pos.push({ x, z, h: H[i] });
  }
  for (let i = 0; i < n; i++) {
    const p = pos[i], q = pos[(i + 1) % n];
    if (!p || !q || p.h < 7 || q.h < 7) continue;
    const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2, len = Math.hypot(q.x - p.x, q.z - p.z) + 1.4;
    B.box(mx, top + 7.35, mz, len, 0.9, 1.3, Math.atan2(-(q.z - p.z), q.x - p.x), [0.72, 0.7, 0.63]);
  }
  // the altar: a low octagonal dais and a broken obelisk (cover in the middle of the fight)
  const dais = new THREE.CylinderGeometry(3.4, 3.8, 0.7, 8); dais.translate(cx, top + 0.35, cz); B.addStone(dais, [0.66, 0.63, 0.57]);
  world.addCyl(cx, cz, 3.6, top - 0.5, top + 0.7);
  B.pillar(cx, cz, 4.6, 0.95, top + 0.7);
  // fallen drums scattered on the floor
  for (let k = 0; k < 4; k++) {
    const a = R(0, 6.28), d = R(6, 11), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (pathDist(x, z) < 2) continue;
    fallenColumn(B, world, x, z, R(2.2, 3.6), R(0, 6.28), top);
  }
}
function fallenColumn(B, world, x, z, len, rot, base = groundH(x, z)) {
  const g = new THREE.CylinderGeometry(0.58, 0.62, len, 10, 2); g.rotateZ(Math.PI / 2); g.rotateY(rot); g.translate(x, base + 0.5, z);
  B.addStone(g, [0.68, 0.65, 0.58]);
  world.addBox(x, z, len / 2, 0.6, -rot, base - 0.5, base + 1.05);
  B.avoid.push({ x, z, r: len * 0.6 });
}
function arch(B, world, x, z, rot, h = 6.5, span = 5.2) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const ax = x - c * span / 2, az = z + s * span / 2, bx = x + c * span / 2, bz = z - s * span / 2;
  const base = Math.min(groundH(ax, az), groundH(bx, bz));
  B.pillar(ax, az, h, 0.7, base); B.pillar(bx, bz, h, 0.7, base);
  B.box(x, base + h - 0.15, z, span + 1.8, 1.1, 1.5, rot, [0.72, 0.7, 0.63]);
  // a keystone sitting proud on top
  B.box(x, base + h + 0.95, z, 1.0, 0.6, 1.6, rot, [0.66, 0.63, 0.57], false);
}
function wall(B, x, z, rot, len, h) {
  // a ruined wall run with a window gap and a crumbling top
  const segs = Math.max(2, Math.round(len / 2.2)), c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < segs; i++) {
    const u = (i + 0.5) / segs - 0.5, px = x + c * u * len, pz = z - s * u * len;
    if (i === Math.floor(segs / 2) && segs > 3) { B.box(px, groundH(px, pz), pz, len / segs, h * 0.35, 1.0, rot); continue; }
    const hh = h * (0.55 + 0.45 * Math.sin(i * 1.7 + x) ** 2);
    B.box(px, groundH(px, pz) - 0.2, pz, len / segs + 0.05, hh + 0.2, 1.0, rot);
  }
}
function watchtower(B, x, z, rot) {
  // roofless square tower: four walls with a doorway, an inner stair of blocks up to the parapet
  const S = 7, H = 9, c = Math.cos(rot), s = Math.sin(rot), base = groundH(x, z) - 0.3;
  const at = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
  for (const [lx, lz, sx, sz] of [[0, -S / 2, S, 1], [-S / 2, 0, 1, S], [S / 2, 0, 1, S]]) { const [px, pz] = at(lx, lz); B.box(px, base, pz, sx, H, sz, rot); }
  for (const lx of [-S / 2 + 1.4, S / 2 - 1.4]) { const [px, pz] = at(lx, S / 2); B.box(px, base, pz, 2.8, H, 1, rot); }
  const [lx0, lz0] = at(0, S / 2); B.box(lx0, base + H - 2.4, lz0, 1.6, 2.4, 1, rot);
  for (let k = 0; k < 7; k++) { const [px, pz] = at(-S / 2 + 1.2, -S / 2 + 1.2 + k * 0.75); B.box(px, base, pz, 1.4, 1.1 + k * 1.15, 0.8, rot); }
}

// ---------------------------------------------------------------- stone lanterns (instanced)
function lanternGeos() {
  const stone = mergeGeometries([
    (() => { const g = new THREE.BoxGeometry(0.9, 0.3, 0.9); g.translate(0, 0.15, 0); return ni(g); })(),
    (() => { const g = new THREE.CylinderGeometry(0.16, 0.22, 1.1, 8); g.translate(0, 0.85, 0); return ni(g); })(),
    (() => { const g = new THREE.BoxGeometry(0.7, 0.14, 0.7); g.translate(0, 1.45, 0); return ni(g); })(),
    (() => { const g = new THREE.ConeGeometry(0.72, 0.5, 4); g.rotateY(Math.PI / 4); g.translate(0, 2.25, 0); return ni(g); })(),
    (() => { const g = new THREE.SphereGeometry(0.1, 6, 4); g.translate(0, 2.55, 0); return ni(g); })(),
    ...[[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]].map(([px, pz]) => { const g = new THREE.BoxGeometry(0.09, 0.5, 0.09); g.translate(px, 1.75, pz); return ni(g); }),
  ]);
  const p = stone.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { c.setRGB(0.66, 0.63, 0.56).multiplyScalar(0.85 + 0.15 * N.n2(p.getX(i) * 5, p.getY(i) * 5)); if (p.getY(i) < 0.4) c.lerp(new THREE.Color(0.34, 0.46, 0.2), 0.4); col.set([c.r, c.g, c.b], i * 3); }
  stone.setAttribute('color', new THREE.BufferAttribute(col, 3));
  stone.computeVertexNormals();
  const glow = new THREE.BoxGeometry(0.42, 0.44, 0.42); glow.translate(0, 1.75, 0);
  return { stone, glow };
}

// ---------------------------------------------------------------- bridges
function crossings() {
  const out = [];
  for (const P of [PATH, PATH2]) for (let i = 0; i < P.length - 1; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1], L = Math.hypot(bx - ax, bz - az);
    let inside = false;
    for (let s = 0; s <= L; s += 0.5) {
      const x = ax + (bx - ax) * s / L, z = az + (bz - az) * s / L, w = riverDist(x, z) < 1.5;
      if (w && !inside) out.push({ x, z, dx: (bx - ax) / L, dz: (bz - az) / L });
      inside = w;
    }
  }
  return out.filter((c, i) => out.findIndex((o) => Math.hypot(o.x - c.x, o.z - c.z) < 20) === i);
}
function bridge(B, world, c) {
  // walk along the path to where the banks are dry on both sides
  let a = 0, b = 0;
  while (a < 20 && groundH(c.x - c.dx * a, c.z - c.dz * a) < WATER_Y + 1.3) a += 0.5;
  while (b < 20 && groundH(c.x + c.dx * b, c.z + c.dz * b) < WATER_Y + 1.3) b += 0.5;
  a += 2.5; b += 2.5;
  const x0 = c.x - c.dx * a, z0 = c.z - c.dz * a, x1 = c.x + c.dx * b, z1 = c.z + c.dz * b;
  const L = a + b, rot = Math.atan2(-c.dz, c.dx);
  const y0 = groundH(x0, z0), y1 = groundH(x1, z1), rise = 1.4;
  const n = Math.ceil(L / 1.6), W = 4.4;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * u;
    const top = y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * rise;
    B.box(x, top - 0.55, z, L / n + 0.06, 0.55, W, rot, [0.7, 0.67, 0.6]);
    // parapets
    for (const sd of [-1, 1]) {
      const px = x - c.dz * sd * (W / 2 - 0.25) * -1, pz = z + c.dx * sd * (W / 2 - 0.25) * -1;
      B.box(px, top, pz, L / n + 0.06, 0.75, 0.4, rot, [0.64, 0.61, 0.55]);
    }
  }
  // the arch's piers in the water
  for (const u of [0.3, 0.7]) {
    const x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * u, top = y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * rise;
    const g = new THREE.BoxGeometry(1.4, top - (WATER_Y - 2.5), W - 0.4); g.rotateY(rot); g.translate(x, (top + WATER_Y - 2.5) / 2 - 0.55, z);
    B.addStone(g, [0.55, 0.53, 0.48]);
  }
  B.avoid.push({ x: c.x, z: c.z, r: L / 2 + 2 });
}

// ---------------------------------------------------------------- assemble
export function buildBiomes(B, world, Q = {}) {
  const group = new THREE.Group(); group.name = 'biomes';
  const ok = (x, z, r) => riverDist(x, z) > r + 6 && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r + r + 6 && Math.hypot(x - MESA.x, z - MESA.z) > MESA.r + r + 4;

  // the centre: the Sunken Colonnade
  colonnade(B, world, 0, 0);
  // ruin sites
  arch(B, world, -78, 42, 0.6); wall(B, -70, 52, 0.6, 12, 4.2); fallenColumn(B, world, -86, 34, 3.4, 1.9);
  wall(B, 96, -4, 1.4, 14, 3.6); wall(B, 104, 6, -0.2, 9, 3); fallenColumn(B, world, 90, 8, 3, 0.4); fallenColumn(B, world, 101, -12, 2.6, 2.4);
  arch(B, world, 28, 98, -0.3, 7, 5.6); arch(B, world, 38, 104, -0.3, 5.5, 5.2);
  arch(B, world, -28, -88, 1.2, 6, 5); wall(B, -18, -96, 1.2, 10, 3.2);
  watchtower(B, 142, 142, 0.5);
  watchtower(B, -150, 18, -0.3);
  wall(B, -138, 30, -0.3, 12, 3.4);

  // karst spires near the cliffs (grassy crowns, trees on top) + their colliders
  const spireParts = [];
  for (const [ang, d, h, r] of [[0.3, 172, 28, 6], [0.95, 182, 36, 7.5], [1.42, 196, 24, 5.5], [1.88, 176, 32, 6.5], [2.62, 182, 26, 5.5], [-0.42, 160, 22, 5], [3.0, 200, 30, 6]]) {
    const x = Math.cos(ang) * d, z = Math.sin(ang) * d;
    if (!ok(x, z, r)) continue;
    const g0 = groundH(x, z);
    spireParts.push(...spireGeometry(r, h, Math.floor(ang * 1000) + 7, x, z, g0 - 1.5));
    world.addCyl(x, z, r * 0.92, g0 - 2, g0 + h * 0.9);
    B.avoid.push({ x, z, r: r + 2 });
  }
  // a natural stone arch on the south-east meadow
  {
    const x = 150, z = 34, rot = 0.9, rad = 12, tube = 3.1;
    const g = new THREE.TorusGeometry(rad, tube, 10, 28, Math.PI);
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + 0.18 * N.n2(v.x * 0.25, v.y * 0.25 + v.z * 0.4); p.setXYZ(i, v.x * (1 + (k - 1) * 0.3), v.y * k, v.z * k); }
    g.rotateY(rot); g.translate(x, groundH(x, z) - 2.5, z);
    const gg = ni(g);
    const pp = gg.attributes.position, col = new Float32Array(pp.count * 3), cc = new THREE.Color();
    gg.computeVertexNormals();
    const nn = gg.attributes.normal;
    for (let i = 0; i < pp.count; i++) { cc.setRGB(0.6, 0.57, 0.5).multiplyScalar(0.8 + 0.2 * N.n2(pp.getX(i) * 0.3, pp.getY(i) * 0.3)); cc.lerp(new THREE.Color(0.32, 0.55, 0.2), smoothstep(0.6, 0.9, nn.getY(i))); col.set([cc.r, cc.g, cc.b], i * 3); }
    gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    spireParts.push(gg);
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const sd of [-1, 1]) { const fx = x + c * rad * sd, fz = z - s * rad * sd; world.addCyl(fx, fz, tube * 1.05, groundH(fx, fz) - 2, groundH(fx, fz) + 6); B.avoid.push({ x: fx, z: fz, r: tube + 2 }); }
  }
  if (spireParts.length) {
    const m = new THREE.Mesh(mergeGeometries(spireParts.map((g) => { const o = ni(g); if (!o.attributes.uv) o.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2)); return o; })),
      stylize(new THREE.MeshLambertMaterial({ vertexColors: true }), { wrap: 0.4, band: 0.12 }));
    m.castShadow = true; m.receiveShadow = true; m.name = 'spires';
    group.add(m);
  }

  // bridges where the trails cross the river
  for (const c of crossings()) bridge(B, world, c);

  // stone lanterns along the trails
  const spots = [];
  for (const P of [PATH, PATH2]) {
    let acc = 0, side = 1;
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1], L = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s < L; s += 1) {
        acc += 1;
        if (acc < 26) continue;
        const x = ax + (bx - ax) * s / L + (-(bz - az) / L) * 2.6 * side, z = az + (bz - az) * s / L + ((bx - ax) / L) * 2.6 * side;
        if (riverDist(x, z) < 8 || Math.hypot(x, z) < 20 || spots.some((p) => Math.hypot(p.x - x, p.z - z) < 10)) continue;
        spots.push({ x, z, r: R(0, 6.28) }); acc = 0; side = -side;
      }
    }
  }
  if (spots.length) {
    const { stone, glow } = lanternGeos();
    const sm = new THREE.InstancedMesh(stone, stylize(new THREE.MeshLambertMaterial({ vertexColors: true }), { wrap: 0.4 }), spots.length);
    const gm = new THREE.InstancedMesh(glow, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.1, 0.55), toneMapped: false }), spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    spots.forEach((p, i) => {
      const y = groundH(p.x, p.z) - 0.05;
      m4.compose(new THREE.Vector3(p.x, y, p.z), q.setFromAxisAngle(up, p.r), one);
      sm.setMatrixAt(i, m4); gm.setMatrixAt(i, m4);
      world.addCyl(p.x, p.z, 0.4, y - 0.5, y + 2.6);
      B.avoid.push({ x: p.x, z: p.z, r: 1 });
    });
    sm.castShadow = true; sm.receiveShadow = true;
    sm.computeBoundingSphere(); gm.computeBoundingSphere();
    group.add(sm, gm);
  }
  void Q;
  return group;
}

// pink petals carpeting the ground under the sakura (thousands of tiny instanced quads)
export function petalCarpet(centres) {
  const n = centres.length * 1400;
  const g = new THREE.PlaneGeometry(0.13, 0.09); g.rotateX(-Math.PI / 2);
  const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  let k = 0;
  for (const { x, z, r } of centres) for (let i = 0; i < 1400; i++) {
    const a = rnd() * 6.28, d = Math.pow(rnd(), 0.7) * r, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    e.set((rnd() - 0.5) * 0.4, rnd() * 6.28, (rnd() - 0.5) * 0.4);
    m4.compose(new THREE.Vector3(px, groundH(px, pz) + 0.04 + rnd() * 0.03, pz), q.setFromEuler(e), new THREE.Vector3(1, 1, 1).multiplyScalar(0.7 + rnd() * 0.8));
    m.setMatrixAt(k, m4);
    m.setColorAt(k, c.setRGB(1, 0.74 + rnd() * 0.12, 0.84 + rnd() * 0.1));
    k++;
  }
  m.receiveShadow = true; m.computeBoundingSphere(); m.name = 'petals';
  return m;
}
