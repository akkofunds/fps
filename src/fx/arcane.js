import * as THREE from 'three';
import { Fx } from './fire.js';
import { groundH } from '../world/terrain.js';
import { mulberry32 } from '../world/noise.js';

// Arcane-fire VFX for Meteora: procedural magic circles (rings, runes, star polygons),
// crimson sparks, Starfall, Blast Sigils, Blink, and the Crimson Nova: magic circles stack up
// over the target while she chants, then a pillar of light slams down into a colossal fireball
// with a shockwave, mushroom cloud and a white flash.

const R = Math.random;
const CRIM = [3.0, 0.5, 0.35, 1], CRIM2 = [2.2, 0.25, 0.15, 0.9], GOLD = [3.2, 1.9, 0.6, 1], DARKR = [0.5, 0.04, 0.03, 0];
const SMOKE0 = [0.2, 0.17, 0.17, 0.5], SMOKE1 = [0.38, 0.34, 0.33, 0];

// ---------------------------------------------------------------- magic circle textures
const texCache = new Map();
export function circleTexture(seed = 1, size = 1024) {
  const key = seed + ':' + size;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const r = mulberry32(seed);
  const C = size / 2;
  g.translate(C, C);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round';
  const ring = (rad, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, rad, 0, Math.PI * 2); g.stroke(); };
  const S = size / 1024;
  ring(500 * S, 10 * S); ring(470 * S, 4 * S); ring(395 * S, 7 * S); ring(380 * S, 2 * S);
  // rune band
  const glyphs = 46 + Math.floor(r() * 10);
  for (let i = 0; i < glyphs; i++) {
    const a = (i / glyphs) * Math.PI * 2;
    g.save(); g.rotate(a); g.translate(0, -432 * S);
    g.lineWidth = 4 * S;
    g.beginPath();
    const n = 2 + Math.floor(r() * 3);
    let x = (r() - 0.5) * 16 * S, y = -18 * S;
    g.moveTo(x, y);
    for (let k = 0; k < n; k++) { x = (r() - 0.5) * 22 * S; y += (12 + r() * 10) * S; g.lineTo(x, y); }
    if (r() < 0.5) { g.moveTo(-9 * S, 0); g.lineTo(9 * S, 0); }
    g.stroke();
    if (r() < 0.35) { g.beginPath(); g.arc(0, -4 * S, 5 * S, 0, Math.PI * 2); g.stroke(); }
    g.restore();
  }
  // star polygon
  const pts = [5, 6, 7, 8][Math.floor(r() * 4)];
  const step = pts === 6 ? 2 : pts === 8 ? 3 : 2;
  g.lineWidth = 7 * S;
  for (let pass = 0; pass < (pts === 6 ? 2 : 1); pass++) {
    g.beginPath();
    for (let i = 0; i <= pts; i++) {
      const k = (i * step + pass) % pts;
      const a = (k / pts) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * 378 * S, y = Math.sin(a) * 378 * S;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  // small circles at the points
  for (let i = 0; i < pts; i++) {
    const a = (i / pts) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * 378 * S, y = Math.sin(a) * 378 * S;
    g.lineWidth = 5 * S; g.beginPath(); g.arc(x, y, 34 * S, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(x, y, 18 * S, 0, Math.PI * 2); g.stroke();
  }
  ring(240 * S, 6 * S); ring(226 * S, 2 * S); ring(120 * S, 5 * S); ring(60 * S, 8 * S);
  // inner spokes and arcs
  g.lineWidth = 3 * S;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath(); g.moveTo(Math.cos(a) * 126 * S, Math.sin(a) * 126 * S); g.lineTo(Math.cos(a) * (i % 2 ? 220 : 236) * S, Math.sin(a) * (i % 2 ? 220 : 236) * S); g.stroke();
  }
  for (let i = 0; i < 3; i++) { g.lineWidth = 4 * S; g.beginPath(); g.arc(0, 0, (280 + i * 30) * S, r() * 6, r() * 6 + 2 + r() * 2); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

function circleMesh(tex, radius, color) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), new THREE.MeshBasicMaterial({
    map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 1, fog: false,
  }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 7;
  return m;
}

// terrain-hugging magic circle (for ground decals); geometry rebuilt per placement
function groundCircle(tex, radius, x, z, color, world) {
  const seg = 40, rings = 8, pos = [], uv = [], idx = [];
  for (let r = 0; r <= rings; r++) for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, rr = (r / rings);
    const px = Math.cos(a) * rr * radius, pz = Math.sin(a) * rr * radius;
    const gy = world ? world.groundAt(x + px, z + pz, 1e9) : groundH(x + px, z + pz);
    pos.push(px, gy + 0.07, pz); uv.push(0.5 + Math.cos(a) * rr * 0.5, 0.5 + Math.sin(a) * rr * 0.5);
  }
  for (let r = 0; r < rings; r++) for (let i = 0; i < seg; i++) {
    const a = r * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }));
  m.position.set(x, 0, z);
  m.renderOrder = 4;
  return m;
}

