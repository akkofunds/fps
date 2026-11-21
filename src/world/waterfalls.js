import * as THREE from 'three';
import { groundH, CLIFF, LAKE, PLAY_RADIUS } from './terrain.js';
import { mulberry32 } from './noise.js';

// Water and air: cascades pouring down the valley walls (each with a churning mist plume at its
// foot), low mist banks hugging the cliff bottoms, and a sea of clouds out past the rim that the
// far plateaus rise out of. All soft, shader-animated, depth-write off.

const rnd = mulberry32(3131);

// ---------------------------------------------------------------- textures
let PUFF = null;
function puffTexture() {
  if (PUFF) return PUFF;
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const r = mulberry32(5);
  for (let i = 0; i < 40; i++) {
    const a = r() * 6.28, d = r() * 34, x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d * 0.7, rr = 14 + r() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (PUFF = t);
}

// ---------------------------------------------------------------- cascades
const FALL_VS = /* glsl */`
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const FALL_FS = /* glsl */`
  uniform float uTime; varying vec2 vUv;
  #include <fog_pars_fragment>
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
  void main(){
    // streaks racing down + churning foam toward the bottom
    float s = n(vec2(vUv.x * 18.0, vUv.y * 4.0 + uTime * 2.6)) * 0.55 + n(vec2(vUv.x * 42.0, vUv.y * 9.0 + uTime * 3.6)) * 0.45;
    float foam = smoothstep(0.35, 0.0, vUv.y) * (0.5 + 0.5 * n(vec2(vUv.x * 10.0 + uTime, vUv.y * 6.0 + uTime * 3.0)));
    float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
    float top = smoothstep(1.0, 0.94, vUv.y);
    vec3 col = mix(vec3(0.5, 0.66, 0.86), vec3(1.0, 0.97, 1.0), clamp(s * 0.9 + foam, 0.0, 1.0));
    col = mix(col, vec3(1.15, 0.9, 0.78), 0.18);   // warm evening light on the spray
    gl_FragColor = vec4(col, edge * top * (0.55 + 0.45 * s + foam * 0.4));
    #include <fog_fragment>
  }`;

function cliffAt(a) {
  // walk out from the meadow to the foot of the first cliff tier at compass angle a
  let r = 60;
  while (r < PLAY_RADIUS + 140 && groundH(Math.cos(a) * r, Math.sin(a) * r) < 2.2) r += 1;
  let top = r;
  while (top < r + 14 && groundH(Math.cos(a) * top, Math.sin(a) * top) < CLIFF.t1 - 0.6) top += 0.5;
  return { foot: r, top };
}

export function buildWaterfalls(Q = {}) {
  const root = new THREE.Group(); root.name = 'waterfalls';
  const fallMat = new THREE.ShaderMaterial({
    vertexShader: FALL_VS, fragmentShader: FALL_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
  });
  const puff = puffTexture();
  const mists = [];
  const mist = (x, y, z, size, op, rise = 0.4, flat = 0.7) => {
    const sm = new THREE.SpriteMaterial({ map: puff, color: 0xf6eaf4, transparent: true, opacity: op, depthWrite: false, fog: true });
    const sp = new THREE.Sprite(sm); sp.position.set(x, y, z); sp.scale.set(size, size * flat, 1);
    sp.userData = { y, ph: rnd() * 6.28, op, rise, size };
    root.add(sp); mists.push(sp);
  };
  // cascades down the valley walls (skipping the big falls and the river gaps)
  for (const a of [-0.85, -1.38, 0.28, 2.18, -1.82, 0.72]) {
    if (Math.abs(a - Math.atan2(LAKE.z, LAKE.x)) < 0.4) continue;
    const { foot, top } = cliffAt(a);
    if (foot > PLAY_RADIUS + 120) continue;
    const yTop = groundH(Math.cos(a) * (top + 1.5), Math.sin(a) * (top + 1.5)) + 0.2, yBot = groundH(Math.cos(a) * (foot - 3), Math.sin(a) * (foot - 3)) - 0.3;
    const w = 6 + rnd() * 6, hh = yTop - yBot;
    const g = new THREE.PlaneGeometry(w, hh, 1, 1);
    const m = new THREE.Mesh(g, fallMat);
    const rr = foot + (top - foot) * 0.35;
    m.position.set(Math.cos(a) * rr, (yTop + yBot) / 2, Math.sin(a) * rr);
    m.lookAt(0, m.position.y, 0);
    m.rotateX(-0.12);
    root.add(m);
    const bx = Math.cos(a) * (foot - 4), bz = Math.sin(a) * (foot - 4), by = groundH(bx, bz);
    mist(bx, by + 2.2, bz, w * 2.0, 0.55, 0.6, 0.6); mist(bx + 2, by + 4, bz - 1, w * 2.6, 0.3, 0.9, 0.5);
  }
  // the big falls get a plume too
  mist(LAKE.x, groundH(LAKE.x, LAKE.z) + 3, LAKE.z, 22, 0.7, 0.7); mist(LAKE.x + 3, groundH(LAKE.x, LAKE.z) + 7, LAKE.z + 2, 30, 0.42, 1.0);
  // low mist banks along the cliff feet all round the valley
  const nBank = Q.particles && Q.particles <= 2000 ? 14 : 28;
  for (let i = 0; i < nBank; i++) {
    const a = (i / nBank) * Math.PI * 2 + rnd() * 0.2;
    const { foot } = cliffAt(a);
    if (foot > PLAY_RADIUS + 120) continue;
    const r = foot - 8 - rnd() * 10, x = Math.cos(a) * r, z = Math.sin(a) * r;
    mist(x, groundH(x, z) + 1.6 + rnd() * 1.5, z, 40 + rnd() * 26, 0.16 + rnd() * 0.08, 0.15, 0.22);
  }
  // sea of clouds beyond the rim: a vast soft layer the far plateaus rise out of
  const sea = new THREE.Mesh(new THREE.RingGeometry(330, 1500, 96, 6), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.07 + 3.1; a *= 0.5; } return s; }
      void main(){
        vec2 p = vW.xz * 0.004 + vec2(uTime * 0.004, uTime * 0.0015);
        float d = fbm(p), r = length(vW.xz);
        float a = smoothstep(0.38, 0.7, d) * smoothstep(330.0, 420.0, r) * 0.85;
        vec3 sun = normalize(vec3(-0.72, 0.2, 0.66));
        float toward = max(dot(normalize(vW.xz), normalize(sun.xz)), 0.0);
        vec3 col = mix(vec3(0.72, 0.6, 0.86), vec3(1.25, 0.86, 0.72), toward * 0.8 + smoothstep(0.55, 0.8, d) * 0.3);
        gl_FragColor = vec4(col, a);
      }`,
  }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = 26; sea.renderOrder = 2; sea.frustumCulled = false;
  root.add(sea);
  root.userData.update = (t) => {
    fallMat.uniforms.uTime.value = t; sea.material.uniforms.uTime.value = t;
    for (const sp of mists) {
      const u = sp.userData;
      sp.position.y = u.y + Math.sin(t * 0.4 + u.ph) * u.rise;
      sp.material.opacity = u.op * (0.8 + 0.2 * Math.sin(t * 0.7 + u.ph));
      sp.material.rotation = Math.sin(t * 0.1 + u.ph) * 0.2;
    }
  };
  return root;
}
