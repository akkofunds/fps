// Stage B: build the game-ready viewmodel GLB for one gun.  Usage: node build.mjs ak ../../public/models/ak.glb
//   scene → weapon (animated root) → body | mag | charge/slide/bolt... | arm_R | arm_L | markers
// Every animated node sits at its pivot; meshes hang off child nodes (so quantization can't
// disturb animated transforms). Clips are baked as glTF animations sampled at 60 fps.
import { prune, dedup, joinPrimitives, textureCompress, meshopt, transformPrimitive } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { loadParts, io, bboxOf } from './parts.mjs';
import { GUNS, norm } from './guns.mjs';
import { RIGS } from './rigs.mjs';

const name = process.argv[2];
const out = process.argv[3];
const g = GUNS[name], rig = RIGS[name];
const { doc, groups } = await loadParts({ ...g, norm: norm(g) });
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const scene = root.getDefaultScene() || doc.createScene('Scene');
root.setDefaultScene(scene);

// ---------- math ----------
const D2R = Math.PI / 180;
function quatEuler(x, y, z) { // XYZ intrinsic, degrees → [x,y,z,w]
  x *= D2R / 2; y *= D2R / 2; z *= D2R / 2;
  const c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z), s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const norm3 = (a) => { const l = Math.hypot(...a); return scl(a, 1 / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const translate = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

// ---------- weapon root + parts ----------
const weapon = doc.createNode('weapon');
scene.addChild(weapon);
const nodes = { weapon };
const binds = { weapon: [0, 0, 0] };
const grip = rig.grip; // everything is re-centered so the right-hand grip point is the origin

function partNode(gname, pivot, parent = weapon) {
  const prims = groups[gname];
  if (!prims || !prims.length) return null;
  const pv = sub(pivot || grip, grip);
  const n = doc.createNode(gname).setTranslation(pv);
  const m = doc.createMesh(gname + '_mesh');
  // join primitives that share a material (fewer draw calls)
  const byMat = new Map();
  for (const p of prims) { const k = p.getMaterial(); if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(p); }
  for (const list of byMat.values()) {
    const joined = list.length > 1 ? joinPrimitives(list) : list[0];
    transformPrimitive(joined, translate(-(pivot || grip)[0], -(pivot || grip)[1], -(pivot || grip)[2]));
    m.addPrimitive(joined);
  }
  const mn = doc.createNode(gname + '_geo').setMesh(m);
  n.addChild(mn);
  parent.addChild(n);
  nodes[gname] = n; binds[gname] = pv;
  return n;
}

for (const [gname, spec] of Object.entries(rig.parts)) {
  if (spec.parent) continue;
  partNode(gname, spec.pivot);
}
for (const [gname, spec] of Object.entries(rig.parts)) {
  if (!spec.parent) continue;
  // child part: pivot in weapon space, translation relative to parent pivot
  const parent = nodes[spec.parent];
  const n = partNode(gname, spec.pivot, parent);
  if (n) { const pv = sub(spec.pivot, rig.parts[spec.parent].pivot); n.setTranslation(pv); binds[gname] = pv; }
}
// optional empty pivot nodes (e.g. bolt rotation) that re-parent an existing part
for (const [pname, spec] of Object.entries(rig.pivots || {})) {
  const n = doc.createNode(pname).setTranslation(sub(spec.at, grip));
  (nodes[spec.parent] || weapon).addChild(n);
  nodes[pname] = n; binds[pname] = sub(spec.at, grip);
}

// ---------- arms (generated low-poly gloves + sleeves) ----------
// arm colors (linear) baked as COLOR_0; one shared material
const ARM_COLORS = { glove: [0.022, 0.021, 0.02], sleeve: [0.03, 0.045, 0.065], cuff: [0.75, 0.06, 0.08] };
const armMat = doc.createMaterial('arms').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.85).setMetallicFactor(0);

function geom() { return { p: [], n: [], i: [] }; }
function pushQuad(G, a, b, c, d, nrm) { const o = G.p.length / 3; for (const v of [a, b, c, d]) { G.p.push(...v); G.n.push(...nrm); } G.i.push(o, o + 1, o + 2, o, o + 2, o + 3); }
// oriented box: center, axes (unit) ux,uy,uz, half sizes
function box(G, c, ux, uy, uz, hx, hy, hz) {
  const P = (sx, sy, sz) => add(add(add(c, scl(ux, sx * hx)), scl(uy, sy * hy)), scl(uz, sz * hz));
  pushQuad(G, P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), ux);
  pushQuad(G, P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), P(-1, -1, -1), scl(ux, -1));
  pushQuad(G, P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), uy);
  pushQuad(G, P(-1, -1, 1), P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), scl(uy, -1));
  pushQuad(G, P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), uz);
  pushQuad(G, P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), scl(uz, -1));
}
// tapered 8-sided tube from a to b
function tube(G, a, b, r0, r1, seg = 8) {
  const ax = norm3(sub(b, a));
  const up = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm3(cross(ax, up)), v = cross(u, ax);
  const o = G.p.length / 3;
  for (let s = 0; s <= seg; s++) {
    const th = (s / seg) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
    const dir = add(scl(u, cs), scl(v, sn));
    G.p.push(...add(a, scl(dir, r0))); G.n.push(...dir);
    G.p.push(...add(b, scl(dir, r1))); G.n.push(...dir);
  }
  for (let s = 0; s < seg; s++) { const k = o + s * 2; G.i.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  // end cap at a
  const c0 = G.p.length / 3; G.p.push(...a); G.n.push(...scl(ax, -1));
  for (let s = 0; s < seg; s++) G.i.push(c0, o + s * 2, o + (s + 1) * 2);
}
// ellipsoid with radii along axes a,b,c (unit vectors)
function ellipsoid(G, c, a, b, cc, ra, rb, rc, seg = 10, rings = 7) {
  const o = G.p.length / 3;
  for (let i = 0; i <= rings; i++) {
    const v = (i / rings) * Math.PI, sv = Math.sin(v), cv = Math.cos(v);
    for (let j = 0; j <= seg; j++) {
      const u = (j / seg) * Math.PI * 2, su = Math.sin(u), cu = Math.cos(u);
      const lx = cv, ly = sv * cu, lz = sv * su;
      G.p.push(...add(c, add(add(scl(a, lx * ra), scl(b, ly * rb)), scl(cc, lz * rc))));
      G.n.push(...norm3(add(add(scl(a, lx / ra), scl(b, ly / rb)), scl(cc, lz / rc))));
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const k = o + i * (seg + 1) + j;
    G.i.push(k, k + seg + 1, k + 1, k + 1, k + seg + 1, k + seg + 2);
  }
}
function primFrom(G, mat) {
  const p = doc.createPrimitive().setMaterial(mat);
  p.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(G.p)).setBuffer(buffer));
  p.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(G.n)).setBuffer(buffer));
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(G.i)).setBuffer(buffer));
  return p;
}
// hand: palm point P (weapon space). N = palm normal (into the grip), F = finger direction,
// D = forearm direction (toward the elbow). Fingers are 2-segment tubes that curl around the grip.
function makeArm(nodeName, spec) {
  const P = sub(spec.palm, grip);
  const D = norm3(spec.dir);
  const N = norm3(spec.wrap);
  const F = norm3(spec.fingers);
  const S = norm3(cross(F, N));
  const hs = spec.size || 1;
  const glove = geom(), sleeve = geom(), cuff = geom();
  const at = (f, n, s) => add(add(scl(F, f * hs), scl(N, n * hs)), scl(S, s * hs));
  // palm (thin block) + back-of-hand padding
  ellipsoid(glove, at(0.004, -0.006, 0), F, N, S, 0.047 * hs, 0.017 * hs, 0.037 * hs);
  tube(glove, at(0.04, -0.004, -0.032), at(0.04, -0.004, 0.032), 0.012 * hs, 0.012 * hs, 6); // knuckle ridge
  // four fingers
  const curl = spec.curl || 1;
  [-0.027, -0.009, 0.009, 0.026].forEach((sv, i) => {
    const len = [0.026, 0.03, 0.029, 0.023][i];
    const k = at(0.046, 0, sv);
    const m = add(k, add(scl(F, len * hs), scl(N, 0.012 * hs * curl)));
    const e = add(m, add(scl(N, 0.026 * hs * curl), scl(F, -0.008 * hs * curl)));
    tube(glove, k, m, 0.0095 * hs, 0.0088 * hs, 6);
    tube(glove, m, e, 0.0088 * hs, 0.0078 * hs, 6);
  });
  // thumb (wraps the opposite side)
  const t0 = at(0.0, 0.002, -0.04), t1 = add(t0, add(scl(F, 0.032 * hs), scl(N, 0.016 * hs))), t2 = add(t1, add(scl(F, 0.024 * hs), scl(N, 0.012 * hs)));
  tube(glove, t0, t1, 0.0115 * hs, 0.0098 * hs, 6);
  tube(glove, t1, t2, 0.0098 * hs, 0.0085 * hs, 6);
  // wrist, cuff, sleeve
  const wrist = add(at(-0.04, -0.004, 0), scl(D, 0.01));
  tube(glove, at(-0.03, -0.004, 0), add(wrist, scl(D, 0.02)), 0.026 * hs, 0.03 * hs, 8);
  tube(cuff, add(wrist, scl(D, 0.015)), add(wrist, scl(D, 0.05)), 0.036 * hs, 0.038 * hs, 10);
  tube(sleeve, add(wrist, scl(D, 0.045)), add(wrist, scl(D, spec.len || 0.5)), 0.041 * hs, 0.052 * hs, 10);
  // one primitive per arm (vertex colors) → a single draw call
  const all = geom(), col = [];
  for (const [G, c] of [[glove, ARM_COLORS.glove], [cuff, ARM_COLORS.cuff], [sleeve, ARM_COLORS.sleeve]]) {
    const o = all.p.length / 3;
    all.p.push(...G.p); all.n.push(...G.n); for (const i of G.i) all.i.push(i + o);
    for (let k = 0; k < G.p.length / 3; k++) col.push(c[0], c[1], c[2], 1);
  }
  const prim = primFrom(all, armMat);
  prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(new Float32Array(col)).setBuffer(buffer));
  const m = doc.createMesh(nodeName + '_mesh').addPrimitive(prim);
  const n = doc.createNode(nodeName).setTranslation(P);
  n.addChild(doc.createNode(nodeName + '_geo').setMesh(m));
  weapon.addChild(n);
  nodes[nodeName] = n; binds[nodeName] = P;
}
makeArm('arm_R', rig.armR);
makeArm('arm_L', rig.armL);

