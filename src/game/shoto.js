import { BAL, ADMIN } from './balance.js';
import * as THREE from 'three';
import { ULT_COST } from '../config.js';
import { PROJ, hitCharacter } from './projectiles.js';
import { B } from '../character/rig.js';
import { MeleeCombo } from './melee.js';

// SHOTO — half-cold, half-hot. Ice from his stomping foot, fire from his fists.
//   LMB Flame Fists · E Flashfreeze Heatwave · C Hellfire Lance · V Cryo-Jet Blitz
//   X Calamity: Absolute Zero-Burn
// (internal id stays 'pyro' so saved settings and older lobbies keep working)
export const SHOTO = {
  id: 'pyro',
  name: 'SHOTO',
  role: 'FROST & FLAME',
  model: 'models/shoto.glb',
  color: '#7fd4ff',
  bio: 'Ice from his right hand, fire from his left. Shoto locks enemies in place with jagged ice, then hits them with heat so sudden the frozen air explodes.',
  abilities: [
    { key: 'LMB', id: 'bolt', name: 'Frost & Flame Combo', desc: 'M1: a 4-hit melee string (jab, cross, hook, flying kick). Frost on the left fist, fire on the right. Every hit stuns so the next one connects, each swing lunges you onto the target, and the kick launches them.' },
    { key: 'Q', id: 'dash', name: 'Flare Step', desc: 'Burst a short distance in the direction you are moving. 2 charges. Dash in the air and you roll when you land. Press jump again in the air to double jump.' },
    { key: 'E', id: 'freeze', name: 'Flashfreeze Heatwave', cd: 10, desc: 'Stomp: jagged ice erupts from your foot and races along the ground to the target, freezing everyone there in place. Then a fire punch rolls a massive wave of flame out over it: frozen enemies shatter in a pressure explosion for heavy bonus damage.' },
    { key: 'C', id: 'lance', name: 'Hellfire Lance', cd: 8, desc: 'Compress white-hot flame into a narrow beam from your fingertip: a long-range sniper shot to exactly where you aim (68 damage, 98 on headshots). Scorches the ground beneath it.' },
    { key: 'V', id: 'blitz', name: 'Cryo-Jet Blitz', cd: 11, desc: 'Freeze the ground and skate forward at blinding speed, fire jets roaring behind you, then finish with a dual-element uppercut that launches, burns and slows.' },
    { key: 'X', id: 'zero', name: 'Calamity: Absolute Zero-Burn', ult: true, cost: ULT_COST, desc: 'ULTIMATE — Flood everything around you with a massive glacier that traps every enemy, superheat the air above them, then slam your hands together to set off a catastrophic thermobaric blast.' },
  ],
};

export const FREEZE = { range: 26, radius: 2.8, dmg: 15, root: 1.25, delay: 0.7, waveLen: 11, waveHalf: 0.6, waveDmg: 40, shatter: 24 };
export const LANCE = { charge: 0.36, range: 120, dmg: 68, head: 1.45 };
export const BLITZ = { speed: 21, time: 0.62, hitR: 1.7, dmg: 38 };
export const ZERO = { radius: 26, freezeDmg: 20, root: 2.7, freezeAt: 0.7, boomAt: 2.35, dmg: 120, minDmg: 70 };

const COOLDOWN = { bolt: 0.31, freeze: 10, lance: 8, blitz: 11 };
const cdOf = (base) => (BAL.noCooldowns ? (base < 1 ? base * 0.6 : 0) : base * (base < 1 ? Math.max(0.6, BAL.cd) : BAL.cd));
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();

export class ShotoKit {
  constructor(match) {
    this.m = match;
    this.def = SHOTO;
    this.cd = { bolt: 0, freeze: 0, lance: 0, blitz: 0 };
    this.max = { freeze: COOLDOWN.freeze, lance: COOLDOWN.lance, blitz: COOLDOWN.blitz };
    this.ult = 0;
    this.side = 1;
    this.pending = [];
    this.busy = 0;
    this.ultReadyAnnounced = false;
    this.frozen = new Map(); // enemy n → time frozen by Flashfreeze (for the shatter bonus)
    this.blitzT = 0; this.blitzDir = new THREE.Vector3(); this.blitzDone = true;
    this.melee = new MeleeCombo(this, 'frostflame');
  }

