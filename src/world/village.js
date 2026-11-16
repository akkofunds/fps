import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { groundH, terrainNoise as N } from './terrain.js';
import { mulberry32 } from './noise.js';
import { stylize } from './stylize.js';

// Hillside hamlet on the ridge around the meadow: timber-framed cottages with tiled roofs,
// windmills with turning sails, fences and hay bales, plus flocks of birds wheeling overhead.
// Pure scenery (outside the play area): merged into one mesh + one instanced sail mesh + one
// instanced bird mesh, so it costs three draw calls.

const polar = (a, r) => [Math.cos(a) * r, Math.sin(a) * r];
export const WINDMILLS = [[0.55, 104], [3.75, 108], [2.15, 112]].map(([a, r]) => polar(a, r));
export const COTTAGES = [
  [0.38, 100], [0.72, 99], [0.6, 113], [3.55, 102], [3.95, 101], [3.7, 117], [2.0, 106], [2.32, 104],
  [5.2, 100], [5.45, 104], [1.35, 103], [4.6, 104],
].map(([a, r]) => polar(a, r));
export const VILLAGE_FOOTPRINTS = [
  ...WINDMILLS.map(([x, z]) => ({ x, z, r: 6.5 })),
  ...COTTAGES.map(([x, z]) => ({ x, z, r: 5.5 })),
];

const C = (r, g, b) => new THREE.Color(r, g, b);
const PLASTER = C(0.95, 0.9, 0.8), TIMBER = C(0.33, 0.22, 0.14), STONE = C(0.6, 0.58, 0.53), GLASS = C(0.98, 0.84, 0.48);
const ROOFS = [C(0.78, 0.3, 0.2), C(0.28, 0.42, 0.66), C(0.72, 0.42, 0.18), C(0.25, 0.52, 0.5), C(0.62, 0.22, 0.24)];

