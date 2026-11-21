import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundH, riverDist, LAKE, PATH, PATH2, WATER_Y, MESA, terrainNoise as N } from './terrain.js';
import { mulberry32, smoothstep } from './noise.js';
import { stylize } from './stylize.js';
import { mesaGeometry } from './scenery.js';

// Points of interest inside the valley (reference painting):
//   - flat carved stone circles: the big one in the centre, a smaller one up the river
//   - Roman ruin arches (some broken), low broken walls, fallen columns
//   - low rock ledges with grassy tops near the cliffs
//   - arched stone bridges over the river (one right below the falls)
// Stone goes through the props Builder (merged, textured, collision registered).

const rnd = mulberry32(4242);
const R = (a, b) => a + rnd() * (b - a);
const ni = (g) => (g.index ? g.toNonIndexed() : g);

function maxGround(x, z, r) {
  let hi = -1e9, lo = 1e9;
  for (let i = 0; i < 16; i++) for (const k of [0.35, 0.7, 1]) { const a = (i / 16) * Math.PI * 2, h = groundH(x + Math.cos(a) * r * k, z + Math.sin(a) * r * k); hi = Math.max(hi, h); lo = Math.min(lo, h); }
  return [lo, Math.max(hi, groundH(x, z))];
}

// ---------------------------------------------------------------- ruins
function engravedTexture() {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), C = S / 2, r = mulberry32(99);
  g.fillStyle = '#b8b0b4'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) { const v = 140 + r() * 70; g.fillStyle = `rgba(${v},${v - 6},${v},${0.18 + r() * 0.2})`; g.fillRect(r() * S, r() * S, 2 + r() * 6, 2 + r() * 6); }
  // slab joints radiating out
  g.strokeStyle = 'rgba(70,64,70,0.55)'; g.lineWidth = 3;
  for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; g.beginPath(); g.moveTo(C + Math.cos(a) * 140, C + Math.sin(a) * 140); g.lineTo(C + Math.cos(a) * 510, C + Math.sin(a) * 510); g.stroke(); }
  // carved rings (dark groove + light lip)
  const ring = (rad, w) => { g.lineWidth = w; g.strokeStyle = 'rgba(60,54,62,0.85)'; g.beginPath(); g.arc(C, C, rad, 0, 7); g.stroke(); g.lineWidth = w * 0.45; g.strokeStyle = 'rgba(240,232,236,0.5)'; g.beginPath(); g.arc(C, C, rad + w * 0.8, 0, 7); g.stroke(); };
  for (const [rad, w] of [[500, 8], [430, 5], [330, 7], [250, 4], [140, 7], [70, 5]]) ring(rad, w);
  // runes in the outer band
  g.fillStyle = 'rgba(60,54,62,0.85)';
  for (let k = 0; k < 40; k++) {
    const a = k / 40 * Math.PI * 2; g.save(); g.translate(C + Math.cos(a) * 465, C + Math.sin(a) * 465); g.rotate(a + Math.PI / 2);
    for (let s = 0; s < 3; s++) g.fillRect(-9 + r() * 12, -14 + s * 10, 3 + r() * 10, 3);
    g.fillRect(-2, -16, 3, 30);
    g.restore();
  }
  // the compass star between the inner rings
  g.strokeStyle = 'rgba(60,54,62,0.8)'; g.lineWidth = 5;
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, b = a + Math.PI / 8; g.beginPath(); g.moveTo(C + Math.cos(a) * 320, C + Math.sin(a) * 320); g.lineTo(C + Math.cos(b) * 150, C + Math.sin(b) * 150); g.lineTo(C + Math.cos(a + Math.PI / 4) * 320, C + Math.sin(a + Math.PI / 4) * 320); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function engravedDisc(B, world, cx, cz, RAD) {
  // the reference's circle: a flat round platform of carved stone, barely raised off the meadow,
  // with a low step round it (no pillars, nothing blocking the view)
  const [lo, hi] = maxGround(cx, cz, RAD);
  const top = hi + 0.12;
  const floor = new THREE.CylinderGeometry(RAD, RAD + 0.3, top - lo + 1.2, 48, 1); floor.translate(cx, (top + lo - 1.2) / 2, cz);
  B.addStone(floor, [0.7, 0.67, 0.6]);
  const step = new THREE.CylinderGeometry(RAD + 1.1, RAD + 1.5, 0.35, 48, 1); step.translate(cx, top - 0.5, cz);
  B.addStone(step, [0.6, 0.58, 0.52]);
  world.addCyl(cx, cz, RAD, lo - 1.2, top);
  world.addCyl(cx, cz, RAD + 1.3, lo - 1.2, top - 0.33);
  B.avoid.push({ x: cx, z: cz, r: RAD + 2.5 });
  if (!ENGRAVED) ENGRAVED = stylize(new THREE.MeshLambertMaterial({ map: engravedTexture() }), { wrap: 0.35 });
  const face = new THREE.Mesh(new THREE.CircleGeometry(RAD - 0.05, 72), ENGRAVED);
  face.rotation.x = -Math.PI / 2; face.position.set(cx, top + 0.015, cz); face.receiveShadow = true; face.name = 'engraved';
  B.extra = (B.extra || []).concat([face]);
}
let ENGRAVED = null;
function fallenColumn(B, world, x, z, len, rot, base = groundH(x, z)) {
  const g = new THREE.CylinderGeometry(0.58, 0.62, len, 10, 2); g.rotateZ(Math.PI / 2); g.rotateY(rot); g.translate(x, base + 0.5, z);
  B.addStone(g, [0.68, 0.65, 0.58]);
  world.addBox(x, z, len / 2, 0.6, -rot, base - 0.5, base + 1.05);
  B.avoid.push({ x, z, r: len * 0.6 });
}
function arch(B, world, x, z, rot, H = 10, span = 5, broken = false) {
  // a Roman ruin arch (reference): two square piers carrying a round arch, an entablature on top;
  // broken ones have lost a corner of their top
  const pw = 2.2, W = span + pw * 2, D = 2.2, spring = H - 1.7 - span / 2;
  const c = Math.cos(rot), s = Math.sin(rot);
  const ax = x - c * (span / 2 + pw / 2), az = z + s * (span / 2 + pw / 2), bx = x + c * (span / 2 + pw / 2), bz = z - s * (span / 2 + pw / 2);
  const base = Math.min(groundH(ax, az), groundH(bx, bz)) - 0.3;
  const sh = new THREE.Shape();
  sh.moveTo(-W / 2, 0); sh.lineTo(-span / 2, 0); sh.lineTo(-span / 2, spring);
  sh.absarc(0, spring, span / 2, Math.PI, 0, true);
  sh.lineTo(span / 2, 0); sh.lineTo(W / 2, 0);
  if (broken) { sh.lineTo(W / 2, H * 0.7); sh.lineTo(W * 0.32, H * 0.78); sh.lineTo(W * 0.22, H * 0.9); sh.lineTo(W * 0.05, H * 0.93); sh.lineTo(-W * 0.12, H); }
  else sh.lineTo(W / 2, H);
  sh.lineTo(-W / 2, H); sh.lineTo(-W / 2, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: false, curveSegments: 18 });
  g.translate(0, 0, -D / 2); g.rotateY(rot); g.translate(x, base, z);
  B.addStone(g, [0.7, 0.68, 0.62]);
  const piece = (lu, y, sx, sy, sz) => { const b = new THREE.BoxGeometry(sx, sy, sz); b.translate(lu, y + sy / 2, 0); b.rotateY(rot); b.translate(x, base, z); B.addStone(b, [0.64, 0.61, 0.55]); };
  for (const sd of [-1, 1]) {
    const lu = sd * (span / 2 + pw / 2);
    piece(lu, 0, pw + 0.6, 0.9, D + 0.6);                   // plinth
    piece(lu, spring - 0.35, pw + 0.3, 0.35, D + 0.3);        // impost
  }
  if (!broken) { piece(0, H, W + 0.7, 0.55, D + 0.5); piece(0, H + 0.55, W + 0.3, 0.35, D + 0.25); } // cornice
  for (const [px, pz] of [[ax, az], [bx, bz]]) { world.addBox(px, pz, pw / 2 + 0.3, D / 2 + 0.3, -rot, base - 0.5, base + H); B.avoid.push({ x: px, z: pz, r: pw + 0.6 }); }
  world.addBox(x, z, W / 2, D / 2, -rot, base + spring, base + H + 0.9);
  // tumbled blocks at its foot
  for (let k = 0; k < 3; k++) { const a = R(0, 6.28), d = R(W * 0.55, W * 0.85), sz = R(0.7, 1.3); B.box(x + Math.cos(a) * d, groundH(x + Math.cos(a) * d, z + Math.sin(a) * d) - 0.2, z + Math.sin(a) * d, sz * 1.4, sz, sz, R(0, 3)); }
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
  // an arched stone bridge (reference): one round arch springing from the water, a humped deck,
  // parapet walls with a coping, abutments sunk into the banks
  let a = 0, b = 0;
  while (a < 24 && groundH(c.x - c.dx * a, c.z - c.dz * a) < WATER_Y + 1.3) a += 0.5;
  while (b < 24 && groundH(c.x + c.dx * b, c.z + c.dz * b) < WATER_Y + 1.3) b += 0.5;
  a += 3.5; b += 3.5;
  const x0 = c.x - c.dx * a, z0 = c.z - c.dz * a, x1 = c.x + c.dx * b, z1 = c.z + c.dz * b;
  const L = a + b, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, rot = Math.atan2(-c.dz, c.dx);
  const y0 = groundH(x0, z0) - 0.15, y1 = groundH(x1, z1) - 0.15, rise = 1.8, W = 4.4;
  const yT = (u) => { const t = u / L + 0.5; return y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * rise; };
  const Yb = WATER_Y - 2.5, S = L * 0.6, sp = WATER_Y - 0.4, archH = Math.max(1.5, yT(0) - 1.1 - sp);
  const prof = new THREE.Shape();
  prof.moveTo(-L / 2, Yb); prof.lineTo(-S / 2, Yb); prof.lineTo(-S / 2, sp);
  for (let k = 1; k < 24; k++) { const th = Math.PI - (k / 24) * Math.PI; prof.lineTo(Math.cos(th) * S / 2, sp + Math.sin(th) * archH); }
  prof.lineTo(S / 2, sp); prof.lineTo(S / 2, Yb); prof.lineTo(L / 2, Yb);
  for (let k = 0; k <= 24; k++) { const u = L / 2 - (k / 24) * L; prof.lineTo(u, yT(u)); }
  const place = (g, off) => { g.translate(0, 0, off); g.rotateY(rot); g.translate(mx, 0, mz); return g; };
  B.addStone(place(new THREE.ExtrudeGeometry(prof, { depth: W, bevelEnabled: false }), -W / 2), [0.68, 0.65, 0.58]);
  const strip = (lo, hi, inset) => {
    const sh = new THREE.Shape(); const n = 24;
    for (let k = 0; k <= n; k++) { const u = -L / 2 + inset + (k / n) * (L - inset * 2); k ? sh.lineTo(u, yT(u) + lo) : sh.moveTo(u, yT(u) + lo); }
    for (let k = n; k >= 0; k--) { const u = -L / 2 + inset + (k / n) * (L - inset * 2); sh.lineTo(u, yT(u) + hi); }
    return sh;
  };
  for (const sd of [-1, 1]) {
    B.addStone(place(new THREE.ExtrudeGeometry(strip(-0.05, 0.85, 0.6), { depth: 0.42, bevelEnabled: false }), sd * (W / 2 - 0.21) - 0.21), [0.66, 0.63, 0.57]);
    B.addStone(place(new THREE.ExtrudeGeometry(strip(0.85, 1.05, 0.45), { depth: 0.6, bevelEnabled: false }), sd * (W / 2 - 0.21) - 0.3), [0.74, 0.71, 0.64]);
    // end posts
    for (const u of [-L / 2 + 0.6, L / 2 - 0.6]) {
      const px = mx + c.dx * u + -c.dz * sd * (W / 2 - 0.21), pz = mz + c.dz * u + c.dx * sd * (W / 2 - 0.21);
      const g = new THREE.BoxGeometry(0.7, 1.5, 0.7); g.rotateY(rot); g.translate(px, yT(u) + 0.6, pz); B.addStone(g, [0.7, 0.67, 0.6]);
    }
  }
  // colliders: deck segments to walk on, parapets to keep you on it
  const n = Math.ceil(L / 1.5);
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + (i + 0.5) * L / n, px = mx + c.dx * u, pz = mz + c.dz * u, y = yT(u);
    world.addBox(px, pz, L / n / 2 + 0.05, W / 2, -rot, y - 1.2, y);
    for (const sd of [-1, 1]) world.addBox(px - c.dz * sd * (W / 2 - 0.21), pz + c.dx * sd * (W / 2 - 0.21), L / n / 2 + 0.05, 0.21, -rot, y, y + 1.05);
  }
  B.avoid.push({ x: mx, z: mz, r: L / 2 + 2 });
}

