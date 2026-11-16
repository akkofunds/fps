import * as THREE from 'three';
import { makeNoise, smoothstep } from './noise.js';
import { stylize } from './stylize.js';

// Sunvale Meadow heightfield: gentle rolling meadow inside a ring of grassy hills, a shallow
// lake, a hill with a ruined watchtower and a flattened stone plaza in the middle.
// One function H(x, z) drives the mesh, collision, grass placement and foot IK.

const N = makeNoise(7331);
export const PLAY_RADIUS = 66;
export const LAKE = { x: -30, z: 22, r: 14 };
export const HILL = { x: 31, z: -25, r: 12, h: 4.4 };
export const PLAZA = { x: 0, z: 0, r: 10.5 };
// meandering dirt trail (polyline)
export const PATH = [[-70, -40], [-46, -30], [-24, -18], [-9, -6], [0, 0], [10, 8], [20, 14], [34, 18], [52, 30], [72, 40]];
export const PATH2 = [[0, 0], [8, -10], [18, -18], [26, -22]];

function distToPolyline(x, z, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const ex = ax + dx * t - x, ez = az + dz * t - z;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
export function pathDist(x, z) { return Math.min(distToPolyline(x, z, PATH), distToPolyline(x, z, PATH2)); }

function baseH(x, z) {
  return 1.5 * N.fbm(x / 46, z / 46, 4) + 0.45 * N.fbm(x / 13 + 7, z / 13 - 3, 2);
}
const PLAZA_H = baseH(0, 0) + 0.1;
const LAKE_BASE = baseH(LAKE.x, LAKE.z);
export const WATER_Y = LAKE_BASE - 0.5;
export function lakeWaterDepth(x, z) {
  if (Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r + 8) return 0;
  return Math.max(0, WATER_Y - groundH(x, z));
}

export function H(x, z) {
  const r = Math.hypot(x, z);
  let h = baseH(x, z);
  // watchtower hill
  const dh2 = (x - HILL.x) ** 2 + (z - HILL.z) ** 2;
  h += HILL.h * Math.exp(-dh2 / (2 * HILL.r * HILL.r));
  // lake bowl (shallow: wadeable)
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z) + N.n2(x / 9, z / 9) * 2.2;
  h = h + (LAKE_BASE - h) * smoothstep(LAKE.r + 6, LAKE.r - 2, dl) - 1.25 * smoothstep(LAKE.r + 1, LAKE.r - 7, dl);
  // plaza flattening
  h += (PLAZA_H - h) * smoothstep(PLAZA.r + 5, PLAZA.r, r);
  // trail is slightly worn into the grass
  const pd = pathDist(x, z);
  h -= 0.12 * smoothstep(2.2, 0.4, pd);
  // ring of hills
  const ang = Math.atan2(z, x);
  const rimH = 15 + 9 * N.fbm(Math.cos(ang) * 2.1 + 11, Math.sin(ang) * 2.1 - 5, 3) + 6 * N.fbm(x / 30, z / 30, 3);
  h += smoothstep(PLAY_RADIUS - 6, PLAY_RADIUS + 34, r) * rimH;
  h += smoothstep(PLAY_RADIUS + 40, 260, r) * 26 * (0.6 + 0.4 * N.fbm(x / 70, z / 70, 3));
  return h;
}

// ---------------------------------------------------------------- collision heightfield (fast)
const HF_HALF = 110, HF_STEP = 1;
const HF_N = HF_HALF * 2 / HF_STEP + 1;
let HF = null;
function buildHF() {
  HF = new Float32Array(HF_N * HF_N);
  for (let j = 0; j < HF_N; j++) for (let i = 0; i < HF_N; i++) HF[j * HF_N + i] = H(-HF_HALF + i * HF_STEP, -HF_HALF + j * HF_STEP);
}
export function groundH(x, z) {
  if (!HF) buildHF();
  const fx = (x + HF_HALF) / HF_STEP, fz = (z + HF_HALF) / HF_STEP;
  if (fx < 0 || fz < 0 || fx >= HF_N - 1 || fz >= HF_N - 1) return H(x, z);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = HF[j * HF_N + i], b = HF[j * HF_N + i + 1], c = HF[(j + 1) * HF_N + i], d = HF[(j + 1) * HF_N + i + 1];
  // match the mesh triangulation (diagonal from (i+1, j) to (i, j+1))
  if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
  return d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
export function groundNormal(x, z, out) {
  const e = 0.6;
  return out.set(groundH(x - e, z) - groundH(x + e, z), 2 * e, groundH(x, z - e) - groundH(x, z + e)).normalize();
}

// ---------------------------------------------------------------- mesh
function axisCoords(step = HF_STEP) {
  const xs = [];
  for (let i = -HF_HALF; i <= HF_HALF; i += step) xs.push(i);
  let s = step, x = HF_HALF;
  const outer = [];
  while (x < 900) { s *= 1.16; x += s; outer.push(x); }
  return [...outer.map((v) => -v).reverse(), ...xs, ...outer];
}

function detailTexture() {
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const n = makeNoise(99);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // mirrored-repeat wrapping makes this seamless without torus tricks
    const v = 0.5 * n.fbm(x / 80, y / 80, 4) + 0.3 * n.n2(x / 12, y / 12) + 0.2 * n.n2(x / 3, y / 3);
    const k = 205 + v * 50 + (Math.random() - 0.5) * 16;
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, k)); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  return t;
}

