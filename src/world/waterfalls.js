import * as THREE from 'three';
import { groundH, LAKE } from './terrain.js';
import { mulberry32 } from './noise.js';

// Water and air: spray at the foot of the big falls, and the low mist lying over the far lands past
// the rim (the map's barrier). The valley itself stays clear. Soft, shader-animated, no depth write.

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

export function buildWaterfalls() {
  const root = new THREE.Group(); root.name = 'waterfalls';
  const puff = puffTexture();
  const mists = [];
  const mist = (x, y, z, size, op, rise = 0.4, flat = 0.7) => {
    const sm = new THREE.SpriteMaterial({ map: puff, color: 0xf6eaf4, transparent: true, opacity: op, depthWrite: false, fog: true });
    const sp = new THREE.Sprite(sm); sp.position.set(x, y, z); sp.scale.set(size, size * flat, 1);
    sp.userData = { y, ph: rnd() * 6.28, op, rise, size };
    root.add(sp); mists.push(sp);
  };
  // spray at the foot of the big falls (the only mist inside the valley)
  mist(LAKE.x, groundH(LAKE.x, LAKE.z) + 3, LAKE.z, 20, 0.5, 0.7);
  // sea of clouds beyond the rim: a vast soft layer the far plateaus rise out of
  const sea = new THREE.Mesh(new THREE.RingGeometry(300, 1500, 128, 8), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */`
      uniform float uTime; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.07 + 3.1; a *= 0.5; } return s; }
      void main(){
        vec2 p = vW.xz * 0.006 + vec2(uTime * 0.004, uTime * 0.0015);
        float d = fbm(p), r = length(vW.xz);
        float a = smoothstep(0.38, 0.7, d) * smoothstep(300.0, 460.0, r) * 0.7;
        vec3 sun = normalize(vec3(0.868, 0.13, -0.497));
        float toward = max(dot(normalize(vW.xz), normalize(sun.xz)), 0.0);
        vec3 col = mix(vec3(0.72, 0.6, 0.86), vec3(1.25, 0.86, 0.72), toward * 0.8 + smoothstep(0.55, 0.8, d) * 0.3);
        gl_FragColor = vec4(col, a);
      }`,
  }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = 20; sea.renderOrder = 2; sea.frustumCulled = false;
  root.add(sea);
  root.userData.update = (t) => {
    sea.material.uniforms.uTime.value = t;
    for (const sp of mists) {
      const u = sp.userData;
      sp.position.y = u.y + Math.sin(t * 0.4 + u.ph) * u.rise;
      sp.material.opacity = u.op * (0.8 + 0.2 * Math.sin(t * 0.7 + u.ph));
      sp.material.rotation = Math.sin(t * 0.1 + u.ph) * 0.2;
    }
  };
  return root;
}
