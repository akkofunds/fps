import { BAL, ADMIN } from './balance.js';
import * as THREE from 'three';
import { ULT_COST } from '../config.js';
import { MeleeCombo } from './melee.js';

// KINE SLAYER: no cursed energy at all. Heavenly Restriction traded it for a body that outruns
// sorcery, and the Inverted Spear of Heaven cuts through any technique. Pure movement and offense:
// no shields, no heals.
//   Passive Heavenly Restriction · LMB Spear Strikes · E Flash Step · C Skyfall
//   V Inverted Spear · X Heavenly Severance (admin-only character)
export const KINE = {
  id: 'kineslayer',
  name: 'KINE SLAYER',
  role: 'SORCERER KILLER',
  model: 'models/kineslayer.glb',
  color: '#d5dbe3',
  // Heavenly Restriction: runs faster, a third jump in the air, three dash charges that refill faster
  perk: { speed: 1.08, airJumps: 2, dashMax: 3, dashRate: 1.1 },
  bio: 'Born with zero cursed energy, he was paid back in flesh: a body so fast, strong and sharp-sensed that sorcerers never see him coming. He carries the Inverted Spear of Heaven, a blade that cancels any technique it touches, and he never stops moving.',
  abilities: [
    { key: 'LMB', id: 'm1', name: 'Spear Strikes', desc: 'M1: a 4-hit string with the Inverted Spear: forehand slash, backhand slash, rising cut, then a lunging thrust that launches. Longer reach than fists, every hit stuns, and each swing steps you in if they are right in front of you.' },
    { key: 'Q', id: 'dash', name: 'Heavenly Restriction', desc: 'Passive: you move 8% faster, have THREE dash charges, and can jump twice in the air. Burst in the direction you are moving with Q.' },
    { key: 'E', id: 'flash', name: 'Flash Step', cd: 7, desc: 'Move faster than the eye can follow: blink 12 m toward your crosshair, cutting every enemy you pass through (24 damage, a short stun).' },
    { key: 'C', id: 'skyfall', name: 'Skyfall', cd: 9, desc: 'Launch yourself high into the air, then dive spear-first onto the spot you aim at: the impact hits everyone around it (34 damage), stuns them and throws them up.' },
    { key: 'V', id: 'nullify', name: 'Inverted Spear', cd: 12, desc: 'A lunging thrust with the Inverted Spear of Heaven (40 damage). The first enemy it pierces has their technique nullified: whatever ability they were winding up is cancelled.' },
    { key: 'X', id: 'sever', name: 'Heavenly Severance', ult: true, cost: ULT_COST, desc: 'ULTIMATE — Lock onto the enemy under your crosshair (up to 16 m) and vanish: five cuts from five directions in under a second, then a thrust that launches them (94 damage in total). No target in range: a long severing dash.' },
  ],
};

export const SPEAR_M1 = {
  hits: [
    { anim: 'ksA', at: 0.08, dmg: 9, stun: 0.55, kb: 2.4, up: 0, sfx: 'slash' },
    { anim: 'ksB', at: 0.08, dmg: 10, stun: 0.55, kb: 2.4, up: 0, sfx: 'slash' },
    { anim: 'ksC', at: 0.1, dmg: 10, stun: 0.6, kb: 2.8, up: 0, sfx: 'slash' },
    { anim: 'ksD', at: 0.13, dmg: 14, stun: 0.9, kb: 15, up: 6.5, sfx: 'slash', fin: true, atY: 1.2 },
  ],
  gap: 0.3, window: 1.0, endlag: 0.85, range: 3.1, cone: 0.4, seek: 3.3, seekCone: 0.82, stop: 1.75, lungeMax: 11,
};
export const FLASH = { dist: 12, time: 0.2, hitR: 1.6, dmg: 24, stun: 0.35 };
export const SKYFALL = { up: 15, fwd: 7, apex: 0.5, range: 18, dive: 40, radius: 3.8, dmg: 34, stun: 0.6 };
export const NULLIFY = { charge: 0.12, dist: 8, time: 0.18, hitR: 1.5, dmg: 40, stun: 0.5 };
export const SEVER = { range: 16, cone: 0.93, cuts: 5, gap: 0.15, cutDmg: 12, finDmg: 34, radius: 2.4, stun: 0.6, missDist: 16, missDmg: 40 };