// ---------- markers (read by the game at runtime) ----------
for (const [mname, pos] of Object.entries(rig.markers)) {
  const n = doc.createNode(mname).setTranslation(sub(pos, grip));
  weapon.addChild(n);
}
weapon.setExtras({ ...rig.extras });
// keep the source credits (CC licenses require attribution)
const srcAsset = JSON.parse(JSON.stringify(doc.getRoot().getAsset()));
doc.getRoot().getAsset().extras = { ...(srcAsset.extras || {}), modifiedBy: 'RIFTLINE tools/weapons: re-rigged, arms + animations added, textures resized' };

// ---------- animations ----------
// keys: [t, [dx,dy,dz], [rx,ry,rz]?]  offsets from bind pose; eased (smoothstep) between keys
function ease(t) { return t * t * (3 - 2 * t); }
function sampleKeys(keys, t, idx) {
  if (t <= keys[0][0]) return keys[0][idx] || [0, 0, 0];
  for (let k = 0; k < keys.length - 1; k++) {
    const a = keys[k], b = keys[k + 1];
    if (t <= b[0]) {
      const f = ease((t - a[0]) / Math.max(1e-6, b[0] - a[0]));
      const va = a[idx] || [0, 0, 0], vb = b[idx] || [0, 0, 0];
      return [va[0] + (vb[0] - va[0]) * f, va[1] + (vb[1] - va[1]) * f, va[2] + (vb[2] - va[2]) * f];
    }
  }
  return keys[keys.length - 1][idx] || [0, 0, 0];
}
for (const [clipName, clip] of Object.entries(rig.clips)) {
  const anim = doc.createAnimation(clipName);
  const dur = clip.duration;
  const frames = Math.max(2, Math.round(dur * 60) + 1);
  const times = new Float32Array(frames).map((_, i) => (i / (frames - 1)) * dur);
  const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
  for (const [nodeName, keysN] of Object.entries(clip.tracks)) {
    const node = nodes[nodeName];
    if (!node) throw new Error(`${name}/${clipName}: no node ${nodeName}`);
    // keys use normalized time 0..1
    const keys = keysN.map((k) => [k[0] * dur, k[1], k[2]]);
    const tr = new Float32Array(frames * 3), rt = new Float32Array(frames * 4);
    for (let f = 0; f < frames; f++) {
      const o = sampleKeys(keys, times[f], 1), r = sampleKeys(keys, times[f], 2);
      const b = binds[nodeName];
      tr.set([b[0] + o[0], b[1] + o[1], b[2] + o[2]], f * 3);
      rt.set(quatEuler(r[0], r[1], r[2]), f * 4);
    }
    for (const [path, arr, type] of [['translation', tr, 'VEC3'], ['rotation', rt, 'VEC4']]) {
      const s = doc.createAnimationSampler().setInput(input).setOutput(doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer)).setInterpolation('LINEAR');
      anim.addSampler(s);
      anim.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(s));
    }
  }
}

// ---------- cleanup, textures, compression ----------
await doc.transform(
  prune({ keepAttributes: false, keepLeaves: true }),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 88, slots: /^(?!normalTexture).*$/ }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 95, slots: /^normalTexture$/ }),
);
if (!process.argv.includes('--nocompress')) {
  await MeshoptEncoder.ready;
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
}
await io.write(out, doc);
const b = bboxOf(root.listMeshes().flatMap((m) => m.listPrimitives()));
console.log(name, 'written', out, 'meshes', root.listMeshes().length, 'anims', root.listAnimations().map((a) => a.getName()).join(','));
