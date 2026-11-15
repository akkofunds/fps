import * as THREE from 'three';
import { ParticlePool } from './particles.js';
import { groundH } from '../world/terrain.js';

// Fire VFX toolkit for Pyro: palm flames, ember bolts, Blaze Orb, explosions with shockwaves,
// Firewall, Flame Leap blasts, the Meteor (telegraph + falling rock + impact), burning status,
// dash embers, scorch decals and a small pool of dynamic point lights. Colors are HDR so the
// bloom pass picks them up.

const R = Math.random;
const HOT = [2.8, 1.75, 0.7, 1], FLAME = [2.4, 0.9, 0.22, 0.95], EMBER = [1.6, 0.35, 0.06, 0.0], DARK = [0.5, 0.08, 0.02, 0];
const SMOKE0 = [0.22, 0.2, 0.19, 0.42], SMOKE1 = [0.4, 0.38, 0.36, 0];

function scorchTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(10,6,4,0.9)'); grd.addColorStop(0.5, 'rgba(20,12,8,0.65)'); grd.addColorStop(1, 'rgba(20,12,8,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(0,0,0,${R() * 0.3})`; g.beginPath(); g.arc(64 + (R() - 0.5) * 90, 64 + (R() - 0.5) * 90, R() * 9, 0, 6.3); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// a disc that hugs the terrain (for decals / telegraphs)
function groundDisc(radius, segs = 40, rings = 6) {
  const pos = [], uv = [], idx = [];
  pos.push(0, 0, 0); uv.push(0.5, 0.5);
  for (let r = 1; r <= rings; r++) for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2, rr = (r / rings);
    pos.push(Math.cos(a) * rr * radius, 0, Math.sin(a) * rr * radius); uv.push(0.5 + Math.cos(a) * rr * 0.5, 0.5 + Math.sin(a) * rr * 0.5);
  }
  for (let i = 0; i < segs; i++) idx.push(0, 1 + ((i + 1) % segs), 1 + i);
  for (let r = 1; r < rings; r++) for (let i = 0; i < segs; i++) {
    const a = 1 + (r - 1) * segs + i, b = 1 + (r - 1) * segs + ((i + 1) % segs), c = a + segs, d = b + segs;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}
function drape(mesh, x, z, lift = 0.06, world = null) {
  const p = mesh.geometry.attributes.position, base = mesh.userData.base || (mesh.userData.base = p.array.slice());
  for (let i = 0; i < p.count; i++) {
    const lx = base[i * 3], lz = base[i * 3 + 2];
    const gy = world ? world.groundAt(x + lx, z + lz, 1e9) : groundH(x + lx, z + lz);
    p.setXYZ(i, lx, gy + lift, lz);
  }
  p.needsUpdate = true;
  mesh.position.set(x, 0, z);
  mesh.geometry.computeBoundingSphere();
}

export class Fx {
  constructor(scene, world, nLights = 4) {
    this.scene = scene; this.world = world;
    this.fire = new ParticlePool(9000, true);
    this.smoke = new ParticlePool(1800, false);
    scene.add(this.smoke.points); scene.add(this.fire.points);
    this.t = 0;
    this.shakeAmt = 0;
    // dynamic lights
    this.lights = [];
    for (let i = 0; i < nLights; i++) { const l = new THREE.PointLight(0xff7a2a, 0, 10, 1.6); l.userData = { life: 0, max: 1, peak: 0 }; scene.add(l); this.lights.push(l); }
    // shockwave rings
    this.rings = [];
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.3, 0.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), ringMat.clone()); m.rotation.x = -Math.PI / 2; m.visible = false; m.userData = { t: 0, life: 0.5, r: 4 }; scene.add(m); this.rings.push(m); }
    // scorch decals
    this.scorchTex = scorchTexture();
    this.decals = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(groundDisc(1, 20, 3), new THREE.MeshBasicMaterial({ map: this.scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, opacity: 0 }));
      m.visible = false; m.renderOrder = 1; m.userData = { t: 0, life: 9 }; scene.add(m); this.decals.push(m);
    }
    this.effects = []; // objects with update(dt) → false when done
  }

  // ---------------------------------------------------------------- primitives
  light(pos, intensity, dist, life, color = 0xff7a2a) {
    let l = this.lights.find((x) => x.userData.life <= 0) || this.lights.reduce((a, b) => (a.userData.life < b.userData.life ? a : b));
    l.position.copy(pos); l.color.set(color); l.distance = dist;
    l.userData.life = life; l.userData.max = life; l.userData.peak = intensity; l.intensity = intensity;
    return l;
  }
  ring(pos, radius, life = 0.45, color = null) {
    const m = this.rings.find((x) => !x.visible) || this.rings[0];
    m.position.set(pos.x, pos.y + 0.15, pos.z); m.visible = true; m.userData.t = 0; m.userData.life = life; m.userData.r = radius;
    if (color) m.material.color.copy(color); else m.material.color.setRGB(3, 1.3, 0.4);
  }
  scorch(x, z, radius, life = 10) {
    const m = this.decals.find((d) => !d.visible) || this.decals.reduce((a, b) => (a.userData.t > b.userData.t ? a : b));
    m.scale.set(1, 1, 1);
    m.geometry.dispose(); m.geometry = groundDisc(radius, 20, 3); m.userData.base = null;
    drape(m, x, z, 0.04, this.world);
    m.visible = true; m.userData.t = 0; m.userData.life = life; m.material.opacity = 0.85;
  }
  shake(a) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }

  // ---------------------------------------------------------------- effects
  palmFlame(p, k = 1) {
    if (R() > 0.75 * k) return;
    this.fire.emit(p.x + (R() - 0.5) * 0.05, p.y, p.z + (R() - 0.5) * 0.05, (R() - 0.5) * 0.2, 0.6 + R() * 0.6, (R() - 0.5) * 0.2, 0.28 + R() * 0.22, 0.09 * k + 0.04, 0.02, R() < 0.3 ? HOT : FLAME, EMBER, 1.5, 1.2);
  }
  castBurst(p, dir, k = 1) {
    for (let i = 0; i < 14 * k; i++) {
      const s = 2 + R() * 4;
      this.fire.emit(p.x, p.y, p.z, dir.x * s + (R() - 0.5) * 2, dir.y * s + (R() - 0.5) * 2, dir.z * s + (R() - 0.5) * 2, 0.15 + R() * 0.2, 0.18 * k, 0.04, HOT, EMBER, 5, 0);
    }
    this.light(p, 6 * k, 6, 0.12);
  }
  boltTrail(p, v, big = 1) {
    // bright head + trailing flame
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.06, 0.6 * big, 0.4 * big, HOT, FLAME, 0, 0);
    for (let i = 0; i < 3 * big; i++) {
      const b = R() * 0.6;
      this.fire.emit(p.x - v.x * 0.016 * b + (R() - 0.5) * 0.08, p.y - v.y * 0.016 * b + (R() - 0.5) * 0.08, p.z - v.z * 0.016 * b + (R() - 0.5) * 0.08,
        v.x * 0.05 + (R() - 0.5) * 0.8, v.y * 0.05 + (R() - 0.5) * 0.8 + 0.4, v.z * 0.05 + (R() - 0.5) * 0.8, 0.2 + R() * 0.22, 0.34 * big, 0.05, FLAME, DARK, 2, 1.5);
    }
  }
  orbTrail(p, v, t) {
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.05, 1.1, 0.9, HOT, FLAME, 0, 0);
    for (let i = 0; i < 7; i++) {
      const a = t * 18 + i * 0.9, r = 0.35;
      this.fire.emit(p.x + Math.cos(a) * r * R(), p.y + Math.sin(a) * r * R(), p.z + (R() - 0.5) * r, (R() - 0.5) * 1.2, (R() - 0.5) * 1.2 + 0.6, (R() - 0.5) * 1.2, 0.3 + R() * 0.25, 0.45, 0.06, FLAME, DARK, 2.5, 1.5);
    }
    if (R() < 0.4) this.smoke.emit(p.x, p.y, p.z, 0, 0.5, 0, 0.9, 0.3, 1.1, SMOKE0, SMOKE1, 1, 0.6);
  }
  explosion(p, radius, power = 1) {
    const n = Math.round(70 * power);
    for (let i = 0; i < n; i++) {
      const u = R() * 2 - 1, a = R() * 6.283, s = Math.sqrt(1 - u * u);
      const sp = (4 + R() * 9) * radius / 4;
      this.fire.emit(p.x, p.y + 0.2, p.z, Math.cos(a) * s * sp, Math.abs(u) * sp * 0.9 + 1.5, Math.sin(a) * s * sp, 0.35 + R() * 0.45, (0.7 + R() * 0.9) * power, 0.1, i < n * 0.3 ? HOT : FLAME, DARK, 3.2, 2.5);
    }
    for (let i = 0; i < 20 * power; i++) {
      const a = R() * 6.283, sp = 1 + R() * 3;
      this.smoke.emit(p.x + (R() - 0.5) * radius * 0.6, p.y + 0.3 + R(), p.z + (R() - 0.5) * radius * 0.6, Math.cos(a) * sp, 1 + R() * 2, Math.sin(a) * sp, 1.2 + R() * 1.4, 0.8 * power, 2.6 * power, SMOKE0, SMOKE1, 1.4, 0.8);
    }
    // flying embers
    for (let i = 0; i < 26 * power; i++) {
      const a = R() * 6.283, sp = 6 + R() * 8;
      this.fire.emit(p.x, p.y + 0.3, p.z, Math.cos(a) * sp, 4 + R() * 7, Math.sin(a) * sp, 0.8 + R() * 0.8, 0.07, 0.03, HOT, EMBER, 0.6, -14);
    }
    this.fire.emit(p.x, p.y + 0.4, p.z, 0, 0, 0, 0.12, radius * 1.4, radius * 2, [4, 3, 2, 1], FLAME, 0, 0);
    this.ring(p, radius * 1.1, 0.4);
    this.light(new THREE.Vector3(p.x, p.y + 1, p.z), 40 * power, radius * 5, 0.45);
    this.scorch(p.x, p.z, radius * 0.75);
    this.shake(0.25 * power);
  }
  hitSpark(p) {
    for (let i = 0; i < 10; i++) this.fire.emit(p.x, p.y, p.z, (R() - 0.5) * 6, R() * 4, (R() - 0.5) * 6, 0.2 + R() * 0.2, 0.15, 0.03, HOT, EMBER, 3, -6);
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.08, 0.9, 1.2, HOT, FLAME, 0, 0);
    this.smoke.emit(p.x, p.y, p.z, 0, 0.8, 0, 0.6, 0.3, 0.9, SMOKE0, SMOKE1, 1, 0.3);
  }
  wallTick(a, b, k = 1, h = 2.6) {
    const n = Math.round(9 * k);
    for (let i = 0; i < n; i++) {
      const t = R();
      const x = a.x + (b.x - a.x) * t + (R() - 0.5) * 0.3, z = a.z + (b.z - a.z) * t + (R() - 0.5) * 0.3;
      const y = a.y + (b.y - a.y) * t;
      this.fire.emit(x, y + R() * 0.3, z, (R() - 0.5) * 0.6, 2.4 + R() * 2.5 * (h / 2.6), (R() - 0.5) * 0.6, 0.4 + R() * 0.45, 0.85 + R() * 0.6, 0.15, R() < 0.3 ? HOT : FLAME, DARK, 1.5, 1.5);
    }
    if (R() < 0.35 * k) { const t = R(); this.smoke.emit(a.x + (b.x - a.x) * t, a.y + h, a.z + (b.z - a.z) * t, 0, 1.4, 0, 1.6, 0.8, 2.4, SMOKE0, SMOKE1, 0.6, 0.4); }
  }
  leapBlast(p) {
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * 6.283, sp = 7 + R() * 3;
      this.fire.emit(p.x, p.y + 0.15, p.z, Math.cos(a) * sp, 0.6 + R(), Math.sin(a) * sp, 0.35 + R() * 0.2, 0.7, 0.12, FLAME, DARK, 3.5, 1);
    }
    for (let i = 0; i < 25; i++) this.fire.emit(p.x + (R() - 0.5) * 0.6, p.y, p.z + (R() - 0.5) * 0.6, (R() - 0.5) * 2, -3 - R() * 3, (R() - 0.5) * 2, 0.3, 0.8, 0.2, HOT, FLAME, 2, 0);
    this.ring(p, 4, 0.35);
    this.light(new THREE.Vector3(p.x, p.y + 0.8, p.z), 30, 12, 0.35);
    this.scorch(p.x, p.z, 1.8, 6);
    for (let i = 0; i < 10; i++) this.smoke.emit(p.x, p.y + 0.3, p.z, (R() - 0.5) * 5, 0.6, (R() - 0.5) * 5, 1.2, 0.6, 1.8, SMOKE0, SMOKE1, 2, 0.4);
    this.shake(0.15);
  }
  // feet flame jets while flying from a leap
  jet(p) { this.fire.emit(p.x + (R() - 0.5) * 0.1, p.y, p.z + (R() - 0.5) * 0.1, (R() - 0.5) * 0.6, -4 - R() * 2, (R() - 0.5) * 0.6, 0.2 + R() * 0.15, 0.35, 0.08, HOT, EMBER, 2, 0); }
  dashTrail(p) {
    for (let i = 0; i < 4; i++) this.fire.emit(p.x + (R() - 0.5) * 0.4, p.y + 0.2 + R() * 1.4, p.z + (R() - 0.5) * 0.4, (R() - 0.5) * 0.4, 0.4 + R() * 0.6, (R() - 0.5) * 0.4, 0.3 + R() * 0.2, 0.3, 0.04, FLAME, DARK, 2, 1);
  }
  burn(p) {
    if (R() < 0.5) this.fire.emit(p.x + (R() - 0.5) * 0.45, p.y + R() * 1.5, p.z + (R() - 0.5) * 0.45, (R() - 0.5) * 0.3, 1 + R(), (R() - 0.5) * 0.3, 0.35 + R() * 0.25, 0.32, 0.05, FLAME, DARK, 1, 1.5);
  }
  brazier(p) {
    for (let i = 0; i < 3; i++) this.fire.emit(p.x + (R() - 0.5) * 0.5, p.y, p.z + (R() - 0.5) * 0.5, (R() - 0.5) * 0.3, 1.4 + R() * 1.4, (R() - 0.5) * 0.3, 0.5 + R() * 0.4, 0.65 + R() * 0.4, 0.1, R() < 0.3 ? HOT : FLAME, DARK, 1.2, 1.4);
    if (R() < 0.15) this.smoke.emit(p.x, p.y + 1.6, p.z, 0.3, 1.2, 0.1, 2.5, 0.5, 2.2, [0.25, 0.24, 0.23, 0.22], SMOKE1, 0.3, 0.3);
  }
  spawnPillar(p) {
    for (let i = 0; i < 70; i++) { const a = R() * 6.283, r = 0.3 + R() * 0.7; this.fire.emit(p.x + Math.cos(a) * r, p.y + R() * 0.3, p.z + Math.sin(a) * r, 0, 3 + R() * 5, 0, 0.5 + R() * 0.5, 0.5, 0.05, HOT, EMBER, 1, 2); }
    this.ring(p, 2.5, 0.5);
    this.light(new THREE.Vector3(p.x, p.y + 1, p.z), 25, 8, 0.6);
  }
  deathBurst(p) {
    for (let i = 0; i < 50; i++) { const a = R() * 6.283, sp = 1 + R() * 3; this.fire.emit(p.x + (R() - 0.5) * 0.6, p.y + R() * 1.4, p.z + (R() - 0.5) * 0.6, Math.cos(a) * sp, 1 + R() * 3, Math.sin(a) * sp, 0.6 + R() * 0.6, 0.3, 0.04, FLAME, EMBER, 1.5, 1); }
    for (let i = 0; i < 12; i++) this.smoke.emit(p.x, p.y + R() * 1.4, p.z, (R() - 0.5), 1, (R() - 0.5), 1.5, 0.6, 1.6, SMOKE0, SMOKE1, 1, 0.5);
  }

  // Meteor: ground telegraph + falling rock; calls onImpact at the end
  meteor(target, radius, delay, onImpact) {
    const tele = new THREE.Mesh(groundDisc(radius, 48, 6), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */`
        uniform float uT; varying vec2 vUv;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float edge = smoothstep(0.9, 0.97, d) * smoothstep(1.0, 0.97, d);
          float fill = smoothstep(uT + 0.02, uT, d) * 0.25;
          float rings = (0.5 + 0.5 * sin(d * 30.0 - uT * 40.0)) * 0.12 * (1.0 - d);
          float a = edge * 1.2 + fill + rings;
          gl_FragColor = vec4(vec3(2.4, 0.7, 0.15) * a, a);
        }`,
    }));
    tele.renderOrder = 3;
    drape(tele, target.x, target.z, 0.08, this.world);
    this.scene.add(tele);
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.7, 0.2) }));
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 0), new THREE.MeshLambertMaterial({ color: 0x2a1a14, emissive: 0x301005, flatShading: true }));
    rock.add(shell); this.scene.add(rock);
    const from = new THREE.Vector3(target.x - 14, target.y + 45, target.z + 8);
    let t = 0;
    const fall = 0.75; // last part of the delay the rock is visible
    const lightL = this.light(new THREE.Vector3(target.x, target.y + 2, target.z), 8, radius * 2.5, delay + 0.1);
    this.effects.push({
      update: (dt) => {
        t += dt;
        tele.material.uniforms.uT.value = Math.min(1, t / delay);
        lightL.userData.life = Math.max(lightL.userData.life, 0.2);
        const u = (t - (delay - fall)) / fall;
        rock.visible = u > 0;
        if (u > 0) {
          rock.position.lerpVectors(from, target, Math.min(1, u * u));
          rock.rotation.x += dt * 6; rock.rotation.y += dt * 4;
          for (let i = 0; i < 8; i++) this.fire.emit(rock.position.x + (R() - 0.5), rock.position.y + (R() - 0.5), rock.position.z + (R() - 0.5), (R() - 0.5) * 2, 3 + R() * 3, (R() - 0.5) * 2, 0.35 + R() * 0.3, 1.4, 0.3, FLAME, DARK, 1, 0);
          if (R() < 0.6) this.smoke.emit(rock.position.x, rock.position.y + 1, rock.position.z, 0, 1, 0, 1.6, 1, 2.6, SMOKE0, SMOKE1, 0.5, 0);
        }
        if (t >= delay) {
          this.scene.remove(tele); this.scene.remove(rock);
          tele.geometry.dispose(); tele.material.dispose(); rock.geometry.dispose(); shell.geometry.dispose();
          this.explosion(target, radius, 2.2);
          this.ring(target, radius * 1.4, 0.6);
          this.shake(0.7);
          if (onImpact) onImpact();
          return false;
        }
        return true;
      },
    });
  }

  // burning ground left by the meteor
  fireField(p, radius, life) {
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      const k = 1 - t / life;
      for (let i = 0; i < 5 * k + 1; i++) {
        const a = R() * 6.283, r = Math.sqrt(R()) * radius;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        this.fire.emit(x, groundH(x, z) + 0.05, z, 0, 1 + R() * 1.6, 0, 0.35 + R() * 0.3, 0.6 * k + 0.2, 0.1, FLAME, DARK, 1, 1);
      }
      return t < life;
    } });
  }

  update(dt, camera, viewportH) {
    this.t += dt;
    for (let i = this.effects.length - 1; i >= 0; i--) if (!this.effects[i].update(dt)) this.effects.splice(i, 1);
    this.fire.update(dt, viewportH);
    this.smoke.update(dt, viewportH);
    for (const l of this.lights) {
      const u = l.userData;
      if (u.life > 0) { u.life -= dt; l.intensity = u.peak * Math.max(0, u.life / u.max) * (0.85 + Math.random() * 0.3); }
      else l.intensity = 0;
    }
    for (const m of this.rings) {
      if (!m.visible) continue;
      const u = m.userData; u.t += dt;
      const k = u.t / u.life;
      if (k >= 1) { m.visible = false; continue; }
      const s = u.r * (0.2 + 0.8 * (1 - (1 - k) * (1 - k)));
      m.scale.set(s, s, s);
      m.material.opacity = (1 - k) * 0.9;
    }
    for (const d of this.decals) {
      if (!d.visible) continue;
      d.userData.t += dt;
      const k = d.userData.t / d.userData.life;
      if (k >= 1) { d.visible = false; continue; }
      d.material.opacity = 0.85 * Math.min(1, (1 - k) * 3);
    }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
  }

  dispose() {
    this.scene.remove(this.fire.points); this.scene.remove(this.smoke.points);
    for (const l of this.lights) this.scene.remove(l);
    for (const r of this.rings) this.scene.remove(r);
    for (const d of this.decals) this.scene.remove(d);
  }
}