const COOLDOWN = { flash: 7, skyfall: 9, nullify: 12 };
const cdOf = (base) => (BAL.noCooldowns ? 0 : base * BAL.cd);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export class KineSlayerKit {
  constructor(match) {
    this.m = match;
    this.def = KINE;
    this.cd = { flash: 0, skyfall: 0, nullify: 0 };
    this.max = { ...COOLDOWN };
    this.ult = 0;
    this.pending = [];
    this.busy = 0;
    this.ultReadyAnnounced = false;
    this.melee = new MeleeCombo(this, 'spear', SPEAR_M1);
    this.sweep = null; // an active cutting dash: { kind, t, from, dir, hit:Set }
    this.sky = null;   // Skyfall state
  }

  reset() { for (const k in this.cd) this.cd[k] = 0; this.pending.length = 0; this.busy = 0; this.sweep = null; this.sky = null; }
  slots() { return [['flash', 'E'], ['skyfall', 'C'], ['nullify', 'V'], ['sever', 'X']]; }
  addUlt(v) {
    this.ult = Math.min(ULT_COST, this.ult + v);
    if (this.ult >= ULT_COST && !this.ultReadyAnnounced) { this.ultReadyAnnounced = true; this.m.onUltReady(); }
  }

  update(dt, input) {
    const m = this.m;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.busy = Math.max(0, this.busy - dt);
    this.addUlt(dt * 0.35 * BAL.ult);
    if (BAL.infiniteUlt || ADMIN.ult) this.ult = Math.max(this.ult, 100);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) { this.pending.splice(i, 1); if (m.local.alive) p.fn(); }
    }
    if (this.sweep) this._sweepTick(dt);
    if (this.sky) this._skyTick(dt);
    if (!m.local.alive || !m.controlsActive) return;
    const pr = input.pressed;
    const buf = this.buf || (this.buf = { e: 0, c: 0, v: 0, x: 0 });
    for (const k in buf) buf[k] = pr[k] ? 0.4 : Math.max(0, buf[k] - dt);
    const go = (k, fn) => { if (buf[k] > 0 && this.busy <= 0) { buf[k] = 0; fn(); } };
    go('e', () => this.flash());
    go('c', () => this.skyfall());
    go('v', () => this.nullify());
    go('x', () => this.sever());
    if (!this.sky) this.melee.update(dt, input);
  }

  _ready(id) {
    if (this.busy > 0) return false;
    if (this.cd[id] > 0) { this.m.app.hud.denied(id); return false; }
    return true;
  }
  _flatAim(out) { const y = this.m.cam.yaw; return out.set(Math.sin(y), 0, Math.cos(y)); }
  _enemies() { const m = this.m; return [...m.ents.values()].filter((e) => e !== m.local && e.alive); }

  // a cutting dash along `dir`: everyone within hitR of the path is cut once
  _startSweep(kind, dir, speed, time, opts = {}) {
    const m = this.m, b = m.body;
    const o = b.pos;
    const free = m.world.raycast(o.x, o.y + 0.9, o.z, dir.x, 0, dir.z, speed * time, 0.3);
    const t = Math.max(0.06, Math.min(time, free / speed));
    b.lunge(dir, speed, t);
    this.sweep = { kind, t, from: o.clone(), dir: dir.clone(), hit: new Set(), first: opts.first, onEnd: opts.onEnd };
    return speed * t;
  }
  _sweepTick(dt) {
    const m = this.m, b = m.body, S = this.sweep;
    S.t -= dt;
    const a = S.from, p = b.pos;
    const R = S.kind === 'nullify' ? NULLIFY.hitR : FLASH.hitR;
    for (const e of this._enemies()) {
      if (S.hit.has(e.n)) continue;
      if (S.kind === 'nullify' && S.hit.size) break;
      // distance from the enemy to the path covered so far (flat), plus a little ahead
      const abx = p.x - a.x + S.dir.x * 0.8, abz = p.z - a.z + S.dir.z * 0.8, l2 = abx * abx + abz * abz || 1e-6;
      const u = Math.max(0, Math.min(1, ((e.pos.x - a.x) * abx + (e.pos.z - a.z) * abz) / l2));
      const dx = e.pos.x - (a.x + abx * u), dz = e.pos.z - (a.z + abz * u);
      if (dx * dx + dz * dz > R * R || Math.abs(e.pos.y - p.y) > 2) continue;
      S.hit.add(e.n);
      const at = new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z);
      if (S.kind === 'flash') {
        m.reportHit(e, FLASH.dmg, 'flash', { stun: FLASH.stun, kb: [S.dir.x * 3, 2, S.dir.z * 3], at });
        m.castAbility({ ab: 'ksHit', p: at.toArray(), d: [S.dir.x, S.dir.z], h: 0, v: e.n });
      } else if (S.kind === 'nullify') {
        m.reportHit(e, NULLIFY.dmg, 'nullify', { stun: NULLIFY.stun, nul: 1, kb: [S.dir.x * 9, 3, S.dir.z * 9], at });
        m.castAbility({ ab: 'nullHit', p: at.toArray(), d: [S.dir.x, S.dir.z], v: e.n });
        // the thrust stops in them
        b.lungeT = 0; b.vel.x *= 0.1; b.vel.z *= 0.1; S.t = 0;
        m.fx.shake(0.35); m.cam.kick += 0.04;
      } else if (S.kind === 'severMiss') {
        m.reportHit(e, SEVER.missDmg, 'severFin', { stun: SEVER.stun, kb: [S.dir.x * 10, 5, S.dir.z * 10], at });
        m.castAbility({ ab: 'ksHit', p: at.toArray(), d: [S.dir.x, S.dir.z], h: 1, v: e.n });
      }
    }
    if (S.t <= 0) { this.sweep = null; if (S.onEnd) S.onEnd(); }
  }

  // ---------------------------------------------------------------- E: Flash Step
  flash() {
    if (!this._ready('flash')) return;
    const m = this.m, b = m.body;
    this.cd.flash = cdOf(COOLDOWN.flash); this.busy = FLASH.time + 0.08;
    const dir = this._flatAim(tmp);
    m.playAnim('ksFlash');
    const o = b.pos.clone();
    const len = this._startSweep('flash', dir, FLASH.dist / FLASH.time, FLASH.time);
    b.vel.y = Math.max(b.vel.y, 0);
    m.castAbility({ ab: 'flash', o: o.toArray(), d: [dir.x, dir.z], l: Math.round(len * 100) / 100 });
    m.sound('blink', o, 0.9, 30);
  }

  // ---------------------------------------------------------------- C: Skyfall
  skyfall() {
    if (!this._ready('skyfall')) return;
    const m = this.m, b = m.body;
    this.cd.skyfall = cdOf(COOLDOWN.skyfall); this.busy = 0.3;
    const f = this._flatAim(tmp);
    b.vel.set(f.x * SKYFALL.fwd, SKYFALL.up, f.z * SKYFALL.fwd);
    b.grounded = false; b.dashT = 0; b.lungeT = 0;
    this.sky = { phase: 'up', t: 0 };
    m.playAnim('ksLeap');
    const o = b.pos;
    m.castAbility({ ab: 'skyLeap', o: [o.x, o.y, o.z] });
  }
  _skyTick(dt) {
    const m = this.m, b = m.body, S = this.sky;
    S.t += dt;
    if (S.phase === 'up') {
      this.busy = Math.max(this.busy, 0.1);
      if (S.t >= SKYFALL.apex || (b.vel.y <= 1 && S.t > 0.2)) {
        // dive at the ground point under the crosshair (in range)
        const me = b.pos;
        tmp.copy(m.aimPoint); tmp2.set(tmp.x - me.x, 0, tmp.z - me.z);
        let d = tmp2.length();
        if (d < 0.5) { this._flatAim(tmp2); d = 2; } else tmp2.divideScalar(d);
        d = Math.min(SKYFALL.range, d);
        let tx = me.x + tmp2.x * d, tz = me.z + tmp2.z * d;
        // aim assist: an enemy under the crosshair, or standing near where it points, is the target
        let snap = m.aimEnt && m.aimEnt.alive && Math.hypot(m.aimEnt.pos.x - me.x, m.aimEnt.pos.z - me.z) <= SKYFALL.range + 2 ? m.aimEnt : null;
        if (!snap) {
          let bd = 2.5;
          for (const e of this._enemies()) { const dd = Math.hypot(e.pos.x - tx, e.pos.z - tz); if (dd < bd) { bd = dd; snap = e; } }
        }
        if (snap) { tx = snap.pos.x; tz = snap.pos.z; }
        const ty = m.world.groundAt(tx, tz, me.y + 2);
        S.target = new THREE.Vector3(tx, ty, tz);
        S.dir = new THREE.Vector3(tx - me.x, ty - me.y, tz - me.z).normalize();
        S.phase = 'dive'; S.t = 0;
        m.playAnim('ksDive');
        m.castAbility({ ab: 'skyDive', o: me.toArray(), c: S.target.toArray() });
      }
      return;
    }
    // diving: straight at the target, fast
    this.busy = Math.max(this.busy, 0.1);
    b.vel.copy(S.dir).multiplyScalar(SKYFALL.dive);
    const landed = b.grounded || S.t > 1.4 || b.pos.distanceTo(S.target) < 0.6;
    if (!landed) return;
    this.sky = null;
    b.vel.set(0, 0, 0); b.locked = 0.3;
    this.busy = 0.35;
    m.playAnim('ksLand');
    const c = b.pos.clone();
    for (const e of this._enemies()) {
      const dx = e.pos.x - c.x, dz = e.pos.z - c.z, d = Math.hypot(dx, dz);
      if (d > SKYFALL.radius || Math.abs(e.pos.y - c.y) > 2.5) continue;
      const k = d > 0.1 ? 1 / d : 0;
      m.reportHit(e, SKYFALL.dmg, 'slam', { stun: SKYFALL.stun, kb: [dx * k * 5, 8, dz * k * 5], at: new THREE.Vector3(e.pos.x, e.pos.y + 1.1, e.pos.z) });
    }
    m.castAbility({ ab: 'skySlam', c: c.toArray() });
    m.fx.shake(0.5); m.cam.kick += 0.05;
  }

  // ---------------------------------------------------------------- V: Inverted Spear
  nullify() {
    if (!this._ready('nullify')) return;
    const m = this.m, b = m.body;
    this.cd.nullify = cdOf(COOLDOWN.nullify); this.busy = NULLIFY.charge + NULLIFY.time + 0.3;
    m.playAnim('ksThrust');
    b.slow = 0.2;
    const dir = this._flatAim(new THREE.Vector3());
    m.castAbility({ ab: 'nullCast', o: b.pos.toArray(), d: [dir.x, dir.z] });
    this.pending.push({ t: NULLIFY.charge, fn: () => {
      b.slow = 1;
      this._startSweep('nullify', dir, NULLIFY.dist / NULLIFY.time, NULLIFY.time);
      m.sound('slash', b.pos, 0.8, 25);
    } });
  }

  // ---------------------------------------------------------------- X: Heavenly Severance
  sever() {
    const m = this.m, b = m.body;
    if (this.ult < ULT_COST) { m.app.hud.denied('sever'); return; }
    if (this.busy > 0) return;
    this.ult = 0; this.ultReadyAnnounced = false;
    // the enemy under the crosshair, else the one closest to where you face, within range
    const inRange = (e) => e && e.alive && e !== m.local && Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z) <= SEVER.range && Math.abs(e.pos.y - b.pos.y) < 6;
    let tgt = inRange(m.aimEnt) ? m.aimEnt : null;
    if (!tgt) {
      const f = this._flatAim(tmp2);
      let best = SEVER.cone;
      for (const e of this._enemies()) {
        if (!inRange(e)) continue;
        const dx = e.pos.x - b.pos.x, dz = e.pos.z - b.pos.z, d = Math.hypot(dx, dz) || 1;
        const s = (dx * f.x + dz * f.z) / d - d / SEVER.range * 0.25;
        if (s > best) { best = s; tgt = e; }
      }
    }
    m.castAbility({ ab: 'severStart', o: b.pos.toArray(), v: tgt ? tgt.n : -1 });
    if (!tgt) {
      // nobody in reach: one long severing dash
      const dir = this._flatAim(new THREE.Vector3());
      this.busy = 0.5;
      m.playAnim('ksFlash');
      const o = b.pos.clone();
      const len = this._startSweep('severMiss', dir, SEVER.missDist / 0.26, 0.26);
      m.castAbility({ ab: 'flash', o: o.toArray(), d: [dir.x, dir.z], l: Math.round(len * 100) / 100, big: 1 });
      return;
    }
    const total = SEVER.cuts * SEVER.gap + 0.5;
    this.busy = total; b.locked = total;
    const yaw0 = Math.atan2(b.pos.x - tgt.pos.x, b.pos.z - tgt.pos.z);
    for (let i = 0; i <= SEVER.cuts; i++) {
      const fin = i === SEVER.cuts;
      this.pending.push({ t: 0.08 + i * SEVER.gap + (fin ? 0.12 : 0), fn: () => {
        if (!tgt.alive) return;
        // blink to a new side of the target and cut through
        const a = fin ? yaw0 : yaw0 + Math.PI + (i % 2 ? 1 : -1) * (0.9 + i * 0.55);
        const r = fin ? 1.6 : SEVER.radius;
        const from = b.pos.clone();
        const x = tgt.pos.x + Math.sin(a) * r, z = tgt.pos.z + Math.cos(a) * r;
        const y = m.world.groundAt(x, z, tgt.pos.y + 2);
        const face = Math.atan2(tgt.pos.x - x, tgt.pos.z - z);
        b.teleport(x, Math.max(y, tgt.pos.y), z, face);
        m.cam.yaw = face; m.faceLockT = 0.3;
        m.playAnim(fin ? 'ksD' : ['ksA', 'ksB', 'ksC'][i % 3]);
        const dir = [Math.sin(face), Math.cos(face)];
        const at = new THREE.Vector3(tgt.pos.x, tgt.pos.y + 1.2, tgt.pos.z);
        m.castAbility({ ab: 'severCut', f: from.toArray(), o: [x, b.pos.y, z], p: at.toArray(), d: dir, i, fin: fin ? 1 : 0, v: tgt.n });
        m.reportHit(tgt, fin ? SEVER.finDmg : SEVER.cutDmg, fin ? 'severFin' : 'sever', fin ? { stun: SEVER.stun, kb: [dir[0] * 16, 8, dir[1] * 16], at } : { stun: SEVER.stun, at });
        m.fx.shake(fin ? 0.6 : 0.2); m.cam.kick += fin ? 0.06 : 0.015;
        if (fin) m.app.hud.dashImpact();
      } });
    }
  }
}
