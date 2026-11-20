import * as THREE from 'three';

// Battlegrounds-style M1 combo (Shoto, Sorcerer): left click = jab → cross → hook → flying kick.
// Each hit stuns the target (can't move or attack) long enough for the next hit to connect, the
// finisher launches them. Every swing lunges you onto the target in front of you so the string
// stays in range. Hits are resolved by the attacker (like every other ability) and the host applies
// damage + stun + knockback.
export const M1 = {
  hits: [
    { anim: 'm1a', at: 0.06, dmg: 9, stun: 0.55, kb: 2.2, up: 0, hand: 'L' },
    { anim: 'm1b', at: 0.07, dmg: 9, stun: 0.55, kb: 2.2, up: 0, hand: 'R' },
    { anim: 'm1c', at: 0.12, dmg: 10, stun: 0.6, kb: 2.6, up: 0, hand: 'L' },
    { anim: 'm1d', at: 0.16, dmg: 15, stun: 0.9, kb: 16, up: 7, hand: 'footR', fin: true },
  ],
  gap: 0.3,        // between swings
  window: 1.0,     // press within this after a hit to continue the string
  endlag: 0.85,    // after the finisher
  range: 2.9,      // reach (metres, from your feet to theirs)
  cone: 0.4,       // dot(facing, to-target) at least this
  seek: 3.0,       // targets this close (and in front) get a short step-in
  seekCone: 0.82,  // …only if they're nearly straight ahead
  lungeMax: 11,    // step-in speed cap (m/s): closes a gap, never drags you across the map
};

const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

export class MeleeCombo {
  // style: 'frostflame' (Shoto) | 'cursed' (Sorcerer) | 'spear' (Kine Slayer); def: the string
  // (hits / timing / reach), M1 by default
  constructor(kit, style, def = M1) {
    this.k = kit; this.m = kit.m; this.style = style; this.D = def;
    this.i = 0; this.cd = 0; this.last = -9;
  }

  update(dt, input) {
    this.cd = Math.max(0, this.cd - dt);
    if ((input.state.fire || input.pressed.fire) && this.cd <= 0 && this.k.busy <= 0) this.swing();
  }

  _facing(out) { const y = this.m.cam.yaw; return out.set(Math.sin(y), 0, Math.cos(y)); }

  // the enemy most in front of you within seek range
  _target(fwd, maxD) {
    const m = this.m, p = m.body.pos;
    let best = null, bestS = -1;
    for (const e of m.ents.values()) {
      if (e === m.local || !e.alive) continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d > maxD || Math.abs(e.pos.y - p.y) > 2.2) continue;
      const dot = d > 0.01 ? (dx * fwd.x + dz * fwd.z) / d : 1;
      if (dot < (this.D.seekCone || this.D.cone)) continue;
      const s = dot * 2 - d / maxD;
      if (s > bestS) { bestS = s; best = e; }
    }
    return best;
  }

  swing() {
    const m = this.m, b = m.body, k = this.k;
    if (m.time - this.last > this.D.window) this.i = 0;
    const idx = this.i, h = this.D.hits[idx];
    this.last = m.time;
    this.i = (idx + 1) % this.D.hits.length;
    this.cd = h.fin ? this.D.endlag : this.D.gap;
    const fwd = this._facing(new THREE.Vector3());
    // lunge onto the target in front of you (TSB-style), or a short step forward
    const tgt = this._target(fwd, this.D.seek);
    if (tgt) {
      const dx = tgt.pos.x - b.pos.x, dz = tgt.pos.z - b.pos.z, d = Math.hypot(dx, dz);
      fwd.set(dx / d, 0, dz / d);
      // stop about an arm's length away (the lunge carries a little momentum past its end)
      const stop = this.D.stop || 1.45;
      if (d > stop + 0.05) b.lunge(fwd, Math.min(this.D.lungeMax || 11, (d - stop) / 0.12), 0.12);
    } else b.lunge(fwd, h.fin ? 9 : 5, 0.1);
    b.slow = 0.35;
    k.pending.push({ t: h.fin ? 0.5 : 0.32, fn: () => { b.slow = 1; } });
    m.playAnim(h.anim);
    m.faceLockT = 0.5;
    const o = b.pos;
    m.castAbility({ ab: 'm1', i: idx, s: this.style, o: [o.x, o.y, o.z], d: [Math.round(fwd.x * 100) / 100, Math.round(fwd.z * 100) / 100] });
    m.sound(h.sfx || (h.fin ? 'kick' : 'swing'), o, 0.6, 25);
    // the impact frame: everyone in front of you within reach takes the hit
    k.pending.push({ t: h.at, fn: () => {
      const p = m.body.pos;
      let hits = 0;
      for (const e of m.ents.values()) {
        if (e === m.local || !e.alive) continue;
        const dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz);
        if (d > this.D.range || Math.abs(e.pos.y - p.y) > 2) continue;
        if (d > 0.4 && (dx * fwd.x + dz * fwd.z) / d < this.D.cone) continue;
        const at = tmp.set(e.pos.x - fwd.x * 0.3, e.pos.y + (h.atY || (h.fin ? 1.0 : 1.35)), e.pos.z - fwd.z * 0.3);
        m.reportHit(e, h.dmg, h.fin ? 'm1f' : 'm1', { stun: h.stun, kb: [fwd.x * h.kb, h.up, fwd.z * h.kb], at: at.clone() });
        m.castAbility({ ab: 'm1hit', s: this.style, i: idx, v: e.n, p: [at.x, at.y, at.z], d: [fwd.x, fwd.z] });
        hits++;
      }
      if (hits) {
        // hit-stop feel: a kick of the camera, a jolt of shake; the finisher gets impact frames
        m.cam.kick += h.fin ? 0.05 : 0.018;
        m.fx.shake(h.fin ? 0.45 : 0.14);
        if (h.fin) m.app.hud.dashImpact();
      }
    } });
  }
}
