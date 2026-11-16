import * as THREE from 'three';

// Simulated fire projectiles. Every client simulates every projectile for visuals; only the
// owner's client turns collisions into damage reports (shooter-side hit detection, host validates).

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpD = new THREE.Vector3(), tmpE = new THREE.Vector3(), hitInfo = { t: 0 };

// closest distance between segments p1-q1 and p2-q2; returns { d2, s } (s = param on first)
function segSeg(p1, q1, p2, q2) {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z, e = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
  else if (a <= 1e-9) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z, den = a * e - b * b;
      s = den !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const cx = p1.x + d1x * s - (p2.x + d2x * t), cy = p1.y + d1y * s - (p2.y + d2y * t), cz = p1.z + d1z * s - (p2.z + d2z * t);
  return { d2: cx * cx + cy * cy + cz * cz, s, t };
}

export const PROJ = {
  bolt: { speed: 58, grav: 0, radius: 0.07, life: 1.3, dmg: 18, head: 1.5 },
  orb: { speed: 33, grav: 7, radius: 0.38, life: 3, dmg: 20, head: 1 },
  spark: { speed: 46, grav: 0, radius: 0.08, life: 1.6, dmg: 20, head: 1.5 },
  ember: { speed: 50, grav: 2, radius: 0.1, life: 0.62, dmg: 9, head: 1 },
  blast: { speed: 46, grav: 0, radius: 0.14, life: 1.2, dmg: 26, head: 1.3 },
};

// character hit test: body capsule + head sphere. returns {s, head} or null
export function hitCharacter(e, a, b, radius) {
  const p = e.pos;
  tmpA.set(p.x, p.y + 0.3, p.z); tmpB.set(p.x, p.y + 1.42, p.z);
  const body = segSeg(a, b, tmpA, tmpB);
  const br = 0.3 + radius; // torso half-width: you have to actually be on them
  tmpA.set(p.x, p.y + 1.62, p.z); tmpB.set(p.x, p.y + 1.64, p.z);
  const head = segSeg(a, b, tmpA, tmpB);
  const hr = 0.16 + radius;
  const hb = body.d2 <= br * br, hh = head.d2 <= hr * hr;
  if (!hb && !hh) return null;
  if (hh && (!hb || head.s <= body.s + 0.02)) return { s: head.s, head: true };
  return { s: body.s, head: false };
}

export class Projectiles {
  constructor(match) {
    this.m = match;
    this.list = [];
  }

  spawn(owner, kind, o, v, local) {
    const def = PROJ[kind];
    this.list.push({ owner, kind, def, pos: new THREE.Vector3(o[0], o[1], o[2]), vel: new THREE.Vector3(v[0], v[1], v[2]), age: 0, local });
  }

  update(dt) {
    const m = this.m, world = m.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      const a = tmpA.copy(p.pos);
      p.vel.y -= p.def.grav * dt;
      const step = p.vel.length() * dt;
      const dir = tmpD.copy(p.vel).normalize();
      // world
      const tw = world.raycast(a.x, a.y, a.z, dir.x, dir.y, dir.z, step, p.def.radius * 0.6, hitInfo);
      const end = tmpE.copy(a).addScaledVector(dir, Math.min(step, tw));
      // characters
      let best = null, bestS = 2;
      for (const e of m.ents.values()) {
        if (e.n === p.owner || !e.alive) continue;
        const h = hitCharacter(e, a, end, p.def.radius);
        if (h && h.s < bestS) { bestS = h.s; best = { e, head: h.head }; }
      }
      if (best) {
        const hp = new THREE.Vector3().lerpVectors(a, end, bestS);
        this._impact(p, hp, best.e, best.head);
        this.list.splice(i, 1); continue;
      }
      if (tw < Infinity && tw <= step) {
        this._impact(p, end, null, false);
        this.list.splice(i, 1); continue;
      }
      p.pos.copy(end);
      if (p.age > p.def.life) {
        if (p.kind === 'orb' || p.kind === 'spark' || p.kind === 'blast') this._impact(p, p.pos, null, false); else if (p.kind === 'ember') m.fx.emberHit(p.pos); else m.fx.hitSpark(p.pos);
        this.list.splice(i, 1); continue;
      }
      // trail
      if (p.kind === 'bolt') m.fx.boltTrail(p.pos, p.vel);
      else if (p.kind === 'blast') m.fx.boltTrail(p.pos, p.vel, 2);
      else if (p.kind === 'spark') m.fx.sparkTrail(p.pos, p.vel);
      else if (p.kind === 'ember') m.fx.emberTrail(p.pos, p.vel);
      else m.fx.orbTrail(p.pos, p.vel, p.age);
    }
  }

  _impact(p, pos, target, head) {
    const m = this.m;
    if (p.kind === 'bolt') {
      m.fx.hitSpark(pos);
      m.sound('boltHit', pos, 0.7, 22);
      if (p.local && target) m.reportHit(target, Math.round(p.def.dmg * (head ? p.def.head : 1)), 'bolt', { head, at: pos });
    } else if (p.kind === 'blast') {
      m.fx.igniteBoom(pos, 2.4);
      m.sound('explode', pos, 0.7, 35);
      if (p.local) {
        if (target) m.reportHit(target, Math.round(p.def.dmg * (head ? p.def.head : 1)), 'blast', { head, at: pos, burn: [3, 2] });
        m.areaDamage(pos, 1.6, 10, 4, 'blast', { skip: target, kb: 4 });
      }
    } else if (p.kind === 'ember') {
      m.fx.emberHit(pos);
      if (target) m.sound('boltHit', pos, 0.5, 20);
      if (p.local && target && m.kit.onEmberHit) m.kit.onEmberHit(target, pos.clone());
    } else if (p.kind === 'spark') {
      m.fx.sparkBurst(pos, 2.2);
      m.sound('boltHit', pos, 0.8, 24);
      if (p.local) {
        if (target) m.reportHit(target, Math.round(p.def.dmg * (head ? p.def.head : 1)), 'spark', { head, at: pos });
      }
    } else {
      m.fx.explosion(pos, 4.2, 1);
      m.sound('explode', pos, 1, 40);
      if (p.local) {
        if (target) m.reportHit(target, p.def.dmg, 'orb', { at: pos, direct: true });
        m.areaDamage(pos, 4.2, 40, 12, 'orb', { burn: [5, 3], kb: 5 });
      }
    }
  }

  clear() { this.list.length = 0; }
}
