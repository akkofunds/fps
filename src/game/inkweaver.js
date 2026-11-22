import { BAL, ADMIN } from './balance.js';
import * as THREE from 'three';
import { ULT_COST } from '../config.js';
import { MeleeCombo } from './melee.js';

// INKWEAVER (Yixuan) — a master of the Yunkui Summit's ink-wash arts: golden ink that takes the
// shape of wings, clouds and talismans. Her kit mirrors the Sorcerer's in spirit (a pulling orb, a
// repelling blast, a sky-clearing finale) in black ink edged with gold.
//   LMB Ink Palms · Q Cloud Step · E Ink Manifestation · C Cloud-Shaper · V Qingming Eruption
//   X Endless Talisman Suppression (admin-only character)
export const INKWEAVER = {
  id: 'inkweaver',
  name: 'INKWEAVER',
  role: 'MASTER OF YUNKUI',
  model: 'models/inkweaver.glb',
  color: '#f2c45a',
  perk: { speed: 1.03, airJumps: 1, dashMax: 2, dashRate: 1.1 },
  bio: 'The master of Yunkui Summit. Her ink is never just ink: a stroke of it becomes wings, a swirl becomes a storm cloud, and a single talisman can hold a mountain down. Calm, unhurried, and very, very thorough.',
  abilities: [
    { key: 'LMB', id: 'm1', name: 'Ink Palms', desc: 'M1: a 4-hit string of open-palm strikes trailing golden ink: palm, backhand, rising palm, then a double palm that launches. Every hit stuns and each swing steps you in.' },
    { key: 'Q', id: 'dash', name: 'Cloud Step', desc: 'Drift a short distance on a wisp of ink. 2 charges. Press jump again in the air to double jump.' },
    { key: 'E', id: 'rush', name: 'Ink Manifestation', cd: 8, desc: 'Dash forward and strike three times: a palm strike, a giant golden-black ink wing slash, then a second wing that slams them into the ground. Each hit stuns; the last knocks them down and back (10 + 10 + 18).' },
    { key: 'C', id: 'orb', name: 'Cloud-Shaper', cd: 10, desc: 'Conjure a spinning sphere of condensed golden ink where you aim. It drags everyone nearby into its centre and shreds them with ink blades, then bursts outward.' },
    { key: 'V', id: 'erupt', name: 'Qingming Eruption', cd: 14, desc: 'A golden Tai Chi array opens under your feet and huge ink wings spread behind you, then a vast wave of ink and light erupts forward. Guard-breaking: everyone in front is launched (36).' },
    { key: 'X', id: 'talisman', name: 'Endless Talisman Suppression', ult: true, cost: ULT_COST, desc: 'ULTIMATE — Rise into the sky on giant ink wings and call down thousands of golden talismans across a huge area, each one a pillar of light, ending in a colossal ink explosion. Massive damage to everyone in range.' },
  ],
};

// the M1 string: open palms
export const INK_M1 = {
  hits: [
    { anim: 'm1a', at: 0.07, dmg: 9, stun: 0.55, kb: 2.2, up: 0, hand: 'R' },
    { anim: 'm1b', at: 0.08, dmg: 9, stun: 0.55, kb: 2.4, up: 0, hand: 'L' },
    { anim: 'm1c', at: 0.12, dmg: 10, stun: 0.6, kb: 2.6, up: 1.5, hand: 'R' },
    { anim: 'm1d', at: 0.16, dmg: 15, stun: 0.9, kb: 15, up: 7, hand: 'R', fin: true },
  ],
  gap: 0.3, window: 1.0, endlag: 0.85, range: 2.9, cone: 0.4, seek: 3.0, seekCone: 0.82, lungeMax: 11,
};
export const RUSH = { dash: 7, dashT: 0.16, beats: [0.2, 0.42, 0.66], range: 3.3, cone: 0.25, dmg: [10, 10, 18], stun: [0.6, 0.6, 0.9] };
export const ORB = { range: 30, delay: 0.25, life: 2.2, pullR: 9.5, coreR: 3.2, pull: 22, tick: 0.25, tickDmg: 3, burst: 16, burstR: 6, burstKb: 14 };
export const ERUPT = { charge: 0.62, len: 18, width: 3.6, near: 4.2, dmg: 36, up: 11, kb: 18 };
export const TALISMAN = { cine: 10.2, rain: [4.4, 8.2], radius: 34, strikes: 10, strikeDmg: 6, boom: 8.8, boomDmg: 90, boomR: 34 };
// the front-on wing shot of the ultimate (the reference art), seconds into the cutscene
export const WING_SHOT = [2.4, 4.4];