function paint(g, col, vary = 0.06, seed = 1) {
  g = g.index ? g.toNonIndexed() : g;
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (N.n2(p.getX(i) * 0.9 + seed, p.getZ(i) * 0.9 + p.getY(i) * 0.5) - 0.5) * vary;
    c[i * 3] = col.r * k; c[i * 3 + 1] = col.g * k; c[i * 3 + 2] = col.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
}
// gable roof: ridge along x, width w (x), depth d (z), height h
function roofGeo(w, d, h) {
  const x = w / 2, z = d / 2;
  const v = [
    // slopes
    -x, 0, z, x, 0, z, x, h, 0, -x, 0, z, x, h, 0, -x, h, 0,
    x, 0, -z, -x, 0, -z, -x, h, 0, x, 0, -z, -x, h, 0, x, h, 0,
    // gables
    -x, 0, -z, -x, 0, z, -x, h, 0, x, 0, z, x, 0, -z, x, h, 0,
    // underside
    -x, 0, -z, x, 0, -z, x, 0, z, -x, 0, -z, x, 0, z, -x, 0, z,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
const box = (w, h, d, x, y, z, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateY(ry); g.translate(x, y, z); return g; };

// Swiss chalet: whitewashed stone ground floor, warm timber upper floor, a wide low roof with a
// deep overhang, a front balcony with red geranium boxes and green shutters.
const WOOD = C(0.52, 0.31, 0.16), WOOD_D = C(0.36, 0.2, 0.1), SHUTTER = C(0.16, 0.42, 0.24), GERANIUM = C(0.92, 0.1, 0.12), LEAF = C(0.2, 0.45, 0.14);
const CHALET_ROOFS = [C(0.34, 0.22, 0.15), C(0.36, 0.35, 0.36), C(0.46, 0.27, 0.16), C(0.3, 0.3, 0.32)];
function cottage(rnd, parts) {
  const w = 5 + rnd() * 1.6, d = 4.2 + rnd() * 1.0, h1 = 2.4, h2 = 2.3;
  const H = h1 + h2;
  const roof = CHALET_ROOFS[Math.floor(rnd() * CHALET_ROOFS.length)];
  parts.push(paint(box(w + 0.3, 2.4, d + 0.3, 0, -0.9, 0), STONE, 0.18));
  parts.push(paint(box(w, h1, d, 0, h1 / 2 + 0.3, 0), PLASTER, 0.04));
  parts.push(paint(box(w + 0.06, h2, d + 0.06, 0, h1 + h2 / 2 + 0.3, 0), WOOD, 0.08));
  // horizontal plank lines on the timber floor
  for (let k = 1; k < 5; k++) parts.push(paint(box(w + 0.1, 0.05, d + 0.1, 0, h1 + 0.3 + k * (h2 / 5), 0), WOOD_D));
  // door + windows with shutters (front), side windows
  parts.push(paint(box(1.0, 1.9, 0.08, -w * 0.18, 1.25, d / 2 + 0.03), WOOD_D));
  const win = (x, y, z, face) => {
    const g = box(0.75, 0.8, 0.06, 0, 0, 0); g.rotateY(face); g.translate(x, y, z); parts.push(paint(g, GLASS, 0.02));
    for (const sx of [-1, 1]) { const sh = box(0.36, 0.84, 0.05, sx * 0.58, 0, 0.02); sh.rotateY(face); sh.translate(x, y, z); parts.push(paint(sh, SHUTTER, 0.05)); }
  };
  win(w * 0.22, 1.5, d / 2 + 0.05, 0);
  win(-w * 0.22, h1 + 1.35, d / 2 + 0.06, 0); win(w * 0.22, h1 + 1.35, d / 2 + 0.06, 0);
  win(w / 2 + 0.05, 1.5, 0, Math.PI / 2); win(-w / 2 - 0.05, h1 + 1.35, 0, -Math.PI / 2);
  // balcony with railing and geranium boxes
  const by = h1 + 0.3;
  parts.push(paint(box(w * 0.85, 0.12, 1.0, 0, by, d / 2 + 0.5), WOOD_D));
  for (let k = 0; k <= 8; k++) parts.push(paint(box(0.06, 0.8, 0.06, -w * 0.42 + (k / 8) * w * 0.84, by + 0.45, d / 2 + 0.97), WOOD));
  parts.push(paint(box(w * 0.86, 0.08, 0.1, 0, by + 0.86, d / 2 + 0.97), WOOD_D));
  parts.push(paint(box(w * 0.8, 0.22, 0.2, 0, by + 0.98, d / 2 + 1.02), WOOD_D));
  for (let k = 0; k < 9; k++) { const f = new THREE.IcosahedronGeometry(0.17 + rnd() * 0.06, 0); f.translate(-w * 0.38 + (k / 8) * w * 0.76, by + 1.16, d / 2 + 1.04); parts.push(paint(f, k % 3 === 2 ? LEAF : GERANIUM, 0.15)); }
  // window box on the ground floor too
  parts.push(paint(box(1.0, 0.18, 0.22, w * 0.22, 1.05, d / 2 + 0.14), WOOD_D));
  for (let k = 0; k < 4; k++) { const f = new THREE.IcosahedronGeometry(0.15, 0); f.translate(w * 0.22 - 0.36 + k * 0.24, 1.2, d / 2 + 0.16); parts.push(paint(f, k % 2 ? LEAF : GERANIUM, 0.15)); }
  // wide low roof with a deep overhang + carved gable board
  const r = roofGeo(d + 2.6, w + 2.4, 1.5 + rnd() * 0.3); r.rotateY(Math.PI / 2); r.translate(0, H + 0.3, 0);
  parts.push(paint(r, roof, 0.1, rnd() * 50));
  parts.push(paint(box(0.5, 1.6, 0.5, w * 0.25, H + 1.1, -d * 0.2), STONE, 0.12));
  // firewood stacked against the side wall
  parts.push(paint(box(0.6, 1.2, d * 0.7, -w / 2 - 0.35, 0.9, 0), WOOD_D, 0.25));
  return { w, d };
}

// Swiss cow (brown-and-white Simmental style) with a bell; built in local space, grazing pose
function cow(rnd, parts) {
  const WHITE = C(0.93, 0.9, 0.84), BROWN = C(0.55, 0.28, 0.13), HOOF = C(0.15, 0.12, 0.1), HORN = C(0.9, 0.86, 0.72), BELL = C(0.95, 0.75, 0.25);
  const body = paint(box(0.9, 0.85, 1.9, 0, 1.05, 0), WHITE, 0.05);
  // brown patches: recolor vertices by noise
  const cb = body.attributes.color, pb = body.attributes.position;
  const seed = rnd() * 40;
  for (let i = 0; i < pb.count; i++) if (N.n2(pb.getX(i) * 2.2 + seed, pb.getZ(i) * 1.6 + pb.getY(i)) > 0.5) cb.setXYZ(i, BROWN.r, BROWN.g, BROWN.b);
  parts.push(body);
  for (const [lx, lz] of [[-0.3, 0.7], [0.3, 0.7], [-0.3, -0.7], [0.3, -0.7]]) { parts.push(paint(box(0.18, 0.7, 0.18, lx, 0.35, lz), WHITE)); parts.push(paint(box(0.2, 0.1, 0.2, lx, 0.05, lz), HOOF)); }
  // head lowered to graze
  const head = box(0.5, 0.5, 0.75, 0, 0, 0); head.rotateX(0.7); head.translate(0, 0.72, 1.18); parts.push(paint(head, BROWN, 0.1));
  const muzzle = box(0.42, 0.3, 0.25, 0, 0, 0); muzzle.rotateX(0.7); muzzle.translate(0, 0.42, 1.48); parts.push(paint(muzzle, C(0.92, 0.78, 0.72)));
  for (const sx of [-1, 1]) { const h = new THREE.ConeGeometry(0.05, 0.28, 5); h.rotateZ(-sx * 1.1); h.translate(sx * 0.3, 1.0, 1.0); parts.push(paint(h, HORN)); }
  const bell = new THREE.CylinderGeometry(0.08, 0.13, 0.2, 6); bell.translate(0, 0.62, 0.92); parts.push(paint(bell, BELL));
  const tail = box(0.06, 0.7, 0.06, 0, 0.85, -0.98); parts.push(paint(tail, WHITE));
}

function windmill(parts) {
  const t = new THREE.CylinderGeometry(1.5, 2.3, 8.5, 10, 3); t.translate(0, 4.25, 0);
  parts.push(paint(t, PLASTER, 0.06));
  const base = new THREE.CylinderGeometry(2.5, 2.7, 2.2, 10); base.translate(0, -0.6, 0);
  parts.push(paint(base, STONE, 0.18));
  for (const y of [2.7, 5.6]) { const b = new THREE.CylinderGeometry(1.5 + (8.5 - y) * 0.094 + 0.06, 1.5 + (8.5 - y) * 0.094 + 0.1, 0.22, 10); b.translate(0, y, 0); parts.push(paint(b, TIMBER)); }
  const cap = new THREE.ConeGeometry(2.05, 2.6, 10); cap.translate(0, 9.8, 0);
  parts.push(paint(cap, ROOFS[0], 0.1));
  parts.push(paint(box(0.9, 1.7, 0.1, 0, 1.0, 2.15), TIMBER));
  parts.push(paint(box(0.6, 0.6, 0.1, 0, 5.2, 1.72), GLASS, 0.02));
  parts.push(paint(box(0.5, 0.5, 1.0, 0, 8.4, 1.7), TIMBER)); // axle housing
}

function sailGeometry() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const arm = new THREE.BoxGeometry(0.22, 6.2, 0.16); arm.translate(0, 3.1, 0);
    const sail = new THREE.BoxGeometry(1.15, 4.6, 0.05); sail.translate(0.72, 3.9, 0.04);
    const slats = [];
    for (let k = 0; k < 6; k++) slats.push(paint(box(1.2, 0.07, 0.09, 0.72, 1.8 + k * 0.85, 0.08), TIMBER));
    for (const g of [arm, sail]) g.rotateZ(a);
    for (const g of slats) g.rotateZ(a);
    parts.push(paint(arm, TIMBER), paint(sail, C(0.94, 0.9, 0.82), 0.04), ...slats);
  }
  const hub = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 8); hub.rotateX(Math.PI / 2);
  parts.push(paint(hub, TIMBER));
  return mergeGeometries(parts);
}

