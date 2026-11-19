import * as THREE from 'three';

// Domain Expansion: Unlimited Void.
// From OUTSIDE the domain is a pitch-black dome with a faint swirling surface and a cold rim.
// From INSIDE (the camera within the dome) the world is replaced by the void of the reference:
// an endless black space full of stars and pale-blue nebula wisps, a black hole ringed by a blazing
// white-to-cyan accretion ring hanging on the horizon in front of the caster, and a glassy black
// floor that reflects it. Terrain and props keep their shapes (and their collisions) but turn into
// dark silhouettes; grass, flowers, water, sky and mountains are hidden.

const NOISE = /* glsl */`
  float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n3(p); p = p * 2.03 + vec3(1.7, 9.2, 4.1); a *= 0.5; } return s; }`;

function skyMaterial(U) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: U,
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uHole; uniform float uT, uOpen; varying vec3 vDir; ${NOISE}
      void main(){
        vec3 d = normalize(vDir);
        vec3 col = vec3(0.003, 0.005, 0.016);
        // pale-blue nebula wisps drifting through the void
        float n = fbm(d * 2.4 + vec3(0.0, uT * 0.015, uT * 0.01));
        float w = smoothstep(0.52, 0.86, n);
        col += vec3(0.05, 0.13, 0.28) * w + vec3(0.35, 0.45, 0.6) * pow(w, 3.0) * 0.5;
        // stars (two layers, twinkling)
        for (int k = 0; k < 2; k++) {
          float sc = k == 0 ? 160.0 : 70.0;
          vec3 g = d * sc; vec3 id = floor(g); float hh = h3(id + float(k) * 17.0); vec3 f = fract(g) - 0.5;
          float st = step(k == 0 ? 0.972 : 0.988, hh) * smoothstep(0.32, 0.0, length(f)) * (0.55 + 0.45 * sin(uT * (2.0 + hh * 3.0) + hh * 60.0));
          col += vec3(0.75, 0.88, 1.25) * st * (k == 0 ? 1.0 : 2.2);
        }
        // the black hole and its accretion ring
        float ang = acos(clamp(dot(d, uHole), -1.0, 1.0));
        vec3 ax = normalize(cross(uHole, vec3(0.0, 1.0, 0.0)));
        vec3 ay = cross(ax, uHole);
        float phi = atan(dot(d, ay), dot(d, ax));
        float rh = 0.17 * uOpen;
        float dr = max(0.0, ang - rh);
        float sw = fbm(vec3(cos(phi) * 2.0 + dr * 22.0, sin(phi) * 2.0 - dr * 18.0, uT * 0.25 - dr * 8.0));
        float swirl = fbm(vec3(phi * 1.6 - uT * 0.6 + dr * 40.0, dr * 9.0, 3.0));
        float ring = exp(-dr * 7.5) * smoothstep(0.0, 0.01, dr);
        vec3 hot = vec3(1.8, 1.9, 2.1), cold = vec3(0.3, 0.85, 1.7);
        vec3 rc = mix(cold, hot, exp(-dr * 26.0));
        col += rc * ring * (0.55 + 0.9 * sw * swirl) * uOpen;
        col += vec3(0.04, 0.18, 0.34) * exp(-dr * 3.2) * uOpen;           // cold halo
        col *= smoothstep(rh * 0.985, rh * 1.015, ang);                       // the event horizon: pure black
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// glassy black floor reflecting the ring and the stars
function floorMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */`
      varying vec3 vW;
      #include <common>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uHole, uCam, uC; uniform float uT, uOpen, uR; varying vec3 vW; ${NOISE}
      void main(){
        float edge = length(vW.xz - uC.xz) / uR;
        if (edge > 1.0) discard;                       // nothing exists beyond the domain
        vec3 base = vec3(0.012, 0.016, 0.036);
        vec3 v = normalize(vW - uCam);
        vec3 r = reflect(v, vec3(0.0, 1.0, 0.0));
        float hl = pow(max(dot(r, uHole), 0.0), 30.0);
        base += vec3(0.45, 0.75, 1.3) * hl * 0.55 * uOpen;
        vec2 g = vW.xz * 1.4; vec2 id = floor(g); float hh = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453); vec2 f = fract(g) - 0.5;
        float st = step(0.965, hh) * smoothstep(0.14, 0.0, length(f)) * (0.5 + 0.5 * sin(uT * 2.2 + hh * 40.0));
        base += vec3(0.45, 0.65, 1.0) * st * 0.8;
        // slow ripples of cursed energy rolling out from the centre of the domain
        float dc = length(vW.xz - uC.xz);
        base += vec3(0.05, 0.14, 0.3) * smoothstep(0.95, 1.0, sin(dc * 0.7 - uT * 2.2)) * 0.35;
        base += vec3(0.08, 0.2, 0.4) * fbm(vec3(vW.xz * 0.08, uT * 0.05)) * 0.12;
        float fogk = max(smoothstep(26.0, 120.0, length(vW - uCam)), smoothstep(0.75, 1.0, edge));
        gl_FragColor = vec4(mix(base, vec3(0.003, 0.005, 0.016), fogk), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function domeMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: U, transparent: false,
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      uniform float uT; varying vec3 vN; varying vec3 vV; varying vec3 vP; ${NOISE}
      void main(){
        float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
        float s = fbm(normalize(vP) * 3.0 + vec3(uT * 0.08, -uT * 0.05, 0.0));
        vec3 col = vec3(0.004, 0.006, 0.018) + vec3(0.1, 0.3, 0.6) * smoothstep(0.6, 0.9, s) * 0.35 + vec3(0.4, 0.75, 1.4) * fr * 0.7;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export class UnlimitedVoid {
  constructor(map) {
    this.map = map;
    this.scene = map.scene;
    this.U = { uR: { value: 30 }, uT: { value: 0 }, uHole: { value: new THREE.Vector3(0, 0.2, 1).normalize() }, uCam: { value: new THREE.Vector3() }, uC: { value: new THREE.Vector3() }, uOpen: { value: 0 } };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), skyMaterial(this.U));
    this.sky.renderOrder = -9; this.sky.frustumCulled = false; this.sky.visible = false;
    this.floorMat = floorMaterial(this.U);
    // props become dark silhouettes, and vanish entirely outside the domain
    this.silhouette = new THREE.MeshBasicMaterial({ color: 0x05070f });
    this.silhouette.onBeforeCompile = (sh) => {
      sh.uniforms.uC = this.U.uC; sh.uniforms.uR = this.U.uR;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWV;').replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wpV = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpV = instanceMatrix * wpV;
        #endif
        vWV = (modelMatrix * wpV).xyz;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWV; uniform vec3 uC; uniform float uR;').replace('void main() {', 'void main() {\n  if (length(vWV.xz - uC.xz) > uR) discard;');
    };
    this.silhouette.customProgramCacheKey = () => 'void-silhouette';
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), domeMaterial(this.U));
    this.dome.visible = false;
    this.scene.add(this.sky); this.scene.add(this.dome);
    this.active = false; this.inside = false; this.k = 0;
    this.c = new THREE.Vector3(); this.radius = 30;
    this.saved = null;
  }

  start(c, radius, yaw) {
    this.c.copy(c); this.radius = radius; this.U.uR.value = radius;
    this.U.uC.value.copy(c);
    // the black hole hangs above the horizon straight ahead of the caster
    this.U.uHole.value.set(Math.sin(yaw) * Math.cos(0.2), Math.sin(0.2), Math.cos(yaw) * Math.cos(0.2)).normalize();
    this.active = true; this.closing = false; this.k = 0; this.t = 0;
    this.dome.visible = true;
  }
  end() { if (this.active) this.closing = true; }

  // true while the camera sees the void (inside an open domain)
  update(dt, camera) {
    if (!this.active) return false;
    this.t += dt;
    this.U.uT.value = this.t;
    this.k = this.closing ? Math.max(0, this.k - dt / 0.45) : Math.min(1, this.k + dt / 0.4);
    const e = 1 - (1 - this.k) * (1 - this.k);
    this.U.uOpen.value = e;
    this.dome.position.copy(this.c);
    this.dome.scale.setScalar(Math.max(0.01, this.radius * e));
    this.U.uCam.value.copy(camera.position);
    this.sky.position.copy(camera.position);
    const inside = camera.position.distanceTo(this.c) < this.radius * e - 0.3;
    if (inside !== this.inside) this._swap(inside);
    if (this.closing && this.k <= 0) {
      this.active = false; this.dome.visible = false;
      if (this.inside) this._swap(false);
    }
    return this.inside;
  }

  _swap(inside) {
    const m = this.map;
    this.inside = inside;
    this.sky.visible = inside;
    for (const o of [m.sky, m.mountains, m.grass, m.flowers, m.bushes, m.water, m.landmarks]) if (o) o.visible = !inside;
    if (inside) {
      this.saved = { fog: [m.scene.fog.color.clone(), m.scene.fog.near, m.scene.fog.far], hemi: m.hemi.intensity, sun: m.sun.intensity, mats: new Map() };
      m.scene.fog.color.setRGB(0.003, 0.005, 0.016); m.scene.fog.near = 30; m.scene.fog.far = 140;
      m.hemi.intensity *= 0.55; m.sun.intensity *= 0.35;
      this.saved.mats.set(m.terrain, m.terrain.material); m.terrain.material = this.floorMat;
      m.props.traverse((o) => { if (o.isMesh) { this.saved.mats.set(o, o.material); o.material = this.silhouette; } });
    } else if (this.saved) {
      const s = this.saved;
      m.scene.fog.color.copy(s.fog[0]); m.scene.fog.near = s.fog[1]; m.scene.fog.far = s.fog[2];
      m.hemi.intensity = s.hemi; m.sun.intensity = s.sun;
      for (const [o, mat] of s.mats) o.material = mat;
      this.saved = null;
    }
  }

  dispose() {
    if (this.inside) this._swap(false);
    this.scene.remove(this.sky); this.scene.remove(this.dome);
  }
}
