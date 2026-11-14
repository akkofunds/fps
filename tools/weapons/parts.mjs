// Stage A: load a source GLB, bake every node transform + a normalization matrix into the
// geometry, and sort primitives into named groups. Output frame: barrel → -Z, +Y up, +X right,
// meters. Islands inside one mesh can be routed to different groups by a classifier.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { transformPrimitive } from '@gltf-transform/functions';

export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

export function mat4Mul(a, b) { // column-major a*b
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
// rows of a 3x3 rotation (new = R * old) + uniform scale + post translation (in new space)
export function normMatrix(R, s, t = [0, 0, 0]) {
  return [R[0][0] * s, R[1][0] * s, R[2][0] * s, 0, R[0][1] * s, R[1][1] * s, R[2][1] * s, 0, R[0][2] * s, R[1][2] * s, R[2][2] * s, 0, t[0], t[1], t[2], 1];
}

function subsetPrimitive(doc, prim, triMask) {
  // copy of prim containing only triangles where triMask[t] is true (re-indexed)
  const idx = prim.getIndices().getArray();
  const map = new Map(); const newIdx = [];
  for (let t = 0; t < idx.length / 3; t++) {
    if (!triMask[t]) continue;
    for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; if (!map.has(v)) map.set(v, map.size); newIdx.push(map.get(v)); }
  }
  const out = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
  for (const sem of prim.listSemantics()) {
    const a = prim.getAttribute(sem); const src = a.getArray(); const n = a.getElementSize();
    const dst = new src.constructor(map.size * n);
    for (const [ov, nv] of map) for (let c = 0; c < n; c++) dst[nv * n + c] = src[ov * n + c];
    out.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(dst).setNormalized(a.getNormalized()).setBuffer(a.getBuffer()));
  }
  out.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(newIdx)).setBuffer(prim.getIndices().getBuffer()));
  return out;
}

// islands (connected by welded positions) → array of {tris:Uint8Array mask, min, max, count}
export function islands(prim) {
  const pos = prim.getAttribute('POSITION').getArray(); const idx = prim.getIndices().getArray();
  const n = pos.length / 3, key = new Map(), rep = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = `${pos[i * 3].toFixed(5)},${pos[i * 3 + 1].toFixed(5)},${pos[i * 3 + 2].toFixed(5)}`; if (!key.has(k)) key.set(k, i); rep[i] = key.get(k); }
  const par = new Int32Array(n).map((_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let t = 0; t < idx.length; t += 3) { const a = find(rep[idx[t]]); par[a] = find(rep[idx[t + 1]]); const b = find(rep[idx[t]]); par[b] = find(rep[idx[t + 2]]); }
  const comps = new Map(); const triComp = new Int32Array(idx.length / 3);
  for (let t = 0; t < idx.length / 3; t++) {
    const r = find(rep[idx[t * 3]]);
    let c = comps.get(r); if (!c) { c = { id: comps.size, count: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; comps.set(r, c); }
    c.count++; triComp[t] = c.id;
    for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; for (let a = 0; a < 3; a++) { c.min[a] = Math.min(c.min[a], pos[v * 3 + a]); c.max[a] = Math.max(c.max[a], pos[v * 3 + a]); } }
  }
  return { list: [...comps.values()], triComp };
}

export function bboxOf(prims) {
  const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const p of prims) { const a = p.getAttribute('POSITION').getArray(); for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], a[i + k]); max[k] = Math.max(max[k], a[i + k]); } }
  return { min, max };
}

// cfg: { file, norm (mat4), route(nodeName, meshName, matName) → group | null | 'split', split(island, matName) → group|null }
export async function loadParts(cfg) {
  const doc = await io.read(cfg.file);
  const root = doc.getRoot();
  const groups = {};
  const add = (g, p) => { (groups[g] || (groups[g] = [])).push(p); };
  const meshNodes = [];
  root.getDefaultScene().traverse((n) => { if (n.getMesh()) meshNodes.push(n); });
  for (const node of meshNodes) {
    const world = mat4Mul(cfg.norm, node.getWorldMatrix());
    for (const prim of node.getMesh().listPrimitives()) {
      const matName = prim.getMaterial() ? prim.getMaterial().getName() : '';
      const parentName = node.getParentNode() ? node.getParentNode().getName() : '';
      const g = cfg.route(node.getName(), parentName, node.getMesh().getName(), matName);
      if (!g) continue;
      const copy = prim.clone();
      // detach accessors (clone shares them) so transforms don't double-apply
      for (const sem of copy.listSemantics()) copy.setAttribute(sem, copy.getAttribute(sem).clone());
      copy.setIndices(copy.getIndices().clone());
      transformPrimitive(copy, world);
      if (g !== 'split') { add(g, copy); continue; }
      const { list, triComp } = islands(copy);
      const byGroup = {};
      for (const c of list) { const gg = cfg.split(c, matName); if (gg) (byGroup[gg] || (byGroup[gg] = new Set())).add(c.id); }
      for (const [gg, ids] of Object.entries(byGroup)) {
        const mask = new Uint8Array(triComp.length);
        for (let t = 0; t < triComp.length; t++) mask[t] = ids.has(triComp[t]) ? 1 : 0;
        add(gg, subsetPrimitive(doc, copy, mask));
      }
      copy.dispose();
    }
  }
  // remove the original scene graph
  for (const n of root.listNodes()) n.dispose();
  for (const m of root.listMeshes()) m.dispose();
  return { doc, groups };
}
