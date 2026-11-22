import * as THREE from 'three';
import { Fx } from './fire.js';
import { groundH } from '../world/terrain.js';

// Glossy anime VFX (reference: Roblox-style blue combo, "TearDrop" vortex, clean white ring slash).
//  ribbon()      a real 3D band swept along an arc round the body: white-hot rim, glossy streaked
//                core, deep-coloured fringe; head sweeps in fast, tail chases it, then it thins,
//                drifts outward and dissolves (noise break-up, never a hard pop)
//  ribbonCombo() 2-3 ribbons at different tilts wrapping the body (one strike)
//  darkStar()    the 4-point "sparkle" star: navy fill, glowing rim, pops and spins
//  hitSilhouette() impact frame on the struck body: flat solid colour for a few frames
//  liquidSlash() the clean slash: a thick glossy crescent ring that thins into expanding rings
//  vortex()      the TearDrop: falling spark → flash → swirling ribbons round a glowing core ring,
//                sparks and flung debris → dissolves into motes over a glowing ground crack
// Everything is shader-driven on shared geometry; colours are HDR so the bloom pass catches them.

const R = Math.random;
const UP = new THREE.Vector3(0, 1, 0);

// palettes: rim (white-hot edge), core (body), deep (fringe), star (dark star rim glow)
export const GLOSS = {
  // (rendered without tone mapping: these are the literal colours, rim just past 1 for bloom)
  cursed: { rim: [0.85, 1.1, 1.3], core: [0.0, 0.55, 1.0], deep: [0.0, 0.1, 0.62], star: [0.2, 0.5, 1.6] },
  ice: { rim: [0.95, 1.15, 1.3], core: [0.25, 0.85, 1.0], deep: [0.0, 0.3, 0.7], star: [0.35, 0.95, 1.6] },
  fire: { rim: [1.3, 1.1, 0.6], core: [1.0, 0.42, 0.02], deep: [0.6, 0.05, 0.0], star: [1.6, 0.55, 0.1] },
  crimson: { rim: [1.3, 0.75, 0.7], core: [0.95, 0.04, 0.04], deep: [0.35, 0.0, 0.02], star: [1.6, 0.2, 0.15] },
  scarlet: { rim: [1.3, 0.85, 1.05], core: [1.0, 0.1, 0.38], deep: [0.4, 0.0, 0.16], star: [1.6, 0.3, 0.75] },
  purple: { rim: [1.1, 0.95, 1.35], core: [0.6, 0.18, 1.0], deep: [0.2, 0.02, 0.6], star: [1.0, 0.4, 1.7] },
  white: { rim: [1.35, 1.35, 1.4], core: [0.92, 0.94, 1.0], deep: [0.26, 0.28, 0.34], star: [1.3, 1.4, 1.7] },
  // Inkweaver: black ink edged with gold
  ink: { rim: [1.45, 1.1, 0.42], core: [0.9, 0.58, 0.1], deep: [0.02, 0.015, 0.012], star: [1.7, 1.2, 0.35] },
  inkDark: { rim: [1.2, 0.86, 0.3], core: [0.06, 0.045, 0.04], deep: [0.01, 0.008, 0.008], star: [1.4, 1.0, 0.3] },
};