  reset() { for (const k in this.cd) this.cd[k] = 0; this.pending.length = 0; this.busy = 0; this.blitzT = 0; this.blitzDone = true; this.frozen.clear(); }
  slots() { return [['freeze', 'E'], ['lance', 'C'], ['blitz', 'V'], ['zero', 'X']]; }
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
    if (this.blitzT > 0 || !this.blitzDone) this._blitzTick(dt);
    if (!m.local.alive || !m.controlsActive) return;
    const pr = input.pressed;
    const buf = this.buf || (this.buf = { e: 0, c: 0, v: 0, x: 0 });
    for (const k in buf) buf[k] = pr[k] ? 0.4 : Math.max(0, buf[k] - dt);
    const go = (k, fn) => { if (buf[k] > 0 && this.busy <= 0) { buf[k] = 0; fn(); } };
    go('e', () => this.freeze());
    go('c', () => this.lance());
    go('v', () => this.blitz());
    go('x', () => this.zero());
    this.melee.update(dt, input);
  }

  _ready(id) {
    if (this.busy > 0) return false;
    if (this.cd[id] > 0) { if (id !== 'bolt') this.m.app.hud.denied(id); return false; }
    return true;
  }
  _aimDir(origin, out) {
    out.copy(this.m.aimPoint).sub(origin);
    const d = out.length();
    if (d < 2) out.copy(this.m.cam.fwd); else out.divideScalar(d);
    return out;
  }
  _flatAim(out) { const y = this.m.cam.yaw; return out.set(Math.sin(y), 0, Math.cos(y)); }

  // ---------------------------------------------------------------- LMB: fire punches (left/right jabs)
  bolt() {
    if (!this._ready('bolt')) return;
    const m = this.m;
    this.cd.bolt = cdOf(COOLDOWN.bolt);
    const hand = this.side > 0 ? 'R' : 'L';
    this.side = -this.side;
    m.playAnim('cast', { anim: hand === 'R' ? 'jabR' : 'jabL' });
    // right jab: an ice shard (chills), left jab: a fire bolt (burns) — his two halves
    const ice = hand === 'R';
    this.pending.push({ t: 0.045, fn: () => {
      const o = m.view.palmWorld(hand, tmp);
      const dir = this._aimDir(o, tmp2);
      if (ice) m.fx.frostBurst(o, dir, 0.8); else m.fx.castBurst(o, dir, 0.7);
      const kind = ice ? 'shard' : 'bolt';
      const v = dir.multiplyScalar(PROJ[kind].speed);
      m.castAbility({ ab: kind, o: [o.x, o.y, o.z], d: [v.x, v.y, v.z] });
      m.sound(ice ? 'iceShot' : 'bolt', o, 0.5, 30);
      m.cam.kick += 0.006;
    } });
  }

  // ---------------------------------------------------------------- E: Flashfreeze Heatwave
  // knee up → STOMP: ice erupts from his right foot and races to the target, freezing it; then a
  // left fire punch rolls the heatwave out over the frozen ground
  freeze() {
    if (!this._ready('freeze')) return;
    const m = this.m, me = m.local.pos;
    this.cd.freeze = cdOf(COOLDOWN.freeze); this.busy = 1.2;
    m.body.slow = 0.15; this.pending.push({ t: 1.15, fn: () => { m.body.slow = 1; } });
    // target: crosshair on the ground, within range
    tmp.copy(m.aimPoint); tmp2.set(tmp.x - me.x, 0, tmp.z - me.z);
    let d = tmp2.length();
    if (d < 0.5) { this._flatAim(tmp2); d = 1; } else tmp2.divideScalar(d);
    d = Math.max(4, Math.min(FREEZE.range, d));
    const cx = me.x + tmp2.x * d, cz = me.z + tmp2.z * d;
    const cy = m.world.groundAt(cx, cz, me.y + 4);
    const dir = [tmp2.x, tmp2.z];
    m.playAnim('freeze');
    this.pending.push({ t: 0.2, fn: () => {
      const f = m.view.rig.bones[B.footR].getWorldPosition(tmp3);
      f.y = m.world.groundAt(f.x, f.z, f.y + 1);
      m.castAbility({ ab: 'freeze', o: [f.x, f.y, f.z], c: [cx, cy, cz] });
      m.fx.shake(0.25);
    } });
    this.pending.push({ t: 0.88, fn: () => {
      const p = m.local.pos, fist = m.view.palmWorld('L', tmp3);
      m.fx.castBurst(fist, tmp.set(dir[0], 0, dir[1]), 1.6);
      m.castAbility({ ab: 'heatwave', o: [p.x, p.y, p.z], d: dir });
      m.fx.shake(0.3);
    } });
  }

  // ---------------------------------------------------------------- C: Hellfire Lance (hitscan to the crosshair)
  lance() {
    if (!this._ready('lance')) return;
    const m = this.m;
    this.cd.lance = cdOf(COOLDOWN.lance); this.busy = 0.6;
    m.body.slow = 0.35; this.pending.push({ t: 0.6, fn: () => { m.body.slow = 1; } });
    m.playAnim('cast', { anim: 'lance' });
    m.castAbility({ ab: 'lanceCharge', o: m.view.palmWorld('L', tmp).toArray() });
    this.pending.push({ t: LANCE.charge, fn: () => {
      const cam = m.camera.position, f = m.cam.fwd;
      const wd = m.world.raycast(cam.x, cam.y, cam.z, f.x, f.y, f.z, LANCE.range, 0);
      const len = Math.min(LANCE.range, wd);
      const end = tmp3.copy(cam).addScaledVector(f, len);
      let best = null, bestS = 2;
      for (const e of m.ents.values()) {
        if (e === m.local || !e.alive) continue;
        const h = hitCharacter(e, cam, end, 0.04);
        if (h && h.s < bestS) { bestS = h.s; best = { e, head: h.head }; }
      }
      const hit = best ? tmp2.copy(cam).lerp(end, bestS) : tmp2.copy(end);
      const o = m.view.palmWorld('L', tmp);
      m.castAbility({ ab: 'lance', o: [o.x, o.y, o.z], t: [hit.x, hit.y, hit.z] });
      if (best) m.reportHit(best.e, Math.round(LANCE.dmg * (best.head ? LANCE.head : 1)), 'lance', { head: best.head, at: hit.clone(), burn: [4, 2] });
      m.cam.kick += 0.05; m.fx.shake(0.18);
    } });
  }

  // ---------------------------------------------------------------- V: Cryo-Jet Blitz
  blitz() {
    if (!this._ready('blitz')) return;
    const m = this.m, b = m.body;
    this.cd.blitz = cdOf(COOLDOWN.blitz); this.busy = BLITZ.time + 0.45;
    const dir = this._flatAim(this.blitzDir);
    const o = b.pos;
    const hitD = m.world.raycast(o.x, o.y + 0.9, o.z, dir.x, 0, dir.z, BLITZ.speed * BLITZ.time, 0.3);
    const t = Math.min(BLITZ.time, hitD / BLITZ.speed);
    b.lunge(dir, BLITZ.speed, Math.max(0.12, t));
    this.blitzT = Math.max(0.12, t); this.blitzDone = false;
    m.playAnim('skate');
    m.castAbility({ ab: 'blitz', o: [o.x, o.y, o.z], d: [dir.x, dir.z], l: Math.round(BLITZ.speed * t * 100) / 100 });
  }
  _blitzTick(dt) {
    const m = this.m, b = m.body, d = this.blitzDir;
    this.blitzT -= dt;
    let early = false;
    if (this.blitzT > 0) {
      for (const e of m.ents.values()) {
        if (e === m.local || !e.alive) continue;
        const dx = e.pos.x - b.pos.x, dz = e.pos.z - b.pos.z;
        if (dx * d.x + dz * d.z > 0 && dx * dx + dz * dz < BLITZ.hitR * BLITZ.hitR && Math.abs(e.pos.y - b.pos.y) < 1.8) { early = true; break; }
      }
    }
    if ((this.blitzT <= 0 || early) && !this.blitzDone) {
      this.blitzDone = true; this.blitzT = 0;
      b.lungeT = 0; b.vel.x *= 0.2; b.vel.z *= 0.2;
      m.playAnim('uppercut');
      this.pending.push({ t: 0.1, fn: () => {
        const p = b.pos;
        const c = [p.x + d.x * 1.3, p.y + 0.9, p.z + d.z * 1.3];
        m.castAbility({ ab: 'uppercut', c });
        m.fx.shake(0.3); m.cam.kick += 0.04;
      } });
    }
  }

  // ---------------------------------------------------------------- X: Calamity — Absolute Zero-Burn
  zero() {
    const m = this.m;
    if (this.ult < ULT_COST) { m.app.hud.denied('zero'); return; }
    if (this.busy > 0) return;
    this.ult = 0; this.ultReadyAnnounced = false;
    this.busy = ZERO.boomAt + 0.6;
    m.body.locked = ZERO.boomAt + 0.45; m.body.vel.x *= 0.1; m.body.vel.z *= 0.1;
    m.playAnim('zeroburn');
    const p = m.local.pos;
    m.castAbility({ ab: 'zero', o: [p.x, p.y, p.z] });
  }
}
