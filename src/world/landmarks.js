import * as THREE from 'three';
import { groundH, WATER_Y, FALLS, LAKE, CLIFF } from './terrain.js';
import { mulberry32 } from './noise.js';

// The valley's waterfall (reference: a tall two-tier cascade in the north-west cliff). The cliff is
// part of the terrain (terrain.js); this builds the water: the upper fall from the top tier onto
// the 9 m ledge, a short stream across the ledge, the lower fall into the plunge pool, foam where
// each lands, and drifting mist. Placement is measured from the terrain itself, so the water always
// sits on the rock whatever the cliff noise does.

export function landmarkFootprints() { return [{ x: LAKE.x, z: LAKE.z, r: LAKE.r + 2 }]; }

export function buildLandmarks(world, Q = {}) {
  const root = new THREE.Group(); root.name = 'landmarks';
  const falls = buildFalls(Q);
  root.add(falls.group);
  root.userData.update = (t) => falls.update(t);
  return root;
}

const WATER_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const NOISE = /* glsl */`
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }`;

function fallMaterial(uT, speed = 4.5) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uT },
    vertexShader: WATER_VS,
    fragmentShader: /* glsl */`
      uniform float uT; varying vec2 vUv; ${NOISE}
      void main(){
        float v = vUv.y;
        float s = n2(vec2(vUv.x * 16.0, v * 7.0 - uT * ${speed.toFixed(2)})) * 0.6 + n2(vec2(vUv.x * 34.0, v * 14.0 - uT * ${(speed * 1.6).toFixed(2)})) * 0.4;
        vec3 col = mix(vec3(0.42, 0.7, 0.82), vec3(0.97, 0.99, 1.0), smoothstep(0.3, 0.75, s) * 0.8 + v * 0.25);
        float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
        float a = edge * (0.62 + 0.36 * s);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// curved sheet of falling water from `top` to `bot` (world), bowing out away from the cliff
function fallRibbon(top, bot, width, away, side) {
  const g = new THREE.PlaneGeometry(1, 1, 8, 28);
  const p = g.attributes.position, uv = g.attributes.uv;
  const P = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5, v = 0.5 - p.getY(i); // v: 0 top → 1 bottom
    P.lerpVectors(top, bot, v);
    P.y = top.y + (bot.y - top.y) * Math.pow(v, 1.15);
    P.addScaledVector(away, Math.sin(v * Math.PI * 0.5) * 1.6 * (1 - v * 0.4));
    P.addScaledVector(side, (u - 0.5) * width * (1 + v * 0.45));
    p.setXYZ(i, P.x, P.y, P.z);
    uv.setXY(i, u, v);
  }
  g.computeVertexNormals();
  return g;
}

function flatStrip(at, side, o0, o1, y, width) {
  const g = new THREE.PlaneGeometry(1, 1, 2, 12);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5, v = 0.5 - p.getY(i);
    const P = at(o0 + (o1 - o0) * v, y).addScaledVector(side, (u - 0.5) * width);
    p.setXYZ(i, P.x, P.y, P.z); uv.setXY(i, u, v);
  }
  return g;
}

function buildFalls(Q) {
  const g = new THREE.Group(); g.name = 'falls';
  const rnd = mulberry32(777);
  const out = new THREE.Vector3(Math.cos(FALLS.a), 0, Math.sin(FALLS.a)); // into the cliff
  const away = out.clone().negate();
  const side = new THREE.Vector3(-out.z, 0, out.x);
  const at = (o, y) => new THREE.Vector3(FALLS.x + out.x * o, y, FALLS.z + out.z * o);
  const hOf = (o) => groundH(FALLS.x + out.x * o, FALLS.z + out.z * o);
  // find the two cliff faces along the falls axis
  const mid = (CLIFF.t1 + WATER_Y) * 0.5, mid2 = (CLIFF.t1 + CLIFF.t2) * 0.5 + 0.5;
  let o1 = 0, o2 = 14;
  for (let o = -6; o < 40; o += 0.1) { if (hOf(o) > mid) { o1 = o; break; } }
  for (let o = o1 + 2; o < 50; o += 0.1) { if (hOf(o) > mid2) { o2 = o; break; } }
  const ledgeY = hOf((o1 + o2) / 2) + 0.06;
  const topY = hOf(o2 + 3) + 0.06;
  const uT = { value: 0 };

  const upper = new THREE.Mesh(fallRibbon(at(o2 + 0.6, topY), at(o2 - 1.6, ledgeY), 6.0, away, side), fallMaterial(uT, 4.8));
  const stream = new THREE.Mesh(flatStrip(at, side, o2 - 1.6, o1 + 0.6, ledgeY, 5.5), fallMaterial(uT, 2.2));
  const topStream = new THREE.Mesh(flatStrip(at, side, o2 + 9, o2 + 0.6, topY, 5.0), fallMaterial(uT, 2.2));
  // lower fall: ledge → pool (wider: the reference's big lower curtain)
  const lower = new THREE.Mesh(fallRibbon(at(o1 + 0.6, ledgeY), at(o1 - 2.8, WATER_Y - 0.1), 9.0, away, side), fallMaterial(uT, 5.2));
  for (const m of [upper, stream, topStream, lower]) { m.renderOrder = 3; g.add(m); }

  // foam where each fall lands
  const foamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uT },
    vertexShader: WATER_VS,
    fragmentShader: /* glsl */`
      uniform float uT; varying vec2 vUv; ${NOISE}
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p);
        float n = n2(p * 6.0 + vec2(0.0, -uT * 1.5)) * 0.6 + n2(vec2(atan(p.y, p.x) * 3.0, r * 8.0 - uT * 2.5)) * 0.4;
        float a = smoothstep(1.0, 0.2, r) * smoothstep(0.3, 0.7, n) * 0.9;
        gl_FragColor = vec4(vec3(0.96, 0.98, 1.0), a);
      }`,
  });
  const foamAt = (P, r) => { const f = new THREE.Mesh(new THREE.CircleGeometry(r, 32), foamMat); f.rotation.x = -Math.PI / 2; f.position.copy(P); f.renderOrder = 4; g.add(f); };
  foamAt(at(o1 - 3.4, WATER_Y + 0.05), 7.5);
  foamAt(at(o2 - 2.4, ledgeY + 0.04), 3.6);

  // drifting mist
  const mistTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const mists = [];
  const nMist = Q.particles && Q.particles < 3000 ? 6 : 12;
  for (let i = 0; i < nMist; i++) {
    const low = i < nMist * 0.7;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex, transparent: true, depthWrite: false, opacity: 0.3 }));
    const base = low ? at(o1 - 3.5, WATER_Y + 0.8) : at(o2 - 2.4, ledgeY + 0.8);
    s.position.copy(base).addScaledVector(side, (rnd() - 0.5) * 9).addScaledVector(away, rnd() * 3); s.position.y += rnd() * 2.5;
    s.userData = { base: s.position.clone(), ph: rnd() * 6, big: low ? 5 : 3 };
    s.scale.setScalar(s.userData.big);
    mists.push(s); g.add(s);
  }
  return {
    group: g,
    update: (t) => {
      uT.value = t;
      for (const m of mists) {
        const k = 0.5 + 0.5 * Math.sin(t * 0.7 + m.userData.ph);
        m.material.opacity = 0.18 + k * 0.22;
        m.scale.setScalar(m.userData.big * (0.85 + k * 0.4));
        m.position.y = m.userData.base.y + k * 1.2;
      }
    },
  };
}
