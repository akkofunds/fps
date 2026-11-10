export const DEFAULTS = {
  // speeds
  runSpeed: 250,
  walkSpeed: 130,
  crouchSpeed: 85,
  slideSpeedBoost: 1.35,

  // accel
  accelerate: 5.5,
  airAccelerate: 12,        // CS:GO default ~12, KZ often 100+
  airMaxWishSpeed: 30,

  // friction / stop
  friction: 5.2,
  stopSpeed: 80,

  // jump / gravity
  jumpForce: 301,
  gravity: 800,
  maxVelocity: 3500,

  // bhop
  autoBhop: true,
  bhopSpeedClamp: false,    // false = classic uncapped feel
  bhopClampMul: 1.1,

  // slide
  slideFriction: 1.8,
  slideMinSpeed: 180,
  slideDuration: 0.85,

  // view
  eyeHeight: 64,
  crouchEyeHeight: 40,
  duckTime: 0.18,
};

export class Movement {
  constructor(settings = {}) {
    this.s = { ...DEFAULTS, ...settings };

    this.pos = { x: 0, y: this.s.eyeHeight, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.angles = { pitch: 0, yaw: 0 }; // degrees

    this.onGround = false;
    this.ducking = false;
    this.sliding = false;
    this.slideTimer = 0;
    this.wishDuck = false;

    this.eyeOffset = this.s.eyeHeight;
    this.groundNormal = { x: 0, y: 1, z: 0 };

    // input state (set from outside each frame)
    this.forward = 0;
    this.side = 0;
    this.jump = false;
    this.jumpPressed = false; // edge
    this.duck = false;
    this.walk = false;
  }

  /** Call once per frame with dt in seconds */
  update(dt, isSolid) {
    // clamp dt
    dt = Math.min(dt, 0.05);

    // ---- duck / slide ----
    this.wishDuck = this.duck;
    if (this.wishDuck && this.onGround && !this.sliding) {
      const speed = Math.hypot(this.vel.x, this.vel.z);
      if (speed > this.s.slideMinSpeed) {
        this.sliding = true;
        this.slideTimer = this.s.slideDuration;
        // small speed boost on entry
        const boost = this.s.slideSpeedBoost;
        this.vel.x *= boost;
        this.vel.z *= boost;
      }
    }

    if (this.sliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0 || !this.onGround || Math.hypot(this.vel.x, this.vel.z) < 60) {
        this.sliding = false;
      }
    }

    this.ducking = this.wishDuck || this.sliding;

    // smooth eye height
    const targetEye = this.ducking ? this.s.crouchEyeHeight : this.s.eyeHeight;
    this.eyeOffset += (targetEye - this.eyeOffset) * Math.min(1, dt / this.s.duckTime);

    // ---- wish direction ----
    const yawRad = this.angles.yaw * Math.PI / 180;
    const forward = {
      x: Math.cos(yawRad),
      z: -Math.sin(yawRad)
    };
    const right = {
      x: Math.sin(yawRad),
      z: Math.cos(yawRad)
    };

    let wishX = forward.x * this.forward + right.x * this.side;
    let wishZ = forward.z * this.forward + right.z * this.side;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }

    // ---- speed target ----
    let maxSpeed = this.s.runSpeed;
    if (this.walk) maxSpeed = this.s.walkSpeed;
    if (this.ducking && !this.sliding) maxSpeed = this.s.crouchSpeed;

    // ---- ground / air move ----
    if (this.onGround) {
      this._groundMove(dt, wishX, wishZ, maxSpeed);
    } else {
      this._airMove(dt, wishX, wishZ);
    }

    // gravity
    this.vel.y -= this.s.gravity * dt;

    // clamp overall velocity
    const speed3 = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    if (speed3 > this.s.maxVelocity) {
      const s = this.s.maxVelocity / speed3;
      this.vel.x *= s; this.vel.y *= s; this.vel.z *= s;
    }

    // integrate position (simple, collision resolved outside)
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    // jump (after move so we can leave ground this frame)
    this._tryJump();

    // clear edge
    this.jumpPressed = false;
  }

  _groundMove(dt, wishX, wishZ, maxSpeed) {
    // friction
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > 0.1) {
      let drop = 0;
      if (this.sliding) {
        drop = speed * this.s.slideFriction * dt;
      } else {
        const control = speed < this.s.stopSpeed ? this.s.stopSpeed : speed;
        drop = control * this.s.friction * dt;
      }
      const newSpeed = Math.max(speed - drop, 0);
      const scale = newSpeed / speed;
      this.vel.x *= scale;
      this.vel.z *= scale;
    } else {
      this.vel.x = 0;
      this.vel.z = 0;
    }

    // accelerate
    if (!this.sliding) {
      this._accelerate(wishX, wishZ, maxSpeed, this.s.accelerate, dt);
    } else {
      // while sliding we still allow slight course correction
      this._accelerate(wishX, wishZ, maxSpeed * 0.4, this.s.accelerate * 0.5, dt);
    }
  }

  _airMove(dt, wishX, wishZ) {
    // classic air accelerate (strafe)
    this._accelerate(wishX, wishZ, this.s.airMaxWishSpeed, this.s.airAccelerate, dt);
  }

  _accelerate(wishX, wishZ, wishSpeed, accel, dt) {
    const currentSpeed = this.vel.x * wishX + this.vel.z * wishZ;
    const addSpeed = wishSpeed - currentSpeed;
    if (addSpeed <= 0) return;

    let accelSpeed = accel * dt * wishSpeed;
    if (accelSpeed > addSpeed) accelSpeed = addSpeed;

    this.vel.x += accelSpeed * wishX;
    this.vel.z += accelSpeed * wishZ;
  }

  _tryJump() {
    if (!this.onGround) return;

    const canJump = this.s.autoBhop ? this.jump : this.jumpPressed;
    if (!canJump) return;

    // optional speed clamp on takeoff (more "realistic" CS feel)
    if (this.s.bhopSpeedClamp) {
      const hSpeed = Math.hypot(this.vel.x, this.vel.z);
      const max = this.s.runSpeed * this.s.bhopClampMul;
      if (hSpeed > max) {
        const s = max / hSpeed;
        this.vel.x *= s;
        this.vel.z *= s;
      }
    }

    this.vel.y = this.s.jumpForce;
    this.onGround = false;
    this.sliding = false;
  }

  /** Call from collision system when feet hit ground */
  setGrounded(grounded, normal = { x: 0, y: 1, z: 0 }) {
    if (grounded && !this.onGround) {
      // landing
      this.vel.y = Math.min(this.vel.y, 0);
    }
    this.onGround = grounded;
    this.groundNormal = normal;
  }

  get horizontalSpeed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get eyePosition() {
    return {
      x: this.pos.x,
      y: this.pos.y - this.s.eyeHeight + this.eyeOffset,
      z: this.pos.z
    };
  }
}
