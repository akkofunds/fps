import { BAL, ADMIN } from './balance.js';
import * as THREE from 'three';
import { ULT_COST } from '../config.js';
import { PROJ, hitCharacter } from './projectiles.js';

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
    { key: 'LMB', id: 'spark', name: 'Crimson Spark', desc: 'Your staff fires a bolt of crimson flame. Aim it: 20 damage on a direct hit, 30 on headshots.' },
    { key: 'Q', id: 'dash', name: 'Flare Step', desc: 'Burst a short distance in the direction you are moving. 2 charges. Dash in the air and you roll when you land.' },
    { key: 'E', id: 'starfall', name: 'Starfall', cd: 8, desc: 'Raise your staff and call down a barrage of 5 burning stars that rain across the target area one after another.' },
    { key: 'C', id: 'ray', name: 'Scarlet Ray', cd: 10, desc: 'Plant your feet and channel: magic circles spin up in front of your staff, then a devastating beam fires to your crosshair, piercing every enemy along its path (85 damage).' },
    { key: 'V', id: 'blink', name: 'Blink', cd: 9, desc: 'Teleport up to 10 m in the direction you are moving. You leave a crimson afterimage behind that explodes a moment later.' },
    { key: 'X', id: 'nova', name: 'Crimson Nova', ult: true, cost: ULT_COST, desc: 'ULTIMATE — Time stops for everyone. A full cutscene plays as you chant and seven magic circles stack up over the target, then a catastrophic explosion obliterates EVERYTHING within 24 m. Afterwards you collapse, exhausted.' },
  ],
};

// the cutscene timeline (seconds after the cast): circles stack, final word, impact, wide shot
export const NOVA = { radius: 24, channel: 7.2, cine: 10.6, maxDmg: 500, minDmg: 220, range: 85, exhausted: 3.3 };
export const RAY = { channel: 1.3, range: 90, width: 1.3, dmg: 85 };
export const STARFALL = { count: 5, spread: 4.2, radius: 2.5, dmg: 26, minDmg: 10, first: 0.55, gap: 0.16 };
const COOLDOWN = { spark: 0.45, starfall: 8, sigil: 11, ray: 10, blink: 9 };
// bolt-type fire rates are not shortened below 60% even with admin cooldown tweaks
const cdOf = (base) => (BAL.noCooldowns ? (base < 1 ? base * 0.6 : 0) : base * (base < 1 ? Math.max(0.6, BAL.cd) : BAL.cd));
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export class MeteoraKit {
  constructor(match) {
    this.m = match;
    this.def = METEORA;
    this.cd = { spark: 0, starfall: 0, ray: 0, blink: 0 };
    this.max = { starfall: 8, ray: 10, blink: 9 };
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
  slots() { return [['starfall', 'E'], ['ray', 'C'], ['blink', 'V'], ['nova', 'X']]; }

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
    // input buffer: a press during another ability's animation goes off as soon as it ends
    const buf = this.buf || (this.buf = { e: 0, c: 0, v: 0, x: 0 });
    for (const k in buf) buf[k] = pr[k] ? 0.4 : Math.max(0, buf[k] - dt);
    const go = (k, fn) => { if (buf[k] > 0 && this.busy <= 0) { buf[k] = 0; fn(); } };
    go('e', () => this.starfall());
    go('c', () => this.ray());
    go('v', () => this.blink());
    go('x', () => this.nova());
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
    // impact points are rolled by the caster so every client sees the same barrage
    const pts = [];
    for (let i = 0; i < STARFALL.count; i++) {
      const a = Math.random() * Math.PI * 2, r = i === 0 ? 0 : Math.sqrt(Math.random()) * STARFALL.spread;
      const x = target.x + Math.cos(a) * r, z = target.z + Math.sin(a) * r;
      pts.push(Math.round(x * 100) / 100, Math.round(m.world.groundAt(x, z, target.y + 4) * 100) / 100, Math.round(z * 100) / 100);
    }
    this.pending.push({ t: 0.36, fn: () => m.castAbility({ ab: 'starfall', c: [target.x, target.y, target.z], p: pts }) });
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

  // C — Scarlet Ray: a channelled spell, then a piercing beam to the crosshair
  ray() {
    if (!this._ready('ray')) return;
    const m = this.m;
    this.cd.ray = cdOf(COOLDOWN.ray); this.busy = RAY.channel + 0.5;
    m.body.locked = RAY.channel + 0.35; m.body.vel.x *= 0.2; m.body.vel.z *= 0.2;
    m.playAnim('ray');
    m.castAbility({ ab: 'rayCharge' });
    this.pending.push({ t: RAY.channel, fn: () => {
      const cam = m.camera.position, f = m.cam.fwd;
      const wd = m.world.raycast(cam.x, cam.y, cam.z, f.x, f.y, f.z, RAY.range, 0);
      const end = tmp2.copy(cam).addScaledVector(f, Math.min(RAY.range, wd));
      const o = m.view.staffTip(tmp);
      m.castAbility({ ab: 'ray', o: [o.x, o.y, o.z], t: [end.x, end.y, end.z] });
      // pierces: everyone along the beam from the staff to the end point
      const hitEnd = end.clone(), start = o.clone();
      for (const e of m.ents.values()) {
        if (e === m.local || !e.alive) continue;
        const h = hitCharacter(e, start, hitEnd, RAY.width * 0.5);
        if (h) m.reportHit(e, RAY.dmg, 'ray', { head: h.head, burn: [6, 2.5], kb: [f.x * 7, 3, f.z * 7], at: new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z) });
      }
      m.cam.kick += 0.06; m.fx.shake(0.45);
    } });
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
    m.castAbility({ ab: 'blink', o: [o.x, o.y, o.z], t: [to.x, to.y, to.z], yaw: Math.round(b.yaw * 100) / 100 });
    b.pos.copy(to); b.vel.multiplyScalar(0.4); b.vel.y = Math.max(0, b.vel.y);
    m.cam.pivotY = null;
  }

  nova() {
    const m = this.m;
    if (this.ult < ULT_COST) { m.app.hud.denied('nova'); return; }
    if (this.busy > 0) return;
    const target = this._groundTarget(NOVA.range);
    this.ult = 0; this.ultReadyAnnounced = false;
    this.busy = ADMIN.ult ? NOVA.cine : NOVA.channel + NOVA.exhausted;
    m.body.locked = NOVA.channel + 0.2;
    m.playAnim('nova');
    const me = m.local.pos;
    m.castAbility({ ab: 'nova', c: [target.x, target.y, target.z], o: [me.x, me.y, me.z] });
    // the price of the spell
    if (!ADMIN.ult) this.pending.push({ t: NOVA.channel + 0.15, fn: () => {
      m.playAnim('exhausted');
      m.body.locked = NOVA.exhausted;
    } });
  }
}