function fence(len, parts) {
  const n = Math.max(2, Math.round(len / 1.6));
  for (let i = 0; i <= n; i++) parts.push(paint(box(0.12, 1.1, 0.12, -len / 2 + (i / n) * len, 0.45, 0), TIMBER));
  for (const y of [0.45, 0.85]) parts.push(paint(box(len, 0.08, 0.06, 0, y, 0), TIMBER));
}

// ground height under a footprint (lowest corner so nothing floats)
function baseY(x, z, r) {
  let y = Infinity;
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; y = Math.min(y, groundH(x + Math.cos(a) * r, z + Math.sin(a) * r)); }
  return Math.min(y, groundH(x, z));
}

export function buildVillage() {
  const rnd = mulberry32(808);
  const root = new THREE.Group(); root.name = 'village';
  const world = [];
  const place = (parts, x, y, z, ry) => { for (const g of parts) { g.rotateY(ry); g.translate(x, y, z); world.push(g); } };
  const face = (x, z) => Math.atan2(-x, -z); // local +z toward the arena

  const hubs = [];
  for (const [x, z] of WINDMILLS) {
    const parts = [];
    windmill(parts);
    const ry = face(x, z), y = baseY(x, z, 2.4) + 0.2;
    place(parts, x, y, z, ry);
    hubs.push({ p: new THREE.Vector3(x, y + 8.4, z).add(new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(2.3)), ry, spin: 0.55 + rnd() * 0.35, phase: rnd() * 6 });
  }
  for (const [x, z] of COTTAGES) {
    const parts = [];
    const { w, d } = cottage(rnd, parts);
    // fence + hay along the front garden
    if (rnd() < 0.7) { const f = []; fence(w + 3, f); for (const g of f) g.translate(0, 0, d / 2 + 2.6); parts.push(...f); }
    if (rnd() < 0.6) for (let k = 0; k < 2; k++) { const h = new THREE.CylinderGeometry(0.55, 0.55, 1.0, 10); h.rotateZ(Math.PI / 2); h.translate(w / 2 + 1.2, 0.5, -0.6 + k * 1.2); parts.push(paint(h, C(0.86, 0.72, 0.36), 0.1)); }
    const ry = face(x, z) + (rnd() - 0.5) * 0.9;
    place(parts, x, baseY(x, z, Math.max(w, d) * 0.6) - 0.05, z, ry);
  }
  // grazing cows scattered on the alpine meadows around the hamlets
  for (let i = 0; i < 9; i++) {
    const [hx, hz] = COTTAGES[Math.floor(rnd() * COTTAGES.length)];
    const a = rnd() * Math.PI * 2, r = 9 + rnd() * 7;
    const x = hx + Math.cos(a) * r, z = hz + Math.sin(a) * r;
    if (Math.hypot(x, z) < 92) continue;
    const parts = [];
    cow(rnd, parts);
    place(parts, x, baseY(x, z, 1.0) + 0.02, z, rnd() * Math.PI * 2);
  }
  const g = mergeGeometries(world);
  g.computeBoundingSphere();
  const mat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { wrap: 0.35, band: 0.14 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'hamlet';
  root.add(mesh);

  // sails (instanced; rotation updated per frame)
  const sails = new THREE.InstancedMesh(sailGeometry(), mat, hubs.length);
  sails.frustumCulled = false;
  root.add(sails);

  // birds: V-shaped gliders that flap now and then, circling in loose flocks
  const birds = buildBirds();
  root.add(birds.mesh);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qz = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);
  root.userData.update = (t) => {
    hubs.forEach((h, i) => {
      q.setFromAxisAngle(Y, h.ry).multiply(qz.setFromAxisAngle(Z, t * h.spin + h.phase));
      m4.compose(h.p, q, one); sails.setMatrixAt(i, m4);
    });
    sails.instanceMatrix.needsUpdate = true;
    birds.update(t);
  };
  return root;
}

