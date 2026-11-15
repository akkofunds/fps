import { BAL } from './balance.js';
import * as THREE from 'three';
import { ULT_COST } from '../config.js';
import { PROJ } from './projectiles.js';

// METEORA — Crimson Archmage. A staff caster who lives for one thing: the biggest explosion
// anyone has ever seen. Her ultimate wipes out everything in a huge radius, but the long, loud
// incantation telegraphs it, and afterwards she collapses, completely spent.
export const METEORA = {
  id: 'meteora',
  name: 'METEORA',
  role: 'CRIMSON ARCHMAGE',
  model: 'models/meteora.glb',
  color: '#ff2f4a',
  bio: 'An archmage who devoted her whole life to a single spell. Her staff fires crimson sparks, rains small stars on her enemies and seals the ground with explosive sigils. When the chant finishes, the sky itself catches fire.',
  abilities: [
    { key: 'LMB', id: 'spark', name: 'Crimson Spark', desc: 'Your staff fires a bolt of crimson flame that bursts on impact. 16 damage, plus 10 splash damage.' },
    { key: 'Q', id: 'dash', name: 'Flare Step', desc: 'Burst a short distance in the direction you are moving. 2 charges. Dash in the air and you roll when you land.' },
    { key: 'E', id: 'starfall', name: 'Starfall', cd: 8, desc: 'Point your staff and a small star falls on the target a moment later, exploding in a burst of flame.' },
    { key: 'C', id: 'sigil', name: 'Blast Sigil', cd: 11, desc: 'Brand an explosive rune on the ground where you aim. It arms after a moment and detonates under the first enemy to step on it. Up to 2 at a time.' },
    { key: 'V', id: 'blink', name: 'Blink', cd: 9, desc: 'Teleport up to 10 m in the direction you are moving, leaving an explosion behind you.' },
    { key: 'X', id: 'nova', name: 'Crimson Nova', ult: true, cost: ULT_COST, desc: 'ULTIMATE — A long incantation stacks magic circles over the target, then a colossal explosion wipes out EVERYTHING within 18 m. Afterwards you collapse, exhausted, for 3 seconds.' },
  ],
};

