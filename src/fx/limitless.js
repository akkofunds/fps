import * as THREE from 'three';
import { Fx } from './fire.js';

// The Sorcerer's Limitless VFX: cursed-energy flicks, Lapse: Blue (a point of attraction that drags
// particles, dust and light into itself, then collapses), Reversal: Red (repulsion condensing at the
// fingertip, a red bolt, a blast that throws everything outward), and Hollow Purple (Blue and Red in
// each hand, merged, released as a huge sphere of imaginary mass that tears a trench as it goes).

const R = Math.random;
const BLUE = [0.5, 1.5, 3.6, 1], BLUE2 = [0.15, 0.55, 2.4, 0.9], ICEW = [2.4, 3.0, 3.8, 1], CLEAR = [0.05, 0.1, 0.4, 0];
const RED = [2.2, 0.1, 0.07, 1], RED2 = [1.5, 0.03, 0.02, 0.9], HOTW = [2.8, 0.8, 0.6, 1], DRED = [0.4, 0.02, 0.02, 0];
const PURP = [1.9, 0.35, 3.8, 1], PURP2 = [1.0, 0.1, 2.4, 0.9], VIOW = [2.8, 1.6, 3.8, 1], DPURP = [0.15, 0.02, 0.3, 0];
const REDD = [1.0, 0.03, 0.02, 1], REDD2 = [0.6, 0.01, 0.01, 0.9]; // deep red that stays red through the hot-core particle shader
const DUST0 = [0.42, 0.4, 0.36, 0.5], DUST1 = [0.5, 0.48, 0.45, 0];

