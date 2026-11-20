import * as THREE from 'three';
import { Fx } from './fire.js';

// Pyro's Fire Force kit VFX: Devil's Foot (blazing kick + burning trail), Rapid Ignition (ember
// fan + 3-stack detonation), Infernal Step (expanding fire shockwave + speed-boost foot flames)
// and Adolla Burst (charging core, then a pierce-everything beam of white-hot fire with a long
// burning scar on the ground). HDR colors so bloom makes them glow.

const R = Math.random;
const WHITE = [3.4, 2.3, 1.0, 1], HOT = [3.0, 1.45, 0.42, 1], FLAME = [2.6, 1.0, 0.24, 0.95], DEEP = [1.8, 0.35, 0.06, 0.6], DARK = [0.5, 0.08, 0.02, 0];
const SMOKE0 = [0.2, 0.18, 0.17, 0.45], SMOKE1 = [0.38, 0.36, 0.34, 0];
// afterburner air: cool white streaks (additive) and soft gray puffs
const AIR0 = [1.5, 1.55, 1.7, 0.75], AIR2 = [0.9, 0.92, 1.0, 0.6], AIR1 = [0.35, 0.36, 0.4, 0];
const PUFF0 = [0.82, 0.83, 0.86, 0.38], PUFF1 = [0.9, 0.9, 0.92, 0];
const tv = new THREE.Vector3();