// ---------------------------------------------------------------- fireball shader (nova)
function fireballMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uT: { value: 0 }, uHeat: { value: 1 } },
    vertexShader: /* glsl */`
      uniform float uT; varying vec3 vN; varying vec3 vW; varying float vNz;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        vec3 p = position;
        float n = n3(normal * 3.0 + uT * 2.0) * 0.6 + n3(normal * 7.0 - uT * 3.0) * 0.4;
        vNz = n;
        p += normal * n * 0.22;
        vN = normalize(normalMatrix * normal);
        vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uHeat; varying vec3 vN; varying vec3 vW; varying float vNz;
      void main(){
        float facing = abs(dot(normalize(vN), vec3(0.0, 0.0, 1.0)));
        float core = pow(facing, 1.5);
        vec3 hot = vec3(4.0, 3.2, 2.2), mid = vec3(3.2, 1.3, 0.35), cool = vec3(1.4, 0.2, 0.06);
        float k = clamp(core * uHeat + vNz * 0.3, 0.0, 1.0);
        vec3 col = mix(cool, mid, smoothstep(0.1, 0.55, k));
        col = mix(col, hot, smoothstep(0.55, 1.0, k));
        float a = (0.35 + core * 0.65) * clamp(uHeat * 1.2, 0.0, 1.0);
        gl_FragColor = vec4(col * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- effects (mixed into Fx)
Object.assign(Fx.prototype, {
  staffGlow(p) {
    this.fire.emit(p.x + (R() - 0.5) * 0.12, p.y + (R() - 0.5) * 0.12, p.z + (R() - 0.5) * 0.12, (R() - 0.5) * 0.3, 0.3 + R() * 0.4, (R() - 0.5) * 0.3, 0.35 + R() * 0.25, 0.1, 0.02, R() < 0.3 ? GOLD : CRIM, DARKR, 1, 0.4);
  },

  arcaneBurst(p, dir, k = 1) {
    for (let i = 0; i < 12 * k; i++) {
      const s = 2 + R() * 5;
      this.fire.emit(p.x, p.y, p.z, dir.x * s + (R() - 0.5) * 2.5, dir.y * s + (R() - 0.5) * 2.5, dir.z * s + (R() - 0.5) * 2.5, 0.16 + R() * 0.2, 0.2 * k, 0.04, R() < 0.4 ? GOLD : CRIM, DARKR, 5, 0);
    }
    this.light(p, 6 * k, 6, 0.12, 0xff3040);
  },

  sparkTrail(p, v) {
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.06, 0.62, 0.4, GOLD, CRIM, 0, 0);
    for (let i = 0; i < 4; i++) {
      const a = R() * 6.283;
      this.fire.emit(p.x + Math.cos(a) * 0.12, p.y + Math.sin(a) * 0.12, p.z + (R() - 0.5) * 0.12,
        v.x * 0.04 + (R() - 0.5) * 1.2, v.y * 0.04 + (R() - 0.5) * 1.2, v.z * 0.04 + (R() - 0.5) * 1.2, 0.18 + R() * 0.2, 0.28, 0.04, CRIM, DARKR, 2.5, 0.5);
    }
  },

  sparkBurst(p, radius = 2.2) {
    for (let i = 0; i < 26; i++) {
      const u = R() * 2 - 1, a = R() * 6.283, s = Math.sqrt(1 - u * u), sp = 3 + R() * 5;
      this.fire.emit(p.x, p.y, p.z, Math.cos(a) * s * sp, u * sp + 1, Math.sin(a) * s * sp, 0.25 + R() * 0.25, 0.45, 0.06, i < 8 ? GOLD : CRIM, DARKR, 3, 1);
    }
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.1, radius * 1.2, radius * 1.8, [3.5, 1.2, 1.0, 1], CRIM, 0, 0);
    this.ring(p, radius * 1.2, 0.3, new THREE.Color(3, 0.5, 0.4));
    this.light(p, 12, radius * 4, 0.25, 0xff3040);
    for (let i = 0; i < 5; i++) this.smoke.emit(p.x, p.y, p.z, (R() - 0.5), 0.8, (R() - 0.5), 0.9, 0.4, 1.2, SMOKE0, SMOKE1, 1, 0.3);
  },

  // E — a small star falls on the target
  starfall(target, radius, delay, onImpact) {
    const tex = circleTexture(7, 512);
    const tele = groundCircle(tex, radius, target.x, target.z, new THREE.Color(1.8, 0.3, 0.12), this.world);
    this.scene.add(tele);
    const star = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.6, 0.9) }));
    this.scene.add(star);
    const from = new THREE.Vector3(target.x + 9, target.y + 30, target.z - 6);
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      tele.rotation.y += dt * 1.5;
      tele.material.opacity = Math.min(1, t / 0.2) * (0.6 + 0.4 * Math.sin(t * 20));
      const u = Math.min(1, t / delay);
      star.position.lerpVectors(from, target, u * u);
      for (let i = 0; i < 6; i++) this.fire.emit(star.position.x + (R() - 0.5) * 0.4, star.position.y + (R() - 0.5) * 0.4, star.position.z + (R() - 0.5) * 0.4, (R() - 0.5), 2 + R() * 2, (R() - 0.5), 0.3 + R() * 0.2, 0.8, 0.15, R() < 0.3 ? GOLD : CRIM, DARKR, 1, 0);
      if (t >= delay) {
        this.scene.remove(tele); this.scene.remove(star); tele.geometry.dispose(); tele.material.dispose(); star.geometry.dispose(); star.material.dispose();
        this.explosion(target, radius, 1.1);
        this.ring(target, radius * 1.3, 0.4, new THREE.Color(3, 0.5, 0.4));
        if (onImpact) onImpact();
        return false;
      }
      return true;
    } });
  },

  // C — persistent rune on the ground. returns a handle with detonate()/remove()
  sigil(p, radius, armTime) {
    const tex = circleTexture(11, 512);
    const m = groundCircle(tex, radius, p.x, p.z, new THREE.Color(1.5, 0.18, 0.1), this.world);
    this.scene.add(m);
    let t = 0, alive = true;
    const h = {
      pos: p.clone(), armed: false,
      remove: () => { if (!alive) return; alive = false; this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); },
    };
    this.effects.push({ update: (dt) => {
      if (!alive) return false;
      t += dt;
      m.rotation.y += dt * (h.armed ? 0.8 : 3);
      const k = Math.min(1, t / armTime);
      h.armed = t >= armTime;
      m.material.opacity = h.armed ? 0.55 + 0.25 * Math.sin(t * 4) : k * 0.9;
      if (h.armed && R() < 0.08) this.fire.emit(p.x + (R() - 0.5) * radius, p.y + 0.1, p.z + (R() - 0.5) * radius, 0, 0.8, 0, 0.6, 0.12, 0.02, CRIM, DARKR, 0.5, 0.5);
      return true;
    } });
    return h;
  },

  blinkFx(a, b) {
    for (const p of [a, b]) {
      for (let i = 0; i < 30; i++) { const u = R() * 2 - 1, an = R() * 6.283, s = Math.sqrt(1 - u * u); this.fire.emit(p.x, p.y + 0.9 + u * 0.8, p.z, Math.cos(an) * s * 3, u * 2, Math.sin(an) * s * 3, 0.3 + R() * 0.2, 0.3, 0.04, R() < 0.5 ? GOLD : CRIM, DARKR, 3, 0); }
    }
    // streak between the two points
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.fire.emit(a.x + (b.x - a.x) * t, a.y + 0.9 + (b.y - a.y) * t, a.z + (b.z - a.z) * t, 0, 0.4, 0, 0.25 + t * 0.15, 0.35, 0.05, CRIM, DARKR, 1, 0);
    }
    this.light(b, 10, 8, 0.2, 0xff3040);
  },

  // X — Crimson Nova. onImpact fires when the fireball lands; onFlash(intensity) for the screen flash
  nova(target, caster, opts) {
    const { radius, channel, onImpact, onFlash, onLayer } = opts;
    const stagger = opts.stagger || [0.12, 0.44, 0.76, 1.08, 1.4];
    const scene = this.scene;
    const layers = [];
    const n = stagger.length;
    for (let i = 0; i < n; i++) {
      const s = radius * (0.98 - (i / (n - 1)) * 0.66);
      const m = circleMesh(circleTexture(21 + i * 7, 1024), s, new THREE.Color(2.6, 0.5 - i * 0.04, 0.08));
      m.position.set(target.x, target.y + 8 + i * (40 / (n - 1)), target.z);
      m.scale.setScalar(0.001);
      scene.add(m);
      layers.push({ m, at: stagger[i], dir: i % 2 ? -1 : 1, i, fired: false });
    }
    // ground warning (huge, so everyone knows to run)
    const warn = groundCircle(circleTexture(5, 1024), radius, target.x, target.z, new THREE.Color(1.8, 0.16, 0.06), this.world);
    warn.material.opacity = 0;
    scene.add(warn);
    // caster's circle under her feet
    const own = groundCircle(circleTexture(3, 512), 2.6, caster.x, caster.z, new THREE.Color(1.9, 0.4, 0.1), this.world);
    scene.add(own);
    // light column
    const colGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    const colMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.4, 0.7), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const column = new THREE.Mesh(colGeo, colMat);
    column.position.set(target.x, target.y + 22, target.z); column.scale.set(0.6, 44, 0.6);
    scene.add(column);
    const glow = this.light(new THREE.Vector3(target.x, target.y + 6, target.z), 0, radius * 3, channel + 2.5, 0xff5020);
    let t = 0, boomed = false, ball = null, ballMat = null, cleanupAt = 0;
    const cleanup = () => {
      for (const L of layers) { scene.remove(L.m); L.m.geometry.dispose(); L.m.material.dispose(); }
      for (const o of [warn, own, column]) { scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
      if (ball) { scene.remove(ball); ball.geometry.dispose(); ballMat.dispose(); }
    };
    this.effects.push({ update: (dt) => {
      t += dt;
      const ch = Math.min(1, t / channel);
      // ---- channel: circles stack up and spin
      for (const L of layers) {
        if (!L.fired && t >= L.at) {
          L.fired = true;
          if (onLayer) onLayer(L.i);
          // each seal slams into place with a ring of sparks
          for (let q = 0; q < 50; q++) { const a = R() * 6.283, rr = L.m.geometry.parameters.width * 0.5; this.fire.emit(L.m.position.x + Math.cos(a) * rr, L.m.position.y, L.m.position.z + Math.sin(a) * rr, Math.cos(a) * 3, (R() - 0.5) * 2, Math.sin(a) * 3, 0.6 + R() * 0.5, 0.9, 0.1, R() < 0.4 ? GOLD : CRIM, DARKR, 1, 0); }
          this.light(L.m.position, 40, 60, 0.5, 0xff3020);
        }
        const k = THREE.MathUtils.clamp((t - L.at) / 0.35, 0, 1);
        const e = 1 - (1 - k) ** 3;
        const s = boomed ? 1 + (t - channel) * 0.6 : e * (1 + 0.04 * Math.sin(t * 9));
        L.m.scale.setScalar(Math.max(0.001, s));
        L.m.rotation.z += dt * L.dir * (0.6 + ch * 2.5);
        L.m.material.opacity = boomed ? Math.max(0, 1 - (t - channel) / 0.9) : e * (0.75 + 0.25 * Math.sin(t * 13 + L.at * 10));
      }
      warn.material.opacity = boomed ? Math.max(0, 1 - (t - channel) / 0.5) : ch * (0.55 + 0.45 * Math.sin(t * (6 + ch * 18)));
      warn.rotation.y -= dt * 0.4;
      own.material.opacity = boomed ? Math.max(0, 1 - (t - channel) / 0.4) : Math.min(1, t * 3);
      own.rotation.y += dt * 2;
      glow.userData.life = Math.max(glow.userData.life, 0.3);
      glow.intensity = (boomed ? 0 : 6 + ch * 60);
      if (!boomed) {
        // energy rising from the ground into the circles, embers spiralling around the column
        for (let i = 0; i < 6 + ch * 18; i++) {
          const a = R() * 6.283, rr = Math.sqrt(R()) * radius;
          const x = target.x + Math.cos(a) * rr, z = target.z + Math.sin(a) * rr;
          this.fire.emit(x, groundH(x, z) + 0.1, z, 0, 3 + R() * 8 * ch, 0, 0.5 + R() * 0.6, 0.25 + ch * 0.25, 0.05, R() < 0.3 ? GOLD : CRIM, DARKR, 0.3, 2);
        }
        for (let i = 0; i < 4; i++) {
          const a = t * 4 + i * 1.57, rr = 2.5;
          this.fire.emit(caster.x + Math.cos(a) * rr, caster.y + 0.2 + R() * 2.5, caster.z + Math.sin(a) * rr, 0, 1.5, 0, 0.5, 0.25, 0.04, GOLD, DARKR, 0.5, 0.5);
        }
        if (t > channel - 0.6) colMat.opacity = (t - (channel - 0.6)) / 0.6 * 0.5;
        this.shake(ch * 0.05);
      }
      // ---- impact
      if (!boomed && t >= channel) {
        boomed = true;
        colMat.opacity = 1; column.scale.set(radius * 0.35, 44, radius * 0.35);
        ballMat = fireballMaterial();
        ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), ballMat);
        ball.position.set(target.x, target.y, target.z);
        ball.renderOrder = 8;
        scene.add(ball);
        this.explosion(target, radius * 0.6, 4);
        for (let i = 0; i < 260; i++) {
          const u = R(), a = R() * 6.283, sp = 10 + R() * 30;
          this.fire.emit(target.x, target.y + 0.5, target.z, Math.cos(a) * sp * (1 - u * 0.5), u * sp * 0.8 + 4, Math.sin(a) * sp * (1 - u * 0.5), 0.6 + R() * 1.1, 1.4 + R() * 1.8, 0.3, R() < 0.3 ? [4, 2.6, 1.2, 1] : GOLD, DARKR, 1.6, 2);
        }
        for (let i = 0; i < 120; i++) {
          const a = R() * 6.283, sp = 6 + R() * 22;
          this.fire.emit(target.x, target.y + 1, target.z, Math.cos(a) * sp, 8 + R() * 22, Math.sin(a) * sp, 1.5 + R() * 1.5, 0.12, 0.05, GOLD, DARKR, 0.4, -16);
        }
        // dust ring + mushroom smoke
        for (let i = 0; i < 90; i++) {
          const a = (i / 90) * 6.283, sp = 18 + R() * 10;
          this.smoke.emit(target.x + Math.cos(a) * 2, target.y + 0.6, target.z + Math.sin(a) * 2, Math.cos(a) * sp, 0.5 + R(), Math.sin(a) * sp, 1.6 + R(), 2.5, 7, [0.45, 0.38, 0.32, 0.45], [0.6, 0.55, 0.5, 0], 2.2, 0.4);
        }
        this.ring(target, radius * 2.6, 0.9, new THREE.Color(4, 1.6, 0.6));
        this.ring(target, radius * 1.4, 0.6, new THREE.Color(4, 0.8, 0.4));
        this.light(new THREE.Vector3(target.x, target.y + 8, target.z), 600, radius * 9, 1.6, 0xffb060);
        this.scorch(target.x, target.z, radius * 0.85, 22);
        this.fireField(target, radius * 0.6, 5);
        this.shake(1.6);
        if (onFlash) onFlash();
        if (onImpact) onImpact();
        cleanupAt = t + 3.2;
      }
      if (boomed) {
        const bt = t - channel;
        // the fireball swells, rises and cools into a mushroom
        const s = radius * (0.9 * (1 - Math.exp(-bt * 5)) + bt * 0.12);
        ball.scale.set(s, s * (0.85 + bt * 0.12), s);
        ball.position.y = target.y + s * 0.25 + bt * 3.5;
        ballMat.uniforms.uT.value = t;
        ballMat.uniforms.uHeat.value = Math.max(0, 1.15 - bt * 0.42);
        colMat.opacity = Math.max(0, 1 - bt / 0.35);
        column.scale.x = column.scale.z = radius * 0.35 * Math.max(0.05, 1 - bt * 2);
        if (bt < 2.6) {
          for (let i = 0; i < 10; i++) {
            const a = R() * 6.283, rr = s * (0.4 + R() * 0.6);
            this.smoke.emit(target.x + Math.cos(a) * rr, ball.position.y + s * (0.2 + R() * 0.6), target.z + Math.sin(a) * rr, Math.cos(a) * 2, 4 + R() * 4, Math.sin(a) * 2, 2.5 + R() * 2, 3, 9, [0.25, 0.18, 0.16, 0.55], [0.45, 0.4, 0.38, 0], 0.6, 1.2);
          }
          for (let i = 0; i < 4; i++) this.smoke.emit(target.x + (R() - 0.5) * 3, target.y + bt * 4, target.z + (R() - 0.5) * 3, 0, 6 + R() * 3, 0, 2.2, 2.5, 5, [0.3, 0.22, 0.2, 0.5], [0.45, 0.4, 0.38, 0], 0.5, 0.5);
        }
        if (t >= cleanupAt) { cleanup(); return false; }
      }
      return true;
    } });
  },

  // E — Starfall barrage: telegraphs on every point, then stars streak down one after another
  starfallBarrage(pts, opts) {
    const { first, gap, radius, onImpact } = opts;
    const tex = circleTexture(7, 512);
    const items = pts.map((p, i) => {
      const tele = groundCircle(tex, radius, p.x, p.z, new THREE.Color(1.8, 0.3, 0.12), this.world);
      tele.material.opacity = 0;
      this.scene.add(tele);
      const star = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.8, 1.0), fog: false }));
      star.visible = false;
      this.scene.add(star);
      const a = R() * 6.283;
      return { p, tele, star, at: first + i * gap, from: new THREE.Vector3(p.x + Math.cos(a) * 10, p.y + 34, p.z + Math.sin(a) * 10), done: false };
    });
    const fall = 0.42;
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      let alive = false;
      for (const it of items) {
        if (it.done) continue;
        alive = true;
        it.tele.rotation.y += dt * 2;
        it.tele.material.opacity = Math.min(1, t / 0.25) * (0.55 + 0.45 * Math.sin(t * 22));
        const u = (t - (it.at - fall)) / fall;
        if (u > 0) {
          it.star.visible = true;
          it.star.position.lerpVectors(it.from, it.p, Math.min(1, u * u));
          const sp = it.star.position;
          for (let i = 0; i < 7; i++) this.fire.emit(sp.x + (R() - 0.5) * 0.35, sp.y + (R() - 0.5) * 0.35, sp.z + (R() - 0.5) * 0.35, (R() - 0.5), 2 + R() * 2, (R() - 0.5), 0.35 + R() * 0.25, 0.75, 0.12, R() < 0.35 ? GOLD : CRIM, DARKR, 1, 0);
          this.fire.emit(sp.x, sp.y, sp.z, 0, 0, 0, 0.05, 1.4, 1, [4, 2.2, 1.2, 1], CRIM, 0, 0);
        }
        if (t >= it.at) {
          it.done = true;
          for (const o of [it.tele, it.star]) { this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
          this.explosion(it.p, radius, 0.85);
          this.sparkBurst(new THREE.Vector3(it.p.x, it.p.y + 0.4, it.p.z), radius);
          this.ring(it.p, radius * 1.3, 0.35, new THREE.Color(3, 0.5, 0.4));
          if (onImpact) onImpact(it.p, items.indexOf(it));
        }
      }
      return alive;
    } });
  },

  // C — sigil triggered: the rune flares and drags everything into its center before blowing
  sigilVortex(p, radius, dur) {
    let t = 0;
    const m = groundCircle(circleTexture(11, 512), radius * 1.6, p.x, p.z, new THREE.Color(3, 0.4, 0.2), this.world);
    this.scene.add(m);
    this.light(new THREE.Vector3(p.x, p.y + 1, p.z), 20, radius * 4, dur, 0xff3040);
    this.effects.push({ update: (dt) => {
      t += dt;
      const k = t / dur;
      m.rotation.y -= dt * (4 + k * 14);
      m.scale.setScalar(1 - k * 0.5);
      m.material.opacity = 0.6 + 0.4 * Math.sin(t * 40);
      for (let i = 0; i < 14; i++) {
        const a = R() * 6.283, rr = radius * (1.4 + R() * 0.8);
        const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
        // swirl inward
        const tx = -Math.cos(a) * rr * 3.2 - Math.sin(a) * rr * 2.2, tz = -Math.sin(a) * rr * 3.2 + Math.cos(a) * rr * 2.2;
        this.fire.emit(x, p.y + 0.2 + R() * 1.4, z, tx, 0.5, tz, 0.3, 0.32, 0.06, R() < 0.3 ? GOLD : CRIM, DARKR, 0, 0);
      }
      if (t >= dur) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); return false; }
      return true;
    } });
  },

  // V — the afterimage left behind: a burning crimson silhouette that flickers, then detonates
  blinkEcho(p, delay, onBoom) {
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      const k = t / delay;
      for (let i = 0; i < 10 + k * 14; i++) {
        // rough body volume: legs, torso, head
        const h = R() * 1.75, w = h > 1.45 ? 0.13 : h > 0.85 ? 0.24 : 0.17;
        const a = R() * 6.283;
        this.fire.emit(p.x + Math.cos(a) * w, p.y + h, p.z + Math.sin(a) * w, 0, 0.25 + R() * 0.3, 0, 0.18 + R() * 0.12, 0.22 + k * 0.1, 0.05, R() < 0.3 + k * 0.4 ? GOLD : CRIM, DARKR, 1, 0.3);
      }
      if (R() < 0.3) this.light(new THREE.Vector3(p.x, p.y + 1, p.z), 6 + k * 10, 6, 0.1, 0xff3040);
      if (t >= delay) {
        const c = new THREE.Vector3(p.x, p.y + 0.8, p.z);
        this.explosion(c, 3.2, 1.1);
        this.sparkBurst(c, 3.2);
        if (onBoom) onBoom(c);
        return false;
      }
      return true;
    } });
  },
});

export { Fx };
