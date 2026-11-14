import { PHYS } from '../config.js';

// Automatic navigation graph: sample the walkable surface on a grid (ray cast down), drop
// points without body clearance, then link neighbors that have line of sight and a
// continuous walkable surface between them (checked by probing the midpoints).
const STEP = 3.2;
const LINK = 5.2;

function surfaceAt(world, x, z, fromY, hit) {
  const t = world.raycast(x, fromY, z, 0, -1, 0, fromY + 1, hit);
  if (t === Infinity || hit.ny < 0.7) return null;
  return fromY - t;
}

function clear(world, x, y, z) {
  const r = PHYS.radius + 0.25, h = PHYS.heightStand;
  for (const b of world.query(x - r, z - r, x + r, z + r)) {
    if (b.kind !== 0) continue;
    if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ && y + h > b.minY + 0.05 && y < b.maxY - 0.05) return false;
  }
  return true;
}

export function buildWaypoints(world) {
  const hit = {};
  const nodes = [];
  // world extents from boxes
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of world.boxes) { if (b.maxX - b.minX > 60) { minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX); minZ = Math.min(minZ, b.minZ); maxZ = Math.max(maxZ, b.maxZ); } }
  if (!isFinite(minX)) { minX = -50; maxX = 50; minZ = -50; maxZ = 50; }
  for (let x = minX + 1.6; x < maxX; x += STEP) for (let z = minZ + 1.6; z < maxZ; z += STEP) {
    const y = surfaceAt(world, x, z, 4.0, hit);
    if (y === null || y > 3.2) continue;
    if (hit.mat === 'wood') continue;
    if (!clear(world, x, y + 0.02, z)) continue;
    nodes.push({ x, y, z, n: [] });
  }
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > LINK) continue;
      const dy = b.y - a.y;
      if (Math.abs(dy) / d > 0.5) continue;
      if (!world.lineClear(a.x, a.y + 0.6, a.z, b.x, b.y + 0.6, b.z)) continue;
      if (!world.lineClear(a.x, a.y + 1.5, a.z, b.x, b.y + 1.5, b.z)) continue;
      let ok = true;
      for (const t of [0.25, 0.5, 0.75]) {
        const mx = a.x + dx * t, mz = a.z + dz * t, my = a.y + dy * t;
        const s = surfaceAt(world, mx, mz, my + 1.0, hit);
        if (s === null || Math.abs(s - my) > 0.45 || !clear(world, mx, s + 0.02, mz)) { ok = false; break; }
      }
      if (!ok) continue;
      a.n.push(j); b.n.push(i);
    }
  }
  return nodes;
}

export function nearestNode(nodes, x, y, z) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n.n.length) continue;
    const d = (n.x - x) ** 2 + (n.z - z) ** 2 + (n.y - y) ** 2 * 4;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// BFS path (unweighted graph, uniform-ish spacing) → array of node indices
export function findPath(nodes, from, to, out) {
  out.length = 0;
  if (from < 0 || to < 0) return out;
  const prev = new Int32Array(nodes.length).fill(-2);
  const q = [from]; prev[from] = -1;
  let head = 0;
  while (head < q.length) {
    const c = q[head++];
    if (c === to) break;
    for (const nb of nodes[c].n) if (prev[nb] === -2) { prev[nb] = c; q.push(nb); }
  }
  if (prev[to] === -2) return out;
  for (let c = to; c !== -1; c = prev[c]) out.push(c);
  out.reverse();
  return out;
}
