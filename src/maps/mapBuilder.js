import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World } from '../physics/collision.js';

// Builds a map out of boxes/ramps. Every static piece goes into ONE merged, vertex-colored
// BufferGeometry (1 draw call). Text labels go into one atlas-textured merged mesh (1 draw call).
// Destructible crates are a single InstancedMesh (1 draw call).
const _c = new THREE.Color();

function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class MapBuilder {
  constructor(seed = 7) {
    this.world = new World();
    this.geos = [];
    this.labels = [];
    this.crates = [];
    this.rand = seeded(seed);
  }

  _colorize(geo, color, jitter, aoFloor) {
    const pos = geo.attributes.position;
    const n = pos.count;
    const col = new Float32Array(n * 3);
    _c.set(color);
    const j = 1 + (this.rand() - 0.5) * jitter;
    const r = _c.r * j, g = _c.g * j, b = _c.b * j;
    for (let i = 0; i < n; i++) {
      // baked ambient occlusion: darken vertices that sit near the floor
      const y = pos.getY(i);
      const ao = aoFloor !== null && y < aoFloor + 0.05 ? 0.68 : 1;
      col[i * 3] = r * ao; col[i * 3 + 1] = g * ao; col[i * 3 + 2] = b * ao;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.deleteAttribute('uv');
    return geo;
  }

  // Axis-aligned box. opts: {collide, mat, jitter, ao(bool), visual}
  box(minX, minY, minZ, maxX, maxY, maxZ, color, opts = {}) {
    const { collide = true, mat = 'solid', jitter = 0.06, ao = true, visual = true } = opts;
    if (visual) {
      const g = new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ).toNonIndexed();
      g.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      this.geos.push(this._colorize(g, color, jitter, ao ? Math.max(minY, 0) : null));
    }
    if (collide) return this.world.addBox(minX, minY, minZ, maxX, maxY, maxZ, mat);
    return null;
  }

  // centered on (cx, cz), standing on y0
  boxC(cx, cz, w, d, y0, h, color, opts) {
    return this.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, color, opts);
  }

  // Visual-only horizontal quad (floor tiles / markings)
  quad(minX, minZ, maxX, maxZ, y, color, jitter = 0.04) {
    const g = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ).toNonIndexed();
    g.rotateX(-Math.PI / 2);
    g.translate((minX + maxX) / 2, y, (minZ + maxZ) / 2);
    this.geos.push(this._colorize(g, color, jitter, null));
  }

  // Solid wedge ramp. axis 'x'|'z'; height goes y0 → y1 along +axis.
  ramp(minX, minZ, maxX, maxZ, axis, y0, y1, color, baseY = 0) {
    this.world.addRamp(minX, minZ, maxX, maxZ, axis, y0, y1, baseY);
    // corners: heights at each xz corner
    const h = (x, z) => {
      const t = axis === 'x' ? (x - minX) / (maxX - minX) : (z - minZ) / (maxZ - minZ);
      return y0 + (y1 - y0) * t;
    };
    const P = [
      [minX, baseY, minZ], [maxX, baseY, minZ], [maxX, baseY, maxZ], [minX, baseY, maxZ],
      [minX, h(minX, minZ), minZ], [maxX, h(maxX, minZ), minZ], [maxX, h(maxX, maxZ), maxZ], [minX, h(minX, maxZ), maxZ],
    ];
    const faces = [[4, 7, 6, 5], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    const verts = [];
    for (const f of faces) {
      const [a, b, c, d] = f.map((i) => P[i]);
      // skip degenerate faces (zero-height side)
      verts.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    // fix winding so every triangle faces outward (compute from centroid)
    const pos = g.attributes.position.array;
    const cx = (minX + maxX) / 2, cy = (baseY + Math.max(y0, y1)) / 3, cz = (minZ + maxZ) / 2;
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
      const ux = pos[i + 3] - ax, uy = pos[i + 4] - ay, uz = pos[i + 5] - az;
      const vx = pos[i + 6] - ax, vy = pos[i + 7] - ay, vz = pos[i + 8] - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const mx = (ax + pos[i + 3] + pos[i + 6]) / 3 - cx, my = (ay + pos[i + 4] + pos[i + 7]) / 3 - cy, mz = (az + pos[i + 5] + pos[i + 8]) / 3 - cz;
      if (nx * mx + ny * my + nz * mz < 0) {
        for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
      }
    }
    g.computeVertexNormals();
    this.geos.push(this._colorize(g, color, 0.04, null));
  }

  // Penetrable + destructible wooden crate (instanced)
  crate(cx, cz, size, h, y0 = 0, hp = 140) {
    const box = this.world.addBox(cx - size / 2, y0, cz - size / 2, cx + size / 2, y0 + h, cz + size / 2, 'wood');
    const c = { index: this.crates.length, cx, cz, size, h, y0, hp, maxHp: hp, box, broken: false };
    box.data = c;
    this.crates.push(c);
    return c;
  }

  // Text label in the world. flat → lies on the floor.
  label(text, x, y, z, height, rotY = 0, opts = {}) {
    this.labels.push({ text, x, y, z, height, rotY, flat: !!opts.flat, fg: opts.fg || '#ece8e1', bg: opts.bg || null, bold: opts.bold !== false });
  }

  build(scene) {
    const out = { world: this.world, meshes: [] };
    // --- static merged geometry (1 draw call) ---
    const merged = mergeGeometries(this.geos, false);
    for (const g of this.geos) g.dispose();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    scene.add(mesh); out.meshes.push(mesh);

    // --- label atlas (1 draw call) ---
    if (this.labels.length) {
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 1024;
      const ctx = canvas.getContext('2d');
      const ROW = 96;
      let cx = 0, cy = 0;
      const geos = [];
      for (const L of this.labels) {
        ctx.font = `${L.bold ? 800 : 500} 64px "Segoe UI", system-ui, sans-serif`;
        const w = Math.ceil(ctx.measureText(L.text).width) + 40;
        if (cx + w > 1024) { cx = 0; cy += ROW; }
        if (L.bg) { ctx.fillStyle = L.bg; ctx.fillRect(cx, cy, w, ROW - 8); }
        ctx.fillStyle = L.fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.fillText(L.text, cx + w / 2, cy + (ROW - 8) / 2 + 2);
        const aspect = w / (ROW - 8);
        const g = new THREE.PlaneGeometry(L.height * aspect, L.height);
        const uv = g.attributes.uv;
        const u0 = cx / 1024, u1 = (cx + w) / 1024, v0 = 1 - (cy + ROW - 8) / 1024, v1 = 1 - cy / 1024;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
        if (L.flat) g.rotateX(-Math.PI / 2);
        g.rotateY(L.rotY);
        g.translate(L.x, L.y, L.z);
        g.deleteAttribute('normal');
        geos.push(g);
        cx += w;
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = 2;
      const lm = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, fog: true }));
      lm.matrixAutoUpdate = false; lm.updateMatrix();
      lm.renderOrder = 1;
      scene.add(lm); out.meshes.push(lm);
    }

    // --- destructible crates (1 draw call) ---
    out.crates = this.crates;
    if (this.crates.length) {
      const parts = [];
      const add = (w, h, d, x, y, z, color) => {
        const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z);
        parts.push(this._colorize(g, color, 0, null));
      };
      add(1, 1, 1, 0, 0.5, 0, 0xb07a45);
      // frame planks (slightly proud of the faces)
      const F = 0.12, P = 1.02;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(F, 1.02, F, sx * (0.5 - F / 2) * P, 0.5, sz * (0.5 - F / 2) * P, 0x7a4f2a);
      for (const sy of [0.04, 0.96]) { add(1.02, F, F, 0, sy, 0.45, 0x7a4f2a); add(1.02, F, F, 0, sy, -0.45, 0x7a4f2a); add(F, F, 1.02, 0.45, sy, 0, 0x7a4f2a); add(F, F, 1.02, -0.45, sy, 0, 0x7a4f2a); }
      add(1.03, 0.08, 0.08, 0, 0.5, 0.49, 0x8e5f33); add(0.08, 0.08, 1.03, 0.49, 0.5, 0, 0x8e5f33);
      const cg = mergeGeometries(parts, false);
      const im = new THREE.InstancedMesh(cg, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), this.crates.length);
      out.crateMesh = im;
      const m4 = new THREE.Matrix4();
      out.setCrate = (c, visible) => {
        if (visible) m4.compose(new THREE.Vector3(c.cx, c.y0, c.cz), new THREE.Quaternion(), new THREE.Vector3(c.size, c.h, c.size));
        else m4.makeScale(0, 0, 0);
        im.setMatrixAt(c.index, m4);
        im.instanceMatrix.needsUpdate = true;
      };
      for (const c of this.crates) out.setCrate(c, true);
      im.computeBoundingSphere();
      im.frustumCulled = false;
      scene.add(im); out.meshes.push(im);
    }
    return out;
  }
}

