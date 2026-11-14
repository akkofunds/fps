// Static collision world: axis-aligned boxes + axis-aligned wedge ramps.
// Brute force is fine for a few hundred primitives (a few microseconds per query),
// and a uniform XZ grid broadphase keeps movement queries O(nearby).
const CELL = 8;

export class World {
  constructor() {
    this.boxes = [];
    this.ramps = [];
    this.grid = new Map();
    this._q = [];
    this._stamp = 0;
    this.bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  }

  addBox(minX, minY, minZ, maxX, maxY, maxZ, mat = 'solid') {
    const b = { minX, minY, minZ, maxX, maxY, maxZ, mat, active: true, kind: 0, id: this.boxes.length, _s: 0, data: null };
    this.boxes.push(b);
    this._insert(b);
    return b;
  }

  // axis 'x' → height varies along x from y0 (at minX) to y1 (at maxX); same for 'z'
  addRamp(minX, minZ, maxX, maxZ, axis, y0, y1, baseY = 0) {
    const r = {
      minX, minZ, maxX, maxZ, axis, y0, y1, baseY, kind: 1, active: true, mat: 'solid', _s: 0,
      minY: baseY, maxY: Math.max(y0, y1),
    };
    // slope plane normal
    const L = axis === 'x' ? maxX - minX : maxZ - minZ;
    const k = (y1 - y0) / L;
    const inv = 1 / Math.sqrt(1 + k * k);
    r.nx = axis === 'x' ? -k * inv : 0;
    r.nz = axis === 'z' ? -k * inv : 0;
    r.ny = inv;
    this.ramps.push(r);
    this._insert(r);
    return r;
  }

  rampHeight(r, x, z) {
    let t = r.axis === 'x' ? (x - r.minX) / (r.maxX - r.minX) : (z - r.minZ) / (r.maxZ - r.minZ);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return r.y0 + (r.y1 - r.y0) * t;
  }

  _insert(o) {
    const c0 = Math.floor(o.minX / CELL), c1 = Math.floor(o.maxX / CELL);
    const r0 = Math.floor(o.minZ / CELL), r1 = Math.floor(o.maxZ / CELL);
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
      const k = c * 4096 + r;
      let cell = this.grid.get(k);
      if (!cell) { cell = []; this.grid.set(k, cell); }
      cell.push(o);
    }
  }

  // Gather primitives overlapping an XZ rectangle (deduplicated). Returns a shared array.
  query(minX, minZ, maxX, maxZ) {
    const out = this._q; out.length = 0;
    const s = ++this._stamp;
    const c0 = Math.floor(minX / CELL), c1 = Math.floor(maxX / CELL);
    const r0 = Math.floor(minZ / CELL), r1 = Math.floor(maxZ / CELL);
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
      const cell = this.grid.get(c * 4096 + r);
      if (!cell) continue;
      for (let i = 0; i < cell.length; i++) {
        const o = cell[i];
        if (o._s === s || !o.active) continue;
        o._s = s; out.push(o);
      }
    }
    return out;
  }

  // Ray vs world. Returns distance (Infinity if none) and fills `hit`.
  // ignoreBox: skip one box (used when continuing through penetrable wood).
  raycast(ox, oy, oz, dx, dy, dz, maxT, hit, ignoreBox = null) {
    let best = maxT;
    let found = false;
    const idx = dx !== 0 ? 1 / dx : 1e30, idy = dy !== 0 ? 1 / dy : 1e30, idz = dz !== 0 ? 1 / dz : 1e30;
    const list = this.boxes;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.active || b === ignoreBox) continue;
      let t1 = (b.minX - ox) * idx, t2 = (b.maxX - ox) * idx;
      let tmin = t1 < t2 ? t1 : t2, tmax = t1 < t2 ? t2 : t1;
      let nAxis = 0;
      t1 = (b.minY - oy) * idy; t2 = (b.maxY - oy) * idy;
      let a = t1 < t2 ? t1 : t2, c = t1 < t2 ? t2 : t1;
      if (a > tmin) { tmin = a; nAxis = 1; }
      if (c < tmax) tmax = c;
      t1 = (b.minZ - oz) * idz; t2 = (b.maxZ - oz) * idz;
      a = t1 < t2 ? t1 : t2; c = t1 < t2 ? t2 : t1;
      if (a > tmin) { tmin = a; nAxis = 2; }
      if (c < tmax) tmax = c;
      if (tmax < 0 || tmin > tmax || tmin >= best) continue;
      if (tmin < 0) continue; // origin inside box: ignore (lets bullets exit a crate)
      best = tmin; found = true;
      hit.obj = b; hit.mat = b.mat; hit.tExit = tmax;
      hit.nx = nAxis === 0 ? -Math.sign(dx) : 0;
      hit.ny = nAxis === 1 ? -Math.sign(dy) : 0;
      hit.nz = nAxis === 2 ? -Math.sign(dz) : 0;
    }
    const ramps = this.ramps;
    for (let i = 0; i < ramps.length; i++) {
      const r = ramps[i];
      // slope plane
      const denom = dx * r.nx + dy * r.ny + dz * r.nz;
      if (denom < 0) {
        const px = r.minX, pz = r.minZ, py = r.y0;
        const t = ((px - ox) * r.nx + (py - oy) * r.ny + (pz - oz) * r.nz) / denom;
        if (t > 0 && t < best) {
          const x = ox + dx * t, z = oz + dz * t;
          if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
            best = t; found = true; hit.obj = r; hit.mat = 'solid'; hit.tExit = t;
            hit.nx = r.nx; hit.ny = r.ny; hit.nz = r.nz;
          }
        }
      }
      // vertical faces of the wedge (sides / tall end)
      let t1 = (r.minX - ox) * idx, t2 = (r.maxX - ox) * idx;
      let tmin = t1 < t2 ? t1 : t2, tmax = t1 < t2 ? t2 : t1, nAxis = 0;
      t1 = (r.baseY - oy) * idy; t2 = (r.maxY - oy) * idy;
      let a = t1 < t2 ? t1 : t2, c = t1 < t2 ? t2 : t1;
      if (a > tmin) { tmin = a; nAxis = 1; }
      if (c < tmax) tmax = c;
      t1 = (r.minZ - oz) * idz; t2 = (r.maxZ - oz) * idz;
      a = t1 < t2 ? t1 : t2; c = t1 < t2 ? t2 : t1;
      if (a > tmin) { tmin = a; nAxis = 2; }
      if (c < tmax) tmax = c;
      if (tmax < 0 || tmin > tmax || tmin >= best || tmin < 0 || nAxis === 1) continue;
      const hx = ox + dx * tmin, hy = oy + dy * tmin, hz = oz + dz * tmin;
      if (hy <= this.rampHeight(r, hx, hz) + 0.01) {
        best = tmin; found = true; hit.obj = r; hit.mat = 'solid'; hit.tExit = tmin;
        hit.nx = nAxis === 0 ? -Math.sign(dx) : 0; hit.ny = 0; hit.nz = nAxis === 2 ? -Math.sign(dz) : 0;
      }
    }
    if (!found) return Infinity;
    hit.t = best;
    hit.x = ox + dx * best; hit.y = oy + dy * best; hit.z = oz + dz * best;
    return best;
  }

  // true if the straight segment a→b is unobstructed
  lineClear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-4) return true;
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len, _tmpHit) === Infinity;
  }
}
const _tmpHit = {};
