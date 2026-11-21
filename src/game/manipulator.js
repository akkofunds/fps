import { BAL, ADMIN } from './balance.js';
import * as THREE from 'three';
import { ULT_COST } from '../config.js';
import { MeleeCombo } from './melee.js';

// THE MANIPULATOR (Ayanokouji Kiyotaka): never raises his voice, never wastes a motion. Every
// opponent is a piece on his board, and the board was set before the match began.
//   Passive White Room · LMB Efficient Strikes · Q King's Step · E Knight's Fork
//   C Rook's File · V Queen's Gambit · X Checkmate (admin-only character, the ultimate kills everyone)
export const MANIP = {
  id: 'manipulator',
  name: 'MANIPULATOR',
  role: 'THE WHITE ROOM',
  model: 'models/manipulator.glb',
  color: '#e9e9ec',
  // White Room conditioning: an extra dash charge that refills faster, nothing flashy
  perk: { speed: 1.02, airJumps: 1, dashMax: 3, dashRate: 1.2 },
  bio: 'Top of nothing on paper, first in everything that matters. A product of the White Room, he treats every person as a piece on a board, and he has already played the game to its last move before you notice it started.',
  abilities: [
    { key: 'LMB', id: 'm1', name: 'Efficient Strikes', desc: 'M1: a 4-hit string with one hand in his pocket and no wasted motion: right straight, turning elbow, low roundhouse, then a stepping palm strike that launches. Every hit stuns and each swing steps you in.' },
    { key: 'Q', id: 'dash', name: "King's Step", desc: 'Passive White Room: 3 dash charges that refill faster. One square in any direction, always exactly where he meant to be.' },
    { key: 'E', id: 'knight', name: "Knight's Fork", cd: 8, desc: 'Jump in an L like the knight, two squares forward and one across, onto the spot you aim at. The white knight crashes down where you land: 24 damage and a stun to everyone on that square.' },
    { key: 'C', id: 'rook', name: "Rook's File", cd: 10, desc: 'A giant black rook slams down where you aim (18), then charges straight down the file away from you, ramming everyone in its path aside (24).' },
    { key: 'V', id: 'queen', name: "Queen's Gambit", cd: 13, desc: 'Raise the white queen at your crosshair. A heartbeat later light races out along all eight of her lines: everyone on any line takes 30 and is slowed.' },
    { key: 'X', id: 'checkmate', name: 'Checkmate', ult: true, cost: ULT_COST, desc: 'ULTIMATE — The field becomes his board. Every enemy is surrounded, their king is toppled, and the game ends. Kills everyone.' },
  ],
};

// M1: the shared fist string, a touch faster and cleaner
export const MANIP_M1 = {
  hits: [
    { anim: 'mnA', at: 0.05, dmg: 9, stun: 0.55, kb: 2.2, up: 0, hand: 'R' },
    { anim: 'mnB', at: 0.06, dmg: 9, stun: 0.55, kb: 2.4, up: 0, hand: 'R' },
    { anim: 'mnC', at: 0.1, dmg: 10, stun: 0.6, kb: 2.6, up: 0, hand: 'footR' },
    { anim: 'mnD', at: 0.15, dmg: 15, stun: 0.9, kb: 16, up: 7, hand: 'R', fin: true },
  ],
  gap: 0.28, window: 1.0, endlag: 0.8, range: 2.9, cone: 0.4, seek: 3.0, seekCone: 0.82, lungeMax: 11,
};
export const KNIGHT = { range: 14, fwd: 2 / 3, minSide: 2.5, hop: 0.2, leg1: 0.2, leg2: 0.14, radius: 3.1, dmg: 24, stun: 0.6 };
export const ROOK = { range: 24, drop: 0.26, slamR: 3.2, slam: 18, len: 18, dur: 0.6, width: 2.3, dmg: 24, kb: 14 };
export const QUEEN = { range: 24, delay: 0.5, len: 16, width: 1.5, dmg: 30, slow: 0.55, slowT: 1.6 };
export const CHECKMATE = { dur: 11.2, kill: 8.6 };

