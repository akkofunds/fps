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
// the whole valley layout is scaled up by MAP_SCALE (cliff heights, rock and grass detail stay in metres)
export const MAP_SCALE = 2.25;
const S = MAP_SCALE;
export const PLAY_RADIUS = 100 * S;
// the cliff line: distance from the meadow centre to the first cliff at a given compass angle
// (atan2(z, x): 0 = east, -π/2 = north, π/2 = south, ±π = west). Large = open.
const RIM = [[0, 92], [-0.55, 84], [-1.05, 70], [-1.57, 66], [-2.0, 72], [-2.35, 82], [-2.75, 118], [Math.PI, 150], [2.6, 104], [2.25, 92], [1.85, 150], [1.35, 150], [0.95, 104], [0.55, 96]].map(([t, r]) => [t, r * S]);
function rimRadius(a) {
  const pts = RIM.map(([t, r]) => [((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), r]).sort((p, q) => p[0] - q[0]);
  let u = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  for (let i = 0; i < pts.length; i++) {
    const [t0, r0] = pts[i], [t1raw, r1] = pts[(i + 1) % pts.length];
    const t1 = i + 1 === pts.length ? t1raw + 2 * Math.PI : t1raw;
    const uu = u < t0 ? u + 2 * Math.PI : u;
    if (uu >= t0 && uu <= t1) { const k = (uu - t0) / (t1 - t0); return r0 + (r1 - r0) * (k * k * (3 - 2 * k)); }
  }
  return 100 * S;
}
const RIM_LUT = Array.from({ length: 721 }, (_, i) => rimRadius((i / 720) * 2 * Math.PI - Math.PI));
const rimAt = (a) => { const f = ((a + Math.PI) / (2 * Math.PI)) * 720; const i = Math.max(0, Math.min(719, Math.floor(f))); return RIM_LUT[i] + (RIM_LUT[i + 1] - RIM_LUT[i]) * (f - i); };
export const CLIFF = { t1: 9, t2: 17 };

// the waterfall in the north-west cliff: the upper fall drops from the top tier onto the 9 m ledge,
// a short stream crosses the ledge and the lower fall drops into the pool
const FA = -2.33; // compass angle of the falls
export const FALLS = { x: Math.cos(FA) * rimRadius(FA), z: Math.sin(FA) * rimRadius(FA), a: FA, w: 24, d: 9, h: CLIFF.t2, mid: CLIFF.t1 };
export const LAKE = { x: Math.cos(FA) * (rimRadius(FA) - 12), z: Math.sin(FA) * (rimRadius(FA) - 12), r: 14 }; // the plunge pool
export const HILL = { x: 9999, z: 9999, r: 1, h: 0 };
export const PLAZA = { x: 0, z: 0, r: 0 };
// the river: from the pool east along the foot of the north cliffs, and south-west out of the valley
const sc = (pts) => pts.map(([x, z]) => [x * S, z * S]);
export const RIVER = [[LAKE.x + 40 * S, LAKE.z - 2 * S], [LAKE.x + 30 * S, LAKE.z + 4 * S]];
const RIVER_E = [[LAKE.x, LAKE.z], [LAKE.x + 18 * S, LAKE.z + 4 * S], ...sc([[-14, -52], [8, -50], [26, -55], [46, -58], [66, -64], [92, -60], [140, -66], [220, -72]])];
const RIVER_W = [[LAKE.x, LAKE.z], [LAKE.x - 10 * S, LAKE.z + 16 * S], ...sc([[-74, -24], [-86, -6], [-100, 10], [-122, 22], [-150, 26], [-230, 40]])];
export const RIVER_W_PTS = RIVER_W, RIVER_E_PTS = RIVER_E;
// faint dirt trails worn across the meadow
export const PATH = sc([[-20, 120], [-12, 70], [-4, 30], [0, 0], [6, -24], [10, -46]]);
export const PATH2 = sc([[-68, 4], [-58, -8], [-45, -20], [-24, -12], [0, 0], [40, -6], [78, -2]]);
// the small round mesa on the east side
export const MESA = { x: 64 * S, z: -16 * S, r: 19, h: 7.5 };
// rolling hills across the meadow (x, z, radius, height): gentle, grassy, kept off the river
export const HILLS = [[115, 70, 40, 7], [-100, 92, 36, 6], [55, 168, 44, 8.5], [-62, -58, 30, 4.5], [172, 112, 34, 6], [0, 196, 40, 7], [-128, -36, 30, 5], [80, -60, 26, 3.5], [-40, 120, 24, 4]];

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
  return 0.9 * N.fbm(x / (60 * S), z / (60 * S), 3) + 0.55 * N.fbm(x / 45 - 11, z / 45 + 5, 2) + 0.25 * N.fbm(x / 14 + 7, z / 14 - 3, 2);
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
  const R = rimAt(a) + N.n2(Math.cos(a) * 9 + 3, Math.sin(a) * 9) * 5 * S * 0.7 + N.n2(Math.cos(a) * 26 - 5, Math.sin(a) * 26) * 4 + N.n2(x / 9, z / 9) * 1.6;
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
  // rolling hills (soft-topped, a little lumpy), fading out near the river banks
  for (const [hx, hz, hr, hh] of HILLS) {
    const d = Math.hypot(x - hx, z - hz) + N.n2(x / 11 + hx, z / 11) * 4;
    if (d < hr) { const k = 1 - d / hr; h += hh * k * k * (3 - 2 * k) * smoothstep(8, 30, rd); }
  }
  const rw = 4.6 + 1.6 * N.n2(x / 20, z / 20);
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
const HF_HALF = 262, HF_STEP = 1;
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
  // full resolution across the basin and its cliffs (|x| <= 112); double spacing out to HF_HALF
  // (distant rims and plateaus, where 1 m detail is sub-pixel), then growing steps to the horizon
  const xs = [];
  const fine = Math.min(HF_HALF, Math.ceil(112 * S / step) * step);
  for (let i = -fine; i <= fine; i += step) xs.push(i);
  const coarse = [];
  for (let x = fine + step * 2; x <= HF_HALF + 1e-6; x += step * 2) coarse.push(x);
  if (coarse[coarse.length - 1] !== HF_HALF) coarse.push(HF_HALF);
  xs.unshift(...coarse.map((v) => -v).reverse()); xs.push(...coarse);
  let s = step * 2, x = HF_HALF;
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

function rockTexture() {
  // greyscale multiplier: horizontal strata bands, vertical cracks and blocky fractures
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const n = makeNoise(1717);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const band = 0.82 + 0.18 * Math.sin(y / S * Math.PI * 2 * 7 + n.n2(x / 70, y / 40) * 2.2);
    const crack = Math.abs(n.n2(x / 22, y / 140));
    const v = (0.72 + 0.22 * n.fbm(x / 60, y / 60, 3) + 0.1 * n.n2(x / 5, y / 5)) * band * (0.75 + 0.25 * Math.min(1, crack * 6));
    const k = Math.max(0, Math.min(255, v * 235));
    const i = (y * S + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = k; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function grassColorAt(x, z, out) {
  // shared palette for the ground and grass blades
  const n1 = N.fbm(x / 23 + 40, z / 23, 3), n2 = N.n2(x / 7, z / 7);
  const lush = new THREE.Color(0.3, 0.34, 0.07), fresh = new THREE.Color(0.68, 0.56, 0.14), dry = new THREE.Color(0.7, 0.42, 0.1);
  out.copy(lush).lerp(fresh, smoothstep(-0.4, 0.5, n1 + n2 * 0.25));
  out.lerp(dry, smoothstep(0.2, 0.8, N.fbm(x / 40 - 30, z / 40 + 12, 2)) * 0.5);
  return out;
}

export function buildTerrain(step = 1, lite = false) {
  const xs = axisCoords(step);
  const nx = xs.length;
  const pos = new Float32Array(nx * nx * 3), col = new Float32Array(nx * nx * 3), uv = new Float32Array(nx * nx * 2);
  const c = new THREE.Color(), tmp = new THREE.Color(), nrm = new THREE.Vector3();
  const dirt = new THREE.Color(0.5, 0.4, 0.26), sand = new THREE.Color(0.66, 0.6, 0.42), mud = new THREE.Color(0.3, 0.3, 0.2), rock = new THREE.Color(0.56, 0.54, 0.5), rockDark = new THREE.Color(0.34, 0.33, 0.31), moss = new THREE.Color(0.24, 0.42, 0.12), pebble = new THREE.Color(0.48, 0.45, 0.38);
  const hillDark = new THREE.Color(0.4, 0.26, 0.08);
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
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const full = new Uint32Array((nx - 1) * (nx - 1) * 6);
  let p = 0;
  for (let j = 0; j < nx - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
    full[p++] = a; full[p++] = cc; full[p++] = b; full[p++] = b; full[p++] = cc; full[p++] = d;
  }
  g.setIndex(new THREE.BufferAttribute(full, 1));
  g.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTexture() });
  if (lite) mat.map.anisotropy = 2;
  // cliffs: a triplanar rock texture (layered strata, vertical cracks) faded in by slope, so the
  // walls read as stone instead of stretched grass detail
  const rockTex = rockTexture();
  if (lite) rockTex.anisotropy = 1;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tRock = { value: rockTex };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTpW; varying vec3 vTpN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTpW = position; vTpN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tRock; varying vec3 vTpW; varying vec3 vTpN;')
      .replace('#include <map_fragment>', `
        vec4 dTex = texture2D( map, vMapUv );
        float rockW = smoothstep( 0.16, 0.36, 1.0 - normalize( vTpN ).y );
        vec3 tc = dTex.rgb;
        // the rock texture is only fetched on the cliffs (most of the screen is flat meadow)
        if ( rockW > 0.001 ) {
          #ifdef TERRAIN_LITE
            vec2 side = abs( vTpN.x ) > abs( vTpN.z ) ? vTpW.zy : vTpW.xy;
            vec3 rTex = texture2D( tRock, side * vec2( 0.11, 0.16 ) ).rgb;
          #else
            vec3 bw = pow( abs( normalize( vTpN ) ), vec3( 4.0 ) ); bw /= ( bw.x + bw.y + bw.z );
            vec3 rTex = texture2D( tRock, vTpW.zy * vec2( 0.11, 0.16 ) ).rgb * bw.x + texture2D( tRock, vTpW.xz * 0.11 ).rgb * bw.y + texture2D( tRock, vTpW.xy * vec2( 0.11, 0.16 ) ).rgb * bw.z;
          #endif
          tc = mix( tc, rTex * 1.12, rockW );
        }
        diffuseColor.rgb *= tc;`);
    if (lite) sh.fragmentShader = '#define TERRAIN_LITE\n' + sh.fragmentShader;
  };
  mat.customProgramCacheKey = () => (lite ? 'terrainLite' : 'terrainTri');
  stylize(mat, { wrap: 0.35, band: 0.1 });
  // tiles sharing one vertex buffer (no seams): each frustum-culls on its own, so only the part of
  // the (big) valley in view is drawn
  const group = new THREE.Group();
  group.name = 'terrain';
  const T = 48, box = new THREE.Box3(), v = new THREE.Vector3();
  for (let tj = 0; tj < nx - 1; tj += T) for (let ti = 0; ti < nx - 1; ti += T) {
    const j1 = Math.min(nx - 1, tj + T), i1 = Math.min(nx - 1, ti + T);
    const idx = new Uint32Array((j1 - tj) * (i1 - ti) * 6);
    let q = 0;
    box.makeEmpty();
    for (let j = tj; j < j1; j++) for (let i = ti; i < i1; i++) {
      const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
      idx[q++] = a; idx[q++] = cc; idx[q++] = b; idx[q++] = b; idx[q++] = cc; idx[q++] = d;
    }
    for (let j = tj; j <= j1; j++) for (let i = ti; i <= i1; i++) { const k = j * nx + i; box.expandByPoint(v.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2])); }
    const tg = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color', 'uv']) tg.setAttribute(name, g.attributes[name]);
    tg.setIndex(new THREE.BufferAttribute(idx, 1));
    tg.boundingBox = box.clone();
    tg.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const m = new THREE.Mesh(tg, mat);
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  g.setIndex(null);
  // void.js swaps the terrain's material: keep that working for the whole group
  let cur = mat;
  Object.defineProperty(group, 'material', { get: () => cur, set: (mm) => { cur = mm; for (const c of group.children) c.material = mm; } });
  return group;
}

export { N as terrainNoise };