// ---------------------------------------------------------------- assemble
export function buildBiomes(B, world, Q = {}) {
  const group = new THREE.Group(); group.name = 'biomes';
  const ok = (x, z, r) => riverDist(x, z) > r + 6 && Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r + r + 6 && Math.hypot(x - MESA.x, z - MESA.z) > MESA.r + r + 4;

  // the carved stone circles: the big one in the centre, a smaller one up the river by the ruins
  engravedDisc(B, world, 0, 0, 15);
  engravedDisc(B, world, -101, -45, 9);
  // ruin sites: tall Roman arches, broken walls, fallen columns
  arch(B, world, -88, -88, -0.67, 9.5, 5);
  arch(B, world, -23, -68, -1.14, 10.5, 5.2, true);
  arch(B, world, -95, -10, -1.571, 12, 5.6, true);
  arch(B, world, -78, 42, 0.6, 9, 5); wall(B, -70, 52, 0.6, 12, 4.2); fallenColumn(B, world, -86, 34, 3.4, 1.9);
  wall(B, 96, -4, 1.4, 14, 3.6); wall(B, 104, 6, -0.2, 9, 3); fallenColumn(B, world, 90, 8, 3, 0.4); fallenColumn(B, world, 101, -12, 2.6, 2.4);
  arch(B, world, 28, 98, -0.3, 11, 5.4, true); arch(B, world, 120, -70, 2.1, 10, 5);
  wall(B, -18, -96, 1.2, 10, 3.2);
  wall(B, -138, 30, -0.3, 12, 3.4);

  // low rock ledges (layered walls, flat grassy tops) + their colliders
  const spireParts = [];
  for (const [ang, d, h, r] of [[0.3, 172, 5, 15], [0.95, 182, 6, 18], [1.88, 176, 5, 16], [2.62, 182, 4.5, 14], [3.0, 200, 6, 16], [-1.9, 105, 3.5, 12]]) {
    const x = Math.cos(ang) * d, z = Math.sin(ang) * d;
    if (!ok(x, z, r)) continue;
    const g0 = groundH(x, z);
    spireParts.push(...mesaGeometry(r, h, Math.floor(ang * 1000) + 7, x, z, g0 - 1.5));
    world.addCyl(x, z, r * 0.9, g0 - 2, g0 + h - 1.3);
    B.avoid.push({ x, z, r: r + 2 });
  }
  if (spireParts.length) {
    const m = new THREE.Mesh(mergeGeometries(spireParts.map((g) => { const o = ni(g); if (!o.attributes.uv) o.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2)); return o; })),
      stylize(new THREE.MeshLambertMaterial({ vertexColors: true }), { wrap: 0.4, band: 0.12 }));
    m.castShadow = true; m.receiveShadow = true; m.name = 'spires';
    group.add(m);
  }

  // stone bridges: one below the falls (the reference shot), one further down the river, and any
  // where a trail crosses the water
  bridge(B, world, { x: -132.2, z: -103.4, dx: 0.85, dz: 0.52 });
  bridge(B, world, { x: -209, z: 5, dx: 0.75, dz: 0.66 });
  // bridges where the trails cross the river
  for (const c of crossings()) if (Math.hypot(c.x + 132, c.z + 103) > 30 && Math.hypot(c.x + 209, c.z - 5) > 30) bridge(B, world, c);

  void Q;
  if (B.extra) for (const m of B.extra) group.add(m);
  return group;
}
