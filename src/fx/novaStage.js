import * as THREE from 'three';
import { Fx } from './fire.js';
import { circleTexture } from './arcane.js';

// The Crimson Nova "casting stage" (anime transformation-sequence style): while the camera is on
// Meteora, the world is replaced by an abstract space around her: a violet cosmos with racing
// horizontal light streaks, rising light pillars and twinkling stars, over a blazing golden
// magic circle of molten light. Built once per cast, removed when the cutscene ends.

const R = Math.random;
const GOLD = [3.2, 2.0, 0.6, 1], VIOLET = [1.6, 0.6, 3.0, 1], PINK = [3.0, 1.2, 2.4, 1], DARK = [0.3, 0.05, 0.4, 0];

function stageMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: true, fog: false, // opaque backdrop: hides everything beyond it
    uniforms: { uT: { value: 0 }, uI: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float uT, uI; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main(){
        vec2 uv = vUv;
        // deep violet cosmos, brighter toward the horizon band where the light is
        vec3 col = mix(vec3(0.015, 0.0, 0.04), vec3(0.16, 0.035, 0.3), smoothstep(0.95, 0.25, abs(uv.y - 0.35) * 1.6));
        col += vec3(0.28, 0.06, 0.36) * n2(uv * vec2(6.0, 3.0) + vec2(uT * 0.05, 0.0)) * 0.3;
        // racing horizontal light streaks (each row its own speed)
        float row = floor(uv.y * 70.0);
        float sp = 0.6 + h(vec2(row, 3.0)) * 2.4;
        float s = n2(vec2(uv.x * (8.0 + h(vec2(row, 1.0)) * 10.0) - uT * sp * 3.0, row));
        float thin = smoothstep(0.5, 0.0, abs(fract(uv.y * 70.0) - 0.5));
        float streak = pow(smoothstep(0.55, 1.0, s), 2.0) * thin * step(0.55, h(vec2(row, 7.0)));
        col += mix(vec3(0.6, 0.3, 1.1), vec3(1.4, 0.9, 1.6), h(vec2(row, 9.0))) * streak * (0.5 + uI * 0.6);
        // soft vertical light pillars that pulse
        float cx = uv.x * 18.0, ci = floor(cx);
        float pil = smoothstep(0.5, 0.0, abs(fract(cx) - 0.5)) * step(0.62, h(vec2(ci, 5.0)));
        pil *= (0.4 + 0.6 * sin(uT * (1.5 + h(vec2(ci, 2.0)) * 3.0) + ci)) * smoothstep(1.0, 0.0, uv.y);
        col += vec3(0.6, 0.4, 1.0) * pil * 0.5 * (0.4 + uI * 0.6);
        // twinkling stars
        vec2 gc = uv * vec2(420.0, 200.0), g = floor(gc);
        float st = step(0.985, h(g)) * (0.5 + 0.5 * sin(uT * 6.0 + h(g + 3.0) * 40.0)) * smoothstep(0.32, 0.0, length(fract(gc) - 0.5)); // round, small
        col += vec3(1.4, 1.1, 1.8) * st;
        // warm glow rising off the golden circle on the floor
        col += vec3(0.8, 0.32, 0.06) * smoothstep(0.15, 0.0, uv.y) * (0.3 + uI * 0.4);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function floorMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uI: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float uT, uI; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.1 + 3.7; a *= 0.5; } return s; }
      void main(){
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p), ang = atan(p.y, p.x);
        // molten light swirling around her feet
        float sw = ang + r * 3.0 - uT * 0.6;
        vec2 q = vec2(cos(sw), sin(sw)) * r * 4.0;
        float f = fbm(q + vec2(uT * 0.3, -uT * 0.2));
        float bright = smoothstep(0.35, 0.85, f + 0.25 * (1.0 - r));
        vec3 col = mix(vec3(1.4, 0.35, 0.02), vec3(3.2, 2.3, 0.8), bright);
        // concentric ripples
        col += vec3(2.0, 1.2, 0.3) * pow(0.5 + 0.5 * sin(r * 40.0 - uT * 6.0), 8.0) * (1.0 - r);
        float a = smoothstep(1.0, 0.55, r) * (0.55 + 0.45 * bright) * uI;
        gl_FragColor = vec4(col * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

Object.assign(Fx.prototype, {
  // returns { setOn(bool), update(dt, intensity), dispose() }
  novaStage(o) {
    const g = new THREE.Group(); g.position.copy(o); g.visible = false; g.renderOrder = -5;
    const sky = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 70, 48, 1, true), stageMaterial());
    sky.position.y = 18; sky.renderOrder = -6;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(26, 64), floorMaterial());
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.03; floor.renderOrder = -4;
    // dark base under the light so the world never shows through
    const base = new THREE.Mesh(new THREE.CircleGeometry(26.5, 48), new THREE.MeshBasicMaterial({ color: 0x0b0214, fog: false }));
    base.rotation.x = -Math.PI / 2; base.position.y = 0.01; base.renderOrder = -5;
    // golden magic circle seal right under her
    const seal = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: circleTexture(29, 1024), color: new THREE.Color(3.2, 2.0, 0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 }));
    seal.rotation.x = -Math.PI / 2; seal.position.y = 0.06;
    const seal2 = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: circleTexture(31, 1024), color: new THREE.Color(2.4, 1.2, 0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 }));
    seal2.rotation.x = -Math.PI / 2; seal2.position.y = 0.05;
    // light pillars rising around her
    const pillars = [];
    const pm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.0, 2.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + R() * 0.4, rr = 5 + R() * 9;
      const pg = new THREE.CylinderGeometry(0.12 + R() * 0.2, 0.3 + R() * 0.4, 40, 12, 1, true); pg.translate(0, 20, 0); // grows from the floor
      const m = new THREE.Mesh(pg, pm);
      m.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      pillars.push(m); g.add(m);
    }
    g.add(base, floor, sky, seal2, seal);
    this.scene.add(g);
    let t = 0;
    const emitAt = (x, y, z) => g.localToWorld(new THREE.Vector3(x, y, z));
    return {
      group: g,
      setOn: (on) => { g.visible = on; },
      update: (dt, I) => {
        t += dt;
        sky.material.uniforms.uT.value = t; sky.material.uniforms.uI.value = I;
        floor.material.uniforms.uT.value = t; floor.material.uniforms.uI.value = 0.22 + I * 0.3;
        seal.rotation.z += dt * (0.5 + I * 2); seal2.rotation.z -= dt * (0.3 + I);
        seal.material.opacity = Math.min(0.75, t * 1.5) * (0.7 + 0.3 * Math.sin(t * 9));
        seal2.material.opacity = Math.min(0.55, t * 0.8);
        pm.opacity = Math.min(0.12, I * 0.15) * (0.7 + 0.3 * Math.sin(t * 5));
        for (const p of pillars) p.scale.y = 0.2 + Math.min(1, I * 1.4);
        if (!g.visible) return;
        // sparkles drifting up and orbiting her (violet, pink and gold motes like the anime)
        for (let i = 0; i < 3 + I * 5; i++) {
          const a = R() * Math.PI * 2, rr = 1.5 + R() * 9;
          const p = emitAt(Math.cos(a) * rr, R() * 0.5, Math.sin(a) * rr);
          const c = R() < 0.45 ? VIOLET : R() < 0.6 ? PINK : GOLD;
          this.fire.emit(p.x, p.y, p.z, -Math.sin(a) * 1.5, 1.5 + R() * 4 * (0.5 + I), Math.cos(a) * 1.5, 1.2 + R(), 0.1 + R() * 0.12, 0.03, c, DARK, 0.2, 0.5);
        }
        // embers boiling off the molten floor
        for (let i = 0; i < 2 + I * 3; i++) {
          const a = R() * Math.PI * 2, rr = 2 + Math.sqrt(R()) * 6;
          const p = emitAt(Math.cos(a) * rr, 0.1, Math.sin(a) * rr);
          this.fire.emit(p.x, p.y, p.z, 0, 0.6 + R() * 1.5, 0, 0.6 + R() * 0.5, 0.3 + R() * 0.3, 0.06, GOLD, [1.6, 0.4, 0.05, 0], 0.5, 1);
        }
      },
      dispose: () => {
        this.scene.remove(g);
        g.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); if (m.material !== pm) m.material.dispose(); } });
        pm.dispose();
      },
    };
  },

  // the explosion's ground shockwave: a ring of dust and fire racing out across the land
  shockwave(c, radius, dur = 1.4) {
    let t = 0;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 96, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.7), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, c.y + 0.6, c.z);
    this.scene.add(ring);
    this.effects.push({ update: (dt) => {
      t += dt;
      const k = Math.min(1, t / dur), e = 1 - (1 - k) ** 3;
      const r = 2 + radius * e;
      ring.scale.setScalar(r);
      ring.material.opacity = (1 - k) * 0.9;
      // a wall of dust riding the front, plus flames near the center
      const n = Math.round(40 * (1 - k * 0.6));
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2;
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        const y = this.world.groundAt(x, z, c.y + 40);
        this.smoke.emit(x, y + 0.4, z, Math.cos(a) * 6, 1.5 + R() * 3, Math.sin(a) * 6, 1.4 + R(), 2.2, 5 + R() * 3, [0.55, 0.45, 0.38, 0.55], [0.6, 0.55, 0.5, 0], 1.2, 0.3);
        if (k < 0.45 && R() < 0.5) this.fire.emit(x, y + 0.3, z, Math.cos(a) * 4, 2 + R() * 4, Math.sin(a) * 4, 0.5 + R() * 0.4, 2 + R() * 1.5, 0.4, [3.2, 1.5, 0.4, 1], [1.2, 0.2, 0.05, 0], 1.5, 1);
      }
      if (t >= dur) { this.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); return false; }
      return true;
    } });
  },

  // After the Nova: a towering mushroom cloud, a glowing crater, and the crust of the sky falling
  // back down as burning fragments (positions from `frags`, identical on every client)
  novaAftermath(c, radius, frags, onFrag) {
    const w = this.world;
    // crater: scorched, glowing ground that keeps burning
    this.scorch(c.x, c.z, radius * 0.75, 30);
    this.fireField(c, radius * 0.5, 7);
    const glow = this.light(new THREE.Vector3(c.x, c.y + 4, c.z), 30, radius * 2.2, 6, 0xff5a1a);
    void glow;
    // mushroom cloud: a boiling stem of fire and smoke, then a rolling cap that spreads out
    let t = 0;
    const H = Math.min(60, radius * 2.2);
    this.effects.push({ update: (dt) => {
      t += dt;
      const k = Math.min(1, t / 5.5);
      const top = H * (1 - (1 - Math.min(1, t / 2.4)) ** 3);
      const stemN = Math.round(26 * (1 - k * 0.7));
      for (let i = 0; i < stemN; i++) {
        const y = c.y + R() * top, rr = (1.5 + (y - c.y) * 0.08) * (0.4 + R() * 0.6), a = R() * 6.283;
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
        if (R() < 0.55 - k * 0.4) this.fire.emit(x, y, z, Math.cos(a) * 1.5, 6 + R() * 6, Math.sin(a) * 1.5, 0.7 + R() * 0.6, 3 + R() * 3, 1.2, [3.0, 1.2, 0.3, 1], [0.8, 0.12, 0.04, 0], 1.2, 0.5);
        this.smoke.emit(x, y, z, Math.cos(a) * 1.2, 4 + R() * 4, Math.sin(a) * 1.2, 2.4 + R() * 1.6, 3 + R() * 2.5, 7 + R() * 5, [0.28, 0.16, 0.12, 0.7], [0.32, 0.27, 0.25, 0], 1.0, 0.2);
      }
      // the cap: a torus of fire-lit smoke rolling outward at the top
      if (t > 1.2) {
        const capR = Math.min(radius * 0.9, 4 + (t - 1.2) * 6);
        const capN = Math.round(30 * (1 - k * 0.6));
        for (let i = 0; i < capN; i++) {
          const a = R() * 6.283, rr = capR * (0.6 + R() * 0.5);
          const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr, y = c.y + top + (R() - 0.3) * 6;
          const lit = R() < 0.35 * (1 - k);
          this.smoke.emit(x, y, z, Math.cos(a) * 3, 1 + R() * 2, Math.sin(a) * 3, 2.8 + R() * 2, 4 + R() * 3, 10 + R() * 6, lit ? [0.9, 0.35, 0.12, 0.8] : [0.25, 0.15, 0.12, 0.75], [0.36, 0.3, 0.28, 0], 1.0, 0.1);
        }
      }
      // embers raining from the cloud
      for (let i = 0; i < 6 * (1 - k); i++) {
        const a = R() * 6.283, rr = R() * radius * 1.2;
        this.fire.emit(c.x + Math.cos(a) * rr, c.y + top * (0.6 + R() * 0.4), c.z + Math.sin(a) * rr, (R() - 0.5) * 2, -2 - R() * 3, (R() - 0.5) * 2, 3 + R() * 2, 0.25, 0.08, [3.2, 1.4, 0.3, 1], [1.2, 0.2, 0.04, 0], 0.4, -3);
      }
      return t < 6.5;
    } });
    // aftershocks
    setTimeout(() => { this.shockwave(c, radius * 1.9, 1.6); this.shake(0.6); }, 900);
    setTimeout(() => { this.shockwave(c, radius * 1.4, 1.3); this.shake(0.4); }, 1800);
    // falling fragments of the sky
    for (const f of frags) {
      setTimeout(() => {
        const p = new THREE.Vector3(f[0], 0, f[1]);
        p.y = w.groundAt(p.x, p.z, c.y + 40);
        this.meteor(p, 2.6, 0.9, () => { this.fireField(p, 2.2, 3); if (onFrag) onFrag(p); });
      }, f[2] * 1000);
    }
  },

  // rocks and burning debris thrown into the sky
  debris(c, n = 80, speed = 30) {
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, up = 0.4 + R() * 0.9, sp = speed * (0.4 + R() * 0.6);
      this.smoke.emit(c.x, c.y + 1, c.z, Math.cos(a) * sp * (1 - up * 0.5), sp * up, Math.sin(a) * sp * (1 - up * 0.5), 2 + R() * 1.5, 0.5 + R() * 0.6, 0.3, [0.12, 0.08, 0.06, 1], [0.2, 0.15, 0.12, 0.6], 0.15, -22);
      if (R() < 0.5) this.fire.emit(c.x, c.y + 1, c.z, Math.cos(a) * sp * (1 - up * 0.5), sp * up, Math.sin(a) * sp * (1 - up * 0.5), 1.4 + R(), 0.35, 0.1, [3.2, 1.6, 0.4, 1], [1.4, 0.2, 0.05, 0], 0.15, -22);
    }
  },
});

export { Fx };
