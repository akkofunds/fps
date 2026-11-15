import * as THREE from 'three';
import { groundH, groundNormal, grassColorAt, pathDist, PLAZA, lakeWaterDepth, PLAY_RADIUS, HILL, terrainNoise as N } from './terrain.js';
import { mulberry32, smoothstep } from './noise.js';

// Instanced grass tufts and wildflowers with a shared wind + trample shader patch.
// Grass is split into chunks so the renderer frustum-culls most of it.

export const WIND = { uTime: { value: 0 }, uPush: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, -999, 0, 0.9)) } };

function windPatch(material, strength = 1, push = true) {
  material.onBeforeCompile = (sh) => {
    // blades are lit like the ground on both faces (no dark back faces)
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
    sh.uniforms.uTime = WIND.uTime;
    sh.uniforms.uPush = WIND.uPush;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform vec4 uPush[8];`)
      .replace('#include <project_vertex>', /* glsl */`
        #ifdef USE_INSTANCING
          vec3 root = instanceMatrix[3].xyz;
        #else
          vec3 root = vec3(0.0);
        #endif
        // blades right in front of the camera shrink away so they never block the view
        float camNear = smoothstep(0.8, 3.2, distance(root.xz, cameraPosition.xz));
        vec4 mvPosition = vec4( transformed * vec3(1.0, mix(0.15, 1.0, camNear), 1.0), 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
        #endif
        float hgt = clamp(position.y, 0.0, 1.0);
        float w = sin(uTime * 1.7 + root.x * 0.23 + root.z * 0.17) * 0.5 + sin(uTime * 2.9 + root.x * 0.61 - root.z * 0.43) * 0.25;
        float gust = smoothstep(0.1, 1.0, sin(uTime * 0.37 + root.x * 0.045 + root.z * 0.03));
        vec2 bend = vec2(0.82, 0.5) * (w * 0.1 + gust * 0.22) * ${strength.toFixed(2)};
        ${push ? `for (int i = 0; i < 8; i++) {
          vec3 d = root - uPush[i].xyz; float dd = length(d.xz);
          float infl = (1.0 - smoothstep(0.0, uPush[i].w, dd)) * step(abs(d.y), 1.6);
          bend += (d.xz / max(dd, 0.001)) * infl * 0.75;
        }` : ''}
        float k = hgt * hgt;
        mvPosition.xz += bend * k;
        mvPosition.y -= dot(bend, bend) * k * 0.3;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
  };
}

function tuftGeometry(blades = 3) {
  const pos = [], col = [], nrm = [], idx = [];
  const rnd = mulberry32(5);
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI + rnd() * 0.6;
    const ca = Math.cos(a), sa = Math.sin(a);
    const ox = (rnd() - 0.5) * 0.12, oz = (rnd() - 0.5) * 0.12;
    const lean = 0.18 + rnd() * 0.2, h = 0.75 + rnd() * 0.25;
    const base = pos.length / 3;
    const segs = [[0, 0.075], [0.38, 0.062], [0.72, 0.038], [1, 0]];
    for (const [t, w] of segs) {
      const y = t * h, f = lean * t * t;
      // blade plane perpendicular to (ca, sa); lean along it
      for (const sgn of t === 1 ? [0] : [-1, 1]) {
        pos.push(ox + -sa * w * sgn + ca * f, y, oz + ca * w * sgn + sa * f);
        const shade = 0.55 + 0.5 * Math.pow(t, 0.7);
        col.push(shade, shade, shade * 0.95);
        nrm.push(0, 1, 0);
      }
    }
    // indices: pairs (0,1) (2,3) (4,5) tip 6
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4, base + 3, base + 5, base + 4, base + 4, base + 5, base + 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

function flowerGeometry(tint) {
  // stem + 4-petal cross head (head vertex color white → tinted per mesh)
  const pos = [], col = [], nrm = [], idx = [];
  const stem = (x0, x1) => { const b = pos.length / 3; pos.push(x0, 0, 0, x1, 0, 0, x0 * 0.4, 0.82, 0, x1 * 0.4, 0.82, 0); for (let i = 0; i < 4; i++) { col.push(0.25, 0.45, 0.12); nrm.push(0, 1, 0); } idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); };
  stem(-0.012, 0.012);
  const head = (rot) => {
    const b = pos.length / 3; const c = Math.cos(rot), s = Math.sin(rot); const r = 0.075;
    const pts = [[0, 0.8, 0], [c * r, 0.86, s * r], [-s * r, 0.88, c * r], [-c * r, 0.86, -s * r], [s * r, 0.88, -c * r]];
    for (const p of pts) { pos.push(...p); col.push(tint.r, tint.g, tint.b); nrm.push(0, 1, 0); }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 3, b + 4, b, b + 4, b + 1);
  };
  head(0); head(0.78);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

export function grassAllowed(x, z, avoid) {
  const r = Math.hypot(x, z);
  if (r < PLAZA.r + 0.6) return 0;
  if (lakeWaterDepth(x, z) > 0) return 0;
  if (avoid && avoid(x, z)) return 0;
  const pd = pathDist(x, z);
  let d = smoothstep(0.7, 2.2, pd);
  d *= 1 - smoothstep(PLAY_RADIUS + 14, PLAY_RADIUS + 30, r) * 0.7;
  d *= 0.55 + 0.45 * smoothstep(-0.5, 0.4, N.fbm(x / 9 + 3, z / 9 - 8, 2));
  return d;
}

export function buildGrass(count, avoid) {
  const group = new THREE.Group();
  group.name = 'grass';
  const geo = tuftGeometry(4);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  windPatch(mat, 1, true);
  const R = PLAY_RADIUS + 26;
  const CH = 22;
  const chunks = new Map();
  const rnd = mulberry32(42);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), nrm = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 4) {
    tries++;
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * R;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const d = grassAllowed(x, z, avoid);
    if (rnd() > d) continue;
    const h = groundH(x, z);
    groundNormal(x, z, nrm);
    if (nrm.y < 0.72) continue;
    const key = Math.floor(x / CH) + ',' + Math.floor(z / CH);
    let ch = chunks.get(key); if (!ch) chunks.set(key, ch = []);
    const tall = 0.42 + rnd() * 0.32 + 0.25 * smoothstep(0, 0.7, N.fbm(x / 14, z / 14, 2));
    q.setFromUnitVectors(up, nrm.lerp(up, 0.6).normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(up, rnd() * Math.PI * 2));
    s.set(0.9 + rnd() * 0.5, tall * (0.85 + d * 0.15), 0.9 + rnd() * 0.5);
    p.set(x, h - 0.02, z);
    m4.compose(p, q, s);
    grassColorAt(x, z, c);
    c.offsetHSL((rnd() - 0.5) * 0.03, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.08);
    ch.push([m4.clone(), c.clone()]);
    placed++;
  }
  for (const list of chunks.values()) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([mm, cc], i) => { im.setMatrixAt(i, mm); im.setColorAt(i, cc); });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.boundingSphere.radius += 1;
    im.receiveShadow = true;
    group.add(im);
  }
  return group;
}

