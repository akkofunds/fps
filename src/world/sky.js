import * as THREE from 'three';
import { makeNoise } from './noise.js';
import { stylize } from './stylize.js';

// Golden-hour sky dome: gradient, sun disc + glow, two layers of drifting fBm clouds.
// Also the distant mountain ring that sits in the haze behind the meadow hills.

export const SUN_DIR = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
export const SKY = {
  zenith: new THREE.Color(0.06, 0.24, 0.74),
  horizon: new THREE.Color(0.62, 0.76, 0.92),
  fog: new THREE.Color(0.66, 0.77, 0.9),
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

// The Alps: a ring of jagged, snow-capped peaks far beyond the meadow. Ridged multifractal noise
// around the ring, rock on steep faces, snow above the treeline, dark conifer forest at the
// foot, and aerial perspective baked into the vertex colors (they are unfogged so they stay crisp).
export function buildMountains() {
  const n = makeNoise(2024);
  const g = new THREE.BufferGeometry();
  const seg = 360, rings = 40;
  const R0 = 620, R1 = 1450;
  const pos = [], idx = [];
  const ridged = (x, z) => {
    let s = 0, a = 1, f = 1, w = 1;
    for (let o = 0; o < 5; o++) {
      let v = 1 - Math.min(1, Math.abs(n.n2(x * f, z * f))); // n2 is ~[-1, 1]
      v = v * v * w; w = Math.min(1, v * 1.6);
      s += v * a; a *= 0.5; f *= 2.05;
    }
    return s;
  };
  for (let r = 0; r <= rings; r++) {
    const u = r / rings;
    const rad = R0 + (R1 - R0) * u;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      // two ranges: a nearer, lower one and the high snowy wall behind it
      const near = Math.exp(-((u - 0.22) ** 2) / 0.012), far = Math.exp(-((u - 0.62) ** 2) / 0.05);
      const nx = x / 620, nz = z / 620;
      const rf = ridged(nx * 0.9 - 3, nz * 0.9 + 11);
      let h = near * (30 + 85 * ridged(nx + 7, nz)) + far * (110 + 300 * Math.pow(rf / 1.6, 1.4) * 1.6);
      h *= 0.75 + 0.25 * (n.n2(Math.cos(a) * 3 + 1, Math.sin(a) * 3) * 0.5 + 0.5);
      if (r === 0 || r === rings) h = -30;
      pos.push(x, h - 25, z);
    }
  }
  for (let r = 0; r < rings; r++) for (let i = 0; i < seg; i++) {
    const a = r * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // colors from height, slope and distance
  const P = g.attributes.position, Nn = g.attributes.normal, col = new Float32Array(P.count * 3), c = new THREE.Color();
  const forest = new THREE.Color(0.1, 0.22, 0.12), meadow = new THREE.Color(0.28, 0.42, 0.16), rock = new THREE.Color(0.42, 0.42, 0.44), snow = new THREE.Color(0.97, 0.98, 1.0), haze = new THREE.Color(0.66, 0.76, 0.9);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), ny = Nn.getY(i);
    const d = Math.hypot(x, z);
    const jit = n.n2(x / 40, z / 40) * 30;
    c.copy(forest).lerp(meadow, Math.min(1, Math.max(0, (y - 30 + jit) / 50)) * 0.7);
    c.lerp(rock, Math.min(1, Math.max(0, (y - 85 + jit) / 45)));
    c.lerp(rock, Math.min(1, Math.max(0, (0.6 - ny) / 0.3)) * 0.55);
    const snowK = Math.min(1, Math.max(0, (y - 135 + jit * 1.5) / 30)) * Math.min(1, Math.max(0, (ny - 0.1) / 0.2));
    c.lerp(snow, snowK);
    c.lerp(haze, Math.min(0.6, Math.max(0, (d - 600) / 1400)));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, stylize(new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }), { wrap: 0.45, band: 0.08, clouds: true }));
  m.name = 'mountains';
  m.frustumCulled = false;
  return m;
}