export function grassColorAt(x, z, out) {
  // shared palette for the ground and grass blades
  const n1 = N.fbm(x / 23 + 40, z / 23, 3), n2 = N.n2(x / 7, z / 7);
  const lush = new THREE.Color(0.2, 0.42, 0.09), fresh = new THREE.Color(0.38, 0.58, 0.14), dry = new THREE.Color(0.62, 0.6, 0.24);
  out.copy(lush).lerp(fresh, smoothstep(-0.4, 0.5, n1 + n2 * 0.25));
  out.lerp(dry, smoothstep(0.25, 0.75, N.fbm(x / 40 - 30, z / 40 + 12, 2)) * 0.7);
  return out;
}

export function buildTerrain(step = 1) {
  const xs = axisCoords(step);
  const nx = xs.length;
  const pos = new Float32Array(nx * nx * 3), col = new Float32Array(nx * nx * 3), uv = new Float32Array(nx * nx * 2);
  const c = new THREE.Color(), tmp = new THREE.Color(), nrm = new THREE.Vector3();
  const dirt = new THREE.Color(0.5, 0.4, 0.26), sand = new THREE.Color(0.66, 0.6, 0.42), mud = new THREE.Color(0.3, 0.3, 0.2), rock = new THREE.Color(0.45, 0.46, 0.42);
  const hillDark = new THREE.Color(0.16, 0.33, 0.1);
  for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) {
    const x = xs[i], z = xs[j];
    const inner = Math.abs(x) <= HF_HALF && Math.abs(z) <= HF_HALF;
    const h = inner ? groundH(x, z) : H(x, z);
    const k = j * nx + i;
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    uv[k * 2] = x / 3.2; uv[k * 2 + 1] = z / 3.2;
    grassColorAt(x, z, c);
    const r = Math.hypot(x, z);
    c.lerp(hillDark, smoothstep(PLAY_RADIUS, PLAY_RADIUS + 60, r) * 0.6);
    // slope → exposed rock
    if (inner) groundNormal(x, z, nrm); else nrm.set(0, 1, 0);
    c.lerp(rock, smoothstep(0.86, 0.7, nrm.y));
    // trail
    const pd = pathDist(x, z);
    c.lerp(tmp.copy(dirt).multiplyScalar(0.9 + 0.2 * N.n2(x / 3, z / 3)), smoothstep(2.4, 0.6, pd + N.n2(x / 2.5, z / 2.5) * 0.5));
    // lake shore
    const dw = h - WATER_Y;
    const nearLake = smoothstep(LAKE.r + 12, LAKE.r + 6, Math.hypot(x - LAKE.x, z - LAKE.z));
    c.lerp(sand, smoothstep(0.55, 0.12, dw) * nearLake); c.lerp(mud, smoothstep(-0.05, -0.6, dw) * nearLake);
    // plaza dirt under the stones
    c.lerp(dirt, smoothstep(PLAZA.r + 2.5, PLAZA.r + 0.5, r) * 0.7);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const idx = new Uint32Array((nx - 1) * (nx - 1) * 6);
  let p = 0;
  for (let j = 0; j < nx - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
    idx[p++] = a; idx[p++] = cc; idx[p++] = b;
    idx[p++] = b; idx[p++] = cc; idx[p++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  const mat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTexture() }), { wrap: 0.35, band: 0.1 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

export { N as terrainNoise };
