import * as THREE from 'three';
import { makeNoise, smoothstep } from './noise.js';
import { stylize } from './stylize.js';

// SUNVALE VALLEY (from the reference board): a wide, open grass meadow in a basin ringed by natural
// grey rock cliffs in two tiers (~9 m and ~17 m) with grassy tops and trees, a small round mesa on
// the east side, a two-tier waterfall in the north-west cliff and a river that winds from its pool
// east along the foot of the cliffs and south-west out of the valley; the south opens toward
// distant hills. Units are metres (a person is 1.8 m). +x = east, -z = north.
// One function H(x, z) drives the mesh, collision, grass placement and foot IK.

const N = makeNoise(7331);
export const PLAY_RADIUS = 100;
// the cliff line: distance from the meadow centre to the first cliff at a given compass angle
// (atan2(z, x): 0 = east, -π/2 = north, π/2 = south, ±π = west). Large = open.
const RIM = [[0, 92], [-0.55, 84], [-1.05, 70], [-1.57, 66], [-2.0, 72], [-2.35, 82], [-2.75, 118], [Math.PI, 150], [2.6, 104], [2.25, 92], [1.85, 150], [1.35, 150], [0.95, 104], [0.55, 96]];
function rimRadius(a) {
  const pts = RIM.map(([t, r]) => [((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), r]).sort((p, q) => p[0] - q[0]);
  let u = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  for (let i = 0; i < pts.length; i++) {
    const [t0, r0] = pts[i], [t1raw, r1] = pts[(i + 1) % pts.length];
    const t1 = i + 1 === pts.length ? t1raw + 2 * Math.PI : t1raw;
    const uu = u < t0 ? u + 2 * Math.PI : u;
    if (uu >= t0 && uu <= t1) { const k = (uu - t0) / (t1 - t0); return r0 + (r1 - r0) * (k * k * (3 - 2 * k)); }
  }
  return 100;
}
const RIM_LUT = Array.from({ length: 721 }, (_, i) => rimRadius((i / 720) * 2 * Math.PI - Math.PI));
const rimAt = (a) => { const f = ((a + Math.PI) / (2 * Math.PI)) * 720; const i = Math.max(0, Math.min(719, Math.floor(f))); return RIM_LUT[i] + (RIM_LUT[i + 1] - RIM_LUT[i]) * (f - i); };
export const CLIFF = { t1: 9, t2: 17 };

// the waterfall in the north-west cliff: the upper fall drops from the top tier onto the 9 m ledge,
// a short stream crosses the ledge and the lower fall drops into the pool
const FA = -2.33; // compass angle of the falls
export const FALLS = { x: Math.cos(FA) * rimRadius(FA), z: Math.sin(FA) * rimRadius(FA), a: FA, w: 24, d: 9, h: CLIFF.t2, mid: CLIFF.t1 };
export const LAKE = { x: Math.cos(FA) * (rimRadius(FA) - 9), z: Math.sin(FA) * (rimRadius(FA) - 9), r: 10 }; // the plunge pool
export const HILL = { x: 9999, z: 9999, r: 1, h: 0 };
export const PLAZA = { x: 0, z: 0, r: 0 };
// the river: from the pool east along the foot of the north cliffs, and south-west out of the valley
export const RIVER = [[LAKE.x + 40, LAKE.z - 2], [LAKE.x + 30, LAKE.z + 4]];
const RIVER_E = [[LAKE.x, LAKE.z], [LAKE.x + 18, LAKE.z + 4], [-14, -52], [8, -50], [26, -55], [46, -58], [66, -64], [92, -60], [140, -66], [220, -72]];
const RIVER_W = [[LAKE.x, LAKE.z], [LAKE.x - 10, LAKE.z + 16], [-74, -24], [-86, -6], [-100, 10], [-122, 22], [-150, 26], [-230, 40]];
export const RIVER_W_PTS = RIVER_W, RIVER_E_PTS = RIVER_E;
// faint dirt trails worn across the meadow
export const PATH = [[-20, 120], [-12, 70], [-4, 30], [0, 0], [6, -24], [10, -46]];
export const PATH2 = [[-70, 40], [-36, 22], [0, 0], [40, -6], [78, -2]];
// the small round mesa on the east side
export const MESA = { x: 64, z: -16, r: 11, h: 6.5 };

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
export function riverDist(x, z) { return Math.min(distToPolyline(x, z, RIVER_E), distToPolyline(x, z, RIVER_W)); }

function baseH(x, z) {
  // the meadow floor: gentle, wide undulation (never dips to the water level)
  return 0.9 * N.fbm(x / 60, z / 60, 3) + 0.25 * N.fbm(x / 14 + 7, z / 14 - 3, 2);
}
export const WATER_Y = -1.1;
export function lakeWaterDepth(x, z) { return Math.max(0, WATER_Y - groundH(x, z)); }
export const LEDGES = [];

function cliffProfile(d) {
  // d = metres beyond the cliff line → height (two tiers with near-vertical faces)
  return CLIFF.t1 * smoothstep(-0.6, 1.8, d) + (CLIFF.t2 - CLIFF.t1) * smoothstep(13, 15.4, d);
}

export function H(x, z) {
  const r = Math.hypot(x, z);
  let h = baseH(x, z) + 0.6;
  const a = Math.atan2(z, x);
  // ragged cliff line (outcrops and bays), wider noise on the upper tier
  const R = rimAt(a) + N.n2(Math.cos(a) * 9 + 3, Math.sin(a) * 9) * 5 + N.n2(x / 9, z / 9) * 1.6;
  const d = r - R;
  if (d > -3) {
    const d2 = d + N.n2(x / 13 - 4, z / 13 + 2) * 4;
    h += CLIFF.t1 * smoothstep(-0.6, 1.8, d) + (CLIFF.t2 - CLIFF.t1) * smoothstep(13, 15.4, d2);
    // grassy, gently rolling tops
    h += 1.6 * N.fbm(x / 22, z / 22, 3) * smoothstep(3, 8, d);
    // far beyond: the plateaus roll on toward the distant hills
    h += smoothstep(80, 420, d) * 30 * (0.5 + 0.5 * N.fbm(x / 110, z / 110, 4));
  }
  // the falls: a notch through both tiers where the stream runs (ledge stream + upper spill)
  const fx = x - FALLS.x, fz = z - FALLS.z;
  const out = fx * Math.cos(FALLS.a) + fz * Math.sin(FALLS.a);   // > 0 into the cliff
  const lat = -fx * Math.sin(FALLS.a) + fz * Math.cos(FALLS.a);
  if (out > -2 && out < 40 && Math.abs(lat) < 6) h -= 0.9 * smoothstep(3.2, 1.6, Math.abs(lat)) * smoothstep(-1, 3, out);
  // the small round mesa
  const dm = Math.hypot(x - MESA.x, z - MESA.z) + N.n2(x / 4, z / 4) * 1.4;
  h += MESA.h * smoothstep(MESA.r + 0.8, MESA.r - 0.8, dm) + 0.6 * N.fbm(x / 6, z / 6, 2) * smoothstep(MESA.r, MESA.r - 3, dm);
  // river channel + plunge pool (below the water level; the banks stay above it)
  const rd = riverDist(x, z);
  const rw = 3.4 + 1.2 * N.n2(x / 20, z / 20);
  const floor = WATER_Y - 0.9;
  const bank = smoothstep(rw + 2.2, rw - 0.4, rd);
  h = h + (floor - h) * bank;
  const pd2 = Math.hypot(x - LAKE.x, z - LAKE.z) + N.n2(x / 5, z / 5) * 1.5;
  h = h + (floor - 0.4 - h) * smoothstep(LAKE.r + 2.5, LAKE.r - 1, pd2);
  // trails are slightly worn into the grass
  h -= 0.1 * smoothstep(1.8, 0.3, pathDist(x, z));
  return h;
}

// ---------------------------------------------------------------- collision heightfield (fast)
const HF_HALF = 150, HF_STEP = 1;
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
  const lush = new THREE.Color(0.16, 0.46, 0.08), fresh = new THREE.Color(0.38, 0.68, 0.13), dry = new THREE.Color(0.5, 0.64, 0.2);
  out.copy(lush).lerp(fresh, smoothstep(-0.4, 0.5, n1 + n2 * 0.25));
  out.lerp(dry, smoothstep(0.3, 0.8, N.fbm(x / 40 - 30, z / 40 + 12, 2)) * 0.3);
  return out;
}

