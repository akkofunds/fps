import { PHYS } from '../config.js';

// Source-engine style movement: ground friction + accelerate, air-accelerate with a capped
// wish speed (the thing that makes air-strafing gain speed), and frame-perfect auto-bhop:
// when jump is held, the jump fires on the very tick the player touches ground, *before*
// friction runs, so no momentum is lost.
const EPS = 0.001;

export class BhopController {
  constructor(world) {
    this.world = world;
    this.x = 0; this.y = 0; this.z = 0; // feet position
    this.px = 0; this.py = 0; this.pz = 0; // previous tick (for render interpolation)
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.onGround = false;
    this.crouched = false;
    this.eye = PHYS.eyeStand; // smoothed eye height
    this.peye = PHYS.eyeStand;
    this.height = PHYS.heightStand;
    this.landed = false; // set on the tick we land (for sfx/view dip)
    this.jumped = false;
    this.airTime = 0;
    this.lastFallSpeed = 0;
    this.jumpReleased = true;
  }

  teleport(x, y, z) {
    this.x = this.px = x; this.y = this.py = y; this.z = this.pz = z;
    this.vx = this.vy = this.vz = 0;
    this.onGround = false;
  }

  speed2D() { return Math.sqrt(this.vx * this.vx + this.vz * this.vz); }