export const NOVA = { radius: 18, channel: 2.35, maxDmg: 400, minDmg: 160, range: 85, exhausted: 3.3 };
const COOLDOWN = { spark: 0.45, starfall: 8, sigil: 11, blink: 9 };
// bolt-type fire rates are not shortened below 60% even with admin cooldown tweaks
const cdOf = (base) => (BAL.noCooldowns ? (base < 1 ? base * 0.6 : 0) : base * (base < 1 ? Math.max(0.6, BAL.cd) : BAL.cd));
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export class MeteoraKit {
  constructor(match) {
    this.m = match;
    this.def = METEORA;
    this.cd = { spark: 0, starfall: 0, sigil: 0, blink: 0 };
    this.max = { starfall: 8, sigil: 11, blink: 9 };
    this.ult = 0;
    this.pending = [];
    this.busy = 0;
    this.ultReadyAnnounced = false;
    this.sigils = [];
  }

  reset() { for (const k in this.cd) this.cd[k] = 0; this.pending.length = 0; this.busy = 0; }
  addUlt(v) {
    this.ult = Math.min(ULT_COST, this.ult + v);
    if (this.ult >= ULT_COST && !this.ultReadyAnnounced) { this.ultReadyAnnounced = true; this.m.onUltReady(); }
  }
  slots() { return [['starfall', 'E'], ['sigil', 'C'], ['blink', 'V'], ['nova', 'X']]; }

  update(dt, input) {
    const m = this.m;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.busy = Math.max(0, this.busy - dt);
    this.addUlt(dt * 0.35 * BAL.ult);
    if (BAL.infiniteUlt) this.ult = Math.max(this.ult, 100);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) { this.pending.splice(i, 1); if (m.local.alive) p.fn(); }
    }
    if (!m.local.alive || !m.controlsActive) return;
    const pr = input.pressed;
    if (pr.e) this.starfall();
    if (pr.c) this.sigil();
    if (pr.v) this.blink();
    if (pr.x) this.nova();
    if (input.state.fire || pr.fire) this.spark();
  }

  _ready(id) {
    if (this.busy > 0) return false;
    if (this.cd[id] > 0) { if (id !== 'spark') this.m.app.hud.denied(id); return false; }
    return true;
  }

  // crosshair target on the ground within `range`
  _groundTarget(range) {
    const m = this.m, me = m.local.pos;
    tmp.copy(m.aimPoint);
    tmp2.set(tmp.x - me.x, 0, tmp.z - me.z);
    const d = tmp2.length();
    if (d > range) { tmp2.multiplyScalar(range / d); tmp.set(me.x + tmp2.x, me.y, me.z + tmp2.z); }
    return new THREE.Vector3(tmp.x, m.world.groundAt(tmp.x, tmp.z, tmp.y + 2), tmp.z);
  }

  spark() {
    if (!this._ready('spark')) return;
    const m = this.m;
    this.cd.spark = cdOf(COOLDOWN.spark);
    m.playAnim('cast', { anim: 'mBolt' });
    this.pending.push({ t: 0.07, fn: () => {
      const o = m.view.staffTip(tmp);
      const dir = tmp2.copy(m.aimPoint).sub(o);
      if (dir.length() < 2) dir.copy(m.cam.fwd); else dir.normalize();
      const v = dir.clone().multiplyScalar(PROJ.spark.speed);
      m.fx.arcaneBurst(o, dir, 0.6);
      m.castAbility({ ab: 'spark', o: [o.x, o.y, o.z], d: [v.x, v.y, v.z] });
      m.sound('spark', o, 0.6, 30);
      m.cam.kick += 0.008;
    } });
  }

  starfall() {
    if (!this._ready('starfall')) return;
    const m = this.m;
    this.cd.starfall = cdOf(COOLDOWN.starfall); this.busy = 0.4;
    m.playAnim('cast', { anim: 'mRaise' });
    const target = this._groundTarget(38);
    this.pending.push({ t: 0.36, fn: () => m.castAbility({ ab: 'starfall', c: [target.x, target.y, target.z] }) });
  }

  sigil() {
    if (!this._ready('sigil')) return;
    const m = this.m;
    this.cd.sigil = cdOf(COOLDOWN.sigil); this.busy = 0.55;
    const target = this._groundTarget(16);
    m.body.locked = 0.4;
    m.playAnim('plant');
    this.pending.push({ t: 0.32, fn: () => m.castAbility({ ab: 'sigil', c: [target.x, target.y, target.z], id: Math.floor(Math.random() * 1e9) }) });
  }

  blink() {
    if (!this._ready('blink')) return;
    const m = this.m, b = m.body;
    this.cd.blink = cdOf(COOLDOWN.blink); this.busy = 0.15;
    const inp = m.app.input.state;
    const sy = Math.sin(b.yaw), cy = Math.cos(b.yaw);
    tmp.set(sy * inp.fwd - cy * inp.side, 0, cy * inp.fwd + sy * inp.side);
    if (tmp.lengthSq() < 0.01) tmp.set(sy, 0, cy); else tmp.normalize();
    const o = b.pos.clone();
    // stop short of walls; never into the ground
    const hit = m.world.raycast(o.x, o.y + 1.0, o.z, tmp.x, 0, tmp.z, 10, 0.5, null, true);
    const dist = Math.max(0, Math.min(10, hit - 0.6));
    const to = o.clone().addScaledVector(tmp, dist);
    to.y = m.world.groundAt(to.x, to.z, o.y + 2.5);
    m.playAnim('cast', { anim: 'mBlink' });
    m.castAbility({ ab: 'blink', o: [o.x, o.y, o.z], t: [to.x, to.y, to.z] });
    b.pos.copy(to); b.vel.multiplyScalar(0.4); b.vel.y = Math.max(0, b.vel.y);
    m.cam.pivotY = null;
  }

  nova() {
    const m = this.m;
    if (this.ult < ULT_COST) { m.app.hud.denied('nova'); return; }
    if (this.busy > 0) return;
    const target = this._groundTarget(NOVA.range);
    this.ult = 0; this.ultReadyAnnounced = false;
    this.busy = NOVA.channel + NOVA.exhausted;
    m.body.locked = NOVA.channel + 0.2;
    m.playAnim('nova');
    const me = m.local.pos;
    m.castAbility({ ab: 'nova', c: [target.x, target.y, target.z], o: [me.x, me.y, me.z] });
    // the price of the spell
    this.pending.push({ t: NOVA.channel + 0.15, fn: () => {
      m.playAnim('exhausted');
      m.body.locked = NOVA.exhausted;
      m.app.hud.banner('EXHAUSTED', 'YOU CANNOT MOVE', 2.5, 'kill');
    } });
  }
}
