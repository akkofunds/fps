import { BAL, ADMIN } from './balance.js';
import * as THREE from 'three';
import { ULT_COST } from '../config.js';
import { PROJ } from './projectiles.js';

// PYRO — Fire-soldier (Fire Force style kit). Kit definition (lobby/HUD) + owner-side ability logic.
//   LMB Ember Fists · E Devil's Foot · C Rapid Ignition · V Infernal Step · X Adolla Burst
export const PYRO = {
  id: 'pyro',
  name: 'PYRO',
  role: 'FIRE SOLDIER',
  model: 'models/pyro.glb',
  color: '#ff6a2b',
  bio: 'A third-generation fire soldier who fights with his feet. Pyro rockets in with flaming kicks, buries enemies in stacking burns and ends fights with a beam of pure, concentrated flame.',
  abilities: [
    { key: 'LMB', id: 'bolt', name: 'Ember Fists', desc: 'Throw rapid fire punches that launch ember bolts. 18 damage, 27 on headshots.' },
    { key: 'Q', id: 'dash', name: 'Flare Step', desc: 'Burst a short distance in the direction you are moving. 2 charges. Dash in the air and you roll when you land. Press jump again in the air to double jump.' },
    { key: 'E', id: 'kick', name: "Devil's Foot", cd: 8, desc: 'Rocket forward with a flaming kick. Hit an enemy to launch them into the air. Leaves a burning trail behind you.' },
    { key: 'C', id: 'ignite', name: 'Rapid Ignition', cd: 9, desc: 'Fire a fan of 7 fireballs in a wide cone. Every hit stacks burn, and 3 hits on the same enemy within 2 seconds set off an explosion.' },
    { key: 'V', id: 'step', name: 'Infernal Step', cd: 11, desc: 'Plant both feet and blast a ring of fire around you that knocks enemies back and slows them. You gain a burst of speed afterwards.' },
    { key: 'X', id: 'adolla', name: 'Adolla Burst', ult: true, cost: ULT_COST, desc: 'ULTIMATE — Gather your flame, then unleash a massive beam of pure fire in a straight line. Pierces every enemy in its path and leaves a long burning scar on the ground.' },
  ],
};

export const KICK = { speed: 25, time: 0.34, dmg: 32, radius: 1.35 };
export const IGNITE = { count: 7, spread: 0.46, window: 2, boomR: 2.8, boomDmg: 30 };
export const STEP = { radius: 6, maxDmg: 34, minDmg: 18, slow: 0.5, slowT: 2, boost: 2.2 };
export const ADOLLA = { charge: 0.75, beam: 0.95, range: 48, width: 2.1, dmg: 120, path: 6 };

const COOLDOWN = { bolt: 0.3, kick: 8, ignite: 9, step: 11 };
// bolt-type fire rates are not shortened below 60% even with admin cooldown tweaks
const cdOf = (base) => (BAL.noCooldowns ? (base < 1 ? base * 0.6 : 0) : base * (base < 1 ? Math.max(0.6, BAL.cd) : BAL.cd));
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();

export class PyroKit {
  constructor(match) {
    this.m = match;
    this.def = PYRO;
    this.cd = { bolt: 0, kick: 0, ignite: 0, step: 0 };
    this.max = { kick: COOLDOWN.kick, ignite: COOLDOWN.ignite, step: COOLDOWN.step };
    this.ult = 0;
    this.side = 1; // alternating punch hand
    this.pending = [];
    this.busy = 0; // can't start another ability
    this.ultReadyAnnounced = false;
    this.kickT = 0; this.kickHit = null; this.kickDir = new THREE.Vector3();
    this.stacks = new Map(); // enemy n → { n, t } Rapid Ignition stacks
  }