export function buildTerrain(step = 1) {
  const xs = axisCoords(step);
  const nx = xs.length;
  const pos = new Float32Array(nx * nx * 3), col = new Float32Array(nx * nx * 3), uv = new Float32Array(nx * nx * 2);
  const c = new THREE.Color(), tmp = new THREE.Color(), nrm = new THREE.Vector3();
  const dirt = new THREE.Color(0.5, 0.4, 0.26), sand = new THREE.Color(0.66, 0.6, 0.42), mud = new THREE.Color(0.3, 0.3, 0.2), rock = new THREE.Color(0.56, 0.54, 0.5), rockDark = new THREE.Color(0.34, 0.33, 0.31), moss = new THREE.Color(0.24, 0.42, 0.12), pebble = new THREE.Color(0.48, 0.45, 0.38);
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
    c.lerp(hillDark, smoothstep(PLAY_RADIUS + 120, PLAY_RADIUS + 400, r) * 0.4);
    // slope → exposed rock
    if (inner) groundNormal(x, z, nrm); else nrm.set(0, 1, 0);
    // steep faces: natural weathered stone — mottled warm/cool greys, darker cracks, faint uneven
    // layering and moss creeping over the less steep parts (no regular banding)
    // vertical cracks / columns (reference cliffs): noise stretched along the height
    const col2 = N.fbm((x + z) * 0.55, h * 0.09, 3), mot = N.fbm(x / 4 + h * 0.1, z / 4, 2);
    tmp.copy(rockDark).lerp(rock, smoothstep(-0.55, 0.35, col2 * 0.8 + mot * 0.4));
    tmp.lerp(moss, smoothstep(0.62, 0.8, nrm.y) * smoothstep(-0.1, 0.4, N.n2(x / 3, z / 3 + h)) * 0.7);
    c.lerp(tmp, smoothstep(0.86, 0.62, nrm.y));
    // trail
    const pd = pathDist(x, z);
    c.lerp(tmp.copy(dirt).multiplyScalar(0.9 + 0.2 * N.n2(x / 3, z / 3)), smoothstep(2.4, 0.6, pd + N.n2(x / 2.5, z / 2.5) * 0.5));
    // river banks and pool: pebbly shore, dark stony bed
    const dw = h - WATER_Y;
    c.lerp(tmp.copy(pebble).multiplyScalar(0.85 + 0.3 * N.n2(x * 1.3, z * 1.3)), smoothstep(0.7, 0.15, dw)); c.lerp(mud, smoothstep(-0.05, -0.7, dw));
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
