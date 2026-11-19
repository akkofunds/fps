import { BAL, ADMIN } from './balance.js';
import * as THREE from 'three';
import { ULT_COST } from '../config.js';
import { PROJ } from './projectiles.js';

// SORCERER — the strongest. Limitless: space itself bends around him.
//   LMB Cursed Flick · E Lapse: Blue · C Reversal: Red · V Hollow Purple
//   X Domain Expansion: Unlimited Void (admin-only character)
export const SORCERER = {
  id: 'sorcerer',
  name: 'SORCERER',
  role: 'THE STRONGEST',
  model: 'models/sorcerer.glb',
  color: '#8fd8ff',
  bio: 'The strongest sorcerer alive. Limitless bends space around him: Blue drags everything into a single point, Red blows it apart, and the two together become Hollow Purple, imaginary mass that erases whatever it passes through. When he opens his domain, there is nowhere left to run.',
  abilities: [
    { key: 'LMB', id: 'flick', name: 'Cursed Flick', desc: 'Flick a dart of compressed cursed energy off your fingertips, alternating hands. 16 damage, 24 on headshots.' },
    { key: 'Q', id: 'dash', name: 'Blink Step', desc: 'Burst a short distance in the direction you are moving. 2 charges. Press jump again in the air to double jump.' },
    { key: 'E', id: 'blue', name: 'Lapse: Blue', cd: 9, desc: 'Create a point of attraction where you aim. Everything nearby is dragged into it and ground down, then it collapses.' },
    { key: 'C', id: 'red', name: 'Reversal: Red', cd: 8, desc: 'Condense repulsion at your fingertip and fire it: a shot that detonates on impact and blasts everyone around it away (46 + splash).' },
    { key: 'V', id: 'purple', name: 'Hollow Purple', cd: 16, desc: 'Open your arms to draw out Blue and Red, bring them together and release imaginary mass: a huge sphere that tears straight through everything in its path (95 damage).' },
    { key: 'X', id: 'domain', name: 'Domain Expansion: Unlimited Void', ult: true, cost: ULT_COST, desc: 'ULTIMATE — Expand your domain. Everyone caught inside is trapped in the void: frozen for a moment, then slowed and dealing 40% less damage for 9 s, while your cooldowns run twice as fast.' },
  ],
};

export const FLICK = { cd: 0.3 };
export const BLUE = { range: 32, delay: 0.22, life: 1.9, pullR: 9, crushR: 3.4, pull: 24, tick: 0.3, tickDmg: 6, implode: 22 };
export const RED = { charge: 0.36, radius: 3.8, splash: 32, minSplash: 12, kb: 15 };
// charge = the model's own Hollow Purple animation up to the release (retargeted, ~1.9x speed)
export const PURPLE = { charge: 2.62, orbsAt: 0.8, speed: 26, len: 70, radius: 3.0, dmg: 95 };
export const VOID = { cine: 5.6, radius: 30, dur: 9, enemyDmg: 0.6, enemySlow: 0.62, cdBoost: 2, stun: 1.2, dmg: 10 };

