import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeNoise, mulberry32, smoothstep } from './noise.js';
import { stylize } from './stylize.js';
import { SKY } from './sky.js';

// The vista: everything you see beyond the valley, built like an open-world skyline.
//   - a ring of towering karst spires with grassy, tree-topped crowns (Liyue-style silhouettes)
//   - floating sky islands with waterfalls pouring off their edges, slowly bobbing
//   - a colossal ancient tree on the northern plateau, visible from everywhere
//   - a white-stone castle with blue spires on the eastern cliffs
// Nothing here collides. Aerial perspective is baked into the vertex colours (cool haze that grows
// with distance), so the far layers read in clear depth planes like a painted backdrop.

const N = makeNoise(5150);
const HAZE = new THREE.Color(0.76, 0.62, 0.8);
const _c = new THREE.Color();
const ni = (g) => (g.index ? g.toNonIndexed() : g);

function hazeK(d) { return Math.min(0.78, smoothstep(220, 1300, d) * 0.85); }
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
function displace(g, amt, freq, seed) {
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = N.n2(v.x * freq + seed, v.y * freq * 0.7 + v.z * freq) * amt;
    p.setXYZ(i, v.x + k * Math.sign(v.x || 1) * 0.6, v.y, v.z + k * Math.sign(v.z || 1) * 0.6);
  }
  return g;
}

// ---------------------------------------------------------------- karst spires
const rockCol = (top) => (x, y, z, nx, ny, nz, c) => {
  const streak = 0.82 + 0.18 * N.n2(x * 0.15 + z * 0.15, y * 0.02);
  c.setRGB(0.6, 0.58, 0.53).multiplyScalar(streak);
  if (y < top * 0.35) c.lerp(_t.setRGB(0.42, 0.46, 0.4), 0.35);
  const grassy = smoothstep(0.55, 0.85, ny) * smoothstep(top * 0.6, top * 0.9, y);
  c.lerp(_t.setRGB(0.32, 0.56, 0.2), grassy);
  // ledges of green creeping down
  c.lerp(_t.setRGB(0.3, 0.5, 0.2), smoothstep(0.7, 0.95, ny) * 0.7);
};
const _t = new THREE.Color();
export function spireGeometry(r, h, seed, x0, z0, y0) {
  const R = mulberry32(seed);
  // a stack of slightly offset, bulging drums: the classic weathered karst column
  const parts = [];
  const tiers = 5 + Math.floor(R() * 3);
  let y = 0, rr = r, ox = 0, oz = 0;
  for (let i = 0; i < tiers; i++) {
    const th = h / tiers * (0.8 + R() * 0.4);
    const r1 = rr * (0.82 + R() * 0.12);
    const g = new THREE.CylinderGeometry(r1, rr, th, 14, 3, false);
    displace(g, rr * 0.25, 0.18, seed + i);
    g.translate(ox, y + th / 2, oz);
    parts.push(ni(g));
    y += th * 0.96; rr = r1; ox += (R() - 0.5) * rr * 0.2; oz += (R() - 0.5) * rr * 0.2;
  }
  // grassy crown + a few trees on top
  const cap = new THREE.SphereGeometry(rr * 1.08, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.32, 1); cap.translate(ox, y - 0.3, oz);
  parts.push(ni(cap));
  const g = mergeGeometries(parts);
  g.translate(x0, y0, z0);
  paint(g, rockCol(y0 + y));
  const trees = [];
  for (let k = 0; k < 3 + Math.floor(R() * 3); k++) {
    const a = R() * 6.28, d = R() * rr * 0.7, s = rr * (0.18 + R() * 0.14);
    const t = new THREE.IcosahedronGeometry(s, 1); t.scale(1, 0.85, 1);
    t.translate(x0 + ox + Math.cos(a) * d, y0 + y + s * 0.6, z0 + oz + Math.sin(a) * d);
    trees.push(ni(t));
  }
  const tg = mergeGeometries(trees);
  paint(tg, (x, yy, z, nx, ny, nz, c) => { c.setRGB(0.18, 0.42, 0.16).lerp(_t.setRGB(0.42, 0.68, 0.24), smoothstep(-0.3, 0.9, ny)); });
  return [g, tg];
}

