import * as THREE from 'three';

// Pre-allocated, object-pooled effects. Nothing here allocates after construction, so a
// sustained gunfight produces zero garbage → no GC hitches. Each pool is one draw call.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1), _d = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function radialTexture(inner, outer, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner); gr.addColorStop(0.45, inner); gr.addColorStop(0.62, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class TracerPool {
  constructor(scene, n = 48) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.025, 0.025, 1), new THREE.MeshBasicMaterial({ color: 0xffe7a3, fog: false }), n);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.items = [];
    for (let i = 0; i < n; i++) { this.items.push({ on: false, sx: 0, sy: 0, sz: 0, dx: 0, dy: 0, dz: 0, len: 0, t: 0 }); this.mesh.setMatrixAt(i, ZERO); }
    this.next = 0;
    scene.add(this.mesh);
  }
  spawn(sx, sy, sz, ex, ey, ez) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.items.length;
    const dx = ex - sx, dy = ey - sy, dz = ez - sz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1) return;
    it.on = true; it.sx = sx; it.sy = sy; it.sz = sz; it.dx = dx / len; it.dy = dy / len; it.dz = dz / len; it.len = len; it.t = 0;
  }
  update(dt) {
    const items = this.items; let any = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.on) continue;
      any = true;
      it.t += dt * 420;
      const seg = 4.5;
      const head = Math.min(it.t, it.len), tail = Math.max(0, it.t - seg);
      if (tail >= it.len) { it.on = false; this.mesh.setMatrixAt(i, ZERO); continue; }
      const mid = (head + tail) / 2, l = Math.max(0.05, head - tail);
      _p.set(it.sx + it.dx * mid, it.sy + it.dy * mid, it.sz + it.dz * mid);
      _d.set(it.dx, it.dy, it.dz);
      _q.setFromUnitVectors(_z, _d);
      _s.set(1, 1, l);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    if (any || this._was) this.mesh.instanceMatrix.needsUpdate = true;
    this._was = any;
  }
}

export class DecalPool {
  constructor(scene, n = 256) {
    const tex = radialTexture('rgba(18,16,14,0.95)', 'rgba(60,55,50,0.5)');
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }), n);
    this.mesh.frustumCulled = false;
    this.pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { this.mesh.setMatrixAt(i, ZERO); this.pos[i * 3 + 1] = -999; }
    this.n = n; this.next = 0;
    scene.add(this.mesh);
  }
  spawn(x, y, z, nx, ny, nz, size = 1) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    _d.set(nx, ny, nz);
    _q.setFromUnitVectors(_z, _d);
    _p.set(x + nx * 0.008, y + ny * 0.008, z + nz * 0.008);
    const s = size * (0.8 + Math.random() * 0.4);
    _s.set(s, s, s);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
  }
  clearBox(minX, minY, minZ, maxX, maxY, maxZ) {
    const p = this.pos; let any = false;
    for (let i = 0; i < this.n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      if (x >= minX - 0.05 && x <= maxX + 0.05 && y >= minY - 0.05 && y <= maxY + 0.05 && z >= minZ - 0.05 && z <= maxZ + 0.05) {
        this.mesh.setMatrixAt(i, ZERO); p[i * 3 + 1] = -999; any = true;
      }
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
  clearAll() { for (let i = 0; i < this.n; i++) { this.mesh.setMatrixAt(i, ZERO); this.pos[i * 3 + 1] = -999; } this.mesh.instanceMatrix.needsUpdate = true; }
}

export class SparkPool {
  constructor(scene, n = 256) {
    this.n = n;
    this.pos = new Float32Array(n * 3).fill(-9999);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, sizeAttenuation: true, fog: false }));
    this.points.frustumCulled = false;
    this.next = 0; this.active = 0;
    scene.add(this.points);
  }
  burst(x, y, z, nx, ny, nz, count, r, g, b, speed = 4, grav = 1) {
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.n;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      const s = speed * (0.4 + Math.random());
      this.vel[i * 3] = (nx + (Math.random() - 0.5) * 1.4) * s;
      this.vel[i * 3 + 1] = (ny + (Math.random() - 0.3) * 1.4) * s;
      this.vel[i * 3 + 2] = (nz + (Math.random() - 0.5) * 1.4) * s;
      const j = 0.75 + Math.random() * 0.25;
      this.col[i * 3] = r * j; this.col[i * 3 + 1] = g * j; this.col[i * 3 + 2] = b * j;
      this.life[i] = 0.25 + Math.random() * 0.3;
      if (grav === 0) this.life[i] *= 0.4;
    }
    this.active = 0.6;
  }
  update(dt) {
    if (this.active <= 0) return;
    this.active -= dt;
    const p = this.pos, v = this.vel, L = this.life;
    for (let i = 0; i < this.n; i++) {
      if (L[i] <= 0) continue;
      L[i] -= dt;
      if (L[i] <= 0) { p[i * 3 + 1] = -9999; continue; }
      v[i * 3 + 1] -= 12 * dt;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

export function muzzleTexture() {
  const size = 64; const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.translate(size / 2, size / 2);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, size / 2);
  gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.25, 'rgba(255,210,110,0.95)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = gr;
  for (let i = 0; i < 6; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(-4, 0); g.lineTo(0, -size / 2); g.lineTo(4, 0); g.fill(); }
  g.beginPath(); g.arc(0, 0, size / 5, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
