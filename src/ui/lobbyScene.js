import * as THREE from 'three';
import { loadMageModel, MageInstance } from '../character/characterModel.js';
import { Fx } from '../fx/arcane.js';
import '../fx/limitless.js';
import { mageOf } from '../game/mages.js';

// Lobby showcase: Pyro stands on the lake shore of Sunvale at golden hour, framed so he
// appears inside the center party card. Drag the card to turn him around.

export class LobbyScene {
  constructor(app) {
    this.app = app;
    this.camera = new THREE.PerspectiveCamera(27, 1, 0.1, 3000);
    // standing on the dirt trail, the ruined plaza and its pillars behind him
    this.P = new THREE.Vector3(-13.2, 0, -9.4);
    this.lakeDir = new THREE.Vector3(15, 0, 12).normalize(); // camera → background direction
    this.yaw = 0; this.yawVel = 0; this.drag = null;
    this.t = 0;
    this.inst = null;
    this.ready = false;
    this.panel = 300;
  }

  async init(map) {
    this.map = map;
    this.scene = map.scene;
    const P = this.P;
    P.y = map.world.groundAt(P.x, P.z, 50);
    this.fx = new Fx(this.scene, map.world, map.Q.lights > 1 ? 1 : 0, 1500);
    await this.setMage(this.app.settings.mage || 'pyro');
    // face the camera
    this.baseYaw = Math.atan2(-this.lakeDir.x, -this.lakeDir.z);
    this.yaw = this.baseYaw + 0.35;
    this.ready = true;
    this._layout();
  }

  async setMage(id) {
    const md = mageOf(id);
    this.mageId = md.id;
    let tmpl;
    try { tmpl = await loadMageModel(md.model); } catch (e) {
      // never leave the lobby without a character: show a stand-in if this model won't load
      console.error('lobby model', md.model, e);
      tmpl = await loadMageModel(mageOf('pyro').model);
    }
    if (this.mageId !== md.id) return; // a newer pick won
    const vis = this.inst ? this.inst.root.visible : true;
    if (this.inst) this.scene.remove(this.inst.root);
    this.inst = new MageInstance(tmpl, { lobby: true, outlines: this.map.Q.outlines, gait: md.gait, groundAt: (x, z) => this.map.world.groundAt(x, z, 50) });
    this.inst.root.position.copy(this.P);
    this.inst.root.visible = vis;
    this.scene.add(this.inst.root);
    this.fx.spawnPillar(this.P);
  }

  setActive(on) {
    if (!this.inst) return;
    this.inst.root.visible = on;
    this.fx.fire.points.visible = on; this.fx.smoke.points.visible = on;
  }

  // the lobby character is a fixed showcase now (no drag-to-rotate)
  bindDrag() {}
  _unusedDrag(elm) {
    elm.addEventListener('pointerdown', (e) => { this.drag = e.clientX; elm.setPointerCapture(e.pointerId); });
    elm.addEventListener('pointermove', (e) => { if (this.drag === null) return; const dx = e.clientX - this.drag; this.drag = e.clientX; this.yaw += dx * 0.012; this.yawVel = dx * 0.6; });
    const up = () => { this.drag = null; };
    elm.addEventListener('pointerup', up); elm.addEventListener('pointercancel', up);
  }

  resize(w, h, panel) { this.w = w; this.h = h; this.panel = panel; this._layout(); }

  _layout() {
    if (!this.w) return;
    const cam = this.camera;
    cam.aspect = this.w / this.h;
    const P = this.P;
    const dist = this.w < 860 ? 8.4 : 7.2;
    const away = this.lakeDir.clone().multiplyScalar(-1); // camera sits back down the trail
    cam.position.set(P.x + away.x * dist, P.y + 1.55, P.z + away.z * dist);
    cam.lookAt(P.x, P.y + 0.98, P.z);
    // shift the image so Pyro lands in the center card (left of the social panel, slightly high)
    const ox = this.panel / 2, oy = this.h * 0.035;
    cam.setViewOffset(this.w, this.h, ox, oy, this.w, this.h);
    cam.updateProjectionMatrix();
  }

  update(dt) {
    if (!this.ready) return;
    this.t += dt;
    if (this.drag === null) {
      this.yawVel *= Math.exp(-3 * dt);
      this.yaw += this.yawVel * dt;
      // drift back toward the hero angle
      this.yaw += (this.baseYaw + 0.35 + Math.sin(this.t * 0.25) * 0.08 - this.yaw) * (1 - Math.exp(-0.8 * dt)) * (Math.abs(this.yawVel) < 0.2 ? 1 : 0);
    }
    // the lobby shows players only: the character is hidden (the meadow stays as the backdrop)
    if (this.inst.root.visible) this.inst.root.visible = false;
    this.fx.update(dt, this.camera, this.h);
    this.map.update(dt, this.camera, this.P, [this.P]);
    return;
    // eslint-disable-next-line no-unreachable
    const a = this.inst.anim;
    a.update(dt, { pos: this.inst.root.position, yaw: this.yaw, pitch: 0.05, vel: new THREE.Vector3(), grounded: true });
    this.inst.root.rotation.y = this.yaw;
    if (this.mageId === 'meteora') { if (Math.random() < 0.6) this.fx.staffGlow(this.inst.staffTip(new THREE.Vector3())); }
    else if (this.mageId === 'sorcerer') {
      // a small Blue turning slowly over his left palm, a cold glint at the Six Eyes
      const p = this.inst.palmWorld('L', new THREE.Vector3()).add(new THREE.Vector3(0, 0.12, 0));
      const a = Math.random() * 6.283, r = 0.22;
      this.fx.fire.emit(p.x + Math.cos(a) * r, p.y + (Math.random() - 0.5) * r, p.z + Math.sin(a) * r, -Math.cos(a) * 1.1, 0, -Math.sin(a) * 1.1, 0.2, 0.05, 0.1, [0.5, 1.5, 3.6, 1], [0.15, 0.55, 2.4, 0.9], 0, 0);
      if (Math.random() < 0.5) this.fx.fire.emit(p.x, p.y, p.z, 0, 0, 0, 0.12, 0.12, 0.16, [1.6, 2.4, 3.8, 1], [0.15, 0.55, 2.4, 0.9], 0, 0);
    }
    else {
      // Shoto: fire flickers in the left hand, frost mist curls off the right
      this.fx.palmFlame(this.inst.palmWorld('L', new THREE.Vector3()).add(new THREE.Vector3(0, 0.05, 0)), 1.2);
      if (Math.random() < 0.5) { const p = this.inst.palmWorld('R', new THREE.Vector3()); this.fx.fire.emit(p.x + (Math.random() - 0.5) * 0.1, p.y, p.z + (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.3, -0.2 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3, 0.7, 0.12, 0.03, [1.2, 2.0, 2.8, 0.9], [0.5, 0.7, 0.9, 0], 1, -0.5); }
      if (Math.random() < 0.06) this.fx.light(this.inst.palmWorld('L', new THREE.Vector3()), 3, 3, 0.4);
    }
    this.fx.update(dt, this.camera, this.h);
    this.map.update(dt, this.camera, this.P, [this.P]);
  }
}
