import * as THREE from 'three';
import { LAKE, WATER_Y, groundH } from './terrain.js';
import { SKY, SUN_DIR } from './sky.js';

// Shallow lake: depth-tinted, fresnel sky reflection, animated ripples, sun glints and a soft
// foam line where it meets the shore (depth baked per vertex from the heightfield).
export function buildWater() {
  // one sheet over the whole river system at the water level; the terrain only dips below it in
  // the river channel and the plunge pool, so that is where it shows (others are culled below)
  const X0 = -540, X1 = 520, Z0 = -260, Z1 = 120, st = 2;
  const nx = (X1 - X0) / st + 1, nz = (Z1 - Z0) / st + 1;
  const pos = [], depth = [], idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = X0 + i * st, z = Z0 + j * st;
    pos.push(x, WATER_Y, z); depth.push(WATER_Y - groundH(x, z));
  }
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    if (Math.max(depth[a], depth[b], depth[c], depth[d]) < -0.05) continue; // dry land: skip
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSun: { value: SUN_DIR }, uSky: { value: SKY.zenith }, uHor: { value: SKY.horizon },
    }]),
    vertexShader: /* glsl */`
      attribute float depth; varying float vDepth; varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vDepth = depth; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
        vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uSun, uSky, uHor; varying float vDepth; varying vec3 vW;
      #include <fog_pars_fragment>
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
      float hgt(vec2 p){ return noise(p*0.9 + uTime*vec2(0.6,0.12))*0.6 + noise(p*2.1 - uTime*vec2(0.18,0.33))*0.3 + noise(p*5.0 + uTime*0.6)*0.1; }
      void main(){
        if (vDepth < -0.02) discard;
        vec2 p = vW.xz;
        float e = 0.08;
        vec3 n = normalize(vec3(hgt(p - vec2(e,0.0)) - hgt(p + vec2(e,0.0)), 0.55, hgt(p - vec2(0.0,e)) - hgt(p + vec2(0.0,e))));
        vec3 v = normalize(cameraPosition - vW);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 r = reflect(-v, n);
        vec3 sky = mix(uHor, uSky, pow(max(r.y, 0.0), 0.5));
        vec3 deep = vec3(0.03, 0.22, 0.42), shallow = vec3(0.16, 0.58, 0.62); // clear turquoise river
        vec3 body = mix(shallow, deep, smoothstep(0.0, 0.9, vDepth));
        vec3 col = mix(body, sky * 0.85, fres * 0.6);
        float spec = pow(max(dot(r, uSun), 0.0), 220.0);
        col += vec3(1.0, 0.9, 0.7) * spec * 3.0;
        float foam = smoothstep(0.12, 0.0, vDepth) * (0.55 + 0.45 * noise(p * 3.0 + uTime));
        col = mix(col, vec3(0.92, 0.95, 0.9), foam * 0.7);
        float a = mix(0.62, 0.92, smoothstep(0.0, 0.6, vDepth)) * smoothstep(-0.02, 0.06, vDepth);
        gl_FragColor = vec4(col, max(a, foam * 0.8));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 2;
  m.name = 'water';
  return m;
}
