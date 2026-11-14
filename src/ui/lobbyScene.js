import * as THREE from 'three';
import { buildShowcaseCharacter, TEAM_COLORS } from '../entities/characterModel.js';

// Lobby showcase: your agent rotating center-stage holding the AK, party members beside you.
const SLOTS = [0, -1.25, 1.25, -2.5, 2.5];

export class LobbyScene {
  constructor() {
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x0f1923);
    s.fog = new THREE.Fog(0x0f1923, 7, 16);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 1.25, 7.4);
    this.camera.lookAt(0, 0.62, 0);
    s.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a1a1c, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2, 3, 3); s.add(key);
    const rim = new THREE.DirectionalLight(0xff4655, 2.0); rim.position.set(-3, 2, -3); s.add(rim);
    // stage
    const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x15212c }));
    s.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.78, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff4655 }));
    ring.position.y = 0.01; s.add(ring);
    this.ring = ring;
    // angular backdrop slabs
    const slabMat = new THREE.MeshLambertMaterial({ color: 0x1b2835, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.4 + Math.random(), 3 + Math.random() * 3, 0.3), slabMat);
      m.position.set(-6 + i * 2, 1.5, -4 - Math.random() * 2); m.rotation.z = (Math.random() - 0.5) * 0.3; m.rotation.y = (Math.random() - 0.5) * 0.5;
      s.add(m);
    }
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(14, 0.06), new THREE.MeshBasicMaterial({ color: 0xff4655 }));
    stripe.position.set(0, 3.6, -3.8); s.add(stripe);
    this.chars = [];
    this.members = [];
    this.t = 0;
    this.offsetX = 0;
    this._v = new THREE.Vector3();
  }

  setMembers(members, myId) {
    const ordered = [...members].sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : 0));
    while (this.chars.length < ordered.length) {
      const i = this.chars.length;
      const c = buildShowcaseCharacter(i === 0 ? 0xff4655 : TEAM_COLORS[(i + 1) % TEAM_COLORS.length]);
      this.scene.add(c); this.chars.push(c);
    }
    this.chars.forEach((c, i) => { c.visible = i < ordered.length; });
    this.members = ordered.slice(0, SLOTS.length);
  }

  resize(w, h, panelW) {
    this.camera.aspect = w / h;
    this.offsetX = panelW / 2;
    if (this.offsetX > 0) this.camera.setViewOffset(w, h, this.offsetX, 0, w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.t += dt;
    this.chars.forEach((c, i) => {
      if (!c.visible) return;
      const x = SLOTS[i] || 0;
      const z = i === 0 ? 0 : -0.6 - Math.floor((i + 1) / 2) * 0.25;
      c.position.set(x, 0, z);
      if (i === 0) c.rotation.y = this.t * 0.5;
      else c.rotation.y = Math.sin(this.t * 0.6 + i) * 0.25 + (x < 0 ? 0.35 : -0.35);
      c.children[0].position.y = Math.sin(this.t * 1.6 + i) * 0.008;
    });
    this.ring.material.color.setHSL(0.985, 1, 0.55 + Math.sin(this.t * 2) * 0.06);
  }

  // screen positions for name plates
  platePositions(w, h, out) {
    out.length = 0;
    this.chars.forEach((c, i) => {
      if (!c.visible || !this.members[i]) return;
      this._v.set(c.position.x, -0.02, c.position.z).project(this.camera);
      out.push({ m: this.members[i], x: (this._v.x + 1) / 2 * w, y: (1 - this._v.y) / 2 * h, lead: i === 0 });
    });
    return out;
  }

  render(renderer) { renderer.render(this.scene, this.camera); }
}
