import * as THREE from 'three';

// Shift-lock style over-the-shoulder camera. The character always faces the camera yaw;
// the crosshair is the screen center and the aim ray starts at the camera.
// Collision pulls the camera in front of walls/terrain; a spring smooths the pivot height.

const tmp = new THREE.Vector3(), hit = { t: 0 };

export class ShoulderCamera {
  constructor(camera, world) {
    this.cam = camera; this.world = world;
    this.yaw = 0; this.pitch = -0.08;
    this.dist = 3.6; this.curDist = 3.6;
    this.shoulder = 0.72; this.side = 1;
    this.pivot = new THREE.Vector3();
    this.pivotY = null;
    this.aimT = 0;
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.baseFov = 80;
    this.shakeT = 0;
    this.kick = 0; // small recoil/feedback pitch offset
  }

  look(dx, dy, sens, invertY) {
    const k = 0.0021 * sens * (1 - this.aimT * 0.35);
    this.yaw -= dx * k;
    this.pitch -= dy * k * (invertY ? -1 : 1);
    this.pitch = Math.max(-1.3, Math.min(1.25, this.pitch));
  }

  update(dt, target, aiming, shake = 0) {
    this.aimT += ((aiming ? 1 : 0) - this.aimT) * (1 - Math.exp(-14 * dt));
    // pivot follows the head; vertical spring hides step/landing jitter
    const py = target.y + 1.58;
    if (this.pivotY === null || Math.abs(this.pivotY - py) > 3) this.pivotY = py;
    this.pivotY += (py - this.pivotY) * (1 - Math.exp(-18 * dt));
    this.pivot.set(target.x, this.pivotY, target.z);
    this.kick *= Math.exp(-12 * dt);
    const pitch = this.pitch + this.kick;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.fwd.set(sy * cp, sp, cy * cp);
    const right = tmp.set(-cy, 0, sy);
    const dist = this.dist * (1 - this.aimT * 0.42);
    const sh = this.shoulder * this.side * (1 - this.aimT * 0.1);
    // shoulder point, then pull back along -fwd
    const shx = this.pivot.x + right.x * sh, shz = this.pivot.z + right.z * sh, shy = this.pivot.y + 0.12;
    // collision: from head to shoulder, then shoulder back
    let sideD = Math.abs(sh);
    const sideHit = this.world.raycast(this.pivot.x, this.pivot.y, this.pivot.z, right.x * Math.sign(sh), 0, right.z * Math.sign(sh), sideD, 0.22);
    if (sideHit < sideD) sideD = Math.max(0, sideHit - 0.05);
    const sx = this.pivot.x + right.x * Math.sign(sh) * sideD, sz = this.pivot.z + right.z * Math.sign(sh) * sideD;
    void shx; void shz;
    let d = dist;
    const back = this.world.raycast(sx, shy, sz, -this.fwd.x, -this.fwd.y, -this.fwd.z, dist, 0.25, hit);
    if (back < d) d = Math.max(0.35, back - 0.1);
    // smooth outward, snap inward
    this.curDist = d < this.curDist ? d : this.curDist + (d - this.curDist) * (1 - Math.exp(-6 * dt));
    this.cam.position.set(sx - this.fwd.x * this.curDist, shy - this.fwd.y * this.curDist, sz - this.fwd.z * this.curDist);
    // shake
    if (shake > 0.001) {
      this.shakeT += dt * 38;
      const a = shake * shake * 0.12;
      this.cam.position.x += Math.sin(this.shakeT * 1.3) * a; this.cam.position.y += Math.sin(this.shakeT * 1.7 + 1) * a; this.cam.position.z += Math.cos(this.shakeT * 1.1) * a;
    }
    this.cam.lookAt(this.cam.position.x + this.fwd.x, this.cam.position.y + this.fwd.y, this.cam.position.z + this.fwd.z);
    const fov = this.baseFov * (1 - this.aimT * 0.22);
    if (Math.abs(this.cam.fov - fov) > 0.01) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
  }

  get tooClose() { return this.curDist < 0.9; }
}
