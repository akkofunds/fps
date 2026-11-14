import { MapBuilder } from './mapBuilder.js';

// ATRIUM — bright coastal white-stone plaza with teal accents. Wide smooth floors,
// sloped ramps, pillar colonnades, raised sniper terraces and 45m+ sightlines.
// Team 0 spawns west, team 1 east.
export function buildAtrium(scene) {
  const b = new MapBuilder(37);
  const WHITE = 0xeeeae2, WHITE2 = 0xe2ddd2, STONE = 0xd6cfc1, TEAL = 0x2fb7a8, TEALD = 0x1d8378, SAND = 0xe8dcc0;

  // ground + big tile pattern with teal inlays
  b.box(-52, -1, -42, 52, 0, 42, WHITE2, { ao: false, visual: false });
  for (let x = -50; x < 50; x += 5) for (let z = -40; z < 40; z += 5) {
    b.quad(x + 0.05, z + 0.05, x + 4.95, z + 4.95, 0.004, ((x + z) / 5 & 1) ? WHITE : 0xe6e1d7, 0.02);
  }
  b.quad(-52, -42, 52, 42, -0.002, 0x9fb8b4, 0);
  for (const z of [-10.1, 9.9]) b.quad(-38, z, 38, z + 0.2, 0.008, TEAL, 0);
  b.quad(-0.1, -26, 0.1, 26, 0.008, TEAL, 0);

  // outer walls
  const H = 8;
  b.box(-52, 0, -42, 52, H, -40, WHITE); b.box(-52, 0, 40, 52, H, 42, WHITE);
  b.box(-52, 0, -40, -50, H, 40, WHITE); b.box(50, 0, -40, 52, H, 40, WHITE);
  // teal accent bands
  b.box(-50, 1.0, -40.0, 50, 1.25, -39.85, TEAL, { collide: false, jitter: 0 });
  b.box(-50, 1.0, 39.85, 50, 1.25, 40, TEAL, { collide: false, jitter: 0 });
  b.box(-50, 1.0, -40, -49.85, 1.25, 40, TEAL, { collide: false, jitter: 0 });
  b.box(49.85, 1.0, -40, 50, 1.25, 40, TEAL, { collide: false, jitter: 0 });

  // spawn rooms (partial walls with wide doorways)
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -50 : 41, x1 = s < 0 ? -41 : 50, fx = s < 0 ? -41 : 41;
    b.box(Math.min(fx, fx + s * 0.8), 0, -12, Math.max(fx, fx + s * 0.8), 5, -4, STONE);
    b.box(Math.min(fx, fx + s * 0.8), 0, 4, Math.max(fx, fx + s * 0.8), 5, 12, STONE);
    b.box(x0, 0, -12.8, x1, 5, -12, STONE); b.box(x0, 0, 12, x1, 5, 12.8, STONE);
    b.box(Math.min(fx, fx + s * 0.8), 5, -12.8, Math.max(fx, fx + s * 0.8), 5.4, 12.8, TEALD, { collide: true });
    b.quad(x0, -12, x1, 12, 0.006, 0xd9e7e4, 0);
  }

  // north + south sniper terraces with ramps on both ends and parapets
  for (const s of [-1, 1]) {
    const z0 = s < 0 ? -40 : 27, z1 = s < 0 ? -27 : 40, ze = s < 0 ? -27 : 27;
    b.box(-26, 0, z0, 26, 2.4, z1, STONE);
    b.box(-26, 2.4, Math.min(ze, ze - s * 0.3), 26, 2.48, Math.max(ze, ze - s * 0.3), TEAL, { collide: false, jitter: 0 });
    b.ramp(-34, z0 + 2, -26, z1 - 2, 'x', 0, 2.4, SAND);
    b.ramp(26, z0 + 2, 34, z1 - 2, 'x', 2.4, 0, SAND);
    const pz0 = s < 0 ? -27.6 : 27, pz1 = s < 0 ? -27 : 27.6;
    b.box(-20, 2.4, pz0, -6, 3.45, pz1, WHITE); b.box(6, 2.4, pz0, 20, 3.45, pz1, WHITE);
    b.box(-1.5, 2.4, pz0, 1.5, 3.45, pz1, WHITE);
    // terrace back pillars for cover from the opposite perch
    for (const x of [-16, 0, 16]) b.box(x - 0.8, 2.4, (z0 + z1) / 2 - 0.8, x + 0.8, 5.2, (z0 + z1) / 2 + 0.8, WHITE2);
  }

  // colonnades
  for (const z of [-18, 18]) for (let x = -36; x <= 36; x += 8) {
    if (x === 0) continue;
    b.box(x - 0.65, 0, z - 0.65, x + 0.65, 6, z + 0.65, WHITE);
    b.box(x - 0.85, 6, z - 0.85, x + 0.85, 6.35, z + 0.85, TEAL, { jitter: 0 });
    b.box(x - 0.85, 0, z - 0.85, x + 0.85, 0.35, z + 0.85, STONE, { collide: false });
  }

  // central fountain + obelisk
  b.box(-6, 0, -6, 6, 0.8, -5.2, STONE); b.box(-6, 0, 5.2, 6, 0.8, 6, STONE);
  b.box(-6, 0, -5.2, -5.2, 0.8, 5.2, STONE); b.box(5.2, 0, -5.2, 6, 0.8, 5.2, STONE);
  b.quad(-5.2, -5.2, 5.2, 5.2, 0.45, TEAL, 0.02);
  b.box(-5.2, 0, -5.2, 5.2, 0.4, 5.2, TEALD, { collide: true });
  b.box(-1.2, 0.4, -1.2, 1.2, 5.5, 1.2, WHITE);
  b.box(-1.4, 5.5, -1.4, 1.4, 5.9, 1.4, TEAL, { jitter: 0 });

  // movement decks (ramp up, flat top, ramp down) north and south of center — bhop lines
  for (const z of [-14, 14]) {
    b.ramp(-12, z - 2, -5, z + 2, 'x', 0, 1.5, SAND);
    b.box(-5, 0, z - 2, 5, 1.5, z + 2, STONE);
    b.ramp(5, z - 2, 12, z + 2, 'x', 1.5, 0, SAND);
  }

  // scattered cover
  for (const [x, z, w, d, h] of [
    [-22, -8, 4, 0.8, 1.15], [22, 8, 4, 0.8, 1.15], [-22, 8, 0.8, 4, 1.15], [22, -8, 0.8, 4, 1.15],
    [-34, 0, 2, 2, 1.3], [34, 0, 2, 2, 1.3], [-14, -24, 2.4, 1.2, 1.4], [14, 24, 2.4, 1.2, 1.4],
    [-44, -22, 3, 3, 2.2], [44, 22, 3, 3, 2.2], [-44, 24, 2, 4, 1.2], [44, -24, 2, 4, 1.2],
  ]) b.boxC(x, z, w, d, 0, h, (x * z) > 0 ? WHITE : STONE);
  b.boxC(-14, 24, 1.6, 1.6, 0, 1.5, 0xc59a6a, { mat: 'wood' });
  b.boxC(14, -24, 1.6, 1.6, 0, 1.5, 0xc59a6a, { mat: 'wood' });

  b.label('ATRIUM', 0, 6.4, -39.85, 1.6, 0, { fg: '#1d8378' });
  b.label('WEST', -45, 0.02, 0, 1.3, -Math.PI / 2, { flat: true, fg: '#1d8378' });
  b.label('EAST', 45, 0.02, 0, 1.3, Math.PI / 2, { flat: true, fg: '#1d8378' });

  const built = b.build(scene);
  const sp = (x0, x1, yaw) => { const a = []; for (let x = x0; x <= x1; x += 2.5) for (let z = -8; z <= 8; z += 4) a.push({ x, y: 0, z, yaw }); return a; };
  const ffa = [
    { x: -45, y: 0, z: 0, yaw: -Math.PI / 2 }, { x: 45, y: 0, z: 0, yaw: Math.PI / 2 },
    { x: 8, y: 2.4, z: -33, yaw: Math.PI }, { x: -8, y: 2.4, z: 33, yaw: 0 },
    { x: -30, y: 0, z: -14, yaw: -Math.PI / 2 }, { x: 30, y: 0, z: 14, yaw: Math.PI / 2 },
    { x: -20, y: 0, z: 22, yaw: 0 }, { x: 20, y: 0, z: -22, yaw: Math.PI },
    { x: -40, y: 0, z: 30, yaw: 0 }, { x: 40, y: 0, z: -30, yaw: Math.PI }, { x: 0, y: 0, z: -9, yaw: 0 }, { x: 0, y: 0, z: 9, yaw: Math.PI },
  ];
  return {
    id: 'atrium', ...built,
    sky: 0xa9dcf0, fog: [0xc4e6f2, 70, 180],
    hemi: [0xf4fbff, 0x9fb3ad, 1.0], sun: [0xffffff, 1.25, [-0.3, 1, -0.45]],
    spawns: { 0: sp(-48, -43, -Math.PI / 2), 1: sp(43, 48, Math.PI / 2), ffa },
    waypoints: 'auto',
  };
}
