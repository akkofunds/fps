import { BhopController } from '../physics/bhopController.js';
import { PHYS } from '../config.js';
import { nearestNode, findPath } from '../maps/waypoints.js';
import { WEAPONS } from '../weapons/weaponDefs.js';

const DEG = Math.PI / 180;
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

// Host-simulated combat bot: patrols the auto-generated nav graph, spots enemies with
// line-of-sight checks, reacts after a human-like delay, flicks with decaying aim error,
// counter-strafes before tapping/spraying and strafes between bursts.
export class BotBrain {
  constructor(match, ent, skill = 0.6) {
    this.m = match; this.e = ent;
    this.ctrl = new BhopController(match.map.world);
    this.skill = skill;
    this.path = []; this.pi = 0;
    this.goal = -1; this.repath = 0;
    this.target = null; this.seenT = 0; this.lostT = 0; this.scanT = Math.random() * 0.2;
    this.errY = 0; this.errP = 0;
    this.aimHead = false;
    this.nextShot = 0; this.burst = 0; this.burstPause = 0;
    this.strafe = 0; this.strafeT = 0;
    this.stuckT = 0; this.lastX = 0; this.lastZ = 0;
    this.crouch = false;
    this.inp = { fwd: 0, side: 0, jump: false, crouch: false, walk: false };
    this.lastKnown = null;
    this.yaw = 0; this.pitch = 0;
    const map = match.map.id;
    ent.w = map === 'atrium' && Math.random() < 0.35 ? 3 : Math.random() < 0.15 ? 2 : 1;
  }

  spawn(x, y, z, yaw) {
    this.ctrl.teleport(x, y, z);
    this.yaw = yaw; this.pitch = 0;
    this.path.length = 0; this.target = null; this.goal = -1; this.lastKnown = null;
    this.syncEnt();
  }

  syncEnt() {
    const e = this.e, c = this.ctrl;
    e.x = c.x; e.y = c.y; e.z = c.z; e.yaw = this.yaw; e.pitch = this.pitch;
    e.crouch = c.crouched; e.onGround = c.onGround; e.vx = c.vx; e.vz = c.vz;
  }

  _pickGoal() {
    const nodes = this.m.map.waypoints;
    if (!nodes || !nodes.length) return;
    let gx, gz;
    const enemies = this.m.enemiesOf(this.e);
    if (this.lastKnown && Math.random() < 0.7) { gx = this.lastKnown.x; gz = this.lastKnown.z; }
    else if (enemies.length && Math.random() < 0.55) { const t = enemies[Math.floor(Math.random() * enemies.length)]; gx = t.x + (Math.random() - 0.5) * 16; gz = t.z + (Math.random() - 0.5) * 16; }
    else { const n = nodes[Math.floor(Math.random() * nodes.length)]; gx = n.x; gz = n.z; }
    const from = nearestNode(nodes, this.ctrl.x, this.ctrl.y, this.ctrl.z);
    const to = nearestNode(nodes, gx, 0, gz);
    findPath(nodes, from, to, this.path);
    this.pi = 0;
    this.goal = to;
  }

  _visible(t) {
    const w = this.m.map.world, c = this.ctrl;
    const ey = c.y + c.eye;
    const th = t.y + (t.crouch ? 1.1 : 1.62);
    if (w.lineClear(c.x, ey, c.z, t.x, th, t.z)) return true;
    return w.lineClear(c.x, ey, c.z, t.x, t.y + (t.crouch ? 0.7 : 1.1), t.z);
  }

