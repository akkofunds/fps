import { groundH, groundNormal, lakeWaterDepth } from './terrain.js';

// Collision world: terrain heightfield + primitive colliders in a uniform grid.
//   cyl    { x, z, r, y0, y1 }                     vertical cylinder (pillars, trunks, plaza disc)
//   box    { x, z, hx, hz, rot, y0, y1 }           box rotated about Y (walls, logs, tower)
//   sphere { x, y, z, r }                          boulders
// Tops of every collider are walkable (step-up / landing).

const CELL = 8;

export class CollisionWorld {
  constructor() {
    this.items = [];
    this.grid = new Map();
    this.water = null; // { x, z, r, y }
    this._q = []; this._stamp = 0;
  }

  _key(i, j) { return i * 73856093 ^ j * 19349663; }
  _insert(it, minX, minZ, maxX, maxZ) {
    for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++) for (let j = Math.floor(minZ / CELL); j <= Math.floor(maxZ / CELL); j++) {
      const k = this._key(i, j);
      let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(it);
    }
  }
  addCyl(x, z, r, y0, y1, tag) { const it = { t: 0, x, z, r, y0, y1, tag, s: 0 }; this.items.push(it); this._insert(it, x - r, z - r, x + r, z + r); return it; }
  addBox(x, z, hx, hz, rot, y0, y1, tag) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
    const it = { t: 1, x, z, hx, hz, c, s, y0, y1, tag, st: 0 };
    this.items.push(it); this._insert(it, x - ex, z - ez, x + ex, z + ez); return it;
  }
  addSphere(x, y, z, r, tag) { const it = { t: 2, x, y, z, r, tag, st: 0 }; this.items.push(it); this._insert(it, x - r, z - r, x + r, z + r); return it; }

  // items near an xz box (deduplicated)
  query(minX, minZ, maxX, maxZ) {
    const out = this._q; out.length = 0;
    const st = ++this._stamp;
    for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++) for (let j = Math.floor(minZ / CELL); j <= Math.floor(maxZ / CELL); j++) {
      const a = this.grid.get(this._key(i, j));
      if (!a) continue;
      for (const it of a) if (it.st !== st) { it.st = st; out.push(it); }
    }
    return out;
  }

  terrain(x, z) { return groundH(x, z); }
  normal(x, z, out) { return groundNormal(x, z, out); }

  // highest walkable surface at (x, z) that is not above yRef + stepUp
  groundAt(x, z, yRef = 1e9, stepUp = 0.55, radius = 0) {
    let g = groundH(x, z);
    const list = this.query(x - radius, z - radius, x + radius, z + radius);
    for (const it of list) {
      let top = -1e9;
      if (it.t === 0) { if ((x - it.x) ** 2 + (z - it.z) ** 2 <= (it.r + radius * 0.5) ** 2) top = it.y1; }
      else if (it.t === 1) {
        const dx = x - it.x, dz = z - it.z;
        const lx = dx * it.c + dz * it.s, lz = -dx * it.s + dz * it.c;
        if (Math.abs(lx) <= it.hx + radius * 0.5 && Math.abs(lz) <= it.hz + radius * 0.5) top = it.y1;
      } else {
        const d2 = (x - it.x) ** 2 + (z - it.z) ** 2;
        const rr = it.r * 0.92;
        if (d2 < rr * rr) top = it.y + Math.sqrt(rr * rr - d2);
      }
      if (top > g && top <= yRef + stepUp) g = top;
    }
    return g;
  }

  // push a vertical capsule (feet at p.y, height h, radius r) out of colliders; returns true if pushed
  resolve(p, r, h, stepUp = 0.5) {
    let hit = false;
    const list = this.query(p.x - r - 1, p.z - r - 1, p.x + r + 1, p.z + r + 1).slice();
    for (let iter = 0; iter < 2; iter++) {
      for (const it of list) {
        if (it.t === 0) {
          if (it.y1 <= p.y + stepUp || it.y0 >= p.y + h) continue;
          const dx = p.x - it.x, dz = p.z - it.z, d = Math.hypot(dx, dz), m = it.r + r;
          if (d < m) { const k = d > 1e-5 ? (m - d) / d : 0; p.x += dx * k + (d > 1e-5 ? 0 : m); p.z += dz * k; hit = true; }
        } else if (it.t === 1) {
          if (it.y1 <= p.y + stepUp || it.y0 >= p.y + h) continue;
          const dx = p.x - it.x, dz = p.z - it.z;
          const lx = dx * it.c + dz * it.s, lz = -dx * it.s + dz * it.c;
          const cx = Math.max(-it.hx, Math.min(it.hx, lx)), cz = Math.max(-it.hz, Math.min(it.hz, lz));
          let ex = lx - cx, ez = lz - cz;
          let d = Math.hypot(ex, ez);
          if (d >= r) continue;
          let nx, nz, push;
          if (d > 1e-5) { nx = ex / d; nz = ez / d; push = r - d; }
          else { // center inside: exit along the shallowest axis
            const px = it.hx - Math.abs(lx), pz = it.hz - Math.abs(lz);
            if (px < pz) { nx = Math.sign(lx) || 1; nz = 0; push = px + r; } else { nx = 0; nz = Math.sign(lz) || 1; push = pz + r; }
          }
          // local → world
          const wx = nx * it.c - nz * it.s, wz = nx * it.s + nz * it.c;
          p.x += wx * push; p.z += wz * push; hit = true;
        } else {
          // sphere vs capsule segment
          const top = it.y + it.r;
          if (top <= p.y + stepUp) continue;
          const cy = Math.max(p.y + r, Math.min(p.y + h - r, it.y));
          const dx = p.x - it.x, dy = cy - it.y, dz = p.z - it.z;
          const d = Math.hypot(dx, dy, dz), m = it.r + r;
          if (d < m) { const hd = Math.hypot(dx, dz) || 1e-5; const k = (m - d); p.x += dx / hd * k; p.z += dz / hd * k; hit = true; }
        }
      }
    }
    return hit;
  }

  // ray vs world. returns distance or Infinity. pads colliders by `pad` (sphere-cast-ish)
  raycast(ox, oy, oz, dx, dy, dz, maxD, pad = 0, out = null, skipTerrain = false) {
    let best = maxD;
    let nrmX = 0, nrmY = 1, nrmZ = 0;
    const ex = ox + dx * maxD, ez = oz + dz * maxD;
    const list = this.query(Math.min(ox, ex) - 2, Math.min(oz, ez) - 2, Math.max(ox, ex) + 2, Math.max(oz, ez) + 2);
    for (const it of list) {
      if (it.t === 0) {
        // infinite cylinder in xz
        const r = it.r + pad;
        const fx = ox - it.x, fz = oz - it.z;
        const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - r * r;
        let t = Infinity;
        if (a > 1e-9) { const disc = b * b - 4 * a * c; if (disc >= 0) { const t0 = (-b - Math.sqrt(disc)) / (2 * a); if (t0 >= 0) t = t0; else if (c < 0) t = 0; } }
        if (t < best) { const y = oy + dy * t; if (y >= it.y0 - pad && y <= it.y1 + pad) { best = t; const hx = fx + dx * t, hz = fz + dz * t, l = Math.hypot(hx, hz) || 1; nrmX = hx / l; nrmY = 0; nrmZ = hz / l; continue; } }
        // top cap
        if (Math.abs(dy) > 1e-6) { const tc = (it.y1 + pad - oy) / dy; if (tc >= 0 && tc < best) { const hx = fx + dx * tc, hz = fz + dz * tc; if (hx * hx + hz * hz <= r * r) { best = tc; nrmX = 0; nrmY = 1; nrmZ = 0; } } }
      } else if (it.t === 1) {
        // slab test in box space
        const fx = ox - it.x, fz = oz - it.z;
        const lox = fx * it.c + fz * it.s, loz = -fx * it.s + fz * it.c;
        const ldx = dx * it.c + dz * it.s, ldz = -dx * it.s + dz * it.c;
        let tmin = 0, tmax = best, axis = -1, sgn = 1;
        const slabs = [[lox, ldx, it.hx + pad, 0], [oy - (it.y0 + it.y1) / 2, dy, (it.y1 - it.y0) / 2 + pad, 1], [loz, ldz, it.hz + pad, 2]];
        let ok = true;
        for (const [o, d, hh, ax] of slabs) {
          if (Math.abs(d) < 1e-9) { if (o < -hh || o > hh) { ok = false; break; } continue; }
          let t1 = (-hh - o) / d, t2 = (hh - o) / d, s = -1;
          if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
          if (t1 > tmin) { tmin = t1; axis = ax; sgn = s; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) { ok = false; break; }
        }
        if (ok && tmin < best) {
          best = tmin;
          if (axis === 1) { nrmX = 0; nrmY = sgn; nrmZ = 0; }
          else { const lx = axis === 0 ? sgn : 0, lz = axis === 2 ? sgn : 0; nrmX = lx * it.c - lz * it.s; nrmY = 0; nrmZ = lx * it.s + lz * it.c; }
        }
      } else {
        const r = it.r + pad;
        const fx = ox - it.x, fy = oy - it.y, fz = oz - it.z;
        const b = fx * dx + fy * dy + fz * dz, c = fx * fx + fy * fy + fz * fz - r * r;
        const disc = b * b - c;
        if (disc >= 0) { let t = -b - Math.sqrt(disc); if (t < 0 && c < 0) t = 0; if (t >= 0 && t < best) { best = t; const hx = fx + dx * t, hy = fy + dy * t, hz = fz + dz * t, l = Math.hypot(hx, hy, hz) || 1; nrmX = hx / l; nrmY = hy / l; nrmZ = hz / l; } }
      }
    }
    if (!skipTerrain) {
      // terrain march + bisection
      const step = 0.5;
      let t = 0, prevT = 0;
      let prevAbove = oy - groundH(ox, oz) > pad;
      if (!prevAbove) { best = 0; nrmX = 0; nrmY = 1; nrmZ = 0; }
      else {
        while (t < best) {
          t = Math.min(best, t + step);
          const y = oy + dy * t, x = ox + dx * t, z = oz + dz * t;
          if (y - groundH(x, z) <= pad) {
            let lo = prevT, hi = t;
            for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (oy + dy * m - groundH(ox + dx * m, oz + dz * m) <= pad) hi = m; else lo = m; }
            if (hi < best) { best = hi; const nn = groundNormal(ox + dx * hi, oz + dz * hi, { set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; }, normalize() { const l = Math.hypot(this.x, this.y, this.z); this.x /= l; this.y /= l; this.z /= l; return this; } }); nrmX = nn.x; nrmY = nn.y; nrmZ = nn.z; }
            break;
          }
          prevT = t;
        }
      }
    }
    if (out) { out.t = best; out.nx = nrmX; out.ny = nrmY; out.nz = nrmZ; }
    return best < maxD ? best : Infinity;
  }

  inWater(x, z) { return lakeWaterDepth(x, z); }
}
