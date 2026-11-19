import * as THREE from 'three';
import { makeNoise } from './noise.js';
import { stylize } from './stylize.js';

// Golden-hour sky dome: gradient, sun disc + glow, two layers of drifting fBm clouds.
// Also the distant mountain ring that sits in the haze behind the meadow hills.

export const SUN_DIR = new THREE.Vector3(0.42, 0.68, 0.6).normalize(); // high, from the south-east: the falls cliff is sunlit (reference)
export const SKY = {
  zenith: new THREE.Color(0.02, 0.15, 0.72),
  horizon: new THREE.Color(0.36, 0.62, 0.96),
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
        vec3 col = mix(uHor, uZen, pow(h, 0.35));
        // warm band toward the sun near the horizon
        float sd = max(dot(d, uSun), 0.0);
        col = mix(col, vec3(1.0, 0.78, 0.55), pow(sd, 6.0) * (1.0 - h) * 0.55);
        // puffy cumulus on a flat layer, self-shadowed: compare density with a sample shifted
        // toward the sun → bright sunlit rims, soft blue-grey bellies
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.14) * 0.8;
          float t = uTime * 0.01;
          vec2 o1 = vec2(t, t * 0.35), o2 = vec2(-t * 1.6, t * 0.2);
          float dens = fbm(uv * 0.55 + o1) * 0.85 + (1.0 - abs(fbm(uv * 2.2 + o2) * 2.0 - 1.0)) * 0.2;
          vec2 sh = normalize(uSun.xz + vec2(1e-4)) * 0.09;
          float dens2 = fbm((uv + sh) * 0.55 + o1) * 0.85 + (1.0 - abs(fbm((uv + sh) * 2.2 + o2) * 2.0 - 1.0)) * 0.2;
          float cov = smoothstep(0.6, 0.7, dens);   // distinct cumulus with blue sky between
          float lit = clamp(0.62 + (dens - dens2) * 7.0, 0.0, 1.0);
          vec3 cc = mix(vec3(0.62, 0.7, 0.86), vec3(1.15, 1.13, 1.1), lit);
          cc = mix(cc, vec3(1.15, 0.98, 0.82), pow(sd, 5.0) * 0.6);
          cc += vec3(0.25, 0.22, 0.18) * smoothstep(0.62, 0.52, dens) * cov; // bright thin edges
          col = mix(col, cc, cov * smoothstep(0.0, 0.16, d.y) * 0.96);
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

// The far landscape (reference: Genshin meadow): layered stone cliffs and plateaus with grassy
// tops, stepping up into soft, rounded blue ridges lost in the haze. Terraced fBm (flat treads,
// near-vertical risers), grey stone with strata on the risers, green on the treads, and strong aerial
// perspective baked into the vertex colors (they are unfogged so they stay crisp).
export function buildMountains() {
  const n = makeNoise(2024);
  const g = new THREE.BufferGeometry();
  const seg = 420, rings = 56;
  const R0 = 560, R1 = 1450;
  const pos = [], idx = [];
  // flat treads with a steep riser over the last `sharp` of each step
  const terrace = (v, step, sharp) => { const f = v / step, i = Math.floor(f), t = f - i; const k = Math.min(1, Math.max(0, (t - (1 - sharp)) / sharp)); return (i + k * k * (3 - 2 * k)) * step; };
  for (let r = 0; r <= rings; r++) {
    const u = r / rings;
    const rad = R0 + (R1 - R0) * Math.pow(u, 1.3);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const nx = x / 520, nz = z / 520;
      // near: terraced cliff plateaus; far: smooth rolling ridges
      const plate = 70 * (0.55 + 0.6 * n.fbm(nx * 1.4 + 3, nz * 1.4 - 2, 4)) * Math.min(1, u / 0.12);
      const near = terrace(plate, 24, 0.22) * Math.exp(-((u - 0.2) ** 2) / 0.05);
      const far = (90 + 170 * Math.max(0, n.fbm(nx * 0.7 - 9, nz * 0.7 + 4, 4) + 0.15)) * Math.exp(-((u - 0.68) ** 2) / 0.08);
      let h = Math.max(near, far * 0.85 + near * 0.3);
      if (r === 0 || r === rings) h = -30;
      pos.push(x, h - 20, z);
    }
  }
  for (let r = 0; r < rings; r++) for (let i = 0; i < seg; i++) {
    const a = r * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const P = g.attributes.position, Nn = g.attributes.normal, col = new Float32Array(P.count * 3), c = new THREE.Color();
  const top = new THREE.Color(0.3, 0.55, 0.16), topDark = new THREE.Color(0.14, 0.34, 0.12);
  const stone = new THREE.Color(0.58, 0.6, 0.6), stoneDark = new THREE.Color(0.36, 0.38, 0.4);
  const haze = new THREE.Color(0.55, 0.7, 0.88), hazeFar = new THREE.Color(0.66, 0.78, 0.93);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), ny = Nn.getY(i);
    const d = Math.hypot(x, z);
    c.copy(topDark).lerp(top, 0.5 + 0.5 * n.n2(x / 35, z / 35));
    // risers: grey stone with horizontal strata
    const strata = 0.82 + 0.18 * Math.sin(y * 0.9 + n.n2(x / 20, z / 20) * 3);
    const rockK = Math.min(1, Math.max(0, (0.75 - ny) / 0.25));
    c.lerp(new THREE.Color().copy(stoneDark).lerp(stone, strata), rockK);
    // aerial perspective
    const hz = Math.min(1, Math.max(0, (d - 520) / 900));
    c.lerp(haze, Math.min(0.85, hz * 1.1));
    c.lerp(hazeFar, Math.max(0, (d - 1100) / 400) * 0.6);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, stylize(new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }), { wrap: 0.5, band: 0.06, clouds: true }));
  m.name = 'mountains';
  m.frustumCulled = false;
  return m;
}