// ---------------------------------------------------------------- floating islands
function islandParts(x0, y0, z0, r, seed) {
  const R = mulberry32(seed);
  const prof = [];
  const depth = r * (1.3 + R() * 0.5);
  for (let i = 0; i <= 10; i++) { const u = i / 10; prof.push(new THREE.Vector2(r * Math.pow(1 - u, 0.65) * (0.9 + 0.1 * Math.sin(u * 9 + seed)) + 0.01, -depth * u)); }
  prof.reverse();
  const rock = new THREE.LatheGeometry(prof, 18);
  displace(rock, r * 0.16, 0.12, seed);
  const top = new THREE.CylinderGeometry(r * 1.02, r * 0.98, r * 0.12, 22, 1); top.translate(0, r * 0.04, 0);
  const g = mergeGeometries([ni(rock), ni(top)]);
  g.translate(x0, y0, z0);
  paint(g, (x, y, z, nx, ny, nz, c) => {
    c.setRGB(0.55, 0.5, 0.44).multiplyScalar(0.8 + 0.2 * N.n2(x * 0.1, y * 0.1 + z * 0.1));
    c.lerp(_t.setRGB(0.36, 0.62, 0.22), smoothstep(y0 - r * 0.1, y0 + r * 0.02, y));
    c.lerp(_t.setRGB(0.3, 0.34, 0.3), smoothstep(y0 - depth * 0.4, y0 - depth, y) * 0.4);
  });
  const trees = [];
  for (let k = 0; k < 6 + Math.floor(R() * 5); k++) {
    const a = R() * 6.28, d = Math.sqrt(R()) * r * 0.75, s = r * (0.12 + R() * 0.1);
    const t = new THREE.IcosahedronGeometry(s, 1); t.scale(1, 1.1, 1);
    t.translate(x0 + Math.cos(a) * d, y0 + r * 0.1 + s * 0.9, z0 + Math.sin(a) * d);
    trees.push(ni(t));
    const tr = new THREE.CylinderGeometry(s * 0.12, s * 0.18, s * 1.2, 5); tr.translate(x0 + Math.cos(a) * d, y0 + r * 0.1 + s * 0.2, z0 + Math.sin(a) * d);
    trees.push(ni(tr));
  }
  const tg = mergeGeometries(trees);
  paint(tg, (x, y, z, nx, ny, nz, c) => { c.setRGB(0.2, 0.46, 0.18).lerp(_t.setRGB(0.5, 0.76, 0.3), smoothstep(-0.2, 0.9, ny)); });
  return { rock: g, trees: tg, depth };
}

const FALL_VS = /* glsl */`
  varying vec2 vUv; varying float vD;
  void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vD = length(w.xz); gl_Position = projectionMatrix * viewMatrix * w; }`;
const FALL_FS = /* glsl */`
  uniform float uTime; varying vec2 vUv; varying float vD;
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
  void main(){
    float s = n(vec2(vUv.x * 14.0, vUv.y * 3.0 + uTime * 1.6)) * 0.6 + n(vec2(vUv.x * 30.0, vUv.y * 7.0 + uTime * 2.4)) * 0.4;
    float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
    float fade = smoothstep(0.0, 0.7, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
    float a = edge * fade * (0.45 + 0.55 * s);
    vec3 col = mix(vec3(0.72, 0.86, 1.0), vec3(1.0), s);
    col = mix(col, vec3(0.7, 0.8, 0.94), min(0.7, smoothstep(220.0, 1300.0, vD) * 0.85));
    gl_FragColor = vec4(col, a * 0.85);
  }`;