const COOLDOWN = { knight: 8, rook: 10, queen: 13 };
const cdOf = (base) => (BAL.noCooldowns ? 0 : base * BAL.cd);
const tmp = new THREE.Vector3();

export class ManipulatorKit {
  constructor(match) {
    this.m = match;
    this.def = MANIP;
    this.cd = { knight: 0, rook: 0, queen: 0 };
    this.max = { ...COOLDOWN };
    this.ult = 0;
    this.pending = [];
    this.busy = 0;
    this.ultReadyAnnounced = false;
    this.melee = new MeleeCombo(this, 'chess', MANIP_M1);
    this.leap = null;
  }

  reset() { for (const k in this.cd) this.cd[k] = 0; this.pending.length = 0; this.busy = 0; this.leap = null; }
  slots() { return [['knight', 'E'], ['rook', 'C'], ['queen', 'V'], ['checkmate', 'X']]; }
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
    if (this.leap) this._leapTick(dt);
    if (!m.local.alive || !m.controlsActive) return;
    const pr = input.pressed;
    const buf = this.buf || (this.buf = { e: 0, c: 0, v: 0, x: 0 });
    for (const k in buf) buf[k] = pr[k] ? 0.4 : Math.max(0, buf[k] - dt);
    const go = (k, fn) => { if (buf[k] > 0 && this.busy <= 0) { buf[k] = 0; fn(); } };
    go('e', () => this.knight());
    go('c', () => this.rook());
    go('v', () => this.queen());
    go('x', () => this.checkmate());
    if (!this.leap) this.melee.update(dt, input);
  }

  _ready(id) {
    if (this.busy > 0) return false;
    if (this.cd[id] > 0) { this.m.app.hud.denied(id); return false; }
    return true;
  }
  _enemies() { const m = this.m; return [...m.ents.values()].filter((e) => e !== m.local && e.alive); }
  // the ground point under the crosshair, clamped to range — or the enemy the crosshair is on
  // (only one it is actually pointing at: no lock-on, no aim assist beyond that)
  _groundTarget(range) {
    const m = this.m, me = m.body.pos;
    const o = m.camera.position, dir = m.camera.getWorldDirection(new THREE.Vector3());
    let best = null, bt = 1e9;
    for (const t of this._enemies()) {
      const v = new THREE.Vector3(t.pos.x, t.pos.y + 1, t.pos.z).sub(o);
      const along = v.dot(dir);
      if (along < 0) continue;
      const perp = v.addScaledVector(dir, -along).length();
      if (perp < 1.1 + along * 0.03 && along < bt && Math.hypot(t.pos.x - me.x, t.pos.z - me.z) < range + 1) { bt = along; best = t; }
    }
    if (best) return new THREE.Vector3(best.pos.x, m.world.groundAt(best.pos.x, best.pos.z, best.pos.y + 3), best.pos.z);
    tmp.copy(m.aimPoint);
    const dx = tmp.x - me.x, dz = tmp.z - me.z, d = Math.hypot(dx, dz);
    if (d > range) { tmp.x = me.x + dx / d * range; tmp.z = me.z + dz / d * range; }
    if (d < 1.5) { const y = m.cam.yaw; tmp.x = me.x + Math.sin(y) * 6; tmp.z = me.z + Math.cos(y) * 6; }
    return new THREE.Vector3(tmp.x, m.world.groundAt(tmp.x, tmp.z, me.y + 8), tmp.z);
  }

  // ---------------------------------------------------------------- E: Knight's Fork
  knight() {
    if (!this._ready('knight')) return;
    const m = this.m, b = m.body;
    this.cd.knight = cdOf(COOLDOWN.knight); this.busy = KNIGHT.leg1 + KNIGHT.leg2 + 0.25;
    const a = b.pos.clone(), T = this._groundTarget(KNIGHT.range);
    const yw = m.cam.yaw, F = new THREE.Vector3(Math.sin(yw), 0, Math.cos(yw)), S = new THREE.Vector3(F.z, 0, -F.x);
    // decompose the jump into the knight's L: the long leg straight ahead, the short one across
    // the L always ends exactly on the target square: the long leg runs ahead, the short leg cuts
    // across onto it (straight ahead → the corner is set a square to the side of the target)
    const rel = T.clone().sub(a);
    let along = rel.dot(F), side = rel.dot(S);
    if (along < 3) { along = 3; T.copy(a).addScaledVector(F, along).addScaledVector(S, side); }
    const cut = Math.abs(side) < KNIGHT.minSide ? (side >= 0 ? -1 : 1) * Math.max(KNIGHT.minSide, Math.min(4, along * 0.35)) : -side;
    const corner = T.clone().addScaledVector(S, cut);
    // land on the edge of their square (never inside them): the hit covers the whole square
    const end = T.clone().addScaledVector(S, Math.sign(cut) * 1.1);
    side = -cut;
    corner.y = m.world.groundAt(corner.x, corner.z, a.y + 8); end.y = m.world.groundAt(end.x, end.z, a.y + 8);
    this.leap = { t: 0, a, corner, end, sq: T.clone(), F, S: S.clone().multiplyScalar(Math.sign(side)), leg: 0, hit: false };
    b.locked = KNIGHT.leg1 + KNIGHT.leg2 + 0.1;
    m.playAnim('leap', { dir: 0 });
    m.castAbility({ ab: 'knight', a: a.toArray(), c: corner.toArray(), b: T.toArray() });
    m.sound('blink', a, 0.8, 30);
  }

  _leapTick(dt) {
    const m = this.m, b = m.body, L = this.leap;
    L.t += dt;
    const k1 = KNIGHT.leg1, k2 = KNIGHT.leg2;
    // two straight hops along the L (position-driven: the leap always lands exactly on its square)
    let p;
    if (L.t < k1) { const u = L.t / k1; p = L.a.clone().lerp(L.corner, u); p.y += Math.sin(u * Math.PI) * 2.2; }
    else if (L.t < k1 + k2) { const u = (L.t - k1) / k2; p = L.corner.clone().lerp(L.end, u); p.y += Math.sin(u * Math.PI) * 1.4; }
    else p = L.end.clone();
    b.pos.copy(p); b.vel.set(0, 0, 0);
    if (L.t >= k1 + k2 && !L.hit) {
      L.hit = true;
      b.pos.y = m.world.groundAt(L.end.x, L.end.z, L.end.y + 3);
      m.playAnim('slam');
      m.fx.shake(0.25);
      for (const t of this._enemies()) {
        const dx = t.pos.x - L.sq.x, dz = t.pos.z - L.sq.z, d = Math.hypot(dx, dz);
        if (d < KNIGHT.radius && Math.abs(t.pos.y - L.end.y) < 3) this.m.reportHit(t, KNIGHT.dmg, 'knight', { stun: KNIGHT.stun, kb: [dx / (d || 1) * 6, 5, dz / (d || 1) * 6], at: new THREE.Vector3(t.pos.x, t.pos.y + 1.3, t.pos.z) });
      }
    }
    if (L.t >= k1 + k2 + 0.05) this.leap = null;
  }

  // ---------------------------------------------------------------- C: Rook's File
  rook() {
    if (!this._ready('rook')) return;
    const m = this.m, b = m.body;
    this.cd.rook = cdOf(COOLDOWN.rook); this.busy = 0.45;
    const c = this._groundTarget(ROOK.range);
    const dir = new THREE.Vector3(c.x - b.pos.x, 0, c.z - b.pos.z);
    if (dir.lengthSq() < 1) dir.set(Math.sin(m.cam.yaw), 0, Math.cos(m.cam.yaw));
    dir.normalize();
    m.playAnim('cast', { anim: 'mnCmd' });
    m.castAbility({ ab: 'rook', c: c.toArray(), d: [dir.x, dir.z] });
    // the slam, then the charge: everyone in its lane once
    this.pending.push({ t: ROOK.drop, fn: () => {
      for (const t of this._enemies()) {
        const dx = t.pos.x - c.x, dz = t.pos.z - c.z, d = Math.hypot(dx, dz);
        if (d < ROOK.slamR) m.reportHit(t, ROOK.slam, 'rookSlam', { kb: [dx / (d || 1) * 5, 6, dz / (d || 1) * 5], at: new THREE.Vector3(t.pos.x, t.pos.y + 1.3, t.pos.z) });
      }
      const hit = new Set();
      let tt = 0;
      const step = () => {
        tt += 0.05;
        const s = Math.min(1, tt / ROOK.dur) * ROOK.len;
        const p = c.clone().addScaledVector(dir, s);
        for (const t of this._enemies()) {
          if (hit.has(t)) continue;
          const dx = t.pos.x - p.x, dz = t.pos.z - p.z;
          if (Math.hypot(dx, dz) < ROOK.width) {
            hit.add(t);
            const sd = Math.sign(dx * dir.z - dz * dir.x) || 1;
            m.reportHit(t, ROOK.dmg, 'rook', { kb: [dir.x * ROOK.kb + dir.z * sd * 6, 6, dir.z * ROOK.kb - dir.x * sd * 6], at: new THREE.Vector3(t.pos.x, t.pos.y + 1.3, t.pos.z) });
          }
        }
        if (tt < ROOK.dur) this.pending.push({ t: 0.05, fn: step });
      };
      step();
    } });
  }

  // ---------------------------------------------------------------- V: Queen's Gambit
  queen() {
    if (!this._ready('queen')) return;
    const m = this.m, b = m.body;
    this.cd.queen = cdOf(COOLDOWN.queen); this.busy = 0.55;
    b.slow = 0.4; this.pending.push({ t: 0.55, fn: () => { b.slow = 1; } });
    const c = this._groundTarget(QUEEN.range), yaw = Math.round(m.cam.yaw * 100) / 100;
    m.playAnim('cast', { anim: 'mnRaise' });
    m.castAbility({ ab: 'queen', c: c.toArray(), yaw });
    this.pending.push({ t: QUEEN.delay, fn: () => {
      for (const t of this._enemies()) {
        const dx = t.pos.x - c.x, dz = t.pos.z - c.z, d = Math.hypot(dx, dz);
        if (d > QUEEN.len + 0.5 || Math.abs(t.pos.y - c.y) > 4) continue;
        // on one of her eight lines?
        let best = 1e9;
        for (let i = 0; i < 8; i++) {
          const a = yaw + (i / 8) * Math.PI * 2, ux = Math.sin(a), uz = Math.cos(a);
          const along = dx * ux + dz * uz;
          if (along < -0.5) continue;
          best = Math.min(best, Math.abs(dx * uz - dz * ux));
        }
        if (best < QUEEN.width || d < 2.2) m.reportHit(t, QUEEN.dmg, 'queen', { slow: [QUEEN.slow, QUEEN.slowT], kb: [dx / (d || 1) * 4, 3, dz / (d || 1) * 4], at: new THREE.Vector3(t.pos.x, t.pos.y + 1.3, t.pos.z) });
      }
    } });
  }

  // ---------------------------------------------------------------- X: Checkmate
  checkmate() {
    const m = this.m, b = m.body;
    if (this.busy > 0) return;
    if (this.ult < ULT_COST) { m.app.hud.denied('checkmate'); return; }
    if (m.cine) return;
    this.ult = 0; this.ultReadyAnnounced = false;
    this.busy = CHECKMATE.dur; b.locked = CHECKMATE.dur; b.vel.set(0, 0, 0);
    const p = b.pos;
    // the cutscene plays for everyone; at its end the caster's client resolves the kills
    m.castAbility({ ab: 'checkmate', c: [p.x, p.y, p.z], yaw: Math.round(b.yaw * 100) / 100 });
  }
}
