import * as THREE from 'three';
import { makeNoise } from './noise.js';
import { stylize } from './stylize.js';

// Golden-hour sky dome: gradient, sun disc + glow, two layers of drifting fBm clouds.
// Also the distant mountain ring that sits in the haze behind the meadow hills.

// golden hour: the sun low in the west-south-west, long warm light across the valley
export const SUN_DIR = new THREE.Vector3(-0.72, 0.2, 0.66).normalize();
export const SKY = {
  zenith: new THREE.Color(0.2, 0.2, 0.52),
  horizon: new THREE.Color(0.98, 0.6, 0.52),
  fog: new THREE.Color(0.88, 0.66, 0.72),
  sun: new THREE.Color(1.0, 0.72, 0.42),
};

// Painted sunset dome: deep violet zenith → lavender → a pink/orange band at the horizon that
// burns gold toward the sun; a big soft sun; layered cumulus lit orange/pink on the sun side with
// violet bellies, plus wispy high streaks catching the light.
export function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uSun: { value: SUN_DIR } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uSun; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        float sd = max(dot(d, uSun), 0.0);
        float az = max(dot(normalize(d.xz + 1e-4), normalize(uSun.xz)), 0.0); // how much toward the sun's side
        vec3 zen = vec3(0.2, 0.18, 0.56), mid = vec3(0.68, 0.42, 0.78), hor = mix(vec3(1.08, 0.5, 0.56), vec3(1.45, 0.62, 0.24), pow(az, 2.5));
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, zen, smoothstep(0.18, 0.85, h));
        // golden glow round the sun
        col += vec3(1.3, 0.62, 0.22) * pow(sd, 6.0) * 0.4 + vec3(1.2, 0.5, 0.3) * pow(sd, 2.0) * 0.12 * (1.0 - h);
        if (d.y > 0.0) {
          float t = uTime * 0.008;
          vec2 uv = d.xz / (d.y + 0.12) * 0.75;
          // cumulus banks
          float dens = fbm(uv * 0.5 + vec2(t, t * 0.3)) * 0.8 + fbm(uv * 1.9 - vec2(t * 1.4, 0.0)) * 0.3;
          vec2 sh = normalize(uSun.xz + 1e-4) * 0.08;
          float dens2 = fbm((uv + sh) * 0.5 + vec2(t, t * 0.3)) * 0.8 + fbm((uv + sh) * 1.9 - vec2(t * 1.4, 0.0)) * 0.3;
          float cov = smoothstep(0.58, 0.74, dens) * smoothstep(0.0, 0.1, d.y);
          float lit = clamp(0.55 + (dens - dens2) * 6.0, 0.0, 1.0);
          vec3 shade = mix(vec3(0.46, 0.32, 0.66), vec3(0.6, 0.42, 0.78), h);
          vec3 light = mix(vec3(1.25, 0.6, 0.62), vec3(1.55, 0.78, 0.36), pow(az, 2.0));
          vec3 cc = mix(shade, light, lit);
          cc += vec3(1.0, 0.62, 0.36) * smoothstep(0.66, 0.58, dens) * cov * 0.6 * (0.4 + az); // bright edges
          col = mix(col, cc, cov * 0.97);
          // wispy high streaks
          vec2 su = vec2(uv.x * 0.25 + t * 2.0, uv.y * 2.2);
          float st = smoothstep(0.62, 0.8, fbm(su)) * smoothstep(0.05, 0.3, d.y) * (1.0 - cov);
          col = mix(col, mix(vec3(1.0, 0.6, 0.66), vec3(1.25, 0.75, 0.45), az), st * 0.6);
        }
        // the sun: a big soft disc with a hot core
        col += vec3(1.5, 1.05, 0.62) * smoothstep(0.9975, 0.9992, sd) * 1.3 + vec3(1.1, 0.6, 0.3) * pow(sd, 300.0) * 0.8;
        // below the horizon: warm haze
        col = mix(col, vec3(0.86, 0.6, 0.68), smoothstep(0.0, -0.06, d.y));
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
      // far: a real mountain range — ridged peaks (sharp crests, deep valleys) up to ~520 m
      const rg = Math.max(0, 1 - Math.abs(n.fbm(nx * 0.55 - 9, nz * 0.55 + 4, 4) * 2 - 1));
      const far = (100 + 170 * Math.max(0, n.fbm(nx * 0.4 - 2, nz * 0.4 + 7, 3) + 0.2) + 230 * Math.pow(rg, 2.6)) * Math.exp(-((u - 0.72) ** 2) / 0.09);
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
  const stone = new THREE.Color(0.7, 0.64, 0.72), stoneDark = new THREE.Color(0.46, 0.42, 0.56);
  const haze = new THREE.Color(0.7, 0.58, 0.8), hazeFar = new THREE.Color(0.9, 0.66, 0.74);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), ny = Nn.getY(i);
    const d = Math.hypot(x, z);
    c.copy(topDark).lerp(top, 0.5 + 0.5 * n.n2(x / 35, z / 35));
    // risers: grey stone with horizontal strata
    const strata = 0.82 + 0.18 * Math.sin(y * 0.9 + n.n2(x / 20, z / 20) * 3);
    const rockK = Math.min(1, Math.max(0, (0.75 - ny) / 0.25));
    c.lerp(new THREE.Color().copy(stoneDark).lerp(stone, strata), rockK);
    // snow on the high peaks: thick on gentle slopes, streaky on steep faces
    const snow = Math.min(1, Math.max(0, (y - 330 - n.n2(x / 60, z / 60) * 40) / 50)) * (0.45 + 0.55 * Math.min(1, Math.max(0, (ny - 0.35) / 0.4)));
    c.lerp(new THREE.Color(1.0, 0.86, 0.84), snow);
    // aerial perspective
    const hz = Math.min(1, Math.max(0, (d - 520) / 900));
    c.lerp(haze, Math.min(0.9, 0.52 + hz * 0.9));
    c.lerp(hazeFar, Math.max(0, (d - 1100) / 400) * 0.6);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, stylize(new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }), { wrap: 0.5, band: 0.06, clouds: true }));
  m.name = 'mountains';
  m.frustumCulled = false;
  return m;
}