  update(dt, now, frozen) {
    const e = this.e, c = this.ctrl, inp = this.inp;
    if (!e.alive) return;
    inp.fwd = 0; inp.side = 0; inp.jump = false; inp.crouch = false;
    const live = this.m.rules.isLive();

    // --- perception ---
    this.scanT -= dt;
    if (this.scanT <= 0 && live) {
      this.scanT = 0.18;
      let best = null, bd = 75 * 75;
      for (const t of this.m.enemiesOf(e)) {
        const dx = t.x - c.x, dz = t.z - c.z, d2 = dx * dx + dz * dz;
        if (d2 > bd) continue;
        const ang = Math.abs(angDiff(Math.atan2(-dx, -dz), this.yaw));
        const heard = d2 < 100 || (t.firedAt && now - t.firedAt < 0.6 && d2 < 900);
        if (ang > 80 * DEG && !heard && t !== this.target) continue;
        if (!this._visible(t)) continue;
        best = t; bd = d2;
      }
      if (best && best !== this.target) {
        this.target = best; this.seenT = now;
        const react = (0.42 - this.skill * 0.2) + Math.random() * 0.16;
        this.nextShot = Math.max(this.nextShot, now + react);
        this.errY = (Math.random() - 0.5) * (14 - this.skill * 6) * DEG;
        this.errP = (Math.random() - 0.5) * (8 - this.skill * 4) * DEG;
        this.aimHead = Math.random() < 0.25 + this.skill * 0.25;
      } else if (!best && this.target) {
        this.lostT += 0.18;
        if (this.lostT > 1.2) { this.lastKnown = { x: this.target.x, z: this.target.z }; this.target = null; this.path.length = 0; this.lostT = 0; }
      } else if (best) this.lostT = 0;
    }
    if (this.target && !this.target.alive) { this.target = null; this.path.length = 0; }

    const w = WEAPONS[e.w];
    let maxSpeed = w.speed;
    if (this.target && live) {
      const t = this.target;
      const ty = t.y + (this.aimHead ? (t.crouch ? 1.12 : 1.66) : (t.crouch ? 0.8 : 1.2));
      const dx = t.x - c.x, dz = t.z - c.z, dy = ty - (c.y + c.eye);
      const dist = Math.sqrt(dx * dx + dz * dz);
      const wantYaw = Math.atan2(-dx, -dz) + this.errY;
      const wantPitch = Math.atan2(dy, dist) + this.errP;
      // error decays (the "flick + settle")
      const decay = Math.exp(-dt * (2.2 + this.skill * 3));
      this.errY *= decay; this.errP *= decay;
      const turn = (420 + this.skill * 300) * DEG * dt;
      const dyaw = angDiff(wantYaw, this.yaw);
      this.yaw += Math.max(-turn, Math.min(turn, dyaw * Math.min(1, dt * 14)));
      this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 12);
      const aimErr = Math.abs(angDiff(wantYaw - this.errY, this.yaw)) + Math.abs(wantPitch - this.errP - this.pitch);

      // movement while fighting: strafe, then counter-strafe to fire accurately
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = 0.25 + Math.random() * 0.5; if (Math.random() < 0.25) this.strafe = 0; }
      const firing = this.burst > 0 || now >= this.nextShot - 0.08;
      const speed = c.speed2D();
      if (!firing || e.w === 2) inp.side = this.strafe;
      if (dist > 30 && e.w !== 3) inp.fwd = 1;
      if (firing && e.w !== 2 && speed > w.speed * 0.3) {
        // counter-strafe: push opposite to current lateral velocity
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
        const lat = c.vx * rx + c.vz * rz;
        inp.side = lat > 0.5 ? -1 : lat < -0.5 ? 1 : 0;
      }
      if (this.crouch) inp.crouch = true;

      // shooting
      if (now >= this.nextShot && aimErr < (e.w === 3 ? 1.6 : 3.2) * DEG && this._visible(t)) {
        if (now >= this.burstPause) {
          const spray = e.w === 1 ? Math.min(this.burst, 8) * 0.35 : 0;
          const moveFrac = Math.max(0, Math.min(1, (speed - 0.34 * w.speed) / (0.66 * w.speed)));
          let spread = (e.w === 3 ? 0.25 : w.spreadBase) + moveFrac * w.spreadMove + spray + (1 - this.skill) * 1.2;
          if (!c.onGround) spread += w.spreadAir;
          const r = Math.sqrt(Math.random()) * spread * DEG, th = Math.random() * Math.PI * 2;
          this.m.rules.botShoot(e, this.yaw + Math.cos(th) * r, this.pitch + Math.sin(th) * r, c.y + c.eye);
          this.burst++;
          if (e.w === 1) {
            this.nextShot = now + w.interval;
            const maxBurst = dist > 25 ? 2 + (Math.random() * 2 | 0) : 4 + (Math.random() * 5 | 0);
            if (this.burst >= maxBurst) { this.burst = 0; this.burstPause = now + 0.25 + Math.random() * 0.3; this.crouch = Math.random() < 0.2; }
          } else if (e.w === 2) { this.nextShot = now + 0.16 + Math.random() * 0.1; if (this.burst > 6) { this.burst = 0; this.burstPause = now + 0.3; } }
          else { this.nextShot = now + w.interval + 0.2; this.burst = 0; }
          this.e.firedAt = now;
          // after each shot re-acquire with a little fresh error
          this.errY += (Math.random() - 0.5) * 0.6 * DEG; this.errP += (Math.random() - 0.5) * 0.4 * DEG;
        }
      }
    } else {
      this.burst = 0; this.crouch = false;
      // patrol along path
      if (!this.path.length || this.pi >= this.path.length) { this.repath -= dt; if (this.repath <= 0) { this._pickGoal(); this.repath = 0.5; } }
      const nodes = this.m.map.waypoints;
      if (nodes && this.pi < this.path.length) {
        const n = nodes[this.path[this.pi]];
        const dx = n.x - c.x, dz = n.z - c.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 1.0) this.pi++;
        else {
          const want = Math.atan2(-dx, -dz);
          const dyaw = angDiff(want, this.yaw);
          this.yaw += dyaw * Math.min(1, dt * 6);
          this.pitch += (0 - this.pitch) * Math.min(1, dt * 4);
          inp.fwd = Math.abs(dyaw) < 1.2 ? 1 : 0.3;
        }
      }
      // stuck detection
      this.stuckT += dt;
      if (this.stuckT > 1.4) {
        const mv = Math.abs(c.x - this.lastX) + Math.abs(c.z - this.lastZ);
        if (mv < 0.6 && this.path.length) { this.path.length = 0; inp.jump = true; }
        this.lastX = c.x; this.lastZ = c.z; this.stuckT = 0;
      }
    }

    this.ctrl.tick(dt, inp, this.yaw, maxSpeed * (frozen ? 0 : 1), { airAccelerate: 12, airCap: PHYS.airCap, frozen });
    this.syncEnt();
  }
}