// ---------------------------------------------------------------- the castle
function castle(x0, z0, y0) {
  const stone = [], roofs = [];
  const tower = (x, z, r, h, roof = true) => {
    const g = new THREE.CylinderGeometry(r, r * 1.08, h, 14, 2); g.translate(x, h / 2, z); stone.push(ni(g));
    const ring = new THREE.CylinderGeometry(r * 1.15, r * 1.15, h * 0.05, 14); ring.translate(x, h * 0.97, z); stone.push(ni(ring));
    if (roof) { const c = new THREE.ConeGeometry(r * 1.25, r * 2.8, 14); c.translate(x, h + r * 1.4, z); roofs.push(ni(c)); }
  };
  tower(0, 0, 9, 95);
  tower(22, 10, 6, 62); tower(-20, 14, 6.5, 70); tower(10, -22, 5, 54); tower(-14, -18, 4.5, 48);
  const wall = new THREE.BoxGeometry(56, 32, 40); wall.translate(0, 16, 0); stone.push(ni(wall));
  const keep = new THREE.BoxGeometry(30, 50, 24); keep.translate(2, 25, 4); stone.push(ni(keep));
  const kr = new THREE.ConeGeometry(22, 22, 4); kr.rotateY(Math.PI / 4); kr.scale(1, 1, 0.8); kr.translate(2, 61, 4); roofs.push(ni(kr));
  const sg = mergeGeometries(stone); sg.translate(x0, y0, z0);
  paint(sg, (x, y, z, nx, ny, nz, c) => { c.setRGB(0.93, 0.9, 0.84).multiplyScalar(0.86 + 0.14 * N.n2(x * 0.1, y * 0.15)); if (Math.abs(ny) < 0.3 && (Math.floor(y / 6) % 3 === 1) && N.n2(x * 0.4, z * 0.4) > 0.6) c.setRGB(0.2, 0.22, 0.3); }, false);
  const rg = mergeGeometries(roofs); rg.translate(x0, y0, z0);
  paint(rg, (x, y, z, nx, ny, nz, c) => { c.setRGB(0.18, 0.36, 0.72).lerp(_t.setRGB(0.42, 0.6, 0.92), smoothstep(-0.2, 0.8, ny)); }, false);
  return [sg, rg];
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

function heroMountain(x0, z0, y0) {
  // one dominant snow peak: a jagged ridged massif (many crests, gullies and a lopsided summit),
  // dark rock streaked with snow, clean snowfields high up
  const W = 120, Rr = 520, H = 600;
  const g = new THREE.PlaneGeometry(Rr * 2, Rr * 2, W, W); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z) / Rr;
    const cone = Math.max(0, 1 - d) ** 1.35;
    const rg = 1 - Math.abs(N.fbm(x / 140 + 3, z / 140 - 7, 4) * 2 - 1);
    const rg2 = 1 - Math.abs(N.fbm(x / 60 - 2, z / 60 + 5, 3) * 2 - 1);
    const h = H * cone * (0.62 + 0.38 * rg) + 50 * rg2 * cone + 35 * Math.max(0, 1 - d * 1.1);
    p.setY(i, h - 30 * smoothstep(0.85, 1.0, d));
  }
  g.translate(x0, y0, z0);
  paint(g, (x, y, z, nx, ny, nz, c) => {
    const yy = (y - y0) / H;
    c.setRGB(0.44, 0.4, 0.52).multiplyScalar(0.82 + 0.25 * N.n2(x * 0.02, z * 0.02 + y * 0.01));
    c.lerp(_t.setRGB(0.36, 0.46, 0.32), smoothstep(0.2, 0.02, yy) * 0.7);
    const snow = smoothstep(0.38 + 0.1 * N.n2(x * 0.012, z * 0.012), 0.5, yy) * smoothstep(0.25, 0.65, ny);
    c.lerp(_t.setRGB(1.05, 0.92, 0.94), snow);
  });
  return g;
}

function temple(x0, z0, y0) {
  // a ruined hilltop temple: a stepped podium, a colonnade, broken pediment walls
  const parts = [];
  const box = (x, y, z, sx, sy, sz) => { const b = new THREE.BoxGeometry(sx, sy, sz); b.translate(x0 + x, y0 + y + sy / 2, z0 + z); parts.push(b); };
  box(0, 0, 0, 96, 10, 64); box(0, 10, 0, 84, 6, 54); box(0, 16, 0, 72, 4, 44);
  for (let i = 0; i < 9; i++) for (const zz of [-18, 18]) { if ((i * 7 + zz) % 5 === 0) continue; const c = new THREE.CylinderGeometry(2.6, 3, 30, 10); c.translate(x0 - 32 + i * 8, y0 + 35, z0 + zz); parts.push(c); }
  box(-6, 50, -18, 60, 6, 8); box(10, 50, 18, 40, 6, 8);
  box(-34, 20, 0, 8, 26, 40); box(30, 20, -6, 8, 18, 28);
  const g = mergeGeometries(parts.map(ni));
  paint(g, (x, y, z, nx, ny, nz, c) => { c.setRGB(0.66, 0.6, 0.62).multiplyScalar(0.82 + 0.18 * N.n2(x * 0.08, y * 0.08 + z * 0.05)); c.lerp(_t.setRGB(0.34, 0.5, 0.22), smoothstep(0.7, 1, ny) * 0.5); }, false);
  return g;
}