// --- Tile grid helper: carve open space out of a solid block, then greedy-merge the rest into walls.
export class TileGrid {
  constructor(cols, rows, tile, originX, originZ) {
    this.cols = cols; this.rows = rows; this.tile = tile; this.ox = originX; this.oz = originZ;
    this.solid = new Uint8Array(cols * rows).fill(1);
    this.floor = new Int16Array(cols * rows).fill(-1);
  }
  carve(c0, r0, c1, r1, floorId = 0) {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
      this.solid[r * this.cols + c] = 0; this.floor[r * this.cols + c] = floorId;
    }
  }
  fill(c0, r0, c1, r1) { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.solid[r * this.cols + c] = 1; }
  x(c) { return this.ox + c * this.tile; }
  z(r) { return this.oz + r * this.tile; }
  cx(c) { return this.ox + (c + 0.5) * this.tile; }
  cz(r) { return this.oz + (r + 0.5) * this.tile; }
  // greedy rectangles of solid tiles
  rects(value = 1, arr = this.solid) {
    const used = new Uint8Array(this.cols * this.rows);
    const out = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const i = r * this.cols + c;
      if (used[i] || arr[i] !== value) continue;
      let w = 1;
      while (c + w < this.cols && !used[i + w] && arr[i + w] === value) w++;
      let h = 1;
      outer: while (r + h < this.rows) {
        for (let k = 0; k < w; k++) { const j = (r + h) * this.cols + c + k; if (used[j] || arr[j] !== value) break outer; }
        h++;
      }
      for (let rr = r; rr < r + h; rr++) for (let k = 0; k < w; k++) used[rr * this.cols + c + k] = 1;
      out.push({ c, r, w, h });
    }
    return out;
  }
}
