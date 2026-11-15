import * as THREE from 'three';
import { MOVE } from '../config.js';
import { PLAY_RADIUS } from '../world/terrain.js';

// Character physics shared by the local player and practice dummies.
// Ground accel/friction, air control, jump buffering + coyote time, Q dash (2 charges, air dash
// hovers), and a landing roll after an air dash or a hard fall.

export class Body {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.grounded = true;
    this.coyote = 0; this.jumpBuf = 0;
    this.dashT = 0; this.dashDir = new THREE.Vector3();
    this.dashCharges = MOVE.dashCharges; this.dashRecharge = 0;
    this.airDashed = false;
    this.rollT = 0; this.rollDir = new THREE.Vector3();
    this.leaping = false;
    this.slow = 1; // ability slows (casting)
    this.locked = 0; // seconds with no movement input (slam)
    this.stepDist = 0;
    this.water = 0;
    this.fallStart = 0;
  }
  teleport(x, y, z, yaw) { this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = 0; this.grounded = true; this.dashT = this.rollT = 0; this.airDashed = false; this.leaping = false; }
}

const wish = new THREE.Vector3();
const hv = new THREE.Vector3();

// cmd: { fwd, side, jump (held), jumpPressed, dashPressed, aim }
export function stepMovement(b, cmd, dt, world, ev) {
  const g = MOVE.gravity;
  // dash charges
  if (b.dashCharges < MOVE.dashCharges) {
    b.dashRecharge += dt;
    if (b.dashRecharge >= MOVE.dashRecharge) { b.dashRecharge = 0; b.dashCharges++; }
  }
  b.locked = Math.max(0, b.locked - dt);
  // wish direction in world space (forward = (sin yaw, cos yaw); +side = character's right)
  const sy = Math.sin(b.yaw), cy = Math.cos(b.yaw);
  const f = b.locked > 0 ? 0 : cmd.fwd, s = b.locked > 0 ? 0 : cmd.side;
  wish.set(sy * f - cy * s, 0, cy * f + sy * s);
  if (wish.lengthSq() > 1) wish.normalize();

  if (cmd.jumpPressed) b.jumpBuf = 0.14; else b.jumpBuf = Math.max(0, b.jumpBuf - dt);
  b.coyote = b.grounded ? 0.1 : Math.max(0, b.coyote - dt);

  // ---- dash
  if (cmd.dashPressed && b.dashCharges > 0 && b.dashT <= 0 && b.rollT <= 0) {
    b.dashCharges--;
    if (b.dashCharges < MOVE.dashCharges && b.dashRecharge <= 0) b.dashRecharge = 0.0001;
    b.dashT = MOVE.dashTime;
    if (wish.lengthSq() > 0.01) b.dashDir.copy(wish).normalize(); else b.dashDir.set(sy, 0, cy);
    if (!b.grounded) b.airDashed = true;
    b.vel.y = Math.max(b.vel.y, b.grounded ? 0 : 1.5);
    // local angle for the animator: 0 forward, + toward the character's left
    const lx = b.dashDir.x * cy - b.dashDir.z * sy, lz = b.dashDir.x * sy + b.dashDir.z * cy;
    ev('dash', { dir: Math.atan2(lx, lz) });
  }

  const water = world.inWater(b.pos.x, b.pos.z);
  b.water = water;
  const maxSpeed = MOVE.run * (water > 0.25 ? MOVE.waterSlow : 1) * (cmd.aim ? 0.78 : 1) * b.slow;

  if (b.dashT > 0) {
    b.dashT -= dt;
    const k = b.dashT > 0 ? 1 : 0;
    b.vel.x = b.dashDir.x * MOVE.dashSpeed * k + b.dashDir.x * MOVE.run * 1.25 * (1 - k);
    b.vel.z = b.dashDir.z * MOVE.dashSpeed * k + b.dashDir.z * MOVE.run * 1.25 * (1 - k);
    b.vel.y = Math.max(b.vel.y - g * 0.15 * dt, -2);
  } else if (b.rollT > 0) {
    b.rollT -= dt;
    const k = Math.max(0, b.rollT / MOVE.rollTime);
    const sp = MOVE.rollSpeed * (0.45 + 0.55 * k);
    b.vel.x = b.rollDir.x * sp; b.vel.z = b.rollDir.z * sp;
    b.vel.y -= g * dt;
  } else {
    hv.set(b.vel.x, 0, b.vel.z);
    const accel = b.grounded ? MOVE.accel : MOVE.airAccel;
    if (b.grounded) {
      // accelerate toward the wished velocity; friction when idle
      const tx = wish.x * maxSpeed, tz = wish.z * maxSpeed;
      let dx = tx - hv.x, dz = tz - hv.z;
      const dl = Math.hypot(dx, dz), maxD = (wish.lengthSq() > 0.01 ? accel : MOVE.friction * Math.max(hv.length(), 2.5)) * dt;
      if (dl > maxD) { dx *= maxD / dl; dz *= maxD / dl; }
      b.vel.x += dx; b.vel.z += dz;
    } else {
      // air: add control without killing momentum beyond max speed
      const cur = hv.dot(wish);
      const add = Math.max(0, Math.min(accel * dt, maxSpeed - cur));
      b.vel.x += wish.x * add; b.vel.z += wish.z * add;
      // light drag above run speed
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (sp > maxSpeed * 1.6) { const k = 1 - Math.min(1, 0.6 * dt); b.vel.x *= k; b.vel.z *= k; }
    }
    // jump
    if (b.jumpBuf > 0 && (b.grounded || b.coyote > 0)) {
      b.vel.y = MOVE.jump * (water > 0.4 ? 0.8 : 1);
      b.grounded = false; b.coyote = 0; b.jumpBuf = 0;
      ev('jump', {});
    }
    b.vel.y -= g * dt;
  }

  // ---- integrate + collide
  const prevY = b.pos.y;
  b.pos.addScaledVector(b.vel, dt);
  world.resolve(b.pos, MOVE.radius, MOVE.height, MOVE.stepUp);
  // soft arena boundary
  const r = Math.hypot(b.pos.x, b.pos.z), lim = PLAY_RADIUS + 12;
  if (r > lim) { b.pos.x *= lim / r; b.pos.z *= lim / r; }
  const ground = world.groundAt(b.pos.x, b.pos.z, Math.max(prevY, b.pos.y), MOVE.stepUp, MOVE.radius);
  const wasGrounded = b.grounded;
  if (b.pos.y <= ground + 0.001 && b.vel.y <= 0.5) {
    if (!wasGrounded) {
      const impact = b.vel.y;
      const hs = Math.hypot(b.vel.x, b.vel.z);
      ev('land', { vy: impact });
      if ((b.airDashed || impact < -15) && hs > 2.5 && b.dashT <= 0) {
        b.rollT = MOVE.rollTime;
        b.rollDir.set(b.vel.x, 0, b.vel.z).normalize();
        const lx = b.rollDir.x * cy - b.rollDir.z * sy, lz = b.rollDir.x * sy + b.rollDir.z * cy;
        ev('roll', { dir: Math.atan2(lx, lz) });
      }
      b.airDashed = false; b.leaping = false;
    }
    b.pos.y = ground; b.vel.y = Math.max(0, b.vel.y); b.grounded = true;
  } else if (wasGrounded && b.vel.y <= 0 && b.pos.y - ground < 0.42 && b.dashT <= 0) {
    b.pos.y = ground; b.vel.y = 0; b.grounded = true; // stick to slopes / step down
  } else {
    if (wasGrounded) b.fallStart = b.pos.y;
    b.grounded = false;
  }
  // footsteps
  if (b.grounded && b.rollT <= 0) {
    b.stepDist += Math.hypot(b.vel.x, b.vel.z) * dt;
    if (b.stepDist > 1.55) { b.stepDist = 0; ev('step', { water }); }
  }
}