// ---------------------------------------------------------------- assemble
export function buildVista(Q = {}, groundAt = () => 0) {
  const root = new THREE.Group(); root.name = 'vista';
  const mat = stylize(new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }), { wrap: 0.5, band: 0.1 });
  const solid = [];
  const R = mulberry32(909);
  // plateau mesas: groups of flat-topped cliff blocks 420–820 m out, layered in depth
  const groups = [-2.9, -2.2, -1.45, -0.7, 0.05, 0.8, 1.6, 2.35];
  for (const ga of groups) {
    const n = 2 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      const a = ga + (R() - 0.5) * 0.45, d = 420 + R() * 400;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = 40 + R() * 90 * (d / 820), r = 28 + R() * 46;
      solid.push(...mesaGeometry(r, h, 100 + Math.floor(R() * 1e5), x, z, groundAt(x, z) - 20));
    }
  }
  // the hero snow peak (north-north-east, behind the valley) and a ruined temple on a far rise with a
  // column of light rising from it (north-east)
  {
    const a = -1.2, d = 1250, x = Math.cos(a) * d, z = Math.sin(a) * d;
    solid.push(heroMountain(x, z, -60));
  }
  let beamAt = null;
  {
    const a = -0.55, d = 600, x = Math.cos(a) * d, z = Math.sin(a) * d, y = groundAt(x, z) + 30;
    solid.push(...mesaGeometry(70, 30, 4242, x, z, y - 30));
    solid.push(temple(x, z, y + 1));
    beamAt = new THREE.Vector3(x, y + 1, z);
  }
  {
    const a = 0.42, d = 560, x = Math.cos(a) * d, z = Math.sin(a) * d;
    solid.push(...castle(x, z, groundAt(x, z) - 2));
  }
  const m = new THREE.Mesh(mergeGeometries(solid.map(ni)), mat);
  m.frustumCulled = false; m.name = 'vistaSolid';
  root.add(m);
  // floating islands + waterfalls (each bobs on its own)
  const islands = [];
  const fallMat = new THREE.ShaderMaterial({ vertexShader: FALL_VS, fragmentShader: FALL_FS, uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const spots = [[2.75, 520, 150, 44], [-2.0, 640, 210, 58]];
  spots.forEach(([a, d, y, r], k) => {
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const g = new THREE.Group();
    const { rock, trees, depth } = islandParts(0, 0, 0, r, 40 + k);
    // bake haze for the island's real position: paint used local coords, so re-tint by distance
    for (const geo of [rock, trees]) {
      const c = geo.attributes.color, k2 = hazeK(d);
      for (let i = 0; i < c.count; i++) { _c.setRGB(c.getX(i), c.getY(i), c.getZ(i)).lerp(HAZE, k2); c.setXYZ(i, _c.r, _c.g, _c.b); }
    }
    g.add(new THREE.Mesh(mergeGeometries([rock, trees]), mat));
    // one or two waterfalls off the rim, falling far below the island
    for (let w = 0; w < (r > 50 ? 2 : 1); w++) {
      const wa = R() * 6.28, fw = r * 0.2, fh = depth * 1.5;
      const fg = new THREE.PlaneGeometry(fw, fh, 1, 1); fg.translate(0, -fh / 2 + r * 0.06, 0);
      const fm = new THREE.Mesh(fg, fallMat);
      fm.position.set(Math.cos(wa) * r * 0.97, 0, Math.sin(wa) * r * 0.97);
      fm.lookAt(fm.position.x * 2, 0, fm.position.z * 2); fm.rotateY(Math.PI / 2);
      g.add(fm);
    }
    g.position.set(x, y, z);
    g.userData = { y, ph: k * 1.7, sp: 0.15 + k * 0.03 };
    for (const c of g.children) c.frustumCulled = false;
    root.add(g); islands.push(g);
  });
  // the light pillar over the temple
  let beam = null;
  if (beamAt) {
    const bg = new THREE.CylinderGeometry(3, 5, 900, 16, 1, true); bg.translate(0, 450, 0);
    beam = new THREE.Mesh(bg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uTime; varying vec2 vUv; void main(){ float core = pow(1.0 - abs(sin(vUv.x * 3.14159 * 2.0)) * 0.6, 3.0); float a = (1.0 - vUv.y) * (0.6 + 0.4 * sin(uTime * 2.0 + vUv.y * 20.0)); gl_FragColor = vec4(vec3(0.55, 0.7, 1.6) * core, a * 0.55); }',
    }));
    beam.position.copy(beamAt); beam.frustumCulled = false;
    root.add(beam);
  }
  root.userData.update = (t) => {
    if (beam) beam.material.uniforms.uTime.value = t;
    fallMat.uniforms.uTime.value = t;
    for (const g of islands) { g.position.y = g.userData.y + Math.sin(t * g.userData.sp + g.userData.ph) * 3.5; g.rotation.y = Math.sin(t * 0.02 + g.userData.ph) * 0.05; }
  };
  void SKY;
  return root;
}
