import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeNoise, mulberry32, smoothstep } from './noise.js';

// Shared stone pieces for the valley (mesa ledges), with colour + haze baked into the vertices.

const N = makeNoise(5150);
const HAZE = new THREE.Color(0.76, 0.62, 0.8);
const _c = new THREE.Color(), _t = new THREE.Color();

function hazeK(d) { return Math.min(0.82, 0.12 + smoothstep(220, 1300, d) * 0.85); }
// bake colours (fn(x, y, z, nx, ny, nz, color) in world space) plus haze from the valley centre
function paint(g, fn, smooth = true) {
  // weld the shared vertices first so the normals are smooth (rounded rock, not crumpled paper);
  // done in place so callers keep their geometry object
  g.deleteAttribute('uv');
  if (smooth) {
    g.deleteAttribute('normal');
    const w = mergeVertices(g, 0.05);
    g.setIndex(w.index); g.setAttribute('position', w.attributes.position);
  } else g.deleteAttribute('normal');
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    fn(x, y, z, n.getX(i), n.getY(i), n.getZ(i), _c);
    _c.lerp(HAZE, hazeK(Math.hypot(x, z)));
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
// ---------------------------------------------------------------- mesas (flat-topped cliff blocks)
// The reference's plateaus: an irregular footprint, near-vertical layered rock walls with vertical
// cracks, a crisp rim and a flat grassy top. Side and top are separate pieces so the rim stays sharp.
export function mesaGeometry(r, h, seed, x0, z0, y0) {
  const R = mulberry32(seed);
  const M = 22, K = Math.max(4, Math.round(h / 2.6));
  const rad = []; for (let i = 0; i < M; i++) rad.push(r * (0.78 + 0.32 * N.n2(Math.cos(i / M * 6.283) * 1.6 + seed, Math.sin(i / M * 6.283) * 1.6)));
  const pos = [], idx = [];
  for (let k = 0; k <= K; k++) {
    const y = (k / K) * h, layer = k % 2 ? 0.985 : 1.0, taper = 1 + (1 - k / K) * 0.12;
    for (let i = 0; i <= M; i++) {
      const a = (i % M) / M * 6.283, crack = 1 + 0.05 * N.n2(a * 9 + seed, y * 0.06) + 0.025 * N.n2(a * 23, y * 0.2 + seed);
      const rr = rad[i % M] * layer * taper * crack;
      pos.push(x0 + Math.cos(a) * rr, y0 + y, z0 + Math.sin(a) * rr);
    }
  }
  for (let k = 0; k < K; k++) for (let i = 0; i < M; i++) { const a = k * (M + 1) + i, b = a + 1, c = a + M + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const side = new THREE.BufferGeometry();
  side.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); side.setIndex(idx);
  // grassy top: a slightly domed cap a touch inside the rim, with a lip that overhangs it
  const top = new THREE.BufferGeometry(), tp = [x0, y0 + h + 0.8, z0], ti = [];
  for (let i = 0; i <= M; i++) { const a = (i % M) / M * 6.283, rr = rad[i % M] * 1.02; tp.push(x0 + Math.cos(a) * rr, y0 + h + 0.15, z0 + Math.sin(a) * rr); }
  for (let i = 1; i <= M; i++) ti.push(0, i + 1, i);
  top.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3)); top.setIndex(ti);
  paint(side, (x, y, z, nx, ny, nz, c) => {
    const yy = (y - y0) / h;
    c.setRGB(0.6, 0.55, 0.6).multiplyScalar(0.8 + 0.2 * N.n2(Math.atan2(z - z0, x - x0) * 6, y * 0.08));
    c.multiplyScalar(1 - 0.16 * smoothstep(0.6, 0.95, Math.abs(Math.sin(y * 1.2)))); // strata lines
    c.lerp(_t.setRGB(0.42, 0.38, 0.44), smoothstep(0.35, 0.0, yy) * 0.6);
    // moss and grass trailing down from the rim
    c.lerp(_t.setRGB(0.32, 0.5, 0.2), smoothstep(0.82, 1.0, yy) * (0.5 + 0.5 * N.n2(Math.atan2(z - z0, x - x0) * 10, 3)));
  }, false);
  paint(top, (x, y, z, nx, ny, nz, c) => { c.setRGB(0.34, 0.56, 0.2).multiplyScalar(0.85 + 0.2 * N.n2(x * 0.1, z * 0.1)); }, false);
  void R;
  return [side, top];
}

// ---------------------------------------------------------------- assemble
// The reference's horizon is just land and mountains (sky.js buildMountains): no floating islands,
// castles or beams. The vista group stays as the hook other systems hide/show.
export function buildVista() {
  const root = new THREE.Group(); root.name = 'vista';
  root.userData.update = () => {};
  return root;
}
