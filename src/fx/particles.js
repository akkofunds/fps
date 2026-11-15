import * as THREE from 'three';

// CPU-simulated, GPU-drawn particle pool (one Points draw call per blend mode).
// Each particle: position, velocity, life, size start/end, color start/end (HDR, >1 blooms),
// drag, gravity (+ = up for hot air), spin-free soft sprites with a flame-shaped falloff.

const VERT = /* glsl */`
  attribute vec4 acolor; attribute float asize; attribute float aseed;
  varying vec4 vColor; varying float vSeed;
  uniform float uScale;
  void main(){
    vColor = acolor; vSeed = aseed;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = asize * uScale / max(0.1, -mv.z);
  }`;
const FRAG_ADD = /* glsl */`
  varying vec4 vColor; varying float vSeed;
  void main(){
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    float core = smoothstep(0.5, 0.0, d);
    float a = core * core * vColor.a;
    gl_FragColor = vec4(vColor.rgb * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const FRAG_SMOKE = /* glsl */`
  varying vec4 vColor; varying float vSeed;
  void main(){
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    float n = sin((p.x + vSeed) * 13.0) * sin((p.y - vSeed) * 11.0) * 0.08;
    float a = smoothstep(0.5, 0.15, d + n) * vColor.a;
    gl_FragColor = vec4(vColor.rgb, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class ParticlePool {
  constructor(max, additive) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 4); this.c1 = new Float32Array(max * 4);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    this.seed = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aSeed = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('acolor', this.aCol); g.setAttribute('asize', this.aSize); g.setAttribute('aseed', this.aSeed);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: VERT, fragmentShader: additive ? FRAG_ADD : FRAG_SMOKE,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      ...(additive ? { blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation } : {}),
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
  }

  // color arrays: [r, g, b, a]
  emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, drag = 0, grav = 0) {
    let i = this.n;
    if (i >= this.max) i = Math.floor(Math.random() * this.max); else this.n++;
    const i3 = i * 3, i4 = i * 4;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.life[i] = life; this.age[i] = 0; this.s0[i] = s0; this.s1[i] = s1;
    this.c0[i4] = c0[0]; this.c0[i4 + 1] = c0[1]; this.c0[i4 + 2] = c0[2]; this.c0[i4 + 3] = c0[3];
    this.c1[i4] = c1[0]; this.c1[i4 + 1] = c1[1]; this.c1[i4 + 2] = c1[2]; this.c1[i4 + 3] = c1[3];
    this.drag[i] = drag; this.grav[i] = grav; this.seed[i] = Math.random() * 10;
  }

  _kill(i) {
    const j = --this.n;
    if (i === j) return;
    const i3 = i * 3, j3 = j * 3, i4 = i * 4, j4 = j * 4;
    for (let k = 0; k < 3; k++) { this.p[i3 + k] = this.p[j3 + k]; this.v[i3 + k] = this.v[j3 + k]; }
    for (let k = 0; k < 4; k++) { this.c0[i4 + k] = this.c0[j4 + k]; this.c1[i4 + k] = this.c1[j4 + k]; }
    this.life[i] = this.life[j]; this.age[i] = this.age[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
    this.drag[i] = this.drag[j]; this.grav[i] = this.grav[j]; this.seed[i] = this.seed[j];
  }

  update(dt, viewportH) {
    this.mat.uniforms.uScale.value = viewportH * 0.9;
    const P = this.aPos.array, C = this.aCol.array, S = this.aSize.array, SD = this.aSeed.array;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this._kill(i); i--; continue; }
      const i3 = i * 3;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.v[i3] *= dr; this.v[i3 + 1] = this.v[i3 + 1] * dr + this.grav[i] * dt; this.v[i3 + 2] *= dr;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
    }
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i];
      const i3 = i * 3, i4 = i * 4;
      P[i3] = this.p[i3]; P[i3 + 1] = this.p[i3 + 1]; P[i3 + 2] = this.p[i3 + 2];
      // ease the alpha in quickly, out smoothly
      const fade = Math.min(1, t * 8) * (1 - t * t);
      C[i4] = this.c0[i4] + (this.c1[i4] - this.c0[i4]) * t;
      C[i4 + 1] = this.c0[i4 + 1] + (this.c1[i4 + 1] - this.c0[i4 + 1]) * t;
      C[i4 + 2] = this.c0[i4 + 2] + (this.c1[i4 + 2] - this.c0[i4 + 2]) * t;
      C[i4 + 3] = (this.c0[i4 + 3] + (this.c1[i4 + 3] - this.c0[i4 + 3]) * t) * fade;
      S[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      SD[i] = this.seed[i];
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aSeed.needsUpdate = true;
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, this.n * 3);
    this.aCol.clearUpdateRanges(); this.aCol.addUpdateRange(0, this.n * 4);
    this.aSize.clearUpdateRanges(); this.aSize.addUpdateRange(0, this.n);
    this.aSeed.clearUpdateRanges(); this.aSeed.addUpdateRange(0, this.n);
  }
}