function beamMaterial(inner) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uT: { value: 0 }, uA: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying float vFace;
      void main(){
        vUv = uv;
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFace = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uT, uA; varying vec2 vUv; varying float vFace;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        // v runs along the beam: flames race outward, u wraps around
        vec2 q = vec2(vUv.x * 6.0, vUv.y * 22.0 - uT * 38.0);
        float n = n2(q) * 0.6 + n2(q * 2.3 + 7.0) * 0.4;
        float core = pow(vFace, ${inner ? '0.6' : '1.8'});
        float k = clamp(core * ${inner ? '1.25' : '0.9'} + (n - 0.5) * 0.7, 0.0, 1.0);
        vec3 col = mix(vec3(1.6, 0.28, 0.04), vec3(3.4, 1.5, 0.45), smoothstep(0.15, 0.6, k));
        col = mix(col, vec3(4.5, 4.0, 3.2), smoothstep(0.62, 1.0, k) * ${inner ? '1.0' : '0.35'});
        // soft start at the hands, ragged tip
        float ends = smoothstep(0.0, 0.03, vUv.y) * smoothstep(1.0, 0.9 + n * 0.08, vUv.y);
        float a = k * ends * uA;
        gl_FragColor = vec4(col * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

Object.assign(Fx.prototype, {
  // ---------------------------------------------------------------- Devil's Foot
  // blazing foot while the kick travels (called per frame for the kicker)
  kickTrail(foot, vel) {
    for (let i = 0; i < 6; i++) {
      this.fire.emit(foot.x + (R() - 0.5) * 0.25, foot.y + (R() - 0.5) * 0.25, foot.z + (R() - 0.5) * 0.25,
        -vel.x * 0.15 + (R() - 0.5) * 1.5, 0.6 + R() * 1.2, -vel.z * 0.15 + (R() - 0.5) * 1.5, 0.22 + R() * 0.2, 0.55 + R() * 0.3, 0.08, R() < 0.35 ? WHITE : HOT, DARK, 3, 1.5);
    }
    this.fire.emit(foot.x, foot.y, foot.z, 0, 0, 0, 0.06, 1.3, 0.9, WHITE, FLAME, 0, 0);
    if (R() < 0.5) this.light(foot, 10, 7, 0.08);
  },
  kickImpact(c, dx, dz) {
    for (let i = 0; i < 70; i++) {
      const a = Math.atan2(dz, dx) + (R() - 0.5) * 1.6, sp = 5 + R() * 11, up = (R() - 0.3) * 8;
      this.fire.emit(c.x, c.y, c.z, Math.cos(a) * sp, up, Math.sin(a) * sp, 0.3 + R() * 0.35, 0.7 + R() * 0.6, 0.1, R() < 0.3 ? WHITE : FLAME, DARK, 3.5, 1);
    }
    for (let i = 0; i < 24; i++) { const a = R() * 6.283, sp = 6 + R() * 8; this.fire.emit(c.x, c.y, c.z, Math.cos(a) * sp, 3 + R() * 7, Math.sin(a) * sp, 0.6 + R() * 0.6, 0.08, 0.03, WHITE, DEEP, 0.6, -14); }
    this.fire.emit(c.x, c.y, c.z, 0, 0, 0, 0.12, 2.0, 2.8, HOT, FLAME, 0, 0);
    this.ring(c, 3.4, 0.35, new THREE.Color(4, 1.8, 0.5));
    this.light(c, 45, 12, 0.3, 0xffa040);
    for (let i = 0; i < 8; i++) this.smoke.emit(c.x, c.y, c.z, (R() - 0.5) * 3, 1 + R(), (R() - 0.5) * 3, 1.2, 0.5, 1.6, SMOKE0, SMOKE1, 2, 0.4);
    this.shake(0.2);
  },
  // burning ground along a segment; grows from a to b over `grow` seconds, burns for `life`
  fireTrail(a, b, life, grow = 0, width = 0.6) {
    let t = 0;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / 1.2));
    for (let i = 0; i <= n; i += 2) { const u = i / n; this.scorch(a.x + (b.x - a.x) * u, a.z + (b.z - a.z) * u, 1.1 + width * 0.6, life + 4); }
    this.effects.push({ update: (dt) => {
      t += dt;
      const reach = grow > 0 ? Math.min(1, t / grow) : 1;
      const k = Math.max(0, 1 - t / life);
      const cnt = Math.round((3 + len * 0.55) * (0.35 + 0.65 * k));
      for (let i = 0; i < cnt; i++) {
        const u = R() * reach;
        const x = a.x + (b.x - a.x) * u + (R() - 0.5) * width * 2, z = a.z + (b.z - a.z) * u + (R() - 0.5) * width * 2;
        const y = this.world.groundAt(x, z, Math.max(a.y, b.y) + 3);
        this.fire.emit(x, y + 0.05, z, (R() - 0.5) * 0.4, 1.4 + R() * 2.2 * k, (R() - 0.5) * 0.4, 0.35 + R() * 0.35, 0.5 + 0.5 * k, 0.12, R() < 0.25 ? HOT : FLAME, DARK, 1.2, 1.6);
      }
      if (R() < 0.25 * k) { const u = R() * reach; this.smoke.emit(a.x + (b.x - a.x) * u, a.y + 1.6, a.z + (b.z - a.z) * u, 0, 1.2, 0, 1.6, 0.6, 2, SMOKE0, SMOKE1, 0.5, 0.4); }
      if (R() < dt * 5 * k) { const u = R() * reach; this.light(tv.set(a.x + (b.x - a.x) * u, a.y + 1, a.z + (b.z - a.z) * u), 10, 8, 0.25); }
      return t < life;
    } });
  },

  // Movement afterburners are AIR, not fire: white/gray streaks and puffs for every character.
  // double jump: a pressure ring of air kicked off under the feet
  doubleJumpFx(p) {
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * 6.283, sp = 3.2 + R() * 1.6;
      this.fire.emit(p.x + Math.cos(a) * 0.3, p.y + 0.05, p.z + Math.sin(a) * 0.3, Math.cos(a) * sp, -1.2 - R(), Math.sin(a) * sp, 0.22 + R() * 0.14, 0.3, 0.05, AIR0, AIR1, 4, 0);
    }
    for (let i = 0; i < 10; i++) {
      const a = R() * 6.283;
      this.smoke.emit(p.x + Math.cos(a) * 0.4, p.y, p.z + Math.sin(a) * 0.4, Math.cos(a) * 2.2, -0.6, Math.sin(a) * 2.2, 0.5 + R() * 0.3, 0.35, 1.3, PUFF0, PUFF1, 2.5, 0);
    }
    this.ring(p, 1.7, 0.26, new THREE.Color(1.6, 1.65, 1.8));
  },
  // dash (exactly as in PR 4): an afterimage streak of flame/arcane wisps along the path (per frame while dashing)
  dashStreak(p, v, mage) {
    const arc = mage === 'meteora', lim = mage === 'sorcerer';
    if (mage === 'kineslayer') {
      // no energy: just air torn apart behind him
      for (let i = 0; i < 4; i++) this.fire.emit(p.x + (R() - 0.5) * 0.4, p.y + 0.15 + R() * 1.6, p.z + (R() - 0.5) * 0.4, -v.x * 0.15 + (R() - 0.5) * 0.4, (R() - 0.5) * 0.4, -v.z * 0.15 + (R() - 0.5) * 0.4, 0.18 + R() * 0.12, 0.05, 0.02, [1.3, 1.4, 1.5, 0.5], [0.7, 0.75, 0.85, 0], 3, 0);
      return;
    }
    for (let i = 0; i < 5; i++) {
      const h = 0.15 + R() * 1.5;
      const c0 = lim ? (R() < 0.4 ? [2.4, 3.0, 3.8, 1] : [0.5, 1.5, 3.6, 1]) : arc ? (R() < 0.4 ? [3.2, 1.9, 0.6, 1] : [3.0, 0.5, 0.35, 1]) : (R() < 0.35 ? WHITE : FLAME);
      this.fire.emit(p.x + (R() - 0.5) * 0.35, p.y + h, p.z + (R() - 0.5) * 0.35, -v.x * 0.12 + (R() - 0.5) * 0.4, 0.3 + R() * 0.5, -v.z * 0.12 + (R() - 0.5) * 0.4, 0.22 + R() * 0.18, 0.42 - h * 0.12, 0.04, c0, lim ? [0.05, 0.1, 0.4, 0] : DARK, 3, 0.5);
    }
  },
  dashBurst(p, dir, mage) {
    const arc = mage === 'meteora', lim = mage === 'sorcerer';
    if (mage === 'kineslayer') {
      for (let i = 0; i < 10; i++) this.smoke.emit(p.x, p.y + 0.1, p.z, (R() - 0.5) * 3 - dir.x * 3, 0.4 + R() * 0.5, (R() - 0.5) * 3 - dir.z * 3, 0.5, 0.3, 1.1, [0.5, 0.47, 0.42, 0.45], [0.58, 0.55, 0.5, 0], 3, 0.2);
      this.ring(p, 1.5, 0.2, new THREE.Color(1.6, 1.7, 1.9));
      return;
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.atan2(-dir.z, -dir.x) + (R() - 0.5) * 1.8, sp = 3 + R() * 6;
      this.fire.emit(p.x, p.y + 0.3 + R() * 1.2, p.z, Math.cos(a) * sp, R() * 2, Math.sin(a) * sp, 0.2 + R() * 0.2, 0.35, 0.04, lim ? [0.6, 1.6, 3.8, 1] : arc ? [3.0, 0.5, 0.35, 1] : HOT, lim ? [0.05, 0.1, 0.4, 0] : DARK, 4, 0);
    }
    this.ring(p, 1.6, 0.22, arc ? new THREE.Color(3, 0.6, 0.4) : new THREE.Color(4, 1.8, 0.5));
    for (let i = 0; i < 6; i++) this.smoke.emit(p.x, p.y + 0.1, p.z, (R() - 0.5) * 2 - dir.x * 2, 0.4, (R() - 0.5) * 2 - dir.z * 2, 0.6, 0.3, 1.0, [0.55, 0.5, 0.42, 0.3], [0.6, 0.56, 0.48, 0], 3, 0.2);
  },

  // ---------------------------------------------------------------- Rapid Ignition
  emberTrail(p, v) {
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.05, 0.55, 0.3, WHITE, FLAME, 0, 0);
    for (let i = 0; i < 2; i++) {
      const b = R() * 0.5;
      this.fire.emit(p.x - v.x * 0.016 * b, p.y - v.y * 0.016 * b, p.z - v.z * 0.016 * b, v.x * 0.04 + (R() - 0.5) * 0.6, v.y * 0.04 + (R() - 0.5) * 0.6 + 0.4, v.z * 0.04 + (R() - 0.5) * 0.6, 0.14 + R() * 0.12, 0.28, 0.04, FLAME, DARK, 2, 1);
    }
  },
  emberHit(p) {
    for (let i = 0; i < 12; i++) this.fire.emit(p.x, p.y, p.z, (R() - 0.5) * 6, R() * 4, (R() - 0.5) * 6, 0.2 + R() * 0.2, 0.22, 0.03, HOT, DARK, 3, -4);
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.1, 1.1, 1.4, WHITE, FLAME, 0, 0);
  },
  igniteBoom(c, r) {
    for (let i = 0; i < 55; i++) {
      const u = R() * 2 - 1, a = R() * 6.283, s = Math.sqrt(1 - u * u), sp = (5 + R() * 7) * r / 3;
      this.fire.emit(c.x, c.y, c.z, Math.cos(a) * s * sp, u * sp + 2, Math.sin(a) * s * sp, 0.3 + R() * 0.3, 0.6 + R() * 0.6, 0.08, i < 18 ? WHITE : FLAME, DARK, 3.5, 2);
    }
    this.fire.emit(c.x, c.y, c.z, 0, 0, 0, 0.14, r * 1.4, r * 2.2, WHITE, FLAME, 0, 0);
    this.ring(c, r * 1.4, 0.35, new THREE.Color(4, 1.5, 0.4));
    this.light(c, 35, r * 5, 0.35, 0xff8030);
    for (let i = 0; i < 8; i++) this.smoke.emit(c.x, c.y, c.z, (R() - 0.5) * 2, 1 + R(), (R() - 0.5) * 2, 1.3, 0.6, 1.8, SMOKE0, SMOKE1, 1.5, 0.5);
    this.shake(0.15);
  },

  // ---------------------------------------------------------------- Infernal Step
  infernalStep(c, radius) {
    let t = 0, last = 0.3;
    const dur = 0.42;
    this.ring(c, radius * 1.15, 0.45, new THREE.Color(4, 1.6, 0.5));
    this.ring(c, radius * 0.7, 0.3, new THREE.Color(4, 3, 2));
    this.light(new THREE.Vector3(c.x, c.y + 1, c.z), 60, radius * 3.5, 0.45, 0xff8a30);
    this.scorch(c.x, c.z, radius * 0.75, 7);
    // impact core at the feet
    for (let i = 0; i < 40; i++) { const a = R() * 6.283, sp = 2 + R() * 4; this.fire.emit(c.x, c.y + 0.1, c.z, Math.cos(a) * sp, 5 + R() * 7, Math.sin(a) * sp, 0.4 + R() * 0.3, 0.7, 0.1, R() < 0.4 ? WHITE : HOT, DARK, 2, 2); }
    for (let i = 0; i < 16; i++) { const a = (i / 16) * 6.283; this.smoke.emit(c.x + Math.cos(a), c.y + 0.3, c.z + Math.sin(a), Math.cos(a) * 9, 0.5, Math.sin(a) * 9, 1.1, 0.8, 2.4, [0.5, 0.45, 0.36, 0.35], [0.6, 0.56, 0.48, 0], 3, 0.2); }
    // the wave front: a wall of flame racing outward
    this.effects.push({ update: (dt) => {
      t += dt;
      const k = Math.min(1, t / dur), e = 1 - (1 - k) ** 2;
      const rr = 0.6 + (radius - 0.6) * e;
      const h = 1 - k * 0.7;
      const n = Math.round(46 * (1 - k * 0.4));
      for (let i = 0; i < n; i++) {
        const a = R() * 6.283;
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
        const y = this.world.groundAt(x, z, c.y + 3);
        this.fire.emit(x, y + 0.05, z, Math.cos(a) * 3, (2.5 + R() * 4) * h, Math.sin(a) * 3, 0.22 + R() * 0.25, 0.75 * h + 0.25, 0.1, R() < 0.25 ? WHITE : FLAME, DARK, 2.5, 1);
      }
      last = rr;
      return t < dur;
    } });
    void last;
  },
  boostFlames(p) {
    if (R() < 0.6) this.fire.emit(p.x + (R() - 0.5) * 0.3, p.y + 0.05 + R() * 0.2, p.z + (R() - 0.5) * 0.3, (R() - 0.5) * 0.4, 0.8 + R() * 0.8, (R() - 0.5) * 0.4, 0.22 + R() * 0.15, 0.3, 0.05, R() < 0.3 ? HOT : FLAME, DARK, 2, 1);
  },
  slowFx(p) {
    if (R() < 0.35) this.smoke.emit(p.x + (R() - 0.5) * 0.4, p.y + 0.2 + R() * 0.5, p.z + (R() - 0.5) * 0.4, 0, 0.4, 0, 0.8, 0.2, 0.5, [0.15, 0.12, 0.11, 0.5], [0.3, 0.28, 0.27, 0], 1, 0.2);
  },

  // ---------------------------------------------------------------- Adolla Burst
  // o: beam origin (hands), dir: unit direction, L: length. onFire() when the beam erupts.
  adolla(o, dir, L, { charge, beam, onFire, follow }) {
    const scene = this.scene;
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const mk = (r, inner) => {
      const g = new THREE.CylinderGeometry(r, r * (inner ? 0.75 : 1.15), 1, 28, 12, true);
      g.translate(0, 0.5, 0);
      const m = new THREE.Mesh(g, beamMaterial(inner));
      m.quaternion.copy(quat); m.position.copy(o); m.scale.set(0.01, L, 0.01);
      m.renderOrder = 9; m.frustumCulled = false; m.visible = false;
      scene.add(m);
      return m;
    };
    const outer = mk(1.25, false), inner = mk(0.62, true);
    // charge core between the hands
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.8), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), coreMat);
    core.position.copy(o); core.scale.setScalar(0.05); scene.add(core);
    const light = this.light(o, 0, 20, charge + beam + 0.6, 0xffa040);
    const end = o.clone().addScaledVector(dir, L);
    let t = 0, fired = false;
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    this.effects.push({ update: (dt) => {
      t += dt;
      if (follow) { const f = follow(); if (f) { o.copy(f); core.position.copy(f); } }
      light.userData.life = Math.max(light.userData.life, 0.2);
      if (t < charge) {
        // gathering: flames spiral in from all around into a white-hot core
        const k = t / charge;
        core.scale.setScalar(0.12 + k * 0.45 + Math.sin(t * 40) * 0.03);
        coreMat.opacity = 0.4 + k * 0.6;
        light.intensity = 10 + k * 50;
        for (let i = 0; i < 6 + k * 10; i++) {
          const a = R() * 6.283, b = (R() - 0.5) * 3, rr = 1.6 + R() * 1.4;
          const sx = Math.cos(a) * rr, sy = b * 0.6, sz = Math.sin(a) * rr;
          this.fire.emit(o.x + sx, o.y + sy, o.z + sz, -sx * 3.2, -sy * 3.2, -sz * 3.2, 0.3, 0.3 + k * 0.2, 0.08, R() < 0.4 ? WHITE : HOT, FLAME, 0.5, 0);
        }
        if (R() < 0.5) this.fire.emit(o.x, o.y, o.z, 0, 0, 0, 0.08, 1.4 + k * 1.6, 0.6, WHITE, HOT, 0, 0);
        this.shake(0.02 + k * 0.03);
        return true;
      }
      if (!fired) {
        fired = true;
        outer.visible = inner.visible = true;
        this.ring(o, 3.5, 0.3, new THREE.Color(4, 2.5, 1));
        this.light(end, 80, 18, 0.6, 0xffa040);
        this.shake(0.9);
        if (onFire) onFire(end);
      }
      const bt = t - charge;
      const grow = Math.min(1, bt / 0.08), fade = bt > beam ? Math.max(0, 1 - (bt - beam) / 0.3) : 1;
      const pulse = 1 + Math.sin(t * 46) * 0.06 + Math.sin(t * 17) * 0.05;
      outer.position.copy(o); inner.position.copy(o);
      outer.scale.set(grow * pulse * fade + 0.01, L * grow, grow * pulse * fade + 0.01);
      inner.scale.set(grow * pulse * (0.6 + 0.4 * fade) + 0.01, L * grow, grow * pulse * (0.6 + 0.4 * fade) + 0.01);
      outer.material.uniforms.uT.value = t; inner.material.uniforms.uT.value = t;
      outer.material.uniforms.uA.value = fade; inner.material.uniforms.uA.value = fade;
      core.scale.setScalar((0.9 + Math.sin(t * 30) * 0.1) * fade + 0.01);
      coreMat.opacity = fade;
      light.position.copy(o).addScaledVector(dir, Math.min(L, 6)); light.intensity = 90 * fade;
      if (fade > 0.05) {
        // flames tearing off the beam + sparks raining from it
        for (let i = 0; i < 26 * fade; i++) {
          const u = R() * L * grow, a = R() * 6.283, rr = 0.6 + R() * 0.9;
          const ox = Math.cos(a) * rr, oy = Math.sin(a) * rr;
          const px = o.x + dir.x * u + side.x * ox, py = o.y + dir.y * u + oy, pz = o.z + dir.z * u + side.z * ox;
          this.fire.emit(px, py, pz, dir.x * 18 + side.x * ox * 3, dir.y * 18 + oy * 3 + 1, dir.z * 18 + side.z * ox * 3, 0.2 + R() * 0.25, 0.9 + R() * 0.8, 0.2, R() < 0.3 ? WHITE : FLAME, DARK, 2, 1);
        }
        for (let i = 0; i < 5; i++) { const u = R() * L; this.fire.emit(o.x + dir.x * u, o.y + dir.y * u, o.z + dir.z * u, (R() - 0.5) * 6, R() * 4, (R() - 0.5) * 6, 0.6 + R() * 0.5, 0.09, 0.03, WHITE, DEEP, 0.4, -12); }
        // muzzle blast + end splash
        this.fire.emit(o.x, o.y, o.z, dir.x * 3, dir.y * 3, dir.z * 3, 0.1, 3 * fade, 2, WHITE, HOT, 0, 0);
        for (let i = 0; i < 6; i++) { const a = R() * 6.283, sp = 4 + R() * 8; this.fire.emit(end.x, end.y, end.z, Math.cos(a) * sp - dir.x * 4, R() * 6, Math.sin(a) * sp - dir.z * 4, 0.3 + R() * 0.3, 1.2, 0.2, FLAME, DARK, 2.5, 1); }
        if (R() < 0.5) this.smoke.emit(end.x, end.y + 1, end.z, 0, 2, 0, 1.6, 1.4, 3.5, SMOKE0, SMOKE1, 0.5, 0.6);
        this.shake(0.05 * fade);
      }
      if (bt > beam + 0.32) {
        for (const m of [outer, inner, core]) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
        return false;
      }
      return true;
    } });
  },
});

export { Fx };