  reset() { this.cd = { bolt: 0, kick: 0, ignite: 0, step: 0 }; this.pending.length = 0; this.busy = 0; this.kickT = 0; this.stacks.clear(); }
  slots() { return [['kick', 'E'], ['ignite', 'C'], ['step', 'V'], ['adolla', 'X']]; }
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
    if (this.kickT > 0) this._kickTick(dt);
    if (!m.local.alive || !m.controlsActive) return;
    const pr = input.pressed;
    // input buffer: a press during another ability's animation goes off as soon as it ends
    const buf = this.buf || (this.buf = { e: 0, c: 0, v: 0, x: 0 });
    for (const k in buf) buf[k] = pr[k] ? 0.3 : Math.max(0, buf[k] - dt);
    const go = (k, fn) => { if (buf[k] > 0 && this.busy <= 0) { buf[k] = 0; fn(); } };
    go('e', () => this.kick());
    go('c', () => this.ignite());
    go('v', () => this.step());
    go('x', () => this.adolla());
    if (input.state.fire || pr.fire) this.bolt();
  }

  _ready(id) {
    if (this.busy > 0) { return false; }
    if (this.cd[id] > 0) { if (id !== 'bolt') this.m.app.hud.denied(id); return false; }
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
  _flatAim(out) { const y = this.m.cam.yaw; return out.set(Math.sin(y), 0, Math.cos(y)); }

  // ---------------------------------------------------------------- LMB
  bolt() {
    if (!this._ready('bolt')) return;
    const m = this.m;
    this.cd.bolt = cdOf(COOLDOWN.bolt);
    const side = this.side > 0 ? 'R' : 'L';
    this.side = -this.side;
    m.playAnim('cast', { anim: side === 'R' ? 'boltR' : 'boltL' });
    this.pending.push({ t: 0.055, fn: () => {
      const o = m.view.palmWorld(side, tmp);
      const dir = this._aimDir(o, tmp2);
      const v = dir.multiplyScalar(PROJ.bolt.speed);
      m.fx.castBurst(o, dir.clone().normalize(), 0.5);
      m.castAbility({ ab: 'bolt', o: [o.x, o.y, o.z], d: [v.x, v.y, v.z] });
      m.sound('bolt', o, 0.55, 30);
      m.cam.kick += 0.006;
    } });
  }

  // ---------------------------------------------------------------- E — Devil's Foot
  kick() {
    if (!this._ready('kick')) return;
    const m = this.m, b = m.body;
    this.cd.kick = cdOf(COOLDOWN.kick); this.busy = 0.5;
    const dir = this._flatAim(this.kickDir);
    // how far the kick can go before a wall stops it (for the trail)
    const o = b.pos;
    const hitD = m.world.raycast(o.x, o.y + 0.9, o.z, dir.x, 0, dir.z, KICK.speed * KICK.time, 0.3);
    const dist = Math.min(KICK.speed * KICK.time, hitD);
    b.lunge(dir, KICK.speed, KICK.time * (dist / (KICK.speed * KICK.time)) + 0.02);
    b.vel.y = Math.max(b.vel.y, 2.5); b.grounded = false;
    this.kickT = KICK.time + 0.04; this.kickHit = null;
    m.playAnim('kick');
    m.castAbility({ ab: 'kick', o: [o.x, o.y, o.z], d: [dir.x, dir.z], l: Math.round(dist * 100) / 100 });
    m.cam.kick += 0.02; m.fx.shake(0.12);
  }

  _kickTick(dt) {
    const m = this.m, b = m.body;
    this.kickT -= dt;
    if (this.kickHit || !m.local.alive) return;
    for (const e of m.ents.values()) {
      if (e === m.local || !e.alive) continue;
      const dx = e.pos.x - b.pos.x, dz = e.pos.z - b.pos.z;
      if (dx * dx + dz * dz > KICK.radius * KICK.radius || Math.abs(e.pos.y - b.pos.y) > 1.9) continue;
      // connect: launch them, bounce off
      this.kickHit = e;
      const d = this.kickDir;
      m.reportHit(e, KICK.dmg, 'kick', { kb: [d.x * 6, 14, d.z * 6], burn: [5, 2.5], at: new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z) });
      b.lungeT = 0;
      b.vel.set(-d.x * 3.5, 6.5, -d.z * 3.5); b.grounded = false;
      m.castAbility({ ab: 'kickHit', c: [e.pos.x, e.pos.y + 1, e.pos.z], d: [d.x, d.z] });
      m.fx.shake(0.35); m.cam.kick += 0.04;
      m.app.hud.hitStop && m.app.hud.hitStop();
      break;
    }
  }

  // ---------------------------------------------------------------- C — Rapid Ignition
  ignite() {
    if (!this._ready('ignite')) return;
    const m = this.m;
    this.cd.ignite = cdOf(COOLDOWN.ignite); this.busy = 0.42;
    m.body.slow = 0.6; this.pending.push({ t: 0.42, fn: () => { m.body.slow = 1; } });
    const n = IGNITE.count;
    for (let i = 0; i < n; i++) {
      this.pending.push({ t: 0.03 + i * 0.045, fn: () => {
        const side = i % 2 ? 'L' : 'R';
        if (i % 2 === 0 || i === n - 1) m.playAnim('cast', { anim: side === 'R' ? 'jabR' : 'jabL' });
        const o = m.view.palmWorld(side, tmp);
        const dir = this._aimDir(o, tmp2);
        // fan: spread across the cone around the aim direction (yaw), slight random pitch
        const a = (i / (n - 1) - 0.5) * 2 * IGNITE.spread;
        const c = Math.cos(a), s = Math.sin(a);
        const dx = dir.x * c + dir.z * s, dz = -dir.x * s + dir.z * c;
        tmp3.set(dx, dir.y + (Math.random() - 0.5) * 0.04, dz).normalize().multiplyScalar(PROJ.ember.speed);
        m.castAbility({ ab: 'ember', o: [o.x, o.y, o.z], d: [tmp3.x, tmp3.y, tmp3.z] });
        if (i % 2 === 0) m.sound('ember', o, 0.45, 25);
        m.cam.kick += 0.005;
      } });
    }
  }

  // called by Projectiles when one of OUR embers hits someone
  onEmberHit(target, pos) {
    const m = this.m;
    const now = m.time;
    let st = this.stacks.get(target.n);
    if (!st || now - st.t > IGNITE.window) st = { n: 0, t: now };
    st.n++; st.t = now;
    this.stacks.set(target.n, st);
    m.reportHit(target, PROJ.ember.dmg, 'ember', { burn: [2 + st.n * 1.5, 2.5], at: pos });
    if (st.n >= 3) {
      this.stacks.delete(target.n);
      m.castAbility({ ab: 'igniteBoom', c: [target.pos.x, target.pos.y + 1, target.pos.z] });
    }
  }

  // ---------------------------------------------------------------- V — Infernal Step
  step() {
    if (!this._ready('step')) return;
    const m = this.m, b = m.body;
    this.cd.step = cdOf(COOLDOWN.step); this.busy = 0.5;
    b.locked = 0.32;
    m.playAnim('stomp');
    this.pending.push({ t: 0.2, fn: () => {
      const p = b.pos;
      m.castAbility({ ab: 'step', c: [p.x, p.y, p.z] });
      b.boostT = STEP.boost;
      m.fx.shake(0.3);
    } });
  }

  // ---------------------------------------------------------------- X — Adolla Burst
  adolla() {
    const m = this.m;
    if (this.ult < 100) { m.app.hud.denied('adolla'); return; }
    if (this.busy > 0) return;
    this.ult = 0; this.ultReadyAnnounced = false;
    const total = ADOLLA.charge + ADOLLA.beam + 0.35;
    this.busy = total;
    m.body.locked = ADOLLA.charge + ADOLLA.beam + 0.1;
    m.body.vel.x *= 0.2; m.body.vel.z *= 0.2;
    m.playAnim('adolla');
    // the beam follows the crosshair, kept fairly flat
    const o = m.local.pos;
    const origin = tmp.set(o.x, o.y + 1.25, o.z).addScaledVector(this._flatAim(tmp3), 0.7);
    const dir = this._aimDir(origin, tmp2);
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const pitch = Math.max(-0.3, Math.min(0.3, Math.atan2(dir.y, flat)));
    dir.set(dir.x / flat * Math.cos(pitch), Math.sin(pitch), dir.z / flat * Math.cos(pitch));
    // stops at terrain / walls
    const L = Math.min(ADOLLA.range, m.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, ADOLLA.range, 0.2));
    m.castAbility({ ab: 'adolla', o: [origin.x, origin.y, origin.z], d: [dir.x, dir.y, dir.z], l: Math.round(L * 100) / 100 });
  }
}