function buildBirds() {
  // body + two wings; the wing tips carry a "flap" weight in the color.r channel
  const v = [
    0, 0, 0.45, -0.12, 0, -0.35, 0.12, 0, -0.35, // body
    0, 0, 0.2, 0, 0, -0.2, -1.0, 0.0, -0.15, // left wing
    0, 0, 0.2, 1.0, 0.0, -0.15, 0, 0, -0.2, // right wing
  ];
  const flap = [0, 0, 0, 0, 0, 1, 0, 1, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('flap', new THREE.Float32BufferAttribute(flap, 1));
  const mat = new THREE.MeshBasicMaterial({ color: 0x232a33, side: THREE.DoubleSide, fog: true });
  const uT = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uT = uT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float flap; uniform float uT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
        float beat = sin(uT * 9.0 + ph) * smoothstep(0.2, 0.7, sin(uT * 0.6 + ph * 3.0));
        transformed.y += flap * (beat * 0.55 + 0.12);`);
  };
  const flocks = [
    { c: [20, 55, -40], r: 70, n: 7, s: 0.12, h: 0 },
    { c: [-60, 62, 30], r: 55, n: 6, s: -0.1, h: 2 },
    { c: [80, 70, 60], r: 90, n: 8, s: 0.08, h: 4 },
  ];
  const total = flocks.reduce((a, f) => a + f.n, 0);
  const mesh = new THREE.InstancedMesh(g, mat, total);
  mesh.frustumCulled = false;
  mesh.name = 'birds';
  const rnd = mulberry32(77);
  const offs = flocks.map((f) => Array.from({ length: f.n }, (_, i) => [(-Math.floor((i + 1) / 2)) * 1.6 * (i % 2 ? 1 : -1) * 0 + (rnd() - 0.5) * 6, (rnd() - 0.5) * 3, -Math.floor((i + 1) / 2) * 2.2 + (rnd() - 0.5) * 2, (i % 2 ? 1 : -1) * Math.floor((i + 1) / 2) * 2.0]));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1.6, 1.6, 1.6), Y = new THREE.Vector3(0, 1, 0), roll = new THREE.Quaternion(), Zax = new THREE.Vector3(0, 0, 1);
  return {
    mesh,
    update(t) {
      uT.value = t;
      let k = 0;
      flocks.forEach((f, fi) => {
        const a = t * f.s + f.h;
        const dir = Math.sign(f.s);
        const cx = f.c[0] + Math.cos(a) * f.r, cz = f.c[2] + Math.sin(a) * f.r, cy = f.c[1] + Math.sin(t * 0.3 + fi) * 4;
        // heading = tangent of the circle
        const yaw = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir);
        const ca = Math.cos(yaw), sa = Math.sin(yaw);
        for (const [ox, oy, oz, side] of offs[fi]) {
          // V formation in the flock's local frame (x right, z forward)
          const lx = side + ox * 0.3, lz = oz;
          p.set(cx + lx * ca + lz * sa, cy + oy, cz - lx * sa + lz * ca);
          q.setFromAxisAngle(Y, yaw).multiply(roll.setFromAxisAngle(Zax, -dir * 0.25));
          m4.compose(p, q, s); mesh.setMatrixAt(k++, m4);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