const COOLDOWN = { rush: 8, orb: 10, erupt: 14 };
const cdOf = (base) => (BAL.noCooldowns ? 0 : base * BAL.cd);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export class InkweaverKit {
  constructor(match) {
    this.m = match;
    this.def = INKWEAVER;
    this.cd = { rush: 0, orb: 0, erupt: 0 };
    this.max = { ...COOLDOWN };
    this.ult = 0;
    this.pending = [];
    this.busy = 0;
    this.ultReadyAnnounced = false;
    this.melee = new MeleeCombo(this, 'ink', INK_M1);
  }

  reset() { for (const k in this.cd) this.cd[k] = 0; this.pending.length = 0; this.busy = 0; }
  slots() { return [['rush', 'E'], ['orb', 'C'], ['erupt', 'V'], ['talisman', 'X']]; }
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
    if (!m.local.alive || !m.controlsActive) return;
    const pr = input.pressed;
    const buf = this.buf || (this.buf = { e: 0, c: 0, v: 0, x: 0 });
    for (const k in buf) buf[k] = pr[k] ? 0.4 : Math.max(0, buf[k] - dt);
    const go = (k, fn) => { if (buf[k] > 0 && this.busy <= 0) { buf[k] = 0; fn(); } };
    go('e', () => this.rush());
    go('c', () => this.orb());
    go('v', () => this.erupt());
    go('x', () => this.talisman());
    this.melee.update(dt, input);
  }

  _ready(id) {
    if (this.busy > 0) return false;
    if (this.cd[id] > 0) { this.m.app.hud.denied(id); return false; }
    return true;
  }
  _enemies() { const m = this.m; return [...m.ents.values()].filter((e) => e !== m.local && e.alive); }
  _groundTarget(range) {
    const m = this.m, me = m.local.pos;
    tmp.copy(m.aimPoint);
    tmp2.set(tmp.x - me.x, 0, tmp.z - me.z);
    const d = tmp2.length();
    if (d > range) { tmp2.multiplyScalar(range / d); tmp.set(me.x + tmp2.x, me.y, me.z + tmp2.z); }
    return new THREE.Vector3(tmp.x, m.world.groundAt(tmp.x, tmp.z, tmp.y + 2), tmp.z);
  }
  _fwd() { const y = this.m.cam.yaw; return new THREE.Vector3(Math.sin(y), 0, Math.cos(y)); }

  // ---------------------------------------------------------------- E: Ink Manifestation
  rush() {
    if (!this._ready('rush')) return;
    const m = this.m, b = m.body;
    this.cd.rush = cdOf(COOLDOWN.rush); this.busy = RUSH.beats[2] + 0.3;
    let F = this._fwd();
    // lock onto the enemy in front of you (if any) and dash to them
    let tgt = null, best = 1e9;
    for (const t of this._enemies()) {
      const dx = t.pos.x - b.pos.x, dz = t.pos.z - b.pos.z, d = Math.hypot(dx, dz);
      if (d < RUSH.dash + 3 && d > 0.1 && (dx * F.x + dz * F.z) / d > 0.6 && d < best) { best = d; tgt = t; }
    }
    if (tgt) F = new THREE.Vector3(tgt.pos.x - b.pos.x, 0, tgt.pos.z - b.pos.z).normalize();
    const dist = tgt ? Math.max(0, best - 1.4) : RUSH.dash;
    b.lunge(F, dist / RUSH.dashT, RUSH.dashT);
    b.slow = 0.25; this.pending.push({ t: RUSH.beats[2] + 0.25, fn: () => { b.slow = 1; } });
    m.faceLockT = RUSH.beats[2] + 0.3;
    m.playAnim('dash', { dir: 0 });
    m.castAbility({ ab: 'inkRush', o: b.pos.toArray(), d: [F.x, F.z] });
    m.sound('dash', b.pos, 0.8, 25);
    const anims = ['m1a', 'm1c', 'slam'];
    RUSH.beats.forEach((t, i) => this.pending.push({ t, fn: () => {
      m.playAnim(i === 2 ? 'slam' : anims[i]);
      const p = b.pos;
      m.castAbility({ ab: 'inkBeat', i, o: [p.x, p.y, p.z], d: [F.x, F.z] });
      m.sound(i === 2 ? 'slashHeavy' : 'slash', p, i === 2 ? 0.9 : 0.6, 25);
      for (const e of this._enemies()) {
        const dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz);
        if (d > RUSH.range || Math.abs(e.pos.y - p.y) > 2.4) continue;
        if (d > 0.4 && (dx * F.x + dz * F.z) / d < RUSH.cone) continue;
        const fin = i === 2;
        m.reportHit(e, RUSH.dmg[i], fin ? 'inkFin' : 'inkHit', { stun: RUSH.stun[i], kb: fin ? [F.x * 12, -2, F.z * 12] : [F.x * 3, 0.5, F.z * 3], at: new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z) });
      }
      if (i === 2) { m.fx.shake(0.35); m.cam.kick += 0.04; }
    } }));
  }

  // ---------------------------------------------------------------- C: Cloud-Shaper
  orb() {
    if (!this._ready('orb')) return;
    const m = this.m;
    this.cd.orb = cdOf(COOLDOWN.orb); this.busy = 0.35;
    m.playAnim('cast', { anim: 'gBlue' });
    const c = this._groundTarget(ORB.range); c.y += 1.4;
    this.pending.push({ t: 0.08, fn: () => {
      const hand = m.view.palmWorld('L', tmp);
      m.castAbility({ ab: 'inkOrb', c: [c.x, c.y, c.z], o: [hand.x, hand.y, hand.z] });
    } });
    // the vortex: pull + shred ticks, then the outward burst (resolved by the caster)
    const ticks = Math.floor(ORB.life / ORB.tick);
    for (let k = 1; k <= ticks; k++) this.pending.push({ t: ORB.delay + k * ORB.tick, fn: () => {
      for (const e of this._enemies()) {
        const dx = c.x - e.pos.x, dz = c.z - e.pos.z, d = Math.hypot(dx, dz);
        if (d > ORB.pullR || Math.abs(e.pos.y - c.y) > 5) continue;
        const k2 = Math.min(1, d / ORB.pullR), sp = ORB.pull * (0.35 + k2);
        m.reportHit(e, d < ORB.coreR ? ORB.tickDmg : 1, 'inkOrb', { kb: [dx / (d || 1) * sp, 1.2, dz / (d || 1) * sp], at: new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z) });
      }
    } });
    this.pending.push({ t: ORB.delay + ORB.life, fn: () => {
      for (const e of this._enemies()) {
        const dx = e.pos.x - c.x, dz = e.pos.z - c.z, d = Math.hypot(dx, dz);
        if (d > ORB.burstR || Math.abs(e.pos.y - c.y) > 5) continue;
        m.reportHit(e, ORB.burst, 'inkBurst', { kb: [dx / (d || 1) * ORB.burstKb, 7, dz / (d || 1) * ORB.burstKb], at: new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z) });
      }
    } });
  }

  // ---------------------------------------------------------------- V: Qingming Eruption
  erupt() {
    if (!this._ready('erupt')) return;
    const m = this.m, b = m.body;
    this.cd.erupt = cdOf(COOLDOWN.erupt); this.busy = ERUPT.charge + 0.4;
    b.locked = ERUPT.charge + 0.15; b.vel.x *= 0.1; b.vel.z *= 0.1;
    const F = this._fwd();
    m.faceLockT = ERUPT.charge + 0.4;
    m.playAnim('cast', { anim: 'gRed' });
    m.castAbility({ ab: 'inkArray', o: b.pos.toArray(), d: [F.x, F.z] });
    this.pending.push({ t: ERUPT.charge, fn: () => {
      const p = b.pos;
      m.castAbility({ ab: 'inkErupt', o: [p.x, p.y, p.z], d: [F.x, F.z] });
      m.cam.kick += 0.07; m.fx.shake(0.55);
      for (const e of this._enemies()) {
        const dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz);
        const along = dx * F.x + dz * F.z, across = Math.abs(dx * F.z - dz * F.x);
        const inWave = along > -0.5 && along < ERUPT.len && across < ERUPT.width + along * 0.12;
        if (!(inWave || d < ERUPT.near) || Math.abs(e.pos.y - p.y) > 4) continue;
        const ux = d > 0.1 ? dx / d : F.x, uz = d > 0.1 ? dz / d : F.z;
        m.reportHit(e, ERUPT.dmg, 'inkErupt', { kb: [F.x * ERUPT.kb * 0.7 + ux * ERUPT.kb * 0.3, ERUPT.up, F.z * ERUPT.kb * 0.7 + uz * ERUPT.kb * 0.3], at: new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z) });
      }
    } });
  }

  // ---------------------------------------------------------------- X: Endless Talisman Suppression
  talisman() {
    const m = this.m, b = m.body;
    if (this.busy > 0) return;
    if (this.ult < ULT_COST) { m.app.hud.denied('talisman'); return; }
    if (m.cine) return;
    this.ult = 0; this.ultReadyAnnounced = false;
    this.busy = TALISMAN.cine; b.locked = TALISMAN.cine; b.vel.set(0, 0, 0);
    const p = b.pos;
    m.castAbility({ ab: 'talisman', c: [p.x, p.y, p.z], yaw: Math.round(b.yaw * 100) / 100 });
    // the rain (several strikes on everyone in range), then the explosion — resolved by the caster
    const c = p.clone();
    const [r0, r1] = TALISMAN.rain;
    for (let k = 0; k < TALISMAN.strikes; k++) this.pending.push({ t: r0 + (r1 - r0) * (k + 0.5) / TALISMAN.strikes, fn: () => {
      for (const e of this._enemies()) {
        if (Math.hypot(e.pos.x - c.x, e.pos.z - c.z) > TALISMAN.radius) continue;
        m.reportHit(e, TALISMAN.strikeDmg, 'talismanRain', { slow: [0.4, 0.6], stun: 0.35, at: new THREE.Vector3(e.pos.x, e.pos.y + 1.0, e.pos.z) });
      }
    } });
    this.pending.push({ t: TALISMAN.boom, fn: () => {
      for (const e of this._enemies()) {
        const dx = e.pos.x - c.x, dz = e.pos.z - c.z, d = Math.hypot(dx, dz);
        if (d > TALISMAN.boomR) continue;
        m.reportHit(e, TALISMAN.boomDmg, 'inkNova', { kb: [dx / (d || 1) * 16, 12, dz / (d || 1) * 16], at: new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z) });
      }
    } });
  }
}