// ------------------------------------------------------------------ ribbon
// one shared strip: a = 0..1 along the arc, b = 0 (outer rim) .. 1 (inner edge)
let STRIP = null;
function strip() {
  if (STRIP) return STRIP;
  const N = 64, pos = [], idx = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= 2; j++) pos.push(i / N, j / 2, 0);
  for (let i = 0; i < N; i++) for (let j = 0; j < 2; j++) {
    const a = i * 3 + j, b = a + 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return (STRIP = g);
}
const RIBBON_VS = /* glsl */`
  uniform vec3 uC, uE1, uE2, uN; uniform float uR, uW, uSpan, uHelix, uFlare;
  varying vec2 vAB;
  void main(){
    float a = position.x, b = position.y;
    float th = a * uSpan;
    vec3 d = uE1 * cos(th) + uE2 * sin(th);
    // the band flares a little outward toward its head (reads as speed)
    float rr = uR - b * uW * (1.0 + uFlare * a);
    vec3 p = uC + d * rr + uN * (uHelix * (a - 0.5) + b * uW * 0.18);
    vAB = vec2(a, b);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const RIBBON_FS = /* glsl */`
  uniform float uHead, uTail, uFade, uSeed, uLiquid; uniform vec3 uRim, uCore, uDeep;
  varying vec2 vAB;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
  void main(){
    float a = vAB.x, b = vAB.y;
    if (a > uHead || a < uTail) discard;
    float k = (a - uTail) / max(1e-3, uHead - uTail);           // 0 tail .. 1 head
    // thickness: fine point at the tail, fullest behind the head, rounded tip
    float th = pow(sin(3.14159 * pow(clamp(k, 0.0, 1.0), 0.5)), 0.55) * (1.0 - 0.5 * uFade);
    float q = b / max(1e-3, th);                                 // 0 rim .. 1 inner edge
    if (q > 1.0) discard;
    // glossy streaks running along the band
    float streak = 0.5 + 0.5 * sin(q * 17.0 + a * 9.0 + uSeed * 6.0 + n2(vec2(a * 14.0, q * 3.0 + uSeed)) * 3.0);
    vec3 col = mix(uCore, uDeep, smoothstep(0.25, 0.95, q));
    col = mix(col, uCore * 1.25 + 0.1, streak * 0.35 * (1.0 - q));
    col = mix(col, uRim, smoothstep(0.14, 0.0, q));              // white-hot rim
    col = mix(col, uRim, smoothstep(0.75, 1.0, k) * smoothstep(0.7, 0.0, q) * 0.8); // hot head
    // liquid look (clean slash): a dark bevel line inside the band, glossy highlight above it
    if (uLiquid > 0.5) {
      float bevel = smoothstep(0.08, 0.0, abs(q - 0.55));
      col = mix(col, uDeep * 0.25, bevel * 0.85);
      col += uRim * smoothstep(0.1, 0.0, abs(q - 0.32)) * 0.35;
    }
    float al = smoothstep(1.0, 0.7, q) * smoothstep(0.0, 0.28, k);
    // dissolve: noise break-up as it fades
    float nz = n2(vec2(a * 26.0 + uSeed * 9.0, q * 4.0));
    al *= smoothstep(uFade - 0.15, uFade + 0.05, nz * 0.95 + 0.05);
    if (al < 0.01) discard;
    gl_FragColor = vec4(col, al);
  }`;
const RIB_POOL = [];
function ribbonMat() {
  const m = RIB_POOL.pop();
  if (m) return m;
  return new THREE.ShaderMaterial({
    vertexShader: RIBBON_VS, fragmentShader: RIBBON_FS,
    uniforms: {
      uC: { value: new THREE.Vector3() }, uE1: { value: new THREE.Vector3() }, uE2: { value: new THREE.Vector3() }, uN: { value: new THREE.Vector3() },
      uR: { value: 1 }, uW: { value: 0.3 }, uSpan: { value: 3 }, uHelix: { value: 0 }, uFlare: { value: 0.3 },
      uHead: { value: 0 }, uTail: { value: 0 }, uFade: { value: 0 }, uSeed: { value: 0 }, uLiquid: { value: 0 },
      uRim: { value: new THREE.Vector3() }, uCore: { value: new THREE.Vector3() }, uDeep: { value: new THREE.Vector3() },
    },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  });
}
const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

// ------------------------------------------------------------------ billboards (stars, flashes, rings)
let QUAD = null;
const quad = () => QUAD || (QUAD = new THREE.PlaneGeometry(2, 2));
const BB_VS = /* glsl */`
  uniform float uSize, uRot; varying vec2 vUv;
  void main(){
    vUv = position.xy;
    float c = cos(uRot), s = sin(uRot);
    vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * uSize;
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += p;
    gl_Position = projectionMatrix * mv;
  }`;
// kind 0: 4-point dark star · 1: flash with radial spikes · 2: thin glowing ring · 3: soft orb
const BB_FS = /* glsl */`
  uniform float uKind, uAlpha, uSeed, uThick; uniform vec3 uCol, uFill;
  varying vec2 vUv;
  float h(float x){ return fract(sin(x * 91.3) * 43758.5); }
  void main(){
    vec2 p = vUv; float r = length(p);
    vec4 o = vec4(0.0);
    if (uKind < 0.5) {
      // concave 4-point star (astroid-like): sharp points on the axes
      float s = pow(abs(p.x), 0.5) + pow(abs(p.y), 0.5);
      float inside = smoothstep(1.0, 0.94, s);
      float rim = smoothstep(0.62, 0.95, s) * inside;
      float halo = smoothstep(1.45, 1.0, s) * (1.0 - inside) * 0.55;
      vec3 c = mix(uFill, uCol, rim) + uCol * halo;
      o = vec4(c, max(inside, halo));
    } else if (uKind < 1.5) {
      float a = atan(p.y, p.x);
      float sp = 0.0;
      for (int i = 0; i < 3; i++) { float f = float(i) * 7.0 + 5.0 + floor(uSeed * 4.0); sp += pow(0.5 + 0.5 * sin(a * f + uSeed * 30.0 + float(i)), 18.0); }
      float core = smoothstep(0.45, 0.0, r);
      float spikes = sp * smoothstep(1.0, 0.15, r) * 0.9;
      float glow = smoothstep(1.0, 0.0, r) * 0.45;
      o = vec4(uCol * (core * 1.6 + spikes + glow) + core * 0.6, clamp(core + spikes + glow, 0.0, 1.0));
    } else if (uKind < 2.5) {
      float d = abs(r - 0.82);
      float line = smoothstep(uThick, 0.0, d);
      float glow = smoothstep(uThick * 5.0, 0.0, d) * 0.5;
      o = vec4(uCol * (line * 1.4 + glow) + line * 0.4, clamp(line + glow, 0.0, 1.0));
    } else {
      float core = smoothstep(1.0, 0.0, r);
      float hotc = smoothstep(0.35, 0.0, r);
      o = vec4(uCol * (core * 1.4) + vec3(0.6, 0.8, 1.0) * hotc * 0.9, core * core * 0.9);
    }
    o.a *= uAlpha;
    if (o.a < 0.005) discard;
    gl_FragColor = o;
  }`;
function bbMat(kind, additive) {
  return new THREE.ShaderMaterial({
    vertexShader: BB_VS, fragmentShader: BB_FS,
    uniforms: { uSize: { value: 1 }, uRot: { value: 0 }, uKind: { value: kind }, uAlpha: { value: 1 }, uSeed: { value: R() }, uThick: { value: 0.03 }, uCol: { value: new THREE.Vector3(1, 1, 1) }, uFill: { value: new THREE.Vector3(0.02, 0.03, 0.12) } },
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false,
  });
}

// ground crack decal (radial cracks), painted once
let CRACK = null;
function crackTex() {
  if (CRACK) return CRACK;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2); g.lineCap = 'round';
  const branch = (x, y, a, len, w) => {
    if (len < 6 || w < 0.4) return;
    const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
    g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
    branch(nx, ny, a + (R() - 0.5) * 0.7, len * (0.62 + R() * 0.2), w * 0.72);
    if (R() < 0.45) branch(nx, ny, a + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.5), len * 0.45, w * 0.55);
  };
  g.strokeStyle = 'rgba(255,255,255,1)';
  for (let i = 0; i < 11; i++) branch(0, 0, (i / 11) * Math.PI * 2 + R() * 0.3, 30 + R() * 22, 3.2);
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, 34); rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 34, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (CRACK = t);
}

let ROCK = null, ROCK_MAT = null;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

Object.assign(Fx.prototype, {
  // c: centre; e1: direction to the arc's start; e2: the sweep direction (both get orthonormalised);
  // r: radius; span: arc angle; o: { w, pal, sweep, life, helix, delay, flare, liquid, grow, onDone }
  ribbon(c, e1, e2, r, span, o = {}) {
    const pal = o.pal || GLOSS.cursed;
    const m = ribbonMat();
    const U = m.uniforms;
    const E1 = e1.clone().normalize(), N = new THREE.Vector3().crossVectors(E1, e2).normalize(), E2 = new THREE.Vector3().crossVectors(N, E1);
    U.uC.value.copy(c); U.uE1.value.copy(E1); U.uE2.value.copy(E2); U.uN.value.copy(N);
    U.uR.value = r; U.uW.value = o.w ?? r * 0.3; U.uSpan.value = span; U.uHelix.value = o.helix ?? 0; U.uFlare.value = o.flare ?? 0.35;
    U.uHead.value = 0; U.uTail.value = 0; U.uFade.value = 0; U.uSeed.value = R() * 10; U.uLiquid.value = o.liquid ? 1 : 0;
    U.uRim.value.fromArray(pal.rim); U.uCore.value.fromArray(pal.core); U.uDeep.value.fromArray(pal.deep);
    m.blending = o.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    const mesh = new THREE.Mesh(strip(), m);
    mesh.frustumCulled = false; mesh.renderOrder = 5;
    const sweep = o.sweep ?? 0.09, life = o.life ?? 0.32, grow = o.grow ?? 0.12, r0 = r, w0 = U.uW.value;
    let t = -(o.delay || 0), added = false;
    this.effects.push({ update: (dt) => {
      t += dt;
      if (t < 0) return true;
      if (!added) { this.scene.add(mesh); added = true; }
      const s = t / sweep;
      U.uHead.value = easeOut(s);
      U.uTail.value = Math.max(0, easeOut((t - sweep * 0.55) / (life * 0.75)) * 0.92);
      const f = Math.max(0, (t - sweep) / Math.max(0.01, life - sweep));
      U.uFade.value = Math.pow(f, 1.4);
      U.uR.value = r0 * (1 + grow * easeOut(f));
      U.uW.value = w0 * (1 - 0.35 * f);
      if (o.onFrame) o.onFrame(U, t, dt);
      if (t >= life) {
        this.scene.remove(mesh); RIB_POOL.push(m);
        if (o.onDone) o.onDone();
        return false;
      }
      return true;
    } });
    return U;
  },

  // one strike: 2-3 glossy ribbons at different tilts wrapping the body.
  // o: feet/centre; dir: strike direction; kind: 'h' (flat) | 'd' (diagonal down) | 'u' (rising) | 'x' (heavy wrap)
  ribbonCombo(o, dir, kind, pal, size = 1, delay = 0) {
    const F = new THREE.Vector3(dir.x, 0, dir.z).normalize(), Rt = new THREE.Vector3(-F.z, 0, F.x);
    const c = new THREE.Vector3(o.x, o.y + 1.15 * size, o.z).addScaledVector(F, 0.35 * size);
    const tilt = { h: [0.1, -0.25], d: [0.9, 0.55], u: [-0.85, -0.5], x: [0.8, -0.7, 0.15] }[kind] || [0.4, -0.3];
    tilt.forEach((tl, k) => {
      // the start side alternates so the layers wrap round the body like the reference
      const side = (k % 2 ? -1 : 1) * (kind === 'u' ? -1 : 1);
      const e1 = Rt.clone().multiplyScalar(side).addScaledVector(UP, tl).addScaledVector(F, -0.35);
      const e2 = F.clone().addScaledVector(UP, -tl * 0.4);
      const r = (1.05 + k * 0.22 + R() * 0.12) * size * (kind === 'x' ? 1.25 : 1);
      this.ribbon(c.clone().addScaledVector(UP, (R() - 0.5) * 0.25 * size), e1, e2, r, 3.6 + R() * 0.8, {
        pal, w: r * (k ? 0.3 : 0.48), sweep: 0.075 + k * 0.015, life: 0.3 + k * 0.05, helix: (k ? -0.35 : 0.3) * size,
        delay: delay + k * 0.035, grow: 0.16,
      });
    });
  },

  darkStar(p, size = 0.5, pal = GLOSS.cursed, delay = 0) {
    const m = bbMat(0, false);
    m.uniforms.uCol.value.fromArray(pal.star);
    m.uniforms.uFill.value.set(pal.deep[0] * 0.05 + 0.01, pal.deep[1] * 0.05 + 0.012, pal.deep[2] * 0.08 + 0.03);
    const mesh = new THREE.Mesh(quad(), m);
    mesh.position.copy(p); mesh.frustumCulled = false; mesh.renderOrder = 7;
    const life = 0.42, spin = (R() < 0.5 ? -1 : 1) * (1.5 + R() * 2);
    let t = -delay, added = false;
    this.effects.push({ update: (dt) => {
      t += dt;
      if (t < 0) return true;
      if (!added) { this.scene.add(mesh); added = true; }
      const u = t / life;
      // pop with overshoot, hold, then pinch away
      const pop = u < 0.18 ? easeOut(u / 0.18) * 1.25 : u < 0.3 ? 1.25 - (u - 0.18) / 0.12 * 0.25 : 1 - Math.pow((u - 0.3) / 0.7, 2);
      m.uniforms.uSize.value = size * Math.max(0, pop);
      m.uniforms.uRot.value = t * spin + 0.1;
      if (t >= life) { this.scene.remove(mesh); m.dispose(); return false; }
      return true;
    } });
  },

  // a few dark stars scattered round a point
  starBurst(p, n, size, pal, spread = 1) {
    for (let k = 0; k < n; k++) {
      _v.set(R() - 0.5, R() * 0.8 - 0.2, R() - 0.5).normalize().multiplyScalar(spread * (0.5 + R() * 0.6));
      this.darkStar(p.clone().add(_v), size * (0.6 + R() * 0.6), pal, k * 0.03 + R() * 0.04);
    }
  },

  // billboard helper: kind (1 flash, 2 ring, 3 orb); returns uniforms; dur; sizeFn(u) → size
  _bb(p, kind, col, dur, sizeFn, alphaFn, additive = true, thick = 0.03) {
    const m = bbMat(kind, additive);
    m.uniforms.uCol.value.fromArray(col); m.uniforms.uThick.value = thick;
    const mesh = new THREE.Mesh(quad(), m);
    mesh.position.copy(p); mesh.frustumCulled = false; mesh.renderOrder = 6;
    this.scene.add(mesh);
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      const u = Math.min(1, t / dur);
      m.uniforms.uSize.value = sizeFn(u, t);
      m.uniforms.uAlpha.value = alphaFn(u, t);
      if (typeof p.update === 'function') mesh.position.copy(p);
      if (t >= dur) { this.scene.remove(mesh); m.dispose(); return false; }
      return true;
    } });
    return { mesh, u: m.uniforms };
  },

  // impact frame on the struck body
  hitSilhouette(view, col = [0.2, 0.55, 1.6], dur = 0.075) {
    if (!view || !view.silhouette) return;
    view.silhouette(col);
    const token = (view._silTok = (view._silTok || 0) + 1);
    let t = 0;
    this.effects.push({ update: (dt) => { t += dt; if (t < dur) return true; if (view._silTok === token) view.silhouette(null); return false; } });
  },

  // the clean slash: thick glossy crescent ring (flat round the body) → thin expanding rings
  liquidSlash(c, dir, size = 1, pal = GLOSS.white, tilt = 0.12) {
    const F = new THREE.Vector3(dir.x, 0, dir.z).normalize(), Rt = new THREE.Vector3(-F.z, 0, F.x);
    const e1 = Rt.clone().negate().addScaledVector(UP, tilt).addScaledVector(F, -0.6);
    const e2 = F.clone().addScaledVector(UP, -tilt * 0.5);
    const r = 1.4 * size;
    this.ribbon(c, e1, e2, r, 5.4, { pal, w: r * 0.6, sweep: 0.1, life: 0.3, liquid: true, grow: 0.12, flare: 0.15 });
    for (let k = 0; k < 2; k++) {
      this.ribbon(c.clone().addScaledVector(UP, -0.04 * k), e1, e2, r * (1.0 + k * 0.06), 5.8, {
        pal, w: r * 0.05, sweep: 0.12, life: 0.55 + k * 0.1, grow: 0.45 + k * 0.2, delay: 0.1 + k * 0.05, flare: 0,
      });
    }
  },

  // the TearDrop: o = { size, pal, dur, drop (fall-in spark), debris, crack, light }
  vortex(p, o = {}) {
    const size = o.size || 1, pal = o.pal || GLOSS.cursed, dur = o.dur || 1.6;
    const c = p.clone();
    const RIM = [...pal.rim, 1], CORE0 = [...pal.core, 0];
    const drop = o.drop ? 0.22 : 0;
    // falling spark streak into the centre
    if (drop) {
      const top = c.clone().addScaledVector(UP, 7 * size);
      let t = 0;
      this.effects.push({ update: (dt) => {
        t += dt;
        const u = Math.min(1, t / drop);
        _v.copy(top).lerp(c, u * u);
        for (let k = 0; k < 4; k++) this.fire.emit(_v.x, _v.y + k * 0.25 * size, _v.z, 0, 4, 0, 0.18, 0.12 * size * (1 - k * 0.2), 0.01, RIM, CORE0, 0, 0);
        return t < drop;
      } });
    }
    const start = () => {
      // flash with radial spikes
      if (o.flash !== false) {
        this._bb(c, 1, pal.core, 0.26, (u) => (0.6 + 1.6 * easeOut(u * 1.6)) * size, (u) => 0.75 * (1 - u) * (1 - u));
        this.light(c, 60 * size, 16 * size, 0.4, new THREE.Color(...pal.core.map((x) => Math.min(1, x / 1.8))).getHex());
      }
      // glowing core and its thin crisp ring
      if (o.core !== false) this._bb(c, 3, pal.deep, dur, (u, t) => size * (0.75 + 0.08 * Math.sin(t * 22)) * (u < 0.85 ? 1 : 1 - (u - 0.85) / 0.15), (u) => Math.min(1, u * 8) * (1 - Math.pow(u, 4)));
      if (o.core !== false) this._bb(c, 2, pal.rim, dur * 0.9, (u) => size * (0.5 + 0.05 * Math.sin(u * 30)), (u) => Math.min(1, u * 10) * (1 - Math.pow(u, 3)), true, 0.035);
      // swirling ribbons: short glossy arcs orbiting tilted axes round the core, constantly re-sweeping
      const n = Math.round((o.ribbons || 12) * (this.fire.max <= 2500 ? 0.6 : 1.4)); // fewer on Low
      for (let k = 0; k < n; k++) {
        const ax = UP.clone().addScaledVector(_w.set(R() - 0.5, 0, R() - 0.5), 0.9).normalize();
        const e1 = new THREE.Vector3(R() - 0.5, 0, R() - 0.5).cross(ax).normalize();
        const e2 = new THREE.Vector3().crossVectors(ax, e1);
        const rr = size * (1.1 + R() * 1.8), spd = (6 + R() * 6) * (k % 3 ? 1 : -1);
        const cc = c.clone().addScaledVector(ax, (R() - 0.5) * size * 1.2);
        const spawn = (delay) => {
          let ang = R() * 6.283;
          this.ribbon(cc, e1, e2, rr, 1.6 + R() * 1.4, {
            pal, w: rr * (0.1 + R() * 0.12), sweep: 0.12, life: 0.42 + R() * 0.2, grow: 0.25, helix: (R() - 0.5) * size, delay,
            onFrame: (U, t, dt) => {
              ang += spd * dt;
              const ca = Math.cos(ang), sa = Math.sin(ang);
              U.uE1.value.copy(e1).multiplyScalar(ca).addScaledVector(e2, sa);
              U.uE2.value.copy(e2).multiplyScalar(ca).addScaledVector(e1, -sa);
              void t;
            },
          });
        };
        const waves = Math.max(1, Math.round(dur / 0.4));
        for (let w = 0; w < waves; w++) spawn(w * 0.38 + k * 0.025 + R() * 0.08);
      }
      // sparks spiralling out
      let t = 0;
      this.effects.push({ update: (dt) => {
        t += dt;
        const live = t < dur * 0.85;
        if (live) for (let k = 0; k < 6 * size; k++) {
          const a = R() * 6.283, r0 = size * (0.6 + R() * 2.2), y = (R() - 0.4) * size * 2;
          const tx = -Math.sin(a), tz = Math.cos(a), sp = 4 + R() * 6;
          this.fire.emit(c.x + Math.cos(a) * r0, c.y + y, c.z + Math.sin(a) * r0, tx * sp + Math.cos(a) * 2, 1 + R() * 2, tz * sp + Math.sin(a) * 2, 0.3 + R() * 0.4, 0.06 + R() * 0.06, 0.01, RIM, CORE0, 1.5, 0);
        }
        // dissolve: motes drifting up
        if (t > dur * 0.75 && t < dur + 0.6) for (let k = 0; k < 5 * size; k++) {
          const a = R() * 6.283, r0 = R() * size * 2.4;
          this.fire.emit(c.x + Math.cos(a) * r0, c.y + (R() - 0.6) * size * 1.5, c.z + Math.sin(a) * r0, 0, 0.6 + R() * 1.5, 0, 0.8 + R() * 0.6, 0.05, 0.02, RIM, CORE0, 0.5, -0.4);
        }
        return t < dur + 0.6;
      } });
      if (o.debris !== false) this.rockChunks(c, Math.round(8 * size), size);
      if (o.crack !== false) this.groundCrack(c, 3.2 * size, pal, dur + 1.2);
    };
    if (drop) setTimeout(start, drop * 1000); else start();
  },

  // dark rock chunks flung up and out, tumbling, then shrinking away
  rockChunks(c, n, size = 1) {
    if (!ROCK) { ROCK = new THREE.IcosahedronGeometry(1, 0); ROCK_MAT = new THREE.MeshLambertMaterial({ color: 0x6d6a66, flatShading: true }); }
    for (let k = 0; k < n; k++) {
      const mesh = new THREE.Mesh(ROCK, ROCK_MAT);
      const s = (0.05 + R() * 0.09) * size;
      mesh.scale.setScalar(s);
      mesh.position.copy(c).add(_v.set((R() - 0.5) * size, (R() - 0.7) * size * 0.6, (R() - 0.5) * size));
      const a = R() * 6.283, sp = (3 + R() * 6) * Math.sqrt(size);
      const vel = new THREE.Vector3(Math.cos(a) * sp, 4 + R() * 7, Math.sin(a) * sp);
      const spin = new THREE.Vector3(R() * 10, R() * 10, R() * 10);
      this.scene.add(mesh);
      let t = 0; const life = 0.9 + R() * 0.7;
      this.effects.push({ update: (dt) => {
        t += dt;
        vel.y -= 18 * dt;
        mesh.position.addScaledVector(vel, dt);
        mesh.rotation.x += spin.x * dt; mesh.rotation.y += spin.y * dt; mesh.rotation.z += spin.z * dt;
        if (t > life * 0.6) mesh.scale.setScalar(s * Math.max(0, 1 - (t - life * 0.6) / (life * 0.4)));
        if (t >= life) { this.scene.remove(mesh); return false; }
        return true;
      } });
    }
  },

  // glowing radial crack on the ground that cools and fades
  groundCrack(c, r, pal, life = 2.4) {
    const groundY = groundH(c.x, c.z);
    if (c.y - groundY > 4) return; // too high above the ground
    const m = new THREE.MeshBasicMaterial({ map: crackTex(), color: new THREE.Color(...pal.core), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), m);
    mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = R() * 6.283;
    mesh.position.set(c.x, groundY + 0.06, c.z);
    this.scene.add(mesh);
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      const u = t / life;
      m.opacity = Math.min(1, t * 8) * (1 - u * u);
      const hot = Math.max(0, 1 - u * 1.6);
      m.color.setRGB(pal.core[0] * 0.6 + pal.rim[0] * 0.5 * hot, pal.core[1] * 0.6 + pal.rim[1] * 0.5 * hot, pal.core[2] * 0.6 + pal.rim[2] * 0.5 * hot);
      if (t >= life) { this.scene.remove(mesh); mesh.geometry.dispose(); m.dispose(); return false; }
      return true;
    } });
  },
});
