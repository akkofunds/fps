import * as THREE from 'three';
import { ULT_COST } from '../config.js';
import { PROJ } from './projectiles.js';

// PYRO — Flamecaller. Kit definition (shown in the lobby/HUD) + the owner-side ability logic.
export const PYRO = {
  id: 'pyro',
  name: 'PYRO',
  role: 'FLAMECALLER',
  model: 'models/pyro.glb',
  color: '#ff6a2b',
  bio: 'A quiet fire-soldier who burns hotter the longer the fight goes. Pyro controls space with walls of flame, punishes clumps with explosive orbs and calls a meteor down from the sky.',
  abilities: [
    { key: 'LMB', id: 'bolt', name: 'Ember Bolt', desc: 'Throw rapid fire punches that launch ember bolts. 18 damage, 27 on headshots.' },
    { key: 'Q', id: 'dash', name: 'Flare Step', desc: 'Burst a short distance in the direction you are moving. 2 charges. Dash in the air and you roll when you land.' },
    { key: 'E', id: 'orb', name: 'Blaze Orb', cd: 7, desc: 'Push out a heavy fireball that arcs and explodes on impact, burning everyone caught in the blast.' },
    { key: 'C', id: 'wall', name: 'Firewall', cd: 15, desc: 'Slam the ground to raise a 7 m wall of flame where you aim. Blocks sight and burns anyone who crosses it.' },
    { key: 'V', id: 'leap', name: 'Flame Leap', cd: 10, desc: 'Detonate the ground beneath you to rocket into the air, knocking back and scorching nearby enemies.' },
    { key: 'X', id: 'meteor', name: 'Meteor', ult: true, cost: ULT_COST, desc: 'ULTIMATE — Call a meteor onto the target area. After a short warning it hits hard and leaves the ground burning.' },
  ],
};

