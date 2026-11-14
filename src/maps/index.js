import { buildRange } from './range.js';
import { buildPiazza } from './piazza.js';
import { buildAtrium } from './atrium.js';
import { buildWaypoints } from './waypoints.js';

const BUILDERS = { range: buildRange, piazza: buildPiazza, atrium: buildAtrium };

export function buildMap(id, scene) {
  const fn = BUILDERS[id] || buildPiazza;
  const map = fn(scene);
  if (map.waypoints === 'auto') map.waypoints = buildWaypoints(map.world);
  map.resetCrates = () => {
    for (const c of map.crates || []) { c.hp = c.maxHp; c.broken = false; c.box.active = true; map.setCrate(c, true); }
  };
  map.breakCrate = (i) => {
    const c = map.crates && map.crates[i];
    if (!c || c.broken) return null;
    c.broken = true; c.hp = 0; c.box.active = false; map.setCrate(c, false);
    return c;
  };
  map.dispose = () => {
    for (const m of map.meshes) {
      scene.remove(m);
      m.geometry.dispose();
      if (m.material.map) m.material.map.dispose();
      m.material.dispose();
    }
  };
  return map;
}
