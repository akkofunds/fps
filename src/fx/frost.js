import * as THREE from 'three';
import { Fx } from './fire.js';

// Shoto's ice + fire VFX: crystalline ice spikes (erupting along a path or flooding an area),
// ice blocks that encase frozen enemies, ice shrapnel, a sweeping heatwave, the Hellfire Lance
// beam, the Cryo-Jet skating trail, and the Absolute Zero-Burn glacier → superheat → thermobaric blast.

const R = Math.random;
const ICE = [1.4, 2.4, 3.2, 1], ICE2 = [0.7, 1.4, 2.2, 0.9], FROST = [0.8, 0.95, 1.0, 0.5], CLEAR = [0.4, 0.6, 0.8, 0];
const HOT = [3.0, 1.45, 0.42, 1], FLAME = [2.6, 1.0, 0.24, 0.95], WHITE = [3.4, 2.3, 1.0, 1], DARK = [0.5, 0.08, 0.02, 0];

let iceMat = null, spikeGeo = null;
function iceAssets() {
  if (!iceMat) {
    iceMat = new THREE.MeshLambertMaterial({ color: 0xcdefff, emissive: 0x2c6c96, transparent: true, opacity: 0.9, flatShading: true });
    spikeGeo = new THREE.ConeGeometry(0.5, 1, 5, 1); spikeGeo.translate(0, 0.5, 0);
  }
  return { iceMat, spikeGeo };
}
// one jagged spike pointing roughly up/outward
function spike(group, x, y, z, h, w, tilt, yaw) {
  const { iceMat: mat, spikeGeo: geo } = iceAssets();
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(tilt * Math.cos(yaw), R() * 6.28, tilt * Math.sin(yaw));
  m.scale.set(w, 0.001, w); m.userData.h = h;
  group.add(m);
  return m;
}