// glowing orb: dark core, bright fresnel rim, swirling bands (inner / rim colours HDR so bloom catches them)
function orbMaterial(inner, rim, opts = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.FrontSide,
    uniforms: { uT: { value: 0 }, uInner: { value: new THREE.Color(...inner) }, uRim: { value: new THREE.Color(...rim) }, uA: { value: 1 }, uSwirl: { value: opts.swirl ?? 1 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      uniform float uT, uA, uSwirl; uniform vec3 uInner, uRim; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z); }
      void main(){
        float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        vec3 p = normalize(vP);
        float a = atan(p.z, p.x) + uT * 3.0 * uSwirl + p.y * 3.0;
        float bands = n3(vec3(cos(a) * 2.0, p.y * 4.0 - uT * 1.5, sin(a) * 2.0) * 1.6);
        vec3 col = mix(uInner, uRim, clamp(fr * 1.3 + bands * 0.35 * uSwirl, 0.0, 1.0));
        float alpha = clamp(0.55 + fr * 0.9 + bands * 0.2, 0.0, 1.0) * uA;
        gl_FragColor = vec4(col, alpha);
      }`,
  });
}
const SPHERE = new THREE.SphereGeometry(1, 32, 24);

function glowSprite(color, size) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}

// a thin glowing ring (accretion / energy rings round the orbs)
function torus(color, radius, tube) {
  const g = new THREE.TorusGeometry(radius, tube, 8, 64);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
}
// a flat ring lying on the ground (scaled to its radius)
const FLATRING = new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2);
function flatRing(color) {
  return new THREE.Mesh(FLATRING, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
}
// a jagged electric arc over a sphere of radius r round c (a chain of bright particles)
function arc(fx, c, r, cA, cB) {
  let u = R() * 2 - 1, a = R() * 6.283;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const sq = Math.sqrt(1 - u * u);
    fx.fire.emit(c.x + Math.cos(a) * sq * r, c.y + u * r, c.z + Math.sin(a) * sq * r, 0, 0, 0, 0.07, 0.07, 0.03, i % 2 ? cA : cB, cA, 0, 0);
    a += (R() - 0.5) * 0.7; u = Math.max(-0.99, Math.min(0.99, u + (R() - 0.5) * 0.5));
  }
}

Object.assign(Fx.prototype, {
  // ---------------------------------------------------------------- LMB flick
  cursedBurst(p, dir, k = 1) {
    for (let i = 0; i < 10 * k; i++) {
      const s = 2 + R() * 4;
      this.fire.emit(p.x, p.y, p.z, dir.x * s + (R() - 0.5) * 2, dir.y * s + (R() - 0.5) * 2, dir.z * s + (R() - 0.5) * 2, 0.12 + R() * 0.15, 0.12 * k, 0.03, R() < 0.4 ? ICEW : BLUE, CLEAR, 5, 0);
    }
    this.light(p, 5 * k, 5, 0.1, 0x6fb8ff);
  },
  flickTrail(p, v) {
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.05, 0.45, 0.25, ICEW, BLUE, 0, 0);
    for (let i = 0; i < 2; i++) this.fire.emit(p.x, p.y, p.z, v.x * 0.03 + (R() - 0.5) * 0.7, v.y * 0.03 + (R() - 0.5) * 0.7, v.z * 0.03 + (R() - 0.5) * 0.7, 0.16 + R() * 0.12, 0.16, 0.02, BLUE, CLEAR, 3, 0);
  },
  flickHit(p) {
    for (let i = 0; i < 14; i++) { const u = R() * 2 - 1, a = R() * 6.283, s = Math.sqrt(1 - u * u), sp = 2 + R() * 4; this.fire.emit(p.x, p.y, p.z, Math.cos(a) * s * sp, u * sp, Math.sin(a) * s * sp, 0.2 + R() * 0.2, 0.18, 0.03, R() < 0.4 ? ICEW : BLUE, CLEAR, 3, 0); }
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.1, 0.8, 1.1, ICEW, BLUE2, 0, 0);
    this.light(p, 6, 5, 0.12, 0x6fb8ff);
  },

  // ---------------------------------------------------------------- E: Lapse: Blue
  // A point where space folds in on itself: a dark-cored orb with a blazing cyan rim, two accretion
  // rings spinning round it, electric arcs, everything nearby (particles, dust, light) spiralling
  // into it, rings on the ground collapsing inward — then it implodes.
  blueOrb(c, from, life, pullR, onCollapse) {
    const g = new THREE.Group(); g.position.copy(c); this.scene.add(g);
    const core = new THREE.Mesh(SPHERE, orbMaterial([0.0, 0.02, 0.18], [0.5, 1.6, 4.2]));
    const shell = new THREE.Mesh(SPHERE, orbMaterial([0.0, 0.08, 0.5], [0.3, 1.0, 3.4], { additive: true, swirl: 2.5 }));
    const halo = glowSprite(new THREE.Color(0.25, 0.65, 2.6), 9);
    const ringA = torus(new THREE.Color(0.5, 1.6, 4.0), 1.55, 0.045), ringB = torus(new THREE.Color(0.3, 0.9, 3.2), 2.15, 0.03);
    ringA.rotation.set(1.1, 0, 0.3); ringB.rotation.set(1.8, 0.6, -0.4);
    g.add(halo); g.add(shell); g.add(core); g.add(ringA); g.add(ringB);
    for (const m of [core, shell, ringA, ringB]) m.scale.setScalar(0.001);
    const light = this.light(c, 0, pullR * 2.6, life + 0.8, 0x4f9bff);
    // ground rings collapsing into the point
    const gy = this.world ? this.world.groundAt(c.x, c.z, c.y + 2) : c.y - 1.3;
    const gRings = [0, 1, 2].map(() => { const m = flatRing(new THREE.Color(0.35, 1.0, 3.0)); m.position.set(c.x, gy + 0.08, c.z); this.scene.add(m); return m; });
    if (from) for (let i = 0; i <= 24; i++) { const k = i / 24; this.fire.emit(from.x + (c.x - from.x) * k, from.y + (c.y - from.y) * k, from.z + (c.z - from.z) * k, 0, 0, 0, 0.1 + k * 0.18, 0.3, 0.06, ICEW, BLUE2, 0, 0); }
    let t = 0, done = false;
    this.effects.push({ update: (dt) => {
      t += dt;
      const grow = 1 - Math.pow(1 - Math.min(1, t / 0.22), 3);
      const collapse = Math.max(0, (t - life) / 0.18);
      const s = (0.8 + Math.sin(t * 24) * 0.05) * grow * (1 - collapse);
      core.scale.setScalar(Math.max(0.001, s)); shell.scale.setScalar(Math.max(0.001, s * 1.9));
      ringA.scale.setScalar(Math.max(0.001, grow * (1 - collapse) * (1 + Math.sin(t * 7) * 0.05))); ringB.scale.copy(ringA.scale);
      ringA.rotation.z += dt * 7; ringB.rotation.z -= dt * 5; ringB.rotation.x += dt * 0.8;
      core.material.uniforms.uT.value = t; shell.material.uniforms.uT.value = t;
      shell.material.uniforms.uA.value = 0.6 * (1 - collapse);
      ringA.material.opacity = ringB.material.opacity = 0.9 * (1 - collapse) * grow;
      halo.material.opacity = (0.75 + Math.sin(t * 9) * 0.15) * (1 - collapse) * grow;
      halo.scale.setScalar(8 + Math.sin(t * 13) * 0.8);
      light.intensity = 45 * grow * (1 - collapse); light.position.copy(c);
      gRings.forEach((m, i) => {
        const k = ((t * 1.6 + i / 3) % 1);
        m.scale.setScalar(Math.max(0.01, pullR * (1 - k)));
        m.material.opacity = t < life ? Math.sin(k * Math.PI) * 0.75 * grow : Math.max(0, m.material.opacity - dt * 4);
      });
      if (t < life) {
        // everything spirals INTO the point
        for (let i = 0; i < 12; i++) {
          const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), r = pullR * (0.3 + R() * 0.7);
          const px = c.x + Math.cos(a) * sq * r, py = c.y + u * r * 0.6, pz = c.z + Math.sin(a) * sq * r;
          const lf = 0.4 + R() * 0.25;
          const ix = (c.x - px) / lf, iy = (c.y - py) / lf, iz = (c.z - pz) / lf;
          this.fire.emit(px, py, pz, ix - (pz - c.z) * 1.4, iy, iz + (px - c.x) * 1.4, lf, 0.04 + R() * 0.07, 0.16, R() < 0.3 ? ICEW : BLUE2, BLUE, 0, 0);
        }
        // crackling arcs across the surface
        if (R() < 0.5) arc(this, c, 0.9 + R() * 0.8, BLUE, ICEW);
        // dust, grass and stones ripped off the ground
        for (let i = 0; i < 2; i++) {
          const a = R() * 6.283, r = pullR * (0.35 + R() * 0.65), px = c.x + Math.cos(a) * r, pz = c.z + Math.sin(a) * r;
          const g2 = this.world ? this.world.groundAt(px, pz, c.y + 5) : gy;
          this.smoke.emit(px, g2 + 0.1, pz, (c.x - px) * 1.5, (c.y - g2) * 1.7, (c.z - pz) * 1.5, 0.7, 0.32, 0.05, DUST0, DUST1, 0.4, 0);
          if (R() < 0.3) this.smoke.emit(px, g2 + 0.1, pz, (c.x - px) * 1.8, (c.y - g2) * 2.0, (c.z - pz) * 1.8, 0.55, 0.12, 0.06, [0.16, 0.15, 0.14, 1], [0.2, 0.2, 0.2, 0.6], 0, 0);
        }
      } else if (!done) {
        done = true;
        // the collapse: an implosion flash, a shock ring, everything flung back out
        for (let i = 0; i < 70; i++) { const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), sp = 8 + R() * 12; this.fire.emit(c.x, c.y, c.z, Math.cos(a) * sq * sp, u * sp, Math.sin(a) * sq * sp, 0.25 + R() * 0.25, 0.32, 0.04, R() < 0.5 ? ICEW : BLUE, CLEAR, 5, 0); }
        this.fire.emit(c.x, c.y, c.z, 0, 0, 0, 0.2, 3.5, 6.5, ICEW, BLUE2, 0, 0);
        this.ring(c, pullR * 1.1, 0.45, new THREE.Color(0.6, 1.4, 3.6));
        this.ring(new THREE.Vector3(c.x, gy, c.z), pullR * 0.8, 0.35, new THREE.Color(1.6, 2.6, 3.8));
        this.light(c, 60, pullR * 4, 0.25, 0x9fd8ff);
        this.shake(0.3);
        if (onCollapse) onCollapse();
      }
      if (t > life + 0.35) {
        this.scene.remove(g); for (const m of gRings) { this.scene.remove(m); m.material.dispose(); }
        for (const m of [core, shell, ringA, ringB]) m.material.dispose(); halo.material.map.dispose(); halo.material.dispose();
        return false;
      }
      return true;
    } });
  },

  // ---------------------------------------------------------------- C: Reversal: Red
  // repulsion condensing at the fingertip (getTip(out) → world position) for `dur` seconds
  redCharge(getTip, dur) {
    const halo = glowSprite(new THREE.Color(2.8, 0.12, 0.08), 0.3); this.scene.add(halo);
    const core = new THREE.Mesh(SPHERE, orbMaterial([1.2, 0.02, 0.02], [4.0, 0.5, 0.35], { additive: true, swirl: 2 })); this.scene.add(core);
    const ring = torus(new THREE.Color(3.6, 0.35, 0.25), 1, 0.06); this.scene.add(ring);
    let t = 0;
    const p = new THREE.Vector3();
    this.effects.push({ update: (dt) => {
      t += dt;
      getTip(p);
      const k = Math.min(1, t / dur), out = t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.1);
      halo.position.copy(p); halo.scale.setScalar((0.3 + k * 1.4 + Math.sin(t * 40) * 0.06) * out);
      halo.material.opacity = 0.95 * out;
      core.position.copy(p); core.scale.setScalar(Math.max(0.001, (0.04 + k * 0.13) * out)); core.material.uniforms.uT.value = t;
      ring.position.copy(p); ring.scale.setScalar(Math.max(0.001, (0.45 - k * 0.25) * out)); ring.rotation.x += dt * 9; ring.rotation.y += dt * 13;
      ring.material.opacity = 0.9 * out;
      if (t < dur) for (let i = 0; i < 4; i++) {
        const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), r = 0.6 + R() * 0.6, lf = 0.16;
        const px = p.x + Math.cos(a) * sq * r, py = p.y + u * r, pz = p.z + Math.sin(a) * sq * r;
        this.fire.emit(px, py, pz, (p.x - px) / lf, (p.y - py) / lf, (p.z - pz) / lf, lf, 0.04, 0.1, R() < 0.3 ? HOTW : RED, RED2, 0, 0);
      }
      if (t < dur && R() < 0.3) arc(this, p, 0.25, RED, HOTW);
      if (t > dur + 0.12) { this.scene.remove(halo); this.scene.remove(core); this.scene.remove(ring); halo.material.map.dispose(); halo.material.dispose(); core.material.dispose(); ring.material.dispose(); return false; }
      return true;
    } });
    this.light(getTip(p), 10, 6, dur, 0xff3020);
  },
  redTrail(p, v, age) {
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.06, 1.2, 0.6, HOTW, RED, 0, 0);
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.14, 0.7, 1.3, RED, RED2, 0, 0);
    const L = Math.hypot(v.x, v.y, v.z) || 1, fx = v.x / L, fy = v.y / L, fz = v.z / L;
    let ux = -fz, uz = fx; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    const wx = fy * uz, wy = fz * ux - fx * uz, wz = -fy * ux;
    for (let k = 0; k < 3; k++) {
      const a = age * 32 + k * 2.094, cs = Math.cos(a) * 0.38, sn = Math.sin(a) * 0.38;
      this.fire.emit(p.x + ux * cs + wx * sn, p.y + wy * sn, p.z + uz * cs + wz * sn, v.x * 0.04, v.y * 0.04, v.z * 0.04, 0.3, 0.18, 0.03, RED, DRED, 3, 0);
    }
  },
  redBlast(p, radius) {
    // a white-hot core and a red shell of force slamming outward: everything is thrown away
    const shell = new THREE.Mesh(SPHERE, orbMaterial([0.6, 0.0, 0.0], [4.0, 0.6, 0.4], { additive: true, swirl: 2 }));
    shell.position.copy(p); this.scene.add(shell);
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt; const k = Math.min(1, t / 0.4);
      shell.scale.setScalar(0.3 + (1 - (1 - k) * (1 - k)) * radius * 1.8);
      shell.material.uniforms.uA.value = (1 - k) * 0.8; shell.material.uniforms.uT.value = t;
      if (k >= 1) { this.scene.remove(shell); shell.material.dispose(); return false; }
      return true;
    } });
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.16, radius * 1.0, radius * 2.4, HOTW, RED, 0, 0);
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.35, radius * 0.7, radius * 1.6, RED, DRED, 0, 0);
    for (let i = 0; i < 100; i++) {
      const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), sp = 12 + R() * 16;
      this.fire.emit(p.x, p.y, p.z, Math.cos(a) * sq * sp, u * sp * 0.7 + 1, Math.sin(a) * sq * sp, 0.24 + R() * 0.24, 0.32, 0.04, R() < 0.35 ? HOTW : RED, DRED, 4, 0);
    }
    for (let i = 0; i < 24; i++) { const a = R() * 6.283; this.smoke.emit(p.x, p.y - 0.4, p.z, Math.cos(a) * 11, 0.6 + R() * 1.5, Math.sin(a) * 11, 0.8 + R() * 0.4, 0.5, 2.0, DUST0, DUST1, 2.6, 0.1); }
    for (let i = 0; i < 4; i++) arc(this, p, radius * 0.8, RED, HOTW);
    this.ring(p, radius * 2.2, 0.42, new THREE.Color(3.6, 0.5, 0.35));
    this.ring(p, radius * 1.2, 0.26, new THREE.Color(3.6, 2.6, 2.2));
    this.light(p, 45, radius * 7, 0.35, 0xff3a28);
    this.scorch(p.x, p.z, radius * 0.9, 9);
  },

  // ---------------------------------------------------------------- V: Hollow Purple
  // Blue in the left hand, Red in the right (getL / getR(out) → world): they appear at `start` and
  // grow big, float out in front of him (getMid) spiralling round each other, collide in a flash and
  // mix into one big purple sphere that swells there until `dur` — where Hollow Purple is released
  purpleCharge(getL, getR, getMid, dur, start = 0, bigR = 1.3) {
    // (Red is drawn with normal blending: red light ADDED onto green grass turns yellow)
    const mk = (inner, rim, rc, additive = true) => {
      const g = new THREE.Group(); this.scene.add(g);
      const m = new THREE.Mesh(SPHERE, orbMaterial(inner, rim, { additive, swirl: 1.8 }));
      const r = torus(rc, 1.6, 0.06); g.add(m); g.add(r); g.scale.setScalar(0.001);
      return { g, m, r };
    };
    // saturated, not white: you must SEE one blue and one red before they mix
    const blue = mk([0.0, 0.08, 0.9], [0.15, 0.6, 2.6], new THREE.Color(0.2, 0.7, 2.6)), red = mk([0.55, 0.0, 0.0], [1.6, 0.05, 0.03], new THREE.Color(1.6, 0.06, 0.03), false);
    red.r.material.blending = THREE.NormalBlending;
    const hb = glowSprite(new THREE.Color(0.04, 0.18, 1.3), 2), hr = glowSprite(new THREE.Color(1.0, 0.02, 0.01), 2);
    hr.material.blending = THREE.NormalBlending;
    this.scene.add(hb); this.scene.add(hr);
    const lb = this.light(new THREE.Vector3(), 0, 9, dur + 0.2, 0x2f6bff), lr = this.light(new THREE.Vector3(), 0, 9, dur + 0.2, 0xff2010);
    // the purple sphere they become
    const purple = new THREE.Group(); purple.visible = false; this.scene.add(purple);
    const pc = new THREE.Mesh(SPHERE, orbMaterial([0.55, 0.1, 1.4], [1.9, 0.45, 3.8], { swirl: 2.4 }));
    const ps = new THREE.Mesh(SPHERE, orbMaterial([0.3, 0.03, 0.8], [1.2, 0.2, 2.8], { additive: true, swirl: 3 }));
    const pr1 = torus(new THREE.Color(2.4, 0.9, 3.8), 1.45, 0.035), pr2 = torus(new THREE.Color(1.4, 0.3, 3.2), 1.75, 0.03);
    purple.add(ps); purple.add(pc); purple.add(pr1); purple.add(pr2);
    const hp = glowSprite(new THREE.Color(0.8, 0.15, 2.0), 3); hp.material.opacity = 0; this.scene.add(hp);
    const L = new THREE.Vector3(), Rr = new THREE.Vector3(), M = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), sd = new THREE.Vector3(), tmpP = new THREE.Vector3();
    const tTravel = dur - 1.25, tHit = dur - 0.6;
    let t = 0, hit = false;
    this.effects.push({ update: (dt) => {
      t += dt;
      getL(L); getR(Rr); getMid(M);
      const grow = Math.max(0, Math.min(1, (t - start) / 0.5));
      const tr = Math.max(0, Math.min(1, (t - tTravel) / (tHit - tTravel)));
      const e = tr * tr * (3 - 2 * tr);
      // spiral: the two orbit the midpoint on opposite sides while closing in
      sd.subVectors(Rr, L).setY(0); if (sd.lengthSq() < 1e-6) sd.set(1, 0, 0); sd.normalize();
      const fw = tmpP.crossVectors(sd, up).normalize();
      const ang = e * Math.PI * 3, rad = 0.55 * (1 - e);
      const ox = Math.cos(ang) * rad, oy = Math.sin(ang) * rad * 0.6;
      blue.g.position.lerpVectors(L, M, e).addScaledVector(sd, -ox * e).addScaledVector(up, oy * e).addScaledVector(fw, 0);
      red.g.position.lerpVectors(Rr, M, e).addScaledVector(sd, ox * e).addScaledVector(up, -oy * e);
      const s = 0.3 * (1 - Math.pow(1 - grow, 3)) * (1 + e * 0.4);
      blue.g.scale.setScalar(Math.max(0.001, s)); red.g.scale.setScalar(Math.max(0.001, s));
      blue.m.material.uniforms.uT.value = t; red.m.material.uniforms.uT.value = t;
      blue.r.rotation.x += dt * 8; blue.r.rotation.y += dt * 5; red.r.rotation.x -= dt * 7; red.r.rotation.z += dt * 9;
      blue.r.material.opacity = red.r.material.opacity = 0.85 * grow;
      hb.position.copy(blue.g.position); hr.position.copy(red.g.position);
      hb.material.opacity = hr.material.opacity = 0.75 * grow;
      hb.scale.setScalar(2.2 + Math.sin(t * 17) * 0.2); hr.scale.setScalar(2.2 + Math.cos(t * 19) * 0.2);
      lb.position.copy(blue.g.position); lr.position.copy(red.g.position); lb.intensity = lr.intensity = 14 * grow;
      if (grow > 0 && !hit) for (const [o, cA, cB, inward] of [[blue.g.position, BLUE, BLUE2, true], [red.g.position, REDD, REDD2, false]]) {
        for (let i = 0; i < 3; i++) {
          const a = R() * 6.283, u = R() * 2 - 1, sq = Math.sqrt(1 - u * u), r = inward ? 0.9 : 0.25, sp = inward ? -3 : 3;
          this.fire.emit(o.x + Math.cos(a) * sq * r, o.y + u * r, o.z + Math.sin(a) * sq * r, Math.cos(a) * sq * sp, u * sp, Math.sin(a) * sq * sp, 0.24, 0.1, 0.03, cA, cB, 1, 0);
        }
        // a trail behind each as they swirl in
        if (tr > 0) this.fire.emit(o.x, o.y, o.z, 0, 0, 0, 0.3, 0.35, 0.05, cA, cB, 0, 0);
      }
      if (tr > 0.6 && !hit && R() < 0.7) arc(this, M, 0.4 + (1 - tr) * 0.8, PURP, VIOW);
      // the collision: blue and red mix into purple
      if (!hit && t >= tHit) {
        hit = true;
        blue.g.visible = red.g.visible = hb.visible = hr.visible = false;
        purple.visible = true;
        for (let i = 0; i < 90; i++) { const a = R() * 6.283, u = R() * 2 - 1, sq = Math.sqrt(1 - u * u), sp = 5 + R() * 10; this.fire.emit(M.x, M.y, M.z, Math.cos(a) * sq * sp, u * sp, Math.sin(a) * sq * sp, 0.25 + R() * 0.2, 0.3, 0.04, R() < 0.33 ? BLUE : R() < 0.5 ? RED : VIOW, DPURP, 4, 0); }
        this.fire.emit(M.x, M.y, M.z, 0, 0, 0, 0.22, 2.4, 5.2, VIOW, PURP, 0, 0);
        this.ring(M, 4, 0.4, new THREE.Color(2.4, 0.8, 3.8));
        this.light(M, 60, 24, 0.45, 0xa04cff);
        this.shake(0.4);
        lb.color.setHex(0xa04cff); lr.color.setHex(0xa04cff);
      }
      if (hit) {
        const k = Math.min(1, (t - tHit) / (dur - tHit)), ke = 1 - Math.pow(1 - k, 3);
        const rr = 0.35 + (bigR - 0.35) * ke + Math.sin(t * 30) * 0.03;
        purple.position.copy(M);
        pc.scale.setScalar(rr * 0.72); ps.scale.setScalar(rr * 1.1); pr1.scale.setScalar(rr * 0.8); pr2.scale.setScalar(rr * 0.8);
        pr1.rotation.x += dt * 6; pr1.rotation.y += dt * 4; pr2.rotation.z += dt * 7; pr2.rotation.x -= dt * 3;
        pc.material.uniforms.uT.value = t; ps.material.uniforms.uT.value = t;
        hp.position.copy(M); hp.material.opacity = 0.9; hp.scale.setScalar(rr * 5);
        lb.position.copy(M); lb.intensity = 30;
        // everything around is drawn into the swelling mass
        for (let i = 0; i < 8; i++) {
          const a = R() * 6.283, u = R() * 2 - 1, sq = Math.sqrt(1 - u * u), r = rr * 2.2, lf = 0.3;
          this.fire.emit(M.x + Math.cos(a) * sq * r, M.y + u * r, M.z + Math.sin(a) * sq * r, -Math.cos(a) * sq * r / lf, -u * r / lf, -Math.sin(a) * sq * r / lf, lf, 0.12, 0.04, R() < 0.4 ? VIOW : PURP, PURP2, 0, 0);
        }
        if (R() < 0.8) arc(this, M, rr * 1.05, PURP, VIOW);
      }
      if (t >= dur) {
        for (const o of [blue, red]) { this.scene.remove(o.g); o.m.material.dispose(); o.r.material.dispose(); }
        for (const h of [hb, hr, hp]) { this.scene.remove(h); h.material.map.dispose(); h.material.dispose(); }
        this.scene.remove(purple); purple.traverse((m) => { if (m.material) m.material.dispose(); });
        return false;
      }
      return true;
    } });
  },
  // the released imaginary mass: o start, dir unit, travels len metres at speed
  hollowPurple(o, dir, len, speed, radius, startR = 0) {
    const g = new THREE.Group(); this.scene.add(g);
    const core = new THREE.Mesh(SPHERE, orbMaterial([0.55, 0.1, 1.4], [1.9, 0.45, 3.8], { swirl: 2.4 }));
    const shell = new THREE.Mesh(SPHERE, orbMaterial([0.3, 0.03, 0.8], [1.2, 0.2, 2.8], { additive: true, swirl: 3 }));
    const halo = glowSprite(new THREE.Color(0.8, 0.15, 2.0), radius * 5);
    const r1 = torus(new THREE.Color(2.4, 0.9, 3.8), 1, 0.035), r2 = torus(new THREE.Color(1.4, 0.3, 3.2), 1, 0.025);
    g.add(halo); g.add(shell); g.add(core); g.add(r1); g.add(r2);
    // the rings spin around the direction of travel
    const look = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    r1.quaternion.copy(look); r2.quaternion.copy(look);
    const light = this.light(o, 0, radius * 12, len / speed + 0.5, 0xa04cff);
    // the launch: a shock ring and a burst of violet light at the hands
    this.ring(o, radius * 2.5, 0.4, new THREE.Color(2.4, 0.8, 3.8));
    for (let i = 0; i < 40; i++) { const a = R() * 6.283, u = R() * 2 - 1, sq = Math.sqrt(1 - u * u), sp = 6 + R() * 8; this.fire.emit(o.x, o.y, o.z, Math.cos(a) * sq * sp - dir.x * 4, u * sp, Math.sin(a) * sq * sp - dir.z * 4, 0.3, 0.3, 0.05, VIOW, PURP, 3, 0); }
    this.shake(0.5);
    const pos = new THREE.Vector3(), life = len / speed;
    let t = 0, lastScorch = -99;
    this.effects.push({ update: (dt) => {
      t += dt;
      const d = Math.min(len, t * speed);
      pos.copy(o).addScaledVector(dir, d);
      g.position.copy(pos);
      const k0 = startR / radius, k = k0 + (1 - k0) * (1 - Math.pow(1 - Math.min(1, t / 0.35), 3)), fade = t > life ? Math.max(0, 1 - (t - life) / 0.35) : 1;
      core.scale.setScalar(radius * 0.7 * k * (0.5 + 0.5 * fade)); shell.scale.setScalar(radius * 1.12 * k * (0.5 + 0.5 * fade));
      r1.scale.setScalar(radius * 1.5 * k); r2.scale.setScalar(radius * 1.85 * k);
      r1.rotateZ(dt * 9); r2.rotateZ(-dt * 6);
      core.material.uniforms.uT.value = t; shell.material.uniforms.uT.value = t;
      core.material.uniforms.uA.value = fade; shell.material.uniforms.uA.value = 0.6 * fade;
      r1.material.opacity = r2.material.opacity = 0.8 * fade;
      halo.material.opacity = 0.85 * fade;
      light.position.copy(pos); light.intensity = 60 * fade;
      if (t < life) {
        // violet plasma torn off the surface, streaming behind; arcs crawling over it
        for (let i = 0; i < 14; i++) {
          const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u);
          this.fire.emit(pos.x + Math.cos(a) * sq * radius, pos.y + u * radius, pos.z + Math.sin(a) * sq * radius, -dir.x * speed * 0.18 + (R() - 0.5) * 2, (R() - 0.5) * 2, -dir.z * speed * 0.18 + (R() - 0.5) * 2, 0.35 + R() * 0.35, 0.55, 0.07, R() < 0.3 ? VIOW : PURP, DPURP, 2, 0);
        }
        if (R() < 0.7) arc(this, pos, radius * 1.05, PURP, VIOW);
        // the ground under it is erased: a trench of scorch + debris thrown aside
        const gy = this.world ? this.world.groundAt(pos.x, pos.z, pos.y + 3) : -99;
        if (pos.y - gy < radius + 1.5) {
          if (d - lastScorch > 2.2) { lastScorch = d; this.scorch(pos.x, pos.z, radius * 1.1, 12); }
          for (let i = 0; i < 3; i++) { const s = R() < 0.5 ? -1 : 1; this.smoke.emit(pos.x + dir.z * s * radius, gy + 0.2, pos.z - dir.x * s * radius, dir.z * s * 6 + dir.x * 3, 2 + R() * 4, -dir.x * s * 6 + dir.z * 3, 0.9, 0.55, 1.8, DUST0, DUST1, 2, -3); }
          if (R() < 0.4) this.smoke.emit(pos.x + (R() - 0.5) * radius, gy + 0.2, pos.z + (R() - 0.5) * radius, (R() - 0.5) * 6, 5 + R() * 5, (R() - 0.5) * 6, 0.9, 0.16, 0.12, [0.16, 0.15, 0.14, 1], [0.2, 0.2, 0.2, 0.5], 0, -14);
        }
      }
      if (t > life + 0.4) { this.scene.remove(g); for (const m of [core, shell, r1, r2]) m.material.dispose(); halo.material.map.dispose(); halo.material.dispose(); return false; }
      return true;
    } });
  },

  // Six Eyes: a faint blue glint at the eyes; the Infinity shimmer when he is standing still
  sixEyes(p) {
    if (R() < 0.25) this.fire.emit(p.x + (R() - 0.5) * 0.08, p.y + (R() - 0.5) * 0.04, p.z + (R() - 0.5) * 0.08, 0, 0.05, 0, 0.3, 0.035, 0.01, BLUE, CLEAR, 0, 0);
  },
});