  _overlapAt(x, y, z, h) {
    const r = PHYS.radius;
    const list = this.world.query(x - r, z - r, x + r, z + r);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.kind !== 0) continue;
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ && y + h > b.minY + EPS && y < b.maxY - EPS) return b;
    }
    return null;
  }

  // in: {fwd, side, jump, crouch, walk}, yaw (rad), maxSpeed (m/s), opts {airAccelerate, airCap, frozen}
  tick(dt, inp, yaw, maxSpeed, opts) {
    this.px = this.x; this.py = this.y; this.pz = this.z; this.peye = this.eye;
    this.landed = false; this.jumped = false;

    // --- crouch ---
    if (inp.crouch) {
      if (!this.crouched) {
        this.crouched = true;
        // mid-air duck pulls the legs up (keeps head in place) like Source
        if (!this.onGround) { this.y += PHYS.heightStand - PHYS.heightCrouch; if (this._overlapAt(this.x, this.y, this.z, PHYS.heightCrouch)) this.y -= PHYS.heightStand - PHYS.heightCrouch; }
      }
    } else if (this.crouched) {
      if (!this._overlapAt(this.x, this.y, this.z, PHYS.heightStand)) this.crouched = false;
      else if (!this.onGround) {
        const dy = PHYS.heightStand - PHYS.heightCrouch;
        if (!this._overlapAt(this.x, this.y - dy, this.z, PHYS.heightStand)) { this.y -= dy; this.crouched = false; }
      }
    }
    this.height = this.crouched ? PHYS.heightCrouch : PHYS.heightStand;
    const targetEye = this.crouched ? PHYS.eyeCrouch : PHYS.eyeStand;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 14);

    // --- wish direction ---
    let f = inp.fwd, s = inp.side;
    if (opts.frozen) { f = 0; s = 0; }
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    let wx = -sy * f + cy * s;
    let wz = -cy * f - sy * s;
    const wl = Math.sqrt(wx * wx + wz * wz);
    let wishSpeed = 0;
    if (wl > 0.0001) {
      wx /= wl; wz /= wl;
      const mag = Math.min(1, wl);
      let mul = 1;
      if (this.crouched && this.onGround) mul = PHYS.crouchMul;
      else if (inp.walk) mul = PHYS.walkMul;
      wishSpeed = maxSpeed * mul * mag;
    }

    // --- jump (auto-bhop: fires on the landing tick, before friction) ---
    if (this.onGround && inp.jump && !opts.frozen) {
      this.vy = PHYS.jumpSpeed;
      this.onGround = false;
      this.jumped = true;
    }

    if (this.onGround) {
      // friction
      const sp = this.speed2D();
      if (sp > 0.0001) {
        const control = sp < PHYS.stopSpeed ? PHYS.stopSpeed : sp;
        let ns = sp - control * PHYS.friction * dt;
        if (ns < 0) ns = 0;
        const k = ns / sp;
        this.vx *= k; this.vz *= k;
      }
      this._accelerate(wx, wz, wishSpeed, PHYS.accelerate, dt, Infinity);
      this.vy = 0;
    } else {
      this._accelerate(wx, wz, wishSpeed, opts.airAccelerate, dt, opts.airCap);
      this.vy -= PHYS.gravity * dt;
      this.airTime += dt;
    }

    // clamp
    const sp2 = this.speed2D();
    if (sp2 > PHYS.maxVelocity) { const k = PHYS.maxVelocity / sp2; this.vx *= k; this.vz *= k; }
    if (this.vy < -40) this.vy = -40;

    this._move(dt);
  }

  _accelerate(wx, wz, wishSpeed, accel, dt, cap) {
    if (wishSpeed <= 0) return;
    const ws = wishSpeed < cap ? wishSpeed : cap;
    const cur = this.vx * wx + this.vz * wz;
    const add = ws - cur;
    if (add <= 0) return;
    let acc = accel * dt * wishSpeed;
    if (acc > add) acc = add;
    this.vx += acc * wx; this.vz += acc * wz;
  }

  _move(dt) {
    const wasGround = this.onGround;
    const dist = Math.max(Math.abs(this.vx), Math.abs(this.vz), Math.abs(this.vy)) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.25));
    const sdt = dt / steps;
    this.onGround = false;
    for (let i = 0; i < steps; i++) {
      this._axis(0, this.vx * sdt, wasGround);
      this._axis(2, this.vz * sdt, wasGround);
      this._vertical(this.vy * sdt);
      this._ramps(sdt, wasGround);
    }
    // ground snap (stairs / ramps going down) when not jumping
    if (!this.onGround && wasGround && this.vy <= 0 && !this.jumped) {
      const g = this._groundBelow(0.4);
      if (g !== null) { this.y = g; this.onGround = true; this.vy = 0; }
    }
    if (this.onGround && !wasGround) {
      this.landed = true;
      this.lastFallSpeed = this.airTime;
      this.airTime = 0;
    }
    // world floor safety
    if (this.y < -20) { this.y = 2; this.vy = 0; }
  }

  _axis(ax, d, canStep) {
    if (d === 0) return;
    const r = PHYS.radius, h = this.height;
    if (ax === 0) this.x += d; else this.z += d;
    const list = this.world.query(this.x - r, this.z - r, this.x + r, this.z + r);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.kind !== 0) continue;
      if (!(this.x + r > b.minX && this.x - r < b.maxX && this.z + r > b.minZ && this.z - r < b.maxZ && this.y + h > b.minY + EPS && this.y < b.maxY - EPS)) continue;
      const rise = b.maxY - this.y;
      if (canStep && rise > 0 && rise <= PHYS.stepHeight && !this._overlapAt(this.x, b.maxY + EPS, this.z, h)) {
        this.y = b.maxY + EPS;
        continue;
      }
      if (ax === 0) {
        this.x = d > 0 ? b.minX - r - EPS : b.maxX + r + EPS;
        this.vx = 0;
      } else {
        this.z = d > 0 ? b.minZ - r - EPS : b.maxZ + r + EPS;
        this.vz = 0;
      }
    }
  }

  _vertical(d) {
    const r = PHYS.radius, h = this.height;
    this.y += d;
    const list = this.world.query(this.x - r, this.z - r, this.x + r, this.z + r);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.kind !== 0) continue;
      if (!(this.x + r > b.minX && this.x - r < b.maxX && this.z + r > b.minZ && this.z - r < b.maxZ && this.y + h > b.minY && this.y < b.maxY)) continue;
      if (d <= 0) { this.y = b.maxY; this.vy = 0; this.onGround = true; }
      else { this.y = b.minY - h - EPS; if (this.vy > 0) this.vy = 0; }
    }
  }

  _ramps(sdt, canStep) {
    const r = PHYS.radius;
    const list = this.world.query(this.x - r, this.z - r, this.x + r, this.z + r);
    for (let i = 0; i < list.length; i++) {
      const rp = list[i];
      if (rp.kind !== 1) continue;
      if (!(this.x + r > rp.minX && this.x - r < rp.maxX && this.z + r > rp.minZ && this.z - r < rp.maxZ)) continue;
      if (this.y + this.height <= rp.baseY || this.y > rp.maxY + 0.01) continue;
      // sample the highest surface point under the footprint
      const sx = rp.axis === 'x' ? (rp.y1 > rp.y0 ? this.x + r : this.x - r) : this.x;
      const sz = rp.axis === 'z' ? (rp.y1 > rp.y0 ? this.z + r : this.z - r) : this.z;
      const s = this.world.rampHeight(rp, sx, sz);
      if (this.y >= s) continue;
      const tol = Math.max(PHYS.stepHeight, -this.vy * sdt + 0.06);
      if (s - this.y <= tol || canStep && s - this.y <= PHYS.stepHeight * 1.5) {
        this.y = s; if (this.vy < 0) this.vy = 0; this.onGround = true;
      } else {
        // hit the tall side of a wedge: push out horizontally
        const cx = (rp.minX + rp.maxX) / 2, cz = (rp.minZ + rp.maxZ) / 2;
        const ox = this.x < cx ? rp.minX - r - EPS - this.x : rp.maxX + r + EPS - this.x;
        const oz = this.z < cz ? rp.minZ - r - EPS - this.z : rp.maxZ + r + EPS - this.z;
        if (Math.abs(ox) < Math.abs(oz)) { this.x += ox; this.vx = 0; } else { this.z += oz; this.vz = 0; }
      }
    }
  }

  _groundBelow(maxDrop) {
    const r = PHYS.radius;
    let best = null;
    const list = this.world.query(this.x - r, this.z - r, this.x + r, this.z + r);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!(this.x + r > b.minX && this.x - r < b.maxX && this.z + r > b.minZ && this.z - r < b.maxZ)) continue;
      const top = b.kind === 0 ? b.maxY : this.world.rampHeight(b, this.x, this.z);
      if (top <= this.y + EPS && top >= this.y - maxDrop && (best === null || top > best)) best = top;
    }
    if (best !== null && this._overlapAt(this.x, best + EPS, this.z, this.height)) return null;
    return best;
  }
}