Object.assign(Fx.prototype, {
  // ---------------------------------------------------------------- shards
  iceTrail(p, v) {
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.05, 0.5, 0.3, [2.2, 3.0, 3.6, 1], ICE, 0, 0);
    for (let i = 0; i < 2; i++) this.fire.emit(p.x, p.y, p.z, v.x * 0.03 + (R() - 0.5) * 0.6, v.y * 0.03 + (R() - 0.5) * 0.6, v.z * 0.03 + (R() - 0.5) * 0.6, 0.18 + R() * 0.12, 0.2, 0.03, ICE2, CLEAR, 3, -1);
  },
  // Shoto's right hand: cold vapour rolling off the palm, a few glittering ice motes falling
  frostMist(p) {
    if (R() < 0.6) this.fire.emit(p.x + (R() - 0.5) * 0.06, p.y, p.z + (R() - 0.5) * 0.06, (R() - 0.5) * 0.15, -0.25 - R() * 0.3, (R() - 0.5) * 0.15, 0.35 + R() * 0.3, 0.035, 0.012, ICE, CLEAR, 1.5, -0.6);
    else this.smoke.emit(p.x, p.y - 0.05, p.z, (R() - 0.5) * 0.2, -0.35, (R() - 0.5) * 0.2, 0.7, 0.07, 0.28, [0.82, 0.93, 1, 0.28], [0.9, 0.96, 1, 0], 1.2, -0.3);
  },
  frostBurst(p, dir, k = 1) {
    for (let i = 0; i < 12 * k; i++) {
      const s = 2 + R() * 4;
      this.fire.emit(p.x, p.y, p.z, dir.x * s + (R() - 0.5) * 2, dir.y * s + (R() - 0.5) * 2, dir.z * s + (R() - 0.5) * 2, 0.14 + R() * 0.18, 0.12 * k, 0.03, ICE, CLEAR, 5, -2);
    }
    this.smoke.emit(p.x, p.y, p.z, dir.x * 1.5, dir.y * 1.5, dir.z * 1.5, 0.45, 0.15, 0.5, [0.85, 0.94, 1, 0.35], [0.9, 0.96, 1, 0], 3, 0);
    this.light(p, 5 * k, 5, 0.1, 0x7fd4ff);
  },
  iceHit(p) {
    for (let i = 0; i < 14; i++) this.fire.emit(p.x, p.y, p.z, (R() - 0.5) * 7, R() * 4, (R() - 0.5) * 7, 0.3 + R() * 0.3, 0.14, 0.03, ICE, CLEAR, 2, -10);
    this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.1, 0.9, 1.2, [2, 3, 3.6, 1], ICE2, 0, 0);
    for (let i = 0; i < 3; i++) this.smoke.emit(p.x, p.y, p.z, (R() - 0.5), 0.5, (R() - 0.5), 0.8, 0.3, 0.9, [0.85, 0.92, 1, 0.35], [0.9, 0.95, 1, 0], 1.5, 0.2);
  },

  // ---------------------------------------------------------------- Flashfreeze: ice races from o to c, then a crystal cluster at c
  iceSurge(o, c, radius, hold) {
    const g = new THREE.Group(); this.scene.add(g);
    const dx = c.x - o.x, dz = c.z - o.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    const spikes = [];
    // the eruption at his foot: a cluster of shards bursting out where the stomp lands
    for (let i = 0; i < 7; i++) {
      const a = Math.atan2(uz, ux) + (R() - 0.5) * 2.6, rr = 0.25 + R() * 0.7;
      const x = o.x + Math.cos(a) * rr, z = o.z + Math.sin(a) * rr, y = this.world.groundAt(x, z, o.y + 2) - 0.08;
      spikes.push({ m: spike(g, x, y, z, 0.5 + R() * 0.8, 0.18 + R() * 0.2, 0.35 + R() * 0.45, a), at: R() * 0.04 });
    }
    for (let i = 0; i < 14; i++) { const a = R() * 6.283; this.fire.emit(o.x, o.y + 0.1, o.z, Math.cos(a) * 3, 1 + R() * 2.5, Math.sin(a) * 3, 0.35, 0.3, 0.05, ICE2, CLEAR, 2, -6); }
    const n = Math.max(3, Math.floor(L / 0.9));
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = o.x + dx * t + (R() - 0.5) * 0.8, z = o.z + dz * t + (R() - 0.5) * 0.8;
      const y = this.world.groundAt(x, z, Math.max(o.y, c.y) + 3) - 0.1;
      spikes.push({ m: spike(g, x, y, z, 0.6 + R() * 0.9 + t * 0.6, 0.25 + R() * 0.25, 0.3 + R() * 0.4, Math.atan2(uz, ux) + (R() - 0.5) * 2), at: t * 0.24 });
    }
    for (let i = 0; i < 16; i++) {
      const a = R() * 6.283, rr = Math.sqrt(R()) * radius;
      const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr, y = this.world.groundAt(x, z, c.y + 3) - 0.15;
      spikes.push({ m: spike(g, x, y, z, 1.4 + R() * 1.8 * (1 - rr / radius * 0.6), 0.35 + R() * 0.35, (rr / radius) * 0.9, a), at: 0.24 + R() * 0.06 });
    }
    this.ring(c, radius * 1.3, 0.35, new THREE.Color(1.4, 2.4, 3.4));
    this.light(new THREE.Vector3(c.x, c.y + 1, c.z), 25, radius * 4, 0.4, 0x9fe0ff);
    let t = 0;
    const life = 0.3 + hold;
    this.effects.push({ update: (dt) => {
      t += dt;
      for (const s of spikes) {
        const k = Math.min(1, Math.max(0, (t - s.at) / 0.08));
        const fade = t > life ? Math.max(0, 1 - (t - life) / 0.25) : 1;
        s.m.scale.y = Math.max(0.001, s.m.userData.h * k * fade);
        if (k > 0 && k < 1 && R() < 0.5) { const p = s.m.position; this.fire.emit(p.x, p.y + 0.2, p.z, (R() - 0.5) * 2, 1 + R() * 2, (R() - 0.5) * 2, 0.4, 0.2, 0.05, ICE2, CLEAR, 2, -6); }
      }
      if (R() < 0.6) { const a = R() * 6.283, rr = R() * radius; this.smoke.emit(c.x + Math.cos(a) * rr, c.y + 0.2, c.z + Math.sin(a) * rr, 0, 0.3, 0, 1.2, 0.6, 1.6, [0.85, 0.93, 1, 0.3], [0.9, 0.95, 1, 0], 0.5, 0); }
      if (t > life + 0.3) { this.scene.remove(g); return false; }
      return true;
    } });
  },

  // an ice block encasing a frozen body for `dur` seconds
  iceBlock(p, dur) {
    const g = new THREE.Group(); g.position.copy(p); this.scene.add(g);
    const parts = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.283 + R() * 0.5;
      parts.push(spike(g, Math.cos(a) * 0.35, -0.1, Math.sin(a) * 0.35, 1.3 + R() * 0.9, 0.42 + R() * 0.2, 0.25 + R() * 0.2, a));
    }
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      const k = Math.min(1, t / 0.1), fade = t > dur ? Math.max(0, 1 - (t - dur) / 0.15) : 1;
      for (const m of parts) m.scale.y = Math.max(0.001, m.userData.h * k * fade);
      if (R() < 0.3) this.fire.emit(p.x + (R() - 0.5) * 0.8, p.y + R() * 1.8, p.z + (R() - 0.5) * 0.8, 0, 0.3, 0, 0.6, 0.12, 0.03, ICE2, CLEAR, 1, -1);
      if (t > dur + 0.15) { this.scene.remove(g); return false; }
      return true;
    } });
  },

  // frozen air bursting: shrapnel + a pressure ring
  shatter(c) {
    for (let i = 0; i < 46; i++) {
      const u = R() * 2 - 1, a = R() * 6.283, s = Math.sqrt(1 - u * u), sp = 6 + R() * 10;
      this.fire.emit(c.x, c.y, c.z, Math.cos(a) * s * sp, u * sp + 3, Math.sin(a) * s * sp, 0.4 + R() * 0.4, 0.16 + R() * 0.12, 0.05, R() < 0.5 ? ICE : [2.6, 3.2, 3.6, 1], CLEAR, 1.5, -14);
    }
    this.fire.emit(c.x, c.y, c.z, 0, 0, 0, 0.12, 2.6, 3.4, [2.4, 3.0, 3.6, 1], FLAME, 0, 0);
    this.ring(c, 3.2, 0.3, new THREE.Color(1.8, 2.6, 3.4));
    this.light(c, 40, 10, 0.25, 0xbfe8ff);
    this.shake(0.2);
  },

  // a wall of flame sweeping out in an arc
  heatWave(o, ux, uz, len, half) {
    let t = 0;
    const dur = 0.42;
    const base = Math.atan2(uz, ux);
    this.light(new THREE.Vector3(o.x + ux * 3, o.y + 1, o.z + uz * 3), 50, len * 2, 0.5);
    this.effects.push({ update: (dt) => {
      t += dt;
      const k = Math.min(1, t / dur), r = 1 + (len - 1) * (1 - (1 - k) ** 2);
      for (let i = 0; i < 34; i++) {
        const a = base + (R() * 2 - 1) * half;
        const x = o.x + Math.cos(a) * r, z = o.z + Math.sin(a) * r;
        const y = this.world.groundAt(x, z, o.y + 3);
        this.fire.emit(x, y + R() * 0.8, z, Math.cos(a) * 6, 2.5 + R() * 4 * (1 - k * 0.5), Math.sin(a) * 6, 0.32 + R() * 0.3, 1.2 + R() * 0.6, 0.3, R() < 0.3 ? WHITE : FLAME, DARK, 2.2, 1.5);
      }
      if (R() < 0.5) { const a = base + (R() * 2 - 1) * half; this.smoke.emit(o.x + Math.cos(a) * r, o.y + 2, o.z + Math.sin(a) * r, Math.cos(a) * 3, 1.5, Math.sin(a) * 3, 1.5, 1, 2.6, [0.22, 0.2, 0.19, 0.45], [0.38, 0.36, 0.34, 0], 1, 0.5); }
      return t < dur;
    } });
    this.shake(0.15);
  },

  // ---------------------------------------------------------------- Hellfire Lance
  lanceCharge(p) {
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      for (let i = 0; i < 5; i++) { const a = R() * 6.283, b = R() * 3.14, r = 0.6; const sx = Math.cos(a) * Math.sin(b) * r, sy = Math.cos(b) * r, sz = Math.sin(a) * Math.sin(b) * r; this.fire.emit(p.x + sx, p.y + sy, p.z + sz, -sx * 5, -sy * 5, -sz * 5, 0.12, 0.2, 0.05, WHITE, HOT, 0, 0); }
      this.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.06, 0.4 + t * 1.6, 0.3, WHITE, HOT, 0, 0);
      return t < 0.36;
    } });
  },
  lanceBeam(o, t) {
    const dir = new THREE.Vector3().subVectors(t, o), L = dir.length(); dir.normalize();
    const geo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true); geo.translate(0, 0.5, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const core = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.4, 2.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const glow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.8, 0.15), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.6 }));
    for (const m of [core, glow]) { m.position.copy(o); m.quaternion.copy(q); m.frustumCulled = false; this.scene.add(m); }
    core.scale.set(0.05, L, 0.05); glow.scale.set(0.2, L, 0.2);
    // impact
    for (let i = 0; i < 30; i++) this.fire.emit(t.x, t.y, t.z, (R() - 0.5) * 9 - dir.x * 3, R() * 6, (R() - 0.5) * 9 - dir.z * 3, 0.3 + R() * 0.3, 0.3, 0.05, R() < 0.4 ? WHITE : HOT, DARK, 2.5, -10);
    this.fire.emit(t.x, t.y, t.z, 0, 0, 0, 0.12, 2.2, 2.8, WHITE, FLAME, 0, 0);
    this.light(t, 30, 10, 0.25);
    this.light(o, 18, 8, 0.15);
    // scorched earth beneath the beam
    const gA = new THREE.Vector3(o.x, this.world.groundAt(o.x, o.z, o.y + 2), o.z), gB = new THREE.Vector3(t.x, this.world.groundAt(t.x, t.z, t.y + 2), t.z);
    if (Math.abs(gB.y - t.y) < 6) this.fireTrail(gA, gB, 2.2, 0.08, 0.3);
    let tt = 0;
    this.effects.push({ update: (dt) => {
      tt += dt;
      const k = Math.max(0, 1 - tt / 0.32);
      core.material.opacity = k; glow.material.opacity = 0.6 * k;
      core.scale.x = core.scale.z = 0.05 + 0.04 * k; glow.scale.x = glow.scale.z = 0.12 + 0.18 * k;
      for (let i = 0; i < 6 * k; i++) { const u = R() * L; this.fire.emit(o.x + dir.x * u, o.y + dir.y * u, o.z + dir.z * u, (R() - 0.5), 0.5 + R(), (R() - 0.5), 0.3, 0.25, 0.05, HOT, DARK, 1, 1); }
      if (tt > 0.32) { for (const m of [core, glow]) { this.scene.remove(m); m.material.dispose(); } geo.dispose(); return false; }
      return true;
    } });
  },

  // ---------------------------------------------------------------- Cryo-Jet Blitz
  frostPath(a, b, life) {
    const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(2, Math.floor(L / 0.7));
    const g = new THREE.Group(); this.scene.add(g);
    const sp = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      for (const side of [-1, 1]) {
        const x = a.x + (b.x - a.x) * t + (b.z - a.z) / L * side * (0.35 + R() * 0.2), z = a.z + (b.z - a.z) * t - (b.x - a.x) / L * side * (0.35 + R() * 0.2);
        const y = this.world.groundAt(x, z, Math.max(a.y, b.y) + 3) - 0.05;
        sp.push({ m: spike(g, x, y, z, 0.25 + R() * 0.35, 0.18 + R() * 0.12, 0.6 + R() * 0.5, Math.atan2(z - a.z, x - a.x)), at: t * 0.5 });
      }
    }
    let t = 0;
    this.effects.push({ update: (dt) => {
      t += dt;
      for (const s of sp) { const k = Math.min(1, Math.max(0, (t - s.at) / 0.06)), f = t > life ? Math.max(0, 1 - (t - life) / 0.4) : 1; s.m.scale.y = Math.max(0.001, s.m.userData.h * k * f); }
      if (t > life + 0.4) { this.scene.remove(g); return false; }
      return true;
    } });
  },
  // per frame while skating: fire jets behind, frost under the feet
  blitzJets(p, v) {
    const l = Math.hypot(v.x, v.z) || 1, ux = v.x / l, uz = v.z / l;
    for (let i = 0; i < 6; i++) this.fire.emit(p.x - ux * 0.5 + (R() - 0.5) * 0.3, p.y + 0.6 + R() * 0.7, p.z - uz * 0.5 + (R() - 0.5) * 0.3, -ux * (10 + R() * 6), (R() - 0.3) * 2, -uz * (10 + R() * 6), 0.18 + R() * 0.12, 0.6, 0.3, R() < 0.4 ? WHITE : FLAME, DARK, 3, 1);
    for (let i = 0; i < 2; i++) this.fire.emit(p.x + (R() - 0.5) * 0.5, p.y + 0.05, p.z + (R() - 0.5) * 0.5, (R() - 0.5), 0.6, (R() - 0.5), 0.4, 0.2, 0.05, ICE2, CLEAR, 1, -1);
    if (R() < 0.5) this.smoke.emit(p.x, p.y + 0.1, p.z, -ux, 0.4, -uz, 0.7, 0.4, 1.2, [0.85, 0.93, 1, 0.35], [0.9, 0.95, 1, 0], 1, 0);
  },
  uppercutBurst(c) {
    for (let i = 0; i < 40; i++) { const a = R() * 6.283, sp = 2 + R() * 4; this.fire.emit(c.x, c.y - 0.4, c.z, Math.cos(a) * sp, 8 + R() * 8, Math.sin(a) * sp, 0.4 + R() * 0.3, 0.8, 0.15, i % 2 ? (R() < 0.3 ? WHITE : FLAME) : ICE, i % 2 ? DARK : CLEAR, 2, i % 2 ? 1 : -8); }
    this.fire.emit(c.x, c.y, c.z, 0, 0, 0, 0.12, 2.4, 3, WHITE, FLAME, 0, 0);
    this.ring(c, 2.6, 0.3, new THREE.Color(3, 2.2, 1.6));
    this.light(c, 35, 10, 0.3, 0xffc890);
  },

  // ---------------------------------------------------------------- Absolute Zero-Burn
  zeroBurn(o, radius, freezeAt, boomAt, onFreeze, onBoom) {
    const g = new THREE.Group(); this.scene.add(g);
    const spikes = [];
    // the glacier: rings of spikes racing outward, tallest near Shoto
    const n = 170;
    for (let i = 0; i < n; i++) {
      const a = R() * 6.283, rr = 1.5 + Math.sqrt(R()) * radius;
      const x = o.x + Math.cos(a) * rr, z = o.z + Math.sin(a) * rr, y = this.world.groundAt(x, z, o.y + 6) - 0.2;
      const h = (1.2 + R() * 2.6) * (1.3 - rr / radius * 0.6);
      spikes.push({ m: spike(g, x, y, z, h, 0.4 + R() * 0.5, 0.15 + (rr / radius) * 0.5, a), at: (rr / radius) * freezeAt });
    }
    // ground frost disc
    const frost = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.95, 1.2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    frost.rotation.x = -Math.PI / 2; frost.position.set(o.x, o.y + 0.08, o.z); g.add(frost);
    // superheated air dome
    const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.9, 0.2), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    dome.position.copy(o); g.add(dome);
    let t = 0, frozeDone = false, boomed = false;
    const glow = this.light(new THREE.Vector3(o.x, o.y + 4, o.z), 0, radius * 2.5, boomAt + 1.5, 0xff8a30);
    this.effects.push({ update: (dt) => {
      t += dt;
      glow.userData.life = Math.max(glow.userData.life, 0.2);
      if (!boomed) {
        for (const s of spikes) {
          const k = Math.min(1, Math.max(0, (t - s.at) / 0.12));
          s.m.scale.y = Math.max(0.001, s.m.userData.h * k);
          if (k > 0 && k < 1 && R() < 0.25) { const p = s.m.position; this.fire.emit(p.x, p.y + 0.3, p.z, (R() - 0.5) * 3, 1 + R() * 3, (R() - 0.5) * 3, 0.5, 0.3, 0.05, ICE2, CLEAR, 2, -8); }
        }
        frost.material.opacity = Math.min(0.35, t / freezeAt * 0.35);
        if (t < freezeAt) { this.shake(0.04); for (let i = 0; i < 4; i++) { const a = R() * 6.283, rr = (t / freezeAt) * radius; this.smoke.emit(o.x + Math.cos(a) * rr, o.y + 0.3, o.z + Math.sin(a) * rr, Math.cos(a) * 4, 0.6, Math.sin(a) * 4, 1.4, 1.5, 3.5, [0.85, 0.93, 1, 0.45], [0.9, 0.95, 1, 0], 1.2, 0); } }
        if (!frozeDone && t >= freezeAt) { frozeDone = true; if (onFreeze) onFreeze(); }
        // superheating: the air above the ice starts to glow and boil
        if (t > freezeAt + 0.1) {
          const k = Math.min(1, (t - freezeAt - 0.1) / (boomAt - freezeAt - 0.1));
          dome.material.opacity = 0.05 + k * 0.28 + Math.sin(t * 30) * 0.03 * k;
          glow.intensity = 10 + k * 70;
          for (let i = 0; i < 4 + k * 14; i++) {
            const a = R() * 6.283, rr = Math.sqrt(R()) * radius;
            this.fire.emit(o.x + Math.cos(a) * rr, o.y + 2 + R() * radius * 0.5, o.z + Math.sin(a) * rr, (R() - 0.5), 1 + R() * 2, (R() - 0.5), 0.6 + R() * 0.5, 0.5 + k * 1.2, 0.2, R() < 0.3 ? WHITE : FLAME, DARK, 0.5, 1.2);
          }
          this.shake(0.02 + k * 0.05);
        }
      }
      if (!boomed && t >= boomAt) {
        boomed = true;
        // THERMOBARIC: the trapped air detonates everywhere at once
        for (const s of spikes) { if (R() < 0.35) { const p = s.m.position; for (let i = 0; i < 3; i++) this.fire.emit(p.x, p.y + 0.5, p.z, (R() - 0.5) * 14, 4 + R() * 10, (R() - 0.5) * 14, 0.6 + R() * 0.4, 0.2, 0.05, ICE, CLEAR, 1, -16); } }
        g.remove(...spikes.map((s) => s.m));
        for (let i = 0; i < 9; i++) { const a = R() * 6.283, rr = Math.sqrt(R()) * radius * 0.85; const p = new THREE.Vector3(o.x + Math.cos(a) * rr, 0, o.z + Math.sin(a) * rr); p.y = this.world.groundAt(p.x, p.z, o.y + 6) + 1; setTimeout(() => this.explosion(p, 4 + R() * 3, 1.8), i * 35); }
        this.explosion(new THREE.Vector3(o.x, o.y + 1, o.z), radius * 0.4, 3);
        this.shockwave(o, radius * 1.6, 1.2);
        this.debris(o, 70, 26);
        this.light(new THREE.Vector3(o.x, o.y + 8, o.z), 500, radius * 6, 1.2, 0xffb060);
        this.shake(1.3);
        if (onBoom) onBoom();
      }
      if (boomed) {
        const bt = t - boomAt;
        dome.material.opacity = Math.max(0, 0.7 - bt * 1.2); dome.scale.setScalar(1 + bt * 0.6);
        frost.material.opacity = Math.max(0, 0.35 - bt);
        if (bt < 1.2) for (let i = 0; i < 20; i++) { const a = R() * 6.283, rr = Math.sqrt(R()) * radius; this.fire.emit(o.x + Math.cos(a) * rr, o.y + R() * 6, o.z + Math.sin(a) * rr, (R() - 0.5) * 4, 3 + R() * 6, (R() - 0.5) * 4, 0.5 + R() * 0.5, 2 + R() * 2, 1, R() < 0.3 ? WHITE : FLAME, DARK, 1, 2); }
        if (bt > 1.8) { this.scene.remove(g); frost.geometry.dispose(); frost.material.dispose(); dome.geometry.dispose(); dome.material.dispose(); return false; }
      }
      return true;
    } });
  },
});

export { Fx };
