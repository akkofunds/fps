import * as THREE from 'three';
import { Fx } from './fire.js';

// The Sorcerer's Limitless VFX: cursed-energy flicks, Lapse: Blue (a point of attraction that drags
// particles, dust and light into itself, then collapses), Reversal: Red (repulsion condensing at the
// fingertip, a red bolt, a blast that throws everything outward), and Hollow Purple (Blue and Red in
// each hand, merged, released as a huge sphere of imaginary mass that tears a trench as it goes).

const R = Math.random;
const BLUE = [0.5, 1.5, 3.6, 1], BLUE2 = [0.15, 0.55, 2.4, 0.9], ICEW = [2.4, 3.0, 3.8, 1], CLEAR = [0.05, 0.1, 0.4, 0];
const RED = [3.6, 0.3, 0.22, 1], RED2 = [2.4, 0.06, 0.05, 0.9], HOTW = [3.6, 1.3, 1.1, 1], DRED = [0.4, 0.02, 0.02, 0];
const PURP = [1.9, 0.35, 3.8, 1], PURP2 = [1.0, 0.1, 2.4, 0.9], VIOW = [2.8, 1.6, 3.8, 1], DPURP = [0.15, 0.02, 0.3, 0];
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
  // from: the hand it is cast from (a streak to the point), c: the point of attraction
  blueOrb(c, from, life, pullR, onCollapse) {
    const g = new THREE.Group(); g.position.copy(c); this.scene.add(g);
    const core = new THREE.Mesh(SPHERE, orbMaterial([0.02, 0.05, 0.25], [0.6, 1.6, 4.0]));
    const shell = new THREE.Mesh(SPHERE, orbMaterial([0.0, 0.1, 0.5], [0.3, 0.9, 3.0], { additive: true, swirl: 2 }));
    const halo = glowSprite(new THREE.Color(0.35, 0.7, 2.4), 6);
    g.add(halo); g.add(shell); g.add(core);
    core.scale.setScalar(0.001); shell.scale.setScalar(0.001);
    const light = this.light(c, 0, pullR * 2.2, life + 0.6, 0x4f9bff);
    // streak from the hand
    if (from) for (let i = 0; i <= 18; i++) { const k = i / 18; this.fire.emit(from.x + (c.x - from.x) * k, from.y + (c.y - from.y) * k, from.z + (c.z - from.z) * k, 0, 0, 0, 0.12 + k * 0.15, 0.25, 0.05, BLUE, CLEAR, 0, 0); }
    let t = 0, done = false;
    this.effects.push({ update: (dt) => {
      t += dt;
      const grow = Math.min(1, t / 0.18);
      const collapse = Math.max(0, (t - life) / 0.22);
      const s = (0.55 + Math.sin(t * 22) * 0.04) * grow * (1 - collapse);
      core.scale.setScalar(Math.max(0.001, s)); shell.scale.setScalar(Math.max(0.001, s * 2.1));
      shell.rotation.y += dt * 4;
      core.material.uniforms.uT.value = t; shell.material.uniforms.uT.value = t;
      shell.material.uniforms.uA.value = 0.55 * (1 - collapse);
      halo.material.opacity = (0.7 + Math.sin(t * 9) * 0.15) * (1 - collapse) * grow;
      halo.scale.setScalar(5.5 + Math.sin(t * 13) * 0.6);
      light.intensity = 26 * grow * (1 - collapse); light.position.copy(c);
      if (t < life) {
        // everything spirals INTO the point
        for (let i = 0; i < 6; i++) {
          const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), r = pullR * (0.35 + R() * 0.65);
          const px = c.x + Math.cos(a) * sq * r, py = c.y + u * r * 0.6, pz = c.z + Math.sin(a) * sq * r;
          const lf = 0.45 + R() * 0.25;
          // inward + a swirl around the vertical axis
          const ix = (c.x - px) / lf, iy = (c.y - py) / lf, iz = (c.z - pz) / lf;
          this.fire.emit(px, py, pz, ix - (pz - c.z) * 1.2, iy, iz + (px - c.x) * 1.2, lf, 0.05 + R() * 0.08, 0.14, R() < 0.3 ? ICEW : BLUE2, BLUE, 0, 0);
        }
        // dust and grass bits ripped off the ground
        if (R() < 0.6) {
          const a = R() * 6.283, r = pullR * (0.4 + R() * 0.6), px = c.x + Math.cos(a) * r, pz = c.z + Math.sin(a) * r;
          const gy = this.world ? this.world.groundAt(px, pz, c.y + 5) : c.y - 1.3;
          this.smoke.emit(px, gy + 0.1, pz, (c.x - px) * 1.4, (c.y - gy) * 1.6, (c.z - pz) * 1.4, 0.7, 0.3, 0.05, DUST0, DUST1, 0.5, 0);
        }
      } else if (!done) {
        done = true;
        // collapse: an implosion flash and a ring
        for (let i = 0; i < 40; i++) { const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), sp = 6 + R() * 8; this.fire.emit(c.x, c.y, c.z, Math.cos(a) * sq * sp, u * sp, Math.sin(a) * sq * sp, 0.25 + R() * 0.2, 0.3, 0.04, R() < 0.5 ? ICEW : BLUE, CLEAR, 5, 0); }
        this.fire.emit(c.x, c.y, c.z, 0, 0, 0, 0.18, 2.6, 4.4, ICEW, BLUE2, 0, 0);
        this.ring(c, pullR * 0.9, 0.4, new THREE.Color(0.6, 1.4, 3.6));
        this.shake(0.2);
        if (onCollapse) onCollapse();
      }
      if (t > life + 0.3) { this.scene.remove(g); core.material.dispose(); shell.material.dispose(); halo.material.map.dispose(); halo.material.dispose(); return false; }
      return true;
    } });
  },

  // ---------------------------------------------------------------- C: Reversal: Red
  // repulsion condensing at the fingertip (getTip(out) → world position) for `dur` seconds
  redCharge(getTip, dur) {
    const halo = glowSprite(new THREE.Color(2.8, 0.12, 0.08), 0.3); this.scene.add(halo);
    let t = 0;
    const p = new THREE.Vector3();
    this.effects.push({ update: (dt) => {
      t += dt;
      getTip(p);
      const k = Math.min(1, t / dur);
      halo.position.copy(p); halo.scale.setScalar(0.25 + k * 0.9 + Math.sin(t * 40) * 0.05);
      halo.material.opacity = t < dur ? 0.9 : Math.max(0, 1 - (t - dur) / 0.12);
      if (t < dur) for (let i = 0; i < 3; i++) {
        const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), r = 0.6 + R() * 0.5, lf = 0.16;
        const px = p.x + Math.cos(a) * sq * r, py = p.y + u * r, pz = p.z + Math.sin(a) * sq * r;
        this.fire.emit(px, py, pz, (p.x - px) / lf, (p.y - py) / lf, (p.z - pz) / lf, lf, 0.04, 0.09, R() < 0.3 ? HOTW : RED, RED2, 0, 0);
      }
      if (t > dur + 0.15) { this.scene.remove(halo); halo.material.map.dispose(); halo.material.dispose(); return false; }
      return true;
    } });
    this.light(getTip(p), 8, 5, dur, 0xff3020);
  },
  redTrail(p, v, age) {
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.06, 0.9, 0.5, HOTW, RED, 0, 0);
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.1, 0.5, 0.9, RED, RED2, 0, 0);
    const L = Math.hypot(v.x, v.y, v.z) || 1, fx = v.x / L, fy = v.y / L, fz = v.z / L;
    let ux = -fz, uz = fx; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    const wx = fy * uz, wy = fz * ux - fx * uz, wz = -fy * ux;
    for (let k = 0; k < 2; k++) {
      const a = age * 30 + k * Math.PI, cs = Math.cos(a) * 0.3, sn = Math.sin(a) * 0.3;
      this.fire.emit(p.x + ux * cs + wx * sn, p.y + wy * sn, p.z + uz * cs + wz * sn, v.x * 0.04, v.y * 0.04, v.z * 0.04, 0.26, 0.16, 0.03, RED, DRED, 3, 0);
    }
  },
  redBlast(p, radius) {
    // a white-hot core that throws everything OUTWARD: radial streaks, a shock ring, dust blown away
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.14, radius * 0.9, radius * 2.0, HOTW, RED, 0, 0);
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.3, radius * 0.6, radius * 1.4, RED, DRED, 0, 0);
    for (let i = 0; i < 70; i++) {
      const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), sp = 10 + R() * 14;
      this.fire.emit(p.x, p.y, p.z, Math.cos(a) * sq * sp, u * sp * 0.7 + 1, Math.sin(a) * sq * sp, 0.22 + R() * 0.22, 0.3, 0.04, R() < 0.35 ? HOTW : RED, DRED, 4, 0);
    }
    for (let i = 0; i < 18; i++) { const a = R() * 6.283; this.smoke.emit(p.x, p.y - 0.4, p.z, Math.cos(a) * 9, 0.6 + R() * 1.5, Math.sin(a) * 9, 0.7 + R() * 0.4, 0.5, 1.8, DUST0, DUST1, 2.6, 0.1); }
    this.ring(p, radius * 1.9, 0.38, new THREE.Color(3.6, 0.5, 0.35));
    this.ring(p, radius * 1.1, 0.24, new THREE.Color(3.6, 2.6, 2.2));
    this.light(p, 30, radius * 6, 0.3, 0xff3a28);
    this.scorch(p.x, p.z, radius * 0.8, 8);
  },

  // ---------------------------------------------------------------- V: Hollow Purple
  // Blue in the left hand, Red in the right (getL / getR(out) → world), merged at `dur`
  purpleCharge(getL, getR, dur) {
    const mk = (inner, rim) => { const m = new THREE.Mesh(SPHERE, orbMaterial(inner, rim, { additive: true, swirl: 1.5 })); m.scale.setScalar(0.001); this.scene.add(m); return m; };
    const blue = mk([0.05, 0.2, 1.4], [0.4, 1.2, 4.0]), red = mk([1.4, 0.05, 0.04], [4.0, 0.4, 0.3]);
    const hb = glowSprite(new THREE.Color(0.12, 0.35, 2.6), 1.6), hr = glowSprite(new THREE.Color(2.6, 0.1, 0.06), 1.6);
    this.scene.add(hb); this.scene.add(hr);
    const L = new THREE.Vector3(), Rr = new THREE.Vector3(), mid = new THREE.Vector3();
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      getL(L); getR(Rr);
      const grow = Math.min(1, t / 0.4);
      // last third: they pull toward each other and fuse
      const merge = Math.max(0, Math.min(1, (t - dur * 0.68) / (dur * 0.32)));
      mid.addVectors(L, Rr).multiplyScalar(0.5);
      const e = merge * merge;
      blue.position.lerpVectors(L, mid, e); red.position.lerpVectors(Rr, mid, e);
      const s = 0.16 * grow * (1 + merge * 0.6);
      blue.scale.setScalar(Math.max(0.001, s)); red.scale.setScalar(Math.max(0.001, s));
      blue.material.uniforms.uT.value = t; red.material.uniforms.uT.value = t;
      hb.position.copy(blue.position); hr.position.copy(red.position);
      hb.scale.setScalar(1.2 + Math.sin(t * 17) * 0.15); hr.scale.setScalar(1.2 + Math.cos(t * 19) * 0.15);
      for (const [o, cA, cB] of [[blue.position, BLUE, BLUE2], [red.position, RED, RED2]]) {
        const a = R() * 6.283, r = 0.35;
        this.fire.emit(o.x + Math.cos(a) * r, o.y + (R() - 0.5) * r, o.z + Math.sin(a) * r, -Math.cos(a) * 1.5, (R() - 0.5), -Math.sin(a) * 1.5, 0.2, 0.08, 0.02, cA, cB, 1, 0);
      }
      if (merge > 0) {
        // crackling violet arcs between them as they meet
        const k = R();
        this.fire.emit(blue.position.x + (red.position.x - blue.position.x) * k, blue.position.y + (red.position.y - blue.position.y) * k + (R() - 0.5) * 0.15, blue.position.z + (red.position.z - blue.position.z) * k, 0, 0, 0, 0.1, 0.12, 0.04, PURP, PURP2, 0, 0);
      }
      if (t >= dur) {
        for (let i = 0; i < 50; i++) { const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u), sp = 4 + R() * 8; this.fire.emit(mid.x, mid.y, mid.z, Math.cos(a) * sq * sp, u * sp, Math.sin(a) * sq * sp, 0.2 + R() * 0.2, 0.25, 0.04, R() < 0.4 ? VIOW : PURP, DPURP, 4, 0); }
        this.fire.emit(mid.x, mid.y, mid.z, 0, 0, 0, 0.16, 1.5, 3.4, VIOW, PURP, 0, 0);
        this.light(mid, 28, 18, 0.35, 0xa04cff);
        for (const m of [blue, red]) { this.scene.remove(m); m.material.dispose(); }
        for (const h of [hb, hr]) { this.scene.remove(h); h.material.map.dispose(); h.material.dispose(); }
        return false;
      }
      return true;
    } });
  },
  // the released imaginary mass: o start, dir unit, travels len metres at speed
  hollowPurple(o, dir, len, speed, radius) {
    const g = new THREE.Group(); this.scene.add(g);
    const core = new THREE.Mesh(SPHERE, orbMaterial([0.7, 0.18, 1.5], [1.9, 0.45, 3.8], { swirl: 2.4 }));
    const shell = new THREE.Mesh(SPHERE, orbMaterial([0.3, 0.03, 0.8], [1.2, 0.2, 2.8], { additive: true, swirl: 3 }));
    const halo = glowSprite(new THREE.Color(0.8, 0.15, 2.0), radius * 4.5);
    g.add(halo); g.add(shell); g.add(core);
    const light = this.light(o, 0, radius * 10, len / speed + 0.5, 0xa04cff);
    const pos = new THREE.Vector3(), life = len / speed;
    let t = 0, lastScorch = -99;
    this.effects.push({ update: (dt) => {
      t += dt;
      const d = Math.min(len, t * speed);
      pos.copy(o).addScaledVector(dir, d);
      g.position.copy(pos);
      const k = Math.min(1, t / 0.15), fade = t > life ? Math.max(0, 1 - (t - life) / 0.35) : 1;
      core.scale.setScalar(radius * 0.72 * k * (0.5 + 0.5 * fade)); shell.scale.setScalar(radius * 1.12 * k * (0.5 + 0.5 * fade));
      core.material.uniforms.uT.value = t; shell.material.uniforms.uT.value = t;
      core.material.uniforms.uA.value = fade; shell.material.uniforms.uA.value = 0.6 * fade;
      halo.material.opacity = 0.85 * fade;
      light.position.copy(pos); light.intensity = 40 * fade;
      if (t < life) {
        // violet plasma torn off the surface, streaming behind
        for (let i = 0; i < 8; i++) {
          const u = R() * 2 - 1, a = R() * 6.283, sq = Math.sqrt(1 - u * u);
          this.fire.emit(pos.x + Math.cos(a) * sq * radius, pos.y + u * radius, pos.z + Math.sin(a) * sq * radius, -dir.x * speed * 0.15 + (R() - 0.5) * 2, (R() - 0.5) * 2, -dir.z * speed * 0.15 + (R() - 0.5) * 2, 0.3 + R() * 0.3, 0.45, 0.06, R() < 0.3 ? VIOW : PURP, DPURP, 2, 0);
        }
        // the ground under it is erased: a trench of scorch + debris thrown aside
        const gy = this.world ? this.world.groundAt(pos.x, pos.z, pos.y + 3) : -99;
        if (pos.y - gy < radius + 1.2) {
          if (d - lastScorch > 3) { lastScorch = d; this.scorch(pos.x, pos.z, radius * 0.9, 9); }
          for (let i = 0; i < 2; i++) { const s = R() < 0.5 ? -1 : 1; this.smoke.emit(pos.x + dir.z * s * radius, gy + 0.2, pos.z - dir.x * s * radius, dir.z * s * 5 + dir.x * 3, 2 + R() * 3, -dir.x * s * 5 + dir.z * 3, 0.8, 0.5, 1.6, DUST0, DUST1, 2, -3); }
        }
      }
      if (t > life + 0.4) { this.scene.remove(g); core.material.dispose(); shell.material.dispose(); halo.material.map.dispose(); halo.material.dispose(); return false; }
      return true;
    } });
  },

  // Six Eyes: a faint blue glint at the eyes; the Infinity shimmer when he is standing still
  sixEyes(p) {
    if (R() < 0.25) this.fire.emit(p.x + (R() - 0.5) * 0.08, p.y + (R() - 0.5) * 0.04, p.z + (R() - 0.5) * 0.08, 0, 0.05, 0, 0.3, 0.035, 0.01, BLUE, CLEAR, 0, 0);
  },
});