const COOLDOWN = { bolt: 0.3, orb: 7, wall: 15, leap: 10 };
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export class PyroKit {
  constructor(match) {
    this.m = match;
    this.def = PYRO;
    this.cd = { bolt: 0, orb: 0, wall: 0, leap: 0 };
    this.max = { orb: 7, wall: 15, leap: 10 };
    this.ult = 0;
    this.side = 1; // alternating punch hand
    this.pending = [];
    this.busy = 0; // can't start another ability
    this.ultReadyAnnounced = false;
  }

  reset() { this.cd = { bolt: 0, orb: 0, wall: 0, leap: 0 }; this.pending.length = 0; this.busy = 0; }
  slots() { return [['orb', 'E'], ['wall', 'C'], ['leap', 'V'], ['meteor', 'X']]; }
  addUlt(v) {
    this.ult = Math.min(ULT_COST, this.ult + v);
    if (this.ult >= ULT_COST && !this.ultReadyAnnounced) { this.ultReadyAnnounced = true; this.m.onUltReady(); }
  }

  update(dt, input) {
    const m = this.m;
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    this.busy = Math.max(0, this.busy - dt);
    this.addUlt(dt * 0.35);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      p.t -= dt;
      if (p.t <= 0) { this.pending.splice(i, 1); if (m.local.alive) p.fn(); }
    }
    if (!m.local.alive || !m.controlsActive) return;
    const pr = input.pressed;
    if (pr.e) this.orb();
    if (pr.c) this.wall();
    if (pr.v) this.leap();
    if (pr.x) this.meteor();
    if (input.state.fire || pr.fire) this.bolt();
  }

  _ready(id) {
    if (this.busy > 0) { return false; }
    if (this.cd[id] > 0) { if (id !== 'bolt') this.m.hud.denied(id); return false; }
    return true;
  }

  // origin → aim point direction (falls back to camera forward when the target is too close)
  _aimDir(origin, out) {
    const aim = this.m.aimPoint;
    out.copy(aim).sub(origin);
    const d = out.length();
    if (d < 2) out.copy(this.m.cam.fwd); else out.divideScalar(d);
    return out;
  }

  bolt() {
    if (!this._ready('bolt')) return;
    const m = this.m;
    this.cd.bolt = COOLDOWN.bolt;
    const side = this.side > 0 ? 'R' : 'L';
    this.side = -this.side;
    m.playAnim('cast', { anim: side === 'R' ? 'boltR' : 'boltL' });
    this.pending.push({ t: 0.055, fn: () => {
      const o = m.view.palmWorld(side, tmp);
      // pull the origin toward the chest line so bolts never start inside walls
      const dir = this._aimDir(o, tmp2);
      const v = dir.multiplyScalar(PROJ.bolt.speed);
      m.fx.castBurst(o, dir.clone().normalize(), 0.5);
      m.castAbility({ ab: 'bolt', o: [o.x, o.y, o.z], d: [v.x, v.y, v.z] });
      m.sound('bolt', o, 0.55, 30);
      m.cam.kick += 0.006;
    } });
  }

  orb() {
    if (!this._ready('orb')) return;
    const m = this.m;
    this.cd.orb = COOLDOWN.orb; this.busy = 0.3;
    m.playAnim('cast', { anim: 'orb' });
    m.sound('orb', m.local.pos, 0.8, 30);
    this.pending.push({ t: 0.24, fn: () => {
      const a = m.view.palmWorld('R', tmp), b = m.view.palmWorld('L', new THREE.Vector3());
      const o = a.add(b).multiplyScalar(0.5);
      const dir = this._aimDir(o, tmp2);
      dir.y += 0.06; dir.normalize();
      const v = dir.multiplyScalar(PROJ.orb.speed);
      m.fx.castBurst(o, dir.clone().normalize(), 1.2);
      m.castAbility({ ab: 'orb', o: [o.x, o.y, o.z], d: [v.x, v.y, v.z] });
      m.cam.kick += 0.02;
    } });
  }

  wall() {
    if (!this._ready('wall')) return;
    const m = this.m;
    // placement: where the crosshair meets the ground, within 16 m
    const me = m.local.pos;
    const aim = m.aimPoint;
    tmp.set(aim.x - me.x, 0, aim.z - me.z);
    let d = tmp.length();
    if (d < 0.01) { tmp.set(Math.sin(m.cam.yaw), 0, Math.cos(m.cam.yaw)); d = 1; }
    tmp.divideScalar(d);
    const dist = Math.max(3, Math.min(16, d));
    const cx = me.x + tmp.x * dist, cz = me.z + tmp.z * dist;
    const rot = Math.atan2(tmp.x, tmp.z); // wall runs perpendicular to the throw direction
    this.cd.wall = COOLDOWN.wall; this.busy = 0.55;
    m.body.locked = 0.42;
    m.playAnim('slam');
    this.pending.push({ t: 0.28, fn: () => {
      const cy = m.world.groundAt(cx, cz, me.y + 6);
      m.castAbility({ ab: 'wall', c: [cx, cy, cz], r: rot });
      m.fx.shake(0.15);
    } });
  }

  leap() {
    if (!this._ready('leap')) return;
    const m = this.m;
    this.cd.leap = COOLDOWN.leap; this.busy = 0.25;
    m.playAnim('leap');
    this.pending.push({ t: 0.1, fn: () => {
      const b = m.body;
      const inp = m.app.input.state;
      const sy = Math.sin(b.yaw), cy = Math.cos(b.yaw);
      tmp.set(sy * inp.fwd - cy * inp.side, 0, cy * inp.fwd + sy * inp.side);
      if (tmp.lengthSq() < 0.01) tmp.set(sy, 0, cy); else tmp.normalize();
      b.vel.set(tmp.x * 7.5, 12.5, tmp.z * 7.5);
      b.grounded = false; b.leaping = true; b.airDashed = false;
      const o = b.pos;
      m.castAbility({ ab: 'leap', o: [o.x, o.y, o.z] });
    } });
  }

  meteor() {
    const m = this.m;
    if (this.ult < 100) { m.hud.denied('meteor'); return; }
    if (this.busy > 0) return;
    // target: crosshair point on the ground, up to 55 m away
    const me = m.local.pos;
    tmp.copy(m.aimPoint);
    tmp2.set(tmp.x - me.x, 0, tmp.z - me.z);
    const d = tmp2.length();
    if (d > 55) { tmp2.multiplyScalar(55 / d); tmp.set(me.x + tmp2.x, 0, me.z + tmp2.z); }
    const target = new THREE.Vector3(tmp.x, m.world.groundAt(tmp.x, tmp.z, tmp.y + 2), tmp.z);
    this.ult = 0; this.ultReadyAnnounced = false;
    this.busy = 0.9;
    m.body.slow = 0.45; setTimeout(() => { m.body.slow = 1; }, 900);
    m.playAnim('cast', { anim: 'ult' });
    m.sound('meteorCall', me, 0.9, 60);
    this.pending.push({ t: 0.5, fn: () => {
      m.castAbility({ ab: 'meteor', c: [target.x, target.y, target.z] });
    } });
  }
}
