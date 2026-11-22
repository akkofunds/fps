import * as THREE from 'three';
import { makeNoise, smoothstep } from './noise.js';

// Golden-hour sky dome: gradient, sun disc + glow, two layers of drifting fBm clouds.
// Also the distant mountain ring that sits in the haze behind the meadow hills.

// sunset (reference): the sun sitting just above the far hills in the east-north-east, so looking up
// the river toward the waterfall it hangs right of the falls, over the ruins
export const SUN_DIR = new THREE.Vector3(Math.cos(-0.52), 0.13, Math.sin(-0.52)).normalize();
export const SKY = {
  zenith: new THREE.Color(0.44, 0.52, 0.78),
  horizon: new THREE.Color(1.0, 0.82, 0.55),
  fog: new THREE.Color(0.95, 0.8, 0.56),
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
        vec3 zen = vec3(0.3, 0.4, 0.74), mid = mix(vec3(0.7, 0.64, 0.7), vec3(0.92, 0.66, 0.42), pow(az, 1.5)), hor = mix(vec3(0.95, 0.7, 0.48), vec3(1.2, 0.74, 0.3), pow(az, 2.0));
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.25, h));
        col = mix(col, zen, smoothstep(0.2, 0.85, h));
        // golden glow round the sun
        col += vec3(1.5, 1.0, 0.4) * pow(sd, 24.0) * 0.4 + vec3(1.0, 0.65, 0.3) * pow(sd, 4.0) * 0.08 * (1.0 - h);
        if (d.y > 0.0) {
          float t = uTime * 0.008;
          vec2 uv = d.xz / (d.y + 0.12) * 0.75;
          // cumulus banks
          float dens = fbm(uv * 0.55 + vec2(t, t * 0.3)) * 0.7 + fbm(uv * 2.6 - vec2(t * 1.4, 0.0)) * 0.42;
          vec2 sh = normalize(uSun.xz + 1e-4) * 0.08;
          float dens2 = fbm((uv + sh) * 0.55 + vec2(t, t * 0.3)) * 0.7 + fbm((uv + sh) * 2.6 - vec2(t * 1.4, 0.0)) * 0.42;
          float cov = smoothstep(0.66, 0.78, dens) * smoothstep(0.02, 0.12, d.y) * 0.6;
          float lit = clamp(0.55 + (dens - dens2) * 6.0, 0.0, 1.0);
          vec3 shade = mix(vec3(0.78, 0.7, 0.72), vec3(0.6, 0.64, 0.82), h);
          vec3 light = mix(vec3(1.2, 1.0, 0.85), vec3(1.8, 1.3, 0.62), pow(az, 2.0));
          vec3 cc = mix(shade, light, lit);
          cc += vec3(1.0, 0.62, 0.36) * smoothstep(0.66, 0.58, dens) * cov * 0.6 * (0.4 + az); // bright edges
          col = mix(col, cc, cov * 0.97);
          // wispy high streaks
          vec2 su = vec2(uv.x * 0.25 + t * 2.0, uv.y * 2.2);
          float st = smoothstep(0.62, 0.8, fbm(su)) * smoothstep(0.05, 0.3, d.y) * (1.0 - cov);
          col = mix(col, mix(vec3(1.0, 0.9, 0.86), vec3(1.4, 1.05, 0.6), az), st * 0.35);
        }
        // the sun: a big soft disc with a hot core
        col = mix(col, vec3(2.0, 1.75, 1.25), smoothstep(0.99895, 0.99918, sd)); col += vec3(1.4, 1.0, 0.5) * pow(sd, 700.0) * 0.5;
        // below the horizon: warm haze
        col = mix(col, vec3(0.95, 0.8, 0.58), smoothstep(0.0, -0.06, d.y));
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

