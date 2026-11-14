import { MapBuilder, TileGrid } from './mapBuilder.js';

// PIAZZA — warm Venetian-plaster 2-site tactical map. Built by carving corridors out of a
// solid tile block (2m tiles), then greedy-merging the remaining solid tiles into wall boxes.
// North = -z. Attackers (team 0) spawn south, defenders (team 1) north.
export function buildPiazza(scene) {
  const b = new MapBuilder(23);
  const T = 2, COLS = 44, ROWS = 38;
  const g = new TileGrid(COLS, ROWS, T, -44, -38);
  const F_PLAZA = 0, F_SITE = 1, F_SPAWN = 2, F_LANE = 3;

  g.carve(1, 1, 13, 12, F_SITE); // A site
  g.carve(17, 1, 26, 5, F_SPAWN); // defender spawn
  g.carve(30, 1, 42, 11, F_SITE); // B site
  g.carve(14, 2, 16, 4, F_LANE); // CT → A
  g.carve(27, 2, 29, 4, F_LANE); // CT → B
  g.carve(19, 6, 24, 12, F_LANE); // mid top
  g.carve(15, 13, 28, 24, F_PLAZA); // mid courtyard
  g.carve(19, 25, 24, 31, F_LANE); // mid bottom
  g.carve(17, 32, 26, 36, F_SPAWN); // attacker spawn
  g.carve(1, 13, 6, 31, F_LANE); // A long
  g.carve(1, 32, 16, 36, F_LANE); // A lobby
  g.carve(8, 15, 14, 17, F_LANE); g.carve(8, 13, 10, 14, F_LANE); // A link
  g.carve(27, 32, 42, 36, F_LANE); // B lobby
  g.carve(37, 12, 42, 31, F_LANE); // B main
  g.carve(29, 16, 35, 18, F_LANE); g.carve(32, 12, 35, 15, F_LANE); // B link

  // ground collider
  b.box(-46, -1, -40, 46, 0, 40, 0xbfae94, { ao: false, visual: false });
  // floor tiles (checker paving per region)
  const FC = [[0xd2c2a6, 0xc6b598], [0xbfa98a, 0xb39d7f], [0x9f9382, 0x958978], [0xcbb79a, 0xc0ac8f]];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const f = g.floor[r * COLS + c];
    if (f < 0) continue;
    b.quad(g.x(c) + 0.03, g.z(r) + 0.03, g.x(c + 1) - 0.03, g.z(r + 1) - 0.03, 0.004, FC[f][(r + c) & 1], 0.05);
  }
  b.quad(-46, -40, 46, 40, -0.002, 0x7d705f, 0);

  // walls: greedy merged rectangles, warm plaster palette, terracotta cap
  const PLASTER = [0xe4c9a2, 0xdab48b, 0xe9d4b2, 0xd39f78, 0xdcc0a0, 0xc98f6a];
  const H = 7;
  for (const rc of g.rects(1)) {
    const x0 = g.x(rc.c), z0 = g.z(rc.r), x1 = g.x(rc.c + rc.w), z1 = g.z(rc.r + rc.h);
    const col = PLASTER[Math.floor(b.rand() * PLASTER.length)];
    const h = H + Math.floor(b.rand() * 3) * 0.8;
    b.box(x0, 0, z0, x1, h, z1, col);
    b.box(x0 - 0.12, h, z0 - 0.12, x1 + 0.12, h + 0.35, z1 + 0.12, 0xa4553a, { collide: false, ao: false });
  }

  // stone archways: lintels + flanking pilasters over corridor mouths
  const STONE = 0xcdbfa8;
  const arch = (x0, z0, x1, z1) => {
    b.box(x0, 3.6, z0, x1, H, z1, STONE);
    b.box(x0, 3.3, z0 - 0.05, x1, 3.6, z1 + 0.05, 0xb5a68e, { collide: true });
  };
  arch(g.x(19), g.z(25) - 0.5, g.x(25), g.z(25) + 0.5); // mid bottom → courtyard
  arch(g.x(19), g.z(13) - 0.5, g.x(25), g.z(13) + 0.5); // mid top → courtyard
  arch(g.x(15) - 0.5, g.z(15), g.x(15) + 0.5, g.z(18)); // courtyard → A link
  arch(g.x(29) - 0.5, g.z(16), g.x(29) + 0.5, g.z(19)); // courtyard → B link
  arch(g.x(1), g.z(13) - 0.5, g.x(7), g.z(13) + 0.5); // A long → A site
  arch(g.x(37), g.z(12) - 0.5, g.x(43), g.z(12) + 0.5); // B main → B site
  arch(g.x(14) - 0.5, g.z(2), g.x(14) + 0.5, g.z(5)); // CT → A
  arch(g.x(30) - 0.5, g.z(2), g.x(30) + 0.5, g.z(5)); // CT → B

  // ---- MID COURTYARD ----
  // playable elevation box with two steps
  b.box(-2.5, 0, -2.5, 2.5, 1.3, 2.5, STONE);
  b.box(-2.5, 0, 2.5, 2.5, 0.86, 3.4, 0xc2b39b);
  b.box(-2.5, 0, 3.4, 2.5, 0.43, 4.3, 0xb8a990);
  // fountain planters / cover
  b.box(-12.5, 0, -6, -10.5, 1.1, -2, 0xb98b66); b.box(10.5, 0, 2, 12.5, 1.1, 6, 0xb98b66);
  b.box(-9, 0, 7, -5, 1.15, 8.2, STONE); b.box(5, 0, -8.2, 9, 1.15, -7, STONE);
  // courtyard columns
  for (const [x, z] of [[-10, -9], [10, -9], [-10, 9], [10, 9]]) {
    b.box(x - 0.55, 0, z - 0.55, x + 0.55, 5.2, z + 0.55, 0xe6dccb);
    b.box(x - 0.75, 5.2, z - 0.75, x + 0.75, 5.6, z + 0.75, 0xb5a68e);
  }

  // ---- A SITE (x -42..-16, z -36..-12): destructible / penetrable wood crates ----
  b.crate(-31, -25, 1.5, 1.3); b.crate(-29.4, -25, 1.5, 1.3); b.crate(-30.2, -26.6, 1.5, 1.3);
  b.crate(-23, -30, 1.6, 1.6); b.crate(-36, -18, 1.5, 1.3); b.crate(-19.5, -20, 1.4, 1.2);
  b.crate(-38.5, -31, 1.5, 2.2, 0, 200); b.crate(-26, -16, 1.4, 1.3);
  b.box(-34, 0, -34, -30, 1.1, -33.2, STONE); // half wall at back of site
  b.quad(-34, -30, -26, -22, 0.008, 0xb7704f, 0.02);
  b.label('A', -30, 0.02, -21.2, 2.0, 0, { flat: true, fg: '#ff4655' });
  b.label('A SITE', -41.9, 3.0, -24, 1.0, Math.PI / 2, { fg: '#0f1923', bg: '#ece8e1' });

  // ---- B SITE (x 16..42, z -36..-14): clean corners, balanced angles ----
  b.box(27, 0, -29, 31, 2.6, -25, STONE); // center block
  b.box(36, 0, -34, 42, 2.2, -32.5, 0xc9b294); // back ledge
  b.box(18, 0, -22, 19.2, 2.2, -16, 0xc9b294); // left pillar wall
  b.box(36.5, 0, -22, 38, 1.15, -18.5, STONE); // low cover near B main
  b.crate(22, -32, 1.5, 1.4); b.crate(33.5, -20, 1.4, 1.3);
  b.quad(25, -33, 34, -24, 0.008, 0xb7704f, 0.02);
  b.label('B', 32.5, 0.02, -22.5, 2.0, 0, { flat: true, fg: '#ff4655' });
  b.label('B SITE', 41.9, 3.0, -24, 1.0, -Math.PI / 2, { fg: '#0f1923', bg: '#ece8e1' });

  // lanes cover
  b.box(-41, 0, 2, -38, 1.2, 3.2, STONE); // A long
  b.box(-38.5, 0, 26, -36.5, 2.4, 28, 0xc98f6a); // A lobby box
  b.box(38, 0, 6, 41, 1.2, 7.2, STONE); // B main
  b.crate(36.5, 27, 1.6, 1.6); b.crate(-16, 31.5, 1.5, 1.3);
  b.label('MID', 0, 0.02, 9.5, 1.6, 0, { flat: true, fg: '#ece8e1' });
  b.label('ATTACKERS', 0, 0.02, 31, 1.3, 0, { flat: true, fg: '#ff4655' });
  b.label('DEFENDERS', 0, 0.02, -31, 1.3, Math.PI, { flat: true, fg: '#4fb3ff' });

  const built = b.build(scene);
  const sp = (x0, x1, z0, z1, yaw) => { const a = []; for (let x = x0; x <= x1; x += 3) for (let z = z0; z <= z1; z += 3) a.push({ x, y: 0, z, yaw }); return a; };
  const ffa = [
    { x: -38, y: 0, z: 30, yaw: 0 }, { x: 38, y: 0, z: 30, yaw: 0 }, { x: 0, y: 0, z: 30, yaw: 0 },
    { x: 0, y: 0, z: -30, yaw: Math.PI }, { x: -38, y: 0, z: -20, yaw: Math.PI / 2 }, { x: 38, y: 0, z: -25, yaw: -Math.PI / 2 },
    { x: -40, y: 0, z: 8, yaw: 0 }, { x: 40, y: 0, z: 0, yaw: 0 }, { x: -8, y: 0, z: -10, yaw: Math.PI }, { x: 8, y: 0, z: 10, yaw: 0 },
    { x: -22, y: 0, z: -4, yaw: -Math.PI / 2 }, { x: 22, y: 0, z: -4, yaw: Math.PI / 2 },
  ];
  return {
    id: 'piazza', ...built,
    sky: 0xf2c9a0, fog: [0xf0caa5, 55, 140],
    hemi: [0xfff0dc, 0x8a6a50, 0.9], sun: [0xffe2b8, 1.3, [0.5, 0.9, 0.35]],
    spawns: { 0: sp(-8, 8, 28, 34, 0), 1: sp(-8, 8, -34, -28, Math.PI), ffa },
    waypoints: 'auto',
  };
}
