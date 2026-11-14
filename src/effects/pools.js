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

// Bullet trails: camera-facing glowing ribbons from muzzle to impact. Each trail draws instantly
// along the whole path with a bright "bullet" head racing to the target, then fades and thins out.
// One InstancedMesh (additive, per-instance color used as brightness) → one draw call.
function trailTexture() {
  const w = 128, h = 32, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.abs((y + 0.5) / h - 0.5) * 2; // 0 center → 1 edge
    const across = Math.exp(-v * v * 5) * 0.85 + Math.exp(-v * v * 40) * 0.6; // soft glow + hot core
    const u = x / (w - 1); // 0 = muzzle end, 1 = impact end
    const along = Math.min(1, u * 14) * (0.7 + 0.3 * u);
    const a = Math.min(1, across * along);
    const core = Math.exp(-v * v * 22);
    const i = (y * w + x) * 4;
    img.data[i] = Math.round(core * 255); img.data[i + 1] = 0; img.data[i + 2] = 0; img.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.premultiplyAlpha = false; return t;
}

const TRAIL_VS = `
  varying vec2 vUv; varying vec3 vCol;
  void main() {
    vUv = uv;
    vCol = instanceColor;
    // point on the path + side offset scaled by distance → constant on-screen width
    vec4 base = modelMatrix * instanceMatrix * vec4(position.x, 0.0, 0.0, 1.0);
    vec3 side = (modelMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
    float d = max(0.35, distance(base.xyz, cameraPosition));
    vec4 world = vec4(base.xyz + side * position.y * d, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;
const TRAIL_FS = `
  uniform sampler2D map; varying vec2 vUv; varying vec3 vCol;
  void main() {
    float fade = max(vCol.r, max(vCol.g, vCol.b));
    if (fade < 0.003) discard;
    vec3 tint = vCol / fade;
    vec4 t = texture2D(map, vUv);
    float core = t.r;
    vec3 col = mix(tint * 0.5, tint, smoothstep(0.02, 0.3, core));   // darker halo → readable on bright maps
    col = mix(col, vec3(1.0, 0.98, 0.9), smoothstep(0.55, 1.0, core)); // white-hot center line
    gl_FragColor = vec4(col, t.a * fade);
    #include <colorspace_fragment>
  }`;

export class TrailPool {
  constructor(scene, n = 64) {
    const geo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0); // x: 0..1 along the path, y: ±0.5 across
    const tex = trailTexture();
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } }, vertexShader: TRAIL_VS, fragmentShader: TRAIL_FS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.items = [];
    const black = new THREE.Color(0, 0, 0);
    for (let i = 0; i < n; i++) {
      this.items.push({ on: false, a: new THREE.Vector3(), b: new THREE.Vector3(), t: 0, life: 0.2, w: 0.005, col: new THREE.Color(), speed: 600 });
      this.mesh.setMatrixAt(i, ZERO); this.mesh.setColorAt(i, black);
    }
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.next = 0; this.n = n;
    this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3(); this._mid = new THREE.Vector3(); this._c = new THREE.Color();
    scene.add(this.mesh);
  }
  // style: { color (hex), life (s), width (screen-space factor), speed (m/s) }
  spawn(sx, sy, sz, ex, ey, ez, style) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.n;
    it.a.set(sx, sy, sz); it.b.set(ex, ey, ez);
    if (it.a.distanceToSquared(it.b) < 0.25) return;
    it.on = true; it.t = 0; it.life = style.life; it.w = style.width; it.speed = style.speed; it.col.set(style.color);
  }
  update(dt, camera) {
    const items = this.items, cp = camera.position;
    let any = false;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.on) continue;
      any = true;
      it.t += dt;
      const len = it.a.distanceTo(it.b);
      const head = Math.min(len, it.t * it.speed); // bullet head racing to the target
      const fade = 1 - Math.min(1, Math.max(0, (it.t - len / it.speed) / it.life));
      if (fade <= 0) { it.on = false; this.mesh.setMatrixAt(i, ZERO); this._c.setRGB(0, 0, 0); this.mesh.setColorAt(i, this._c); continue; }
      const x = this._x.subVectors(it.b, it.a).normalize();
      this._mid.copy(it.a).addScaledVector(x, head * 0.5);
      const toCam = this._z.subVectors(cp, this._mid);
      const y = this._y.crossVectors(x, toCam).normalize();
      const w = it.w * (0.5 + 0.5 * fade);
      const z = this._z.crossVectors(x, y);
      _m.set(
        x.x * head, y.x * w, z.x, it.a.x,
        x.y * head, y.y * w, z.y, it.a.y,
        x.z * head, y.z * w, z.z, it.a.z,
        0, 0, 0, 1,
      );
      this.mesh.setMatrixAt(i, _m);
      const k = fade * fade;
      this._c.setRGB(it.col.r * k, it.col.g * k, it.col.b * k);
      this.mesh.setColorAt(i, this._c);
    }
    if (any || this._was) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
    this._was = any;
  }
}

// width is screen-space: world width = width × distance (0.015 ≈ 9 px glow, ~3 px hot core at 720p)
export const TRAIL_STYLE = {
  1: { color: 0xffa020, life: 0.22, width: 0.015, speed: 900 },
  2: { color: 0xffb84d, life: 0.16, width: 0.012, speed: 700 },
  3: { color: 0xff8a3a, life: 0.6, width: 0.026, speed: 1400 },
};

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
