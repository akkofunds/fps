import { BAL, ADMIN } from './balance.js';
import * as THREE from 'three';
import { ULT_COST } from '../config.js';
import { MeleeCombo } from './melee.js';

// KINE SLAYER: no cursed energy at all. Heavenly Restriction traded it for a body that outruns
// sorcery, and the Inverted Spear of Heaven cuts through any technique. No shields, no heals.
//   Passive Heavenly Restriction · LMB Spear Strikes · E Spear Throw / Recall · C Skyfall
//   V Severing Whirlwind · X Heavenly Severance
export const KINE = {
  id: 'kineslayer',
  name: 'KINE SLAYER',
  role: 'SORCERER KILLER',
  model: 'models/kineslayer.glb',
  color: '#d5dbe3',
  // Heavenly Restriction: a little faster than anyone, a third jump in the air
  perk: { speed: 1.03, airJumps: 2, dashMax: 2, dashRate: 0.9 },
  bio: 'Born with zero cursed energy, he was paid back in flesh: a body so fast, strong and sharp-sensed that sorcerers never see him coming. He carries the Inverted Spear of Heaven, a blade that cancels any technique it touches.',
  abilities: [
    { key: 'LMB', id: 'm1', name: 'Spear Strikes', desc: 'M1: a 4-hit string with the Inverted Spear: forehand slash, backhand slash, rising cut, then a lunging thrust that launches. Longer reach than fists, every hit stuns, and each swing steps you in if they are right in front of you.' },
    { key: 'Q', id: 'dash', name: 'Heavenly Restriction', desc: 'Passive: you move 3% faster and can jump twice in the air. Burst in the direction you are moving with Q (2 charges).' },
    { key: 'E', id: 'throw', name: 'Spear Throw', cd: 9, desc: 'Hurl the Inverted Spear at your crosshair (24 damage). The enemy it pierces has their technique nullified, cancelling whatever they were winding up. Press E again (or wait) and it rips back to your hand, cutting everyone on its way (14) and dragging the first one toward you. No spear, no M1 until it is back.' },
    { key: 'C', id: 'skyfall', name: 'Skyfall', cd: 11, desc: 'Launch yourself high into the air, then dive spear-first onto the spot you aim at: the impact hits everyone around it (30 damage), stuns them and throws them up.' },
    { key: 'V', id: 'whirl', name: 'Severing Whirlwind', cd: 11, desc: 'Plant your feet and spin the spear round yourself: five rings of red cuts (6 each) that drag everyone close into the blades. You can still creep around while spinning.' },
    { key: 'X', id: 'sever', name: 'Heavenly Severance', ult: true, cost: ULT_COST, desc: 'ULTIMATE — Sink low while the air goes red, then cut the world twice: a giant horizontal crescent and a giant vertical one rip across the field in front of you, 40 m long, through everyone in their way (52 + 36 damage).' },
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
export const THROW = { speed: 48, range: 34, hitR: 0.9, dmg: 24, stun: 0.35, recallSpeed: 58, recallDmg: 14, recallR: 1.3, pull: 9, auto: 4, windup: 0.2 };
export const SKYFALL = { up: 15, fwd: 7, apex: 0.5, range: 18, dive: 40, radius: 3.6, dmg: 30, stun: 0.55 };
export const WHIRL = { ticks: 5, gap: 0.2, radius: 3.4, dmg: 6, pull: 4, slow: 0.4 };
export const SEVER = { wind: 0.65, gap: 0.38, len: 40, speed: 60, width: 10, dmg1: 52, dmg2: 36, stun: 0.6 };

const COOLDOWN = { throw: 9, skyfall: 11, whirl: 11 };
const cdOf = (base) => (BAL.noCooldowns ? 0 : base * BAL.cd);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export class KineSlayerKit {
  constructor(match) {
    this.m = match;
    this.def = KINE;
    this.cd = { throw: 0, skyfall: 0, whirl: 0 };
    this.max = { ...COOLDOWN };
    this.ult = 0;
    this.pending = [];
    this.busy = 0;
    this.ultReadyAnnounced = false;
    this.melee = new MeleeCombo(this, 'spear', SPEAR_M1);
    this.sky = null;    // Skyfall state
    this.spear = null;  // the thrown spear: { st: 'fly' | 'stuck' | 'back', p, d, t, hit }
    this.waves = [];    // Heavenly Severance crescents in flight
  }

  reset() { for (const k in this.cd) this.cd[k] = 0; this.pending.length = 0; this.busy = 0; this.sky = null; if (this.spear) this._catch(); this.waves.length = 0; }
  slots() { return [['throw', 'E'], ['skyfall', 'C'], ['whirl', 'V'], ['sever', 'X']]; }
  addUlt(v) {
    this.ult = Math.min(ULT_COST, this.ult + v);
    if (this.ult >= ULT_COST && !this.ultReadyAnnounced) { this.ultReadyAnnounced = true; this.m.onUltReady(); }
  }

  update(dt, input) {
    const m = this.m;
    for (const k in this.cd) if (!(k === 'throw' && this.spear)) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.busy = Math.max(0, this.busy - dt);
    this.addUlt(dt * 0.35 * BAL.ult);
    if (BAL.infiniteUlt || ADMIN.ult) this.ult = Math.max(this.ult, 100);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) { this.pending.splice(i, 1); if (m.local.alive) p.fn(); }
    }
    if (this.spear) this._spearTick(dt);
    if (this.waves.length) this._waveTick(dt);
    if (this.sky) this._skyTick(dt);
    if (!m.local.alive || !m.controlsActive) return;
    const pr = input.pressed;
    const buf = this.buf || (this.buf = { e: 0, c: 0, v: 0, x: 0 });
    for (const k in buf) buf[k] = pr[k] ? 0.4 : Math.max(0, buf[k] - dt);
    const go = (k, fn) => { if (buf[k] > 0 && this.busy <= 0) { buf[k] = 0; fn(); } };
    go('e', () => (this.spear ? this._recall() : this.throwSpear()));
    go('c', () => this.skyfall());
    go('v', () => this.whirl());
    go('x', () => this.sever());
    if (!this.sky && !this.spear) this.melee.update(dt, input);
  }

  _ready(id) {
    if (this.busy > 0) return false;
    if (this.cd[id] > 0) { this.m.app.hud.denied(id); return false; }
    return true;
  }
  _flatAim(out) { const y = this.m.cam.yaw; return out.set(Math.sin(y), 0, Math.cos(y)); }
  _enemies() { const m = this.m; return [...m.ents.values()].filter((e) => e !== m.local && e.alive); }
  _aimDir(o, out) {
    out.copy(this.m.aimPoint).sub(o);
    const d = out.length();
    if (d < 2) out.copy(this.m.cam.fwd); else out.divideScalar(d);
    return out;
  }

  // ---------------------------------------------------------------- E: Spear Throw / Recall
  throwSpear() {
    if (!this._ready('throw')) return;
    const m = this.m, b = m.body;
    this.busy = THROW.windup + 0.15;
    m.playAnim('cast', { anim: 'ksThrow' });
    this.pending.push({ t: THROW.windup, fn: () => {
      const o = m.view.handWorld('R', new THREE.Vector3()).add(new THREE.Vector3(0, 0.15, 0));
      const d = this._aimDir(o, new THREE.Vector3());
      this.spear = { st: 'fly', p: o.clone(), d: d.clone(), t: 0, dist: 0, hit: new Set() };
      m.castAbility({ ab: 'spearThrow', o: o.toArray(), d: d.toArray() });
      m.sound('slash', o, 1, 30);
      m.cam.kick += 0.02;
    } });
  }
  _spearTick(dt) {
    const m = this.m, S = this.spear;
    S.t += dt;
    if (S.st === 'fly') {
      const step = THROW.speed * dt;
      const free = m.world.raycast(S.p.x, S.p.y, S.p.z, S.d.x, S.d.y, S.d.z, step, 0);
      const adv = Math.min(step, free);
      const a = S.p.clone();
      S.p.addScaledVector(S.d, adv); S.dist += adv;
      // pierce the first enemy on the segment travelled this frame
      for (const e of this._enemies()) {
        const c = tmp.set(e.pos.x, e.pos.y + 1.0, e.pos.z);
        const ab = tmp2.subVectors(S.p, a), t = Math.max(0, Math.min(1, c.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
        if (c.distanceTo(a.clone().addScaledVector(ab, t)) > THROW.hitR) continue;
        m.reportHit(e, THROW.dmg, 'spearThrow', { stun: THROW.stun, nul: 1, kb: [S.d.x * 4, 2, S.d.z * 4], at: c.clone() });
        m.castAbility({ ab: 'nullHit', p: [c.x, c.y, c.z], d: [S.d.x, S.d.z], v: e.n });
        S.hit.add(e.n);
        this._stick(c.clone().addScaledVector(S.d, 0.5));
        return;
      }
      if (adv < step - 1e-3 || S.dist >= THROW.range) this._stick(S.p.clone());
    } else if (S.st === 'stuck') {
      if (S.t >= THROW.auto) this._recall();
    } else if (S.st === 'back') {
      const hand = m.view.handWorld('R', new THREE.Vector3());
      const to = hand.clone().sub(S.p), d = to.length();
      const step = THROW.recallSpeed * dt;
      const a = S.p.clone();
      if (d <= step + 0.3) { this._catch(); return; }
      S.p.addScaledVector(to.divideScalar(d), step);
      // the way back cuts everyone in the line and drags the first one in
      for (const e of this._enemies()) {
        if (S.hit.has('r' + e.n)) continue;
        const c = tmp.set(e.pos.x, e.pos.y + 1.0, e.pos.z);
        const ab = tmp2.subVectors(S.p, a), t = Math.max(0, Math.min(1, c.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
        if (c.distanceTo(a.clone().addScaledVector(ab, t)) > THROW.recallR) continue;
        S.hit.add('r' + e.n);
        const pull = S.pulled ? 0 : THROW.pull; S.pulled = true;
        const dx = hand.x - e.pos.x, dz = hand.z - e.pos.z, dl = Math.hypot(dx, dz) || 1;
        m.reportHit(e, THROW.recallDmg, 'spearRecall', { stun: 0.3, kb: [dx / dl * pull, 3, dz / dl * pull], at: c.clone() });
        m.castAbility({ ab: 'ksHit', p: [c.x, c.y, c.z], d: [dx / dl, dz / dl], h: 0, v: e.n });
      }
    }
  }
  _stick(p) {
    const S = this.spear;
    S.st = 'stuck'; S.t = 0; S.p.copy(p);
    this.m.castAbility({ ab: 'spearStick', p: p.toArray() });
  }
  _recall(silent) {
    const S = this.spear;
    if (!S || S.st === 'back') return;
    if (S.st === 'fly') this._stick(S.p.clone());
    S.st = 'back'; S.t = 0;
    this.m.castAbility({ ab: 'spearRecall', p: S.p.toArray() });
    if (!silent) this.m.playAnim('cast', { anim: 'ksCatch' });
  }
  _catch() {
    this.spear = null;
    this.cd.throw = cdOf(COOLDOWN.throw);
    this.m.castAbility({ ab: 'spearCatch' });
  }

  // ---------------------------------------------------------------- C: Skyfall
  skyfall() {
    if (!this._ready('skyfall')) return;
    const m = this.m, b = m.body;
    this.cd.skyfall = cdOf(COOLDOWN.skyfall); this.busy = 0.3;
    if (this.spear) this._recall(true);
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

  // ---------------------------------------------------------------- V: Severing Whirlwind
  whirl() {
    if (!this._ready('whirl')) return;
    if (this.spear) { this.m.app.hud.denied('whirl'); return; }
    const m = this.m, b = m.body;
    this.cd.whirl = cdOf(COOLDOWN.whirl);
    const dur = WHIRL.ticks * WHIRL.gap + 0.2;
    this.busy = dur; b.slow = WHIRL.slow;
    m.playAnim('ksWhirl');
    m.castAbility({ ab: 'whirl', o: b.pos.toArray(), n: WHIRL.ticks, g: WHIRL.gap });
    for (let i = 0; i < WHIRL.ticks; i++) {
      this.pending.push({ t: 0.08 + i * WHIRL.gap, fn: () => {
        const c = b.pos;
        for (const e of this._enemies()) {
          const dx = e.pos.x - c.x, dz = e.pos.z - c.z, d = Math.hypot(dx, dz);
          if (d > WHIRL.radius || Math.abs(e.pos.y - c.y) > 2.2) continue;
          const k = d > 0.3 ? -WHIRL.pull / d : 0;   // drawn in toward the blades
          m.reportHit(e, WHIRL.dmg, 'whirl', { stun: 0.25, kb: [dx * k * 0.25, 1, dz * k * 0.25], at: new THREE.Vector3(e.pos.x, e.pos.y + 1.1, e.pos.z) });
        }
        m.fx.shake(0.08);
      } });
    }
    this.pending.push({ t: dur, fn: () => { b.slow = 1; } });
  }

  // ---------------------------------------------------------------- X: Heavenly Severance
  sever() {
    const m = this.m, b = m.body;
    if (this.ult < ULT_COST) { m.app.hud.denied('sever'); return; }
    if (this.busy > 0) return;
    this.ult = 0; this.ultReadyAnnounced = false;
    if (this.spear) this._recall(true);
    const total = SEVER.wind + SEVER.gap + 0.55;
    this.busy = total; b.locked = total; b.vel.x *= 0.2; b.vel.z *= 0.2;
    m.playAnim('ksSever');
    const o = b.pos.clone(), d = this._flatAim(new THREE.Vector3());
    m.castAbility({ ab: 'severWind', o: o.toArray(), d: [d.x, d.z] });
    // two crescents: flat, then upright, both racing down the same line
    for (const [k, vert] of [[0, false], [1, true]]) {
      this.pending.push({ t: SEVER.wind + k * SEVER.gap, fn: () => {
        const p = b.pos.clone();
        this.waves.push({ o: p, d: d.clone(), s: 0, vert, hit: new Set(), dmg: vert ? SEVER.dmg2 : SEVER.dmg1 });
        m.castAbility({ ab: 'severWave', o: p.toArray(), d: [d.x, d.z], v: vert ? 1 : 0 });
        m.fx.shake(vert ? 0.6 : 0.45); m.cam.kick += 0.05;
        m.app.hud.dashImpact();
      } });
    }
  }
  _waveTick(dt) {
    const m = this.m;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const W = this.waves[i];
      const s0 = W.s; W.s = Math.min(SEVER.len, W.s + SEVER.speed * dt);
      const side = tmp2.set(-W.d.z, 0, W.d.x);
      for (const e of this._enemies()) {
        if (W.hit.has(e.n)) continue;
        const rx = e.pos.x - W.o.x, rz = e.pos.z - W.o.z;
        const along = rx * W.d.x + rz * W.d.z, lat = Math.abs(rx * side.x + rz * side.z);
        if (along < s0 - 1 || along > W.s + 1) continue;
        if (lat > (W.vert ? 2.2 : SEVER.width / 2) || Math.abs(e.pos.y - W.o.y) > (W.vert ? 6 : 2.6)) continue;
        W.hit.add(e.n);
        const at = new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z);
        m.reportHit(e, W.dmg, W.vert ? 'severWave2' : 'severWave', { stun: SEVER.stun, kb: W.vert ? [W.d.x * 6, 11, W.d.z * 6] : [W.d.x * 12, 3, W.d.z * 12], at });
        m.castAbility({ ab: 'ksHit', p: at.toArray(), d: [W.d.x, W.d.z], h: 1, v: e.n });
      }
      if (W.s >= SEVER.len) this.waves.splice(i, 1);
    }
  }
}
