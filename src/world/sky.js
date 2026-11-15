import * as THREE from 'three';
import { makeNoise } from './noise.js';
import { stylize } from './stylize.js';

// Golden-hour sky dome: gradient, sun disc + glow, two layers of drifting fBm clouds.
// Also the distant mountain ring that sits in the haze behind the meadow hills.

export const SUN_DIR = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
export const SKY = {
  zenith: new THREE.Color(0.09, 0.27, 0.72),
  horizon: new THREE.Color(0.6, 0.72, 0.86),
  fog: new THREE.Color(0.62, 0.72, 0.82),
  sun: new THREE.Color(1.0, 0.86, 0.66),
};

export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTime: { value: 0 }, uSun: { value: SUN_DIR }, uZen: { value: SKY.zenith }, uHor: { value: SKY.horizon }, uSunCol: { value: SKY.sun },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uSun, uZen, uHor, uSunCol; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHor, uZen, pow(h, 0.55));
        // warm band toward the sun near the horizon
        float sd = max(dot(d, uSun), 0.0);
        col = mix(col, vec3(1.0, 0.78, 0.55), pow(sd, 6.0) * (1.0 - h) * 0.55);
        // clouds projected on a flat layer
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.12) * 1.6;
          float t = uTime * 0.012;
          float c = fbm(uv + vec2(t, t * 0.4));
          float c2 = fbm(uv * 2.3 - vec2(t * 1.7, 0.0));
          float cov = smoothstep(0.48, 0.78, c * 0.75 + c2 * 0.35);
          vec3 cloudLit = mix(vec3(1.0, 0.95, 0.88), vec3(1.0, 0.82, 0.62), pow(sd, 3.0));
          vec3 cloudShade = vec3(0.62, 0.66, 0.76);
          vec3 cc = mix(cloudShade, cloudLit, smoothstep(0.3, 0.85, c2 + sd * 0.4));
          col = mix(col, cc, cov * smoothstep(0.0, 0.18, d.y) * 0.92);
        }
        // sun
        col += uSunCol * (pow(sd, 900.0) * 5.0 + pow(sd, 90.0) * 0.3 + pow(sd, 10.0) * 0.08);
        // below horizon: haze
        col = mix(col, uHor * 0.92, smoothstep(0.0, -0.08, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.name = 'sky';
  return mesh;
}

export function buildMountains() {
  const n = makeNoise(2024);
  const g = new THREE.BufferGeometry();
  const seg = 220, rings = 7;
  const pos = [], col = [], idx = [];
  const near = new THREE.Color(0.32, 0.42, 0.36), far = new THREE.Color(0.58, 0.66, 0.78), snow = new THREE.Color(0.92, 0.94, 0.98);
  for (let r = 0; r < rings; r++) {
    const rad = 620 + r * 90;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const ridge = 1 - Math.abs(n.n2(Math.cos(a) * 4 + 3, Math.sin(a) * 4));
      let h = r === 0 || r === rings - 1 ? -20 : (90 + 170 * Math.pow(ridge, 2.2) * (0.5 + 0.5 * n.fbm(Math.cos(a) * 9, Math.sin(a) * 9, 4))) * Math.sin((r / (rings - 1)) * Math.PI);
      pos.push(x, h, z);
      const c = near.clone().lerp(far, 0.35 + r / rings * 0.4);
      if (h > 170) c.lerp(snow, Math.min(1, (h - 170) / 60));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let r = 0; r < rings - 1; r++) for (let i = 0; i < seg; i++) {
    const a = r * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, stylize(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { wrap: 0.5, band: 0.1 }));
  m.name = 'mountains';
  return m;
}