export function buildFlowers(count, avoid) {
  const group = new THREE.Group();
  group.name = 'flowers';
  const tints = [new THREE.Color(1, 1, 0.96), new THREE.Color(1, 0.84, 0.2), new THREE.Color(0.66, 0.46, 1), new THREE.Color(1, 0.36, 0.3), new THREE.Color(0.45, 0.65, 1)];
  const rnd = mulberry32(77);
  const per = tints.map(() => []);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let n = 0, tries = 0;
  while (n < count && tries < count * 30) {
    tries++;
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * (PLAY_RADIUS + 12);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const patch = N.fbm(x / 11 + 50, z / 11 - 20, 2);
    if (patch < 0.18 + rnd() * 0.25) continue;
    if (!grassAllowed(x, z, avoid) || Math.hypot(x - HILL.x, z - HILL.z) < 3.5) continue;
    const t = Math.floor((N.n2(x / 25, z / 25) * 0.5 + 0.5) * tints.length * 0.999 + rnd() * 1.4) % tints.length;
    q.setFromAxisAngle(up, rnd() * 6.28);
    const sc = 0.45 + rnd() * 0.35;
    m4.compose(new THREE.Vector3(x, groundH(x, z) - 0.02, z), q, new THREE.Vector3(sc, sc * (0.8 + rnd() * 0.5), sc));
    per[t].push(m4.clone());
    n++;
  }
  per.forEach((list, i) => {
    if (!list.length) return;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    windPatch(mat, 0.8, true);
    const im = new THREE.InstancedMesh(flowerGeometry(tints[i]), mat, list.length);
    list.forEach((mm, k) => im.setMatrixAt(k, mm));
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
}

export { windPatch };
