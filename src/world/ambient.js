import * as THREE from 'three';
import { groundH, PLAY_RADIUS } from './terrain.js';
import { mulberry32 } from './noise.js';

// Ambient life, all animated on the GPU from a single time uniform (no per-frame CPU work):
//   - sakura petals tumbling down through and around every blossom grove
//   - butterflies fluttering over the meadow (wing flap + wandering loops)
//   - dandelion seeds drifting on the breeze around the camera

const rnd = mulberry32(8080);

function petals(groves) {
  const per = 260, n = groves.length * per;
  const pos = new Float32Array(n * 3), ph = new Float32Array(n), hi = new Float32Array(n);
  let k = 0;
  for (const g of groves) for (let i = 0; i < per; i++, k++) {
    const a = rnd() * 6.28, d = Math.sqrt(rnd()) * (g.r + 5), x = g.x + Math.cos(a) * d, z = g.z + Math.sin(a) * d;
    pos.set([x, groundH(x, z), z], k * 3); ph[k] = rnd() * 100; hi[k] = 5 + rnd() * 4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  geo.setAttribute('hi', new THREE.BufferAttribute(hi, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: /* glsl */`
      attribute float phase, hi; uniform float uTime; varying float vA, vSpin;
      #include <fog_pars_vertex>
      void main(){
        float fall = 0.55 + fract(phase * 7.13) * 0.5;
        float t = mod(uTime * fall + phase, hi);
        vec3 p = position;
        p.y += hi - t;
        p.x += sin(uTime * 0.9 + phase) * 0.8 + t * 0.35;   // drift with the breeze
        p.z += cos(uTime * 0.7 + phase * 1.3) * 0.8;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(140.0 / -mvPosition.z, 1.5, 9.0);
        vA = smoothstep(0.0, 0.6, t) * smoothstep(hi, hi - 0.8, t) * smoothstep(90.0, 30.0, -mvPosition.z);
        vSpin = uTime * (2.0 + fract(phase) * 3.0) + phase;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying float vA, vSpin;
      #include <fog_pars_fragment>
      void main(){
        // a little tumbling oval petal
        vec2 q = gl_PointCoord - 0.5;
        float c = cos(vSpin), s = sin(vSpin);
        q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
        q.y *= 1.0 + 0.8 * abs(sin(vSpin * 0.7));
        float d = length(q * vec2(1.0, 1.8));
        if (d > 0.5) discard;
        gl_FragColor = vec4(mix(vec3(1.0, 0.72, 0.84), vec3(1.0, 0.92, 0.95), smoothstep(0.5, 0.0, d)), vA * 0.95);
        #include <fog_fragment>
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.name = 'petalsFall';
  return pts;
}

function butterflies(count) {
  // two wing quads hinged on the body axis (local x = across the wings)
  const g = new THREE.BufferGeometry();
  const P = [0, 0, -0.05, 0.11, 0.02, -0.09, 0.1, 0, 0.07, 0, 0, 0.05, -0.11, 0.02, -0.09, -0.1, 0, 0.07];
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 0, 4, 5, 0, 5, 3]);
  const m = new THREE.InstancedMesh(g, new THREE.ShaderMaterial({
    side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: /* glsl */`
      uniform float uTime; varying vec3 vCol;
      #include <fog_pars_vertex>
      void main(){
        vec3 base = instanceMatrix[3].xyz;
        float ph = base.x * 0.37 + base.z * 0.71;
        // flap: wings rotate about the body axis
        float flap = sin(uTime * 22.0 + ph * 5.0) * 1.1;
        vec3 p = position;
        float sgn = sign(p.x);
        float r = abs(p.x);
        p.x = sgn * r * cos(flap); p.y += r * sin(flap);
        // wander: a lazy figure-of-eight hop around its spot
        vec3 o = vec3(sin(uTime * 0.6 + ph) * 3.0, 0.9 + sin(uTime * 1.7 + ph * 2.0) * 0.35 + sin(uTime * 0.3 + ph) * 0.4, sin(uTime * 1.2 + ph * 1.3) * 1.6);
        float head = atan(cos(uTime * 0.6 + ph) * 3.0 * 0.6, cos(uTime * 1.2 + ph * 1.3) * 1.6 * 1.2);
        float ch = cos(head), sh = sin(head);
        p = vec3(ch * p.x + sh * p.z, p.y, -sh * p.x + ch * p.z) * 1.6;
        vec4 mvPosition = viewMatrix * vec4(base + o + p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vCol = instanceColor;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol;
      #include <fog_pars_fragment>
      void main(){ gl_FragColor = vec4(vCol, 1.0);
        #include <fog_fragment>
      }`,
  }), count);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  const cols = [[1, 1, 0.95], [1, 0.86, 0.3], [0.45, 0.7, 1], [1, 0.6, 0.25], [0.9, 0.75, 1]];
  for (let i = 0; i < count; i++) {
    const a = rnd() * 6.28, d = 20 + Math.sqrt(rnd()) * (PLAY_RADIUS - 40), x = Math.cos(a) * d, z = Math.sin(a) * d;
    m4.makeTranslation(x, groundH(x, z), z);
    m.setMatrixAt(i, m4);
    const cc = cols[Math.floor(rnd() * cols.length)];
    m.setColorAt(i, c.setRGB(cc[0], cc[1], cc[2]));
  }
  m.frustumCulled = false; m.name = 'butterflies';
  return m;
}

function seeds() {
  const n = 260;
  const pos = new Float32Array(n * 3), ph = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos.set([(rnd() - 0.5) * 70, rnd() * 9, (rnd() - 0.5) * 70], i * 3); ph[i] = rnd() * 100; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uC: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */`
      attribute float phase; uniform float uTime; uniform vec3 uC; varying float vA;
      void main(){
        vec3 p = position;
        p.x += uTime * 1.1 + sin(uTime * 0.4 + phase) * 2.0;
        p.z += uTime * 0.4 + cos(uTime * 0.3 + phase * 1.7) * 2.0;
        p.y += sin(uTime * 0.6 + phase) * 0.8;
        p.xz = uC.xz + mod(p.xz - uC.xz + 35.0, 70.0) - 35.0;
        p.y += uC.y - 1.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(60.0 / -mv.z, 1.0, 4.0);
        vA = smoothstep(45.0, 8.0, -mv.z) * (0.55 + 0.45 * sin(uTime * 1.5 + phase * 3.0));
      }`,
    fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(1.0, 1.0, 0.96, vA * 0.75 * smoothstep(0.5, 0.1, d)); }',
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false; p.name = 'seeds';
  return p;
}

export function buildAmbient(groves = [], Q = {}) {
  const root = new THREE.Group(); root.name = 'ambient';
  const lite = Q.particles && Q.particles <= 2000;
  const parts = [];
  if (groves.length) parts.push(petals(lite ? groves.slice(0, 2) : groves));
  parts.push(butterflies(lite ? 24 : 70));
  const sd = seeds(); parts.push(sd);
  for (const p of parts) root.add(p);
  root.userData.update = (t, cam) => {
    for (const p of parts) p.material.uniforms.uTime.value = t;
    if (cam) sd.material.uniforms.uC.value.copy(cam);
  };
  return root;
}
