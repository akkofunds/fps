import * as THREE from 'three';

// Points of interest inside the valley. The current look (autumn reference) is pure grassland: no
// ruins, stone circles, bridges or rock ledges — just the meadow, its trees and boulders (props.js),
// the river and the waterfall. Kept as the hook props.js builds landmarks through.
export function buildBiomes(B) {
  const group = new THREE.Group(); group.name = 'biomes';
  if (B.extra) for (const m of B.extra) group.add(m);
  return group;
}