// The farlands (reference): past the valley rim, forested rolling plateaus drop away into a misty
// lowland, and behind them a range of sharp purple mountains — one tall pyramid peak, ranks of
// ridges fading lighter with distance, a low gap where the sun sets. Shading and aerial perspective
// are baked into the vertex colours (sun-side lavender-pink, shadow-side deep violet, mist pooling
// at the feet of the peaks), drawn unlit + unfogged so it reads like a painted backdrop.
const _ad = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
export function buildMountains(groundAt = null) {
  const n = makeNoise(2024);
  const seg = 720, rings = 90;
  const R0 = 245, R1 = 1480;
  const sunA = Math.atan2(SUN_DIR.z, SUN_DIR.x);
  const peaks = [[-1.12, 1050, 250, 330], [-1.42, 1150, 200, 280], [-0.88, 1180, 180, 260], [0.35, 1100, 180, 280], [2.4, 1050, 210, 300], [1.4, 1150, 190, 280], [-2.3, 1100, 200, 280], [-2.9, 1050, 170, 260]];
  const valleys = [2.97, -0.32]; // where the two rivers leave the valley
  const EDGE = []; for (let i = 0; i <= 360; i++) { const a = (i / 360) * Math.PI * 2 - Math.PI; EDGE.push(groundAt ? groundAt(Math.cos(a) * 238, Math.sin(a) * 238) - 0.6 : 15); }
  const edge = (a) => { const f = (a + Math.PI) / (Math.PI * 2) * 360, i = Math.max(0, Math.min(359, Math.floor(f))); return EDGE[i] + (EDGE[i + 1] - EDGE[i]) * (f - i); };
  const height = (x, z, rad, a) => {
    const u = (rad - R0) / (R1 - R0);
    // forested plateaus right behind the rim, falling away to a lowland
    let hill = 13 + 20 * n.fbm(x / 110 + 4, z / 110 - 2, 4) * smoothstep(250, 340, rad) + 10 * smoothstep(240, 300, rad);
    hill *= 1 - smoothstep(420, 700, rad) * 0.75;
    for (const v of valleys) hill -= 30 * Math.exp(-(_ad(a, v) ** 2) / (0.02 + smoothstep(245, 600, rad) * 0.05)) * (1 - smoothstep(500, 800, rad));
    // the mountain range: ridged crests, deep gullies
    const rg = Math.max(0, 1 - Math.abs(n.fbm(x / 230 - 9, z / 230 + 4, 4) * 2 - 1));
    const rg2 = Math.max(0, 1 - Math.abs(n.fbm(x / 70 + 3, z / 70 - 6, 3) * 2 - 1));
    let mt = (25 + 105 * Math.pow(rg, 1.7) + 9 * rg2 * rg) * smoothstep(620, 900, rad) * (1 - smoothstep(1300, R1, rad));
    mt *= 0.45 + 0.55 * smoothstep(0.0, 0.5, Math.abs(_ad(a, sunA)));        // a low gap under the sun
    for (const [pa, pd, ph, pr] of peaks) {
      const px = Math.cos(pa) * pd, pz = Math.sin(pa) * pd, d = Math.hypot(x - px, z - pz) / pr;
      if (d < 1.4) mt = Math.max(mt, ph * Math.pow(Math.max(0, 1 - d / 1.4), 1.25) * (0.94 + 0.06 * rg2) + 6 * rg2 * Math.max(0, 1 - d));
    }
    void u;
    // blend out of the valley's own terrain at the rim, so the land continues without a seam
    const e = edge(a), k = smoothstep(245, 360, rad);
    return Math.max(e + (Math.max(hill, -1) - e) * k, mt);
  };
  const pos = new Float32Array((rings + 1) * (seg + 1) * 3), rads = [];
  let k = 0;
  for (let r = 0; r <= rings; r++) {
    const rad = R0 + (R1 - R0) * Math.pow(r / rings, 1.5); rads.push(rad);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2 - Math.PI, x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      pos[k++] = x; pos[k++] = r === rings ? -40 : height(x, z, rad, a) - (r === 0 ? 3 : 0); pos[k++] = z;
    }
  }
  const idx = [];
  for (let r = 0; r < rings; r++) for (let i = 0; i < seg; i++) { const a = r * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const P = g.attributes.position, Nn = g.attributes.normal, col = new Float32Array(P.count * 3), c = new THREE.Color(), t = new THREE.Color();
  const sun = SUN_DIR;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), nx = Nn.getX(i), ny = Nn.getY(i), nz = Nn.getZ(i);
    const d = Math.hypot(x, z), a = Math.atan2(z, x);
    const ndl = nx * sun.x + ny * sun.y * 0.6 + nz * sun.z + ny * 0.25;
    const lit = smoothstep(-0.15, 0.55, ndl);
    const mtn = smoothstep(40, 90, y) * smoothstep(560, 760, d);
    // forest canopy mottle on the plateaus (clumps of trees, lit tops)
    const clump = n.n2(x / 7, z / 7) * 0.6 + n.n2(x / 19 + 5, z / 19) * 0.4;
    c.setRGB(0.26, 0.09, 0.03).lerp(t.setRGB(0.95, 0.5, 0.12), smoothstep(0.35, 0.8, clump) * (0.35 + 0.65 * lit));
    c.lerp(t.setRGB(0.66, 0.52, 0.16), smoothstep(0.55, 0.2, clump) * 0.6);
    c.multiplyScalar(0.7 + 0.4 * lit);
    // mountain rock: violet shadow side, pink-lavender sun side, faint gullies
    const gully = 0.85 + 0.15 * n.n2(x / 25, z / 25 + y / 40);
    t.setRGB(0.38, 0.42, 0.56).lerp(c.clone().setRGB(0.86, 0.8, 0.76), lit).multiplyScalar(gully);
    c.lerp(t, mtn);
    c.lerp(t.setRGB(1.05, 1.02, 1.0), mtn * smoothstep(110, 200, y) * smoothstep(0.2, 0.7, ny));   // snow on the high peaks
    // aerial perspective: lighter + pinker with distance, gold toward the sun; mist pooling low
    const toward = Math.max(0, Math.cos(_ad(a, sunA)));
    const haze = t.setRGB(0.7, 0.72, 0.8).lerp(c.clone().setRGB(1.05, 0.86, 0.6), toward * toward);
    let hk = (1 - mtn) * (0.05 + 0.45 * smoothstep(300, 900, d)) + mtn * (0.25 + 0.3 * smoothstep(700, 1400, d));
    c.lerp(haze, Math.min(0.8, hk));
    // the same mist wall the fog puts on the terrain past the rim (fog.js), baked in
    c.lerp(SKY.fog, smoothstep(300, 700, d) * (1 - mtn) * 0.55);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  m.name = 'mountains';
  m.frustumCulled = false;
  // ground height of the far lands (for planting groves on them)
  m.userData.heightAt = (x, z) => { const rad = Math.hypot(x, z); return height(x, z, rad, Math.atan2(z, x)); };
  return m;
}