const COOLDOWN = { flick: FLICK.cd, blue: 9, red: 8, purple: 16 };
const cdOf = (base) => (BAL.noCooldowns ? (base < 1 ? base * 0.6 : 0) : base * (base < 1 ? Math.max(0.6, BAL.cd) : BAL.cd));
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export class SorcererKit {
  constructor(match) {
    this.m = match;
    this.def = SORCERER;
    this.cd = { flick: 0, blue: 0, red: 0, purple: 0 };
    this.max = { blue: COOLDOWN.blue, red: COOLDOWN.red, purple: COOLDOWN.purple };
    this.ult = 0;
    this.side = 1;
    this.pending = [];
    this.busy = 0;
    this.ultReadyAnnounced = false;
  }

  reset() { for (const k in this.cd) this.cd[k] = 0; this.pending.length = 0; this.busy = 0; }
  slots() { return [['blue', 'E'], ['red', 'C'], ['purple', 'V'], ['domain', 'X']]; }
  addUlt(v) {
    this.ult = Math.min(ULT_COST, this.ult + v);
    if (this.ult >= ULT_COST && !this.ultReadyAnnounced) { this.ultReadyAnnounced = true; this.m.onUltReady(); }
  }

  update(dt, input) {
    const m = this.m;
    // inside his own domain every cooldown runs twice as fast
    const boost = m.domainBoost && m.domainBoost(m.local) ? VOID.cdBoost : 1;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt * boost);
    this.busy = Math.max(0, this.busy - dt);
    this.addUlt(dt * 0.35 * BAL.ult);
    if (BAL.infiniteUlt || ADMIN.ult) this.ult = Math.max(this.ult, 100);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) { this.pending.splice(i, 1); if (m.local.alive) p.fn(); }
    }
    if (!m.local.alive || !m.controlsActive) return;
    const pr = input.pressed;
    const buf = this.buf || (this.buf = { e: 0, c: 0, v: 0, x: 0 });
    for (const k in buf) buf[k] = pr[k] ? 0.4 : Math.max(0, buf[k] - dt);
    const go = (k, fn) => { if (buf[k] > 0 && this.busy <= 0) { buf[k] = 0; fn(); } };
    go('e', () => this.blue());
    go('c', () => this.red());
    go('v', () => this.purple());
    go('x', () => this.domain());
    if (input.state.fire || pr.fire) this.flick();
  }

  _ready(id) {
    if (this.busy > 0) return false;
    if (this.cd[id] > 0) { if (id !== 'flick') this.m.app.hud.denied(id); return false; }
    return true;
  }
  _aimDir(origin, out) {
    out.copy(this.m.aimPoint).sub(origin);
    const d = out.length();
    if (d < 2) out.copy(this.m.cam.fwd); else out.divideScalar(d);
    return out;
  }
  _groundTarget(range) {
    const m = this.m, me = m.local.pos;
    tmp.copy(m.aimPoint);
    tmp2.set(tmp.x - me.x, 0, tmp.z - me.z);
    const d = tmp2.length();
    if (d > range) { tmp2.multiplyScalar(range / d); tmp.set(me.x + tmp2.x, me.y, me.z + tmp2.z); }
    return new THREE.Vector3(tmp.x, m.world.groundAt(tmp.x, tmp.z, tmp.y + 2), tmp.z);
  }

  // ---------------------------------------------------------------- LMB: Cursed Flick (alternating hands)
  flick() {
    if (!this._ready('flick')) return;
    const m = this.m;
    this.cd.flick = cdOf(COOLDOWN.flick);
    const hand = this.side > 0 ? 'R' : 'L';
    this.side = -this.side;
    m.playAnim('cast', { anim: hand === 'R' ? 'boltR' : 'boltL' });
    this.pending.push({ t: 0.05, fn: () => {
      const o = m.view.palmWorld(hand, tmp);
      const dir = this._aimDir(o, tmp2);
      m.fx.cursedBurst(o, dir, 0.7);
      const v = dir.multiplyScalar(PROJ.flick.speed);
      m.castAbility({ ab: 'flick', o: [o.x, o.y, o.z], d: [v.x, v.y, v.z] });
      m.sound('flick', o, 0.5, 30);
      m.cam.kick += 0.005;
    } });
  }

  // ---------------------------------------------------------------- E: Lapse: Blue
  blue() {
    if (!this._ready('blue')) return;
    const m = this.m;
    this.cd.blue = cdOf(COOLDOWN.blue); this.busy = 0.35;
    m.playAnim('cast', { anim: 'gBlue' });
    // a point in the air where the crosshair meets the world (never inside the ground)
    const c = this._groundTarget(BLUE.range);
    c.y += 1.3;
    this.pending.push({ t: 0.1, fn: () => {
      const hand = m.view.palmWorld('L', tmp);
      m.castAbility({ ab: 'blue', c: [c.x, c.y, c.z], o: [hand.x, hand.y, hand.z] });
    } });
  }

  // ---------------------------------------------------------------- C: Reversal: Red
  red() {
    if (!this._ready('red')) return;
    const m = this.m;
    this.cd.red = cdOf(COOLDOWN.red); this.busy = 0.6;
    m.body.slow = 0.4; this.pending.push({ t: 0.6, fn: () => { m.body.slow = 1; } });
    m.playAnim('cast', { anim: 'gRed' });
    m.castAbility({ ab: 'redCharge' });
    this.pending.push({ t: RED.charge, fn: () => {
      const o = m.view.palmWorld('R', tmp);
      const dir = this._aimDir(o, tmp2);
      const v = dir.multiplyScalar(PROJ.red.speed);
      m.castAbility({ ab: 'red', o: [o.x, o.y, o.z], d: [v.x, v.y, v.z] });
      m.cam.kick += 0.03; m.fx.shake(0.15);
    } });
  }

  // ---------------------------------------------------------------- V: Hollow Purple
  purple() {
    if (!this._ready('purple')) return;
    const m = this.m, b = m.body;
    this.cd.purple = cdOf(COOLDOWN.purple); this.busy = PURPLE.charge + 0.45;
    b.locked = PURPLE.charge + 0.25; b.vel.x *= 0.15; b.vel.z *= 0.15;
    m.playAnim('purple');
    m.castAbility({ ab: 'purpleCharge' });
    this.pending.push({ t: PURPLE.charge, fn: () => {
      // launched from in front of his chest, flat toward the crosshair
      const p = m.local.pos;
      const o = new THREE.Vector3(p.x, p.y + 1.35, p.z);
      const dir = this._aimDir(o, tmp2);
      dir.y = Math.max(-0.25, Math.min(0.25, dir.y)); dir.normalize();
      o.addScaledVector(dir, 1.6);
      m.castAbility({ ab: 'purple', o: [o.x, o.y, o.z], d: [dir.x, dir.y, dir.z] });
      m.cam.kick += 0.08; m.fx.shake(0.5);
    } });
  }

  // ---------------------------------------------------------------- X: Domain Expansion — Unlimited Void
  domain() {
    const m = this.m;
    if (this.ult < ULT_COST) { m.app.hud.denied('domain'); return; }
    if (this.busy > 0) return;
    this.ult = 0; this.ultReadyAnnounced = false;
    this.busy = VOID.cine + 0.3;
    m.body.locked = VOID.cine; m.body.vel.x *= 0.1; m.body.vel.z *= 0.1;
    m.playAnim('domain');
    const p = m.local.pos;
    // a universal cutscene plays for everyone, then the domain stays open for VOID.dur
    m.castAbility({ ab: 'domain', c: [p.x, p.y, p.z], yaw: Math.round(m.body.yaw * 100) / 100 });
  }
}
