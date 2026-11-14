import { MapBuilder } from './mapBuilder.js';

// THE RANGE — sunlit brutalist concrete + wood practice facility.
// Player area z∈[9,23]; shooting lane runs north (-z). Counter front edge at z=8.
export function buildRange(scene) {
  const b = new MapBuilder(11);
  const CONC = 0xbdb8ae, CONC2 = 0xa8a296, CONCD = 0x8f897e, WOOD = 0x9a6a3e, WOODL = 0xc99a68, LINE = 0xece8e1, RED = 0xff4655;

  // ground + slab pattern
  b.box(-38, -1, -52, 38, 0, 26, CONC2, { ao: false, jitter: 0 });
  for (let x = -36; x < 36; x += 6) for (let z = -50; z < 24; z += 6) {
    const alt = ((x / 6 + z / 6) & 1) === 0;
    b.quad(x + 0.04, z + 0.04, x + 5.96, z + 5.96, 0.005, alt ? CONC : 0xb3ada2, 0.03);
  }
  // outer walls (concrete) with wood paneling bands
  const H = 7;
  b.box(-38, 0, -52, 38, H, -50, CONC); b.box(-38, 0, 24, 38, H, 26, CONC);
  b.box(-38, 0, -50, -36, H, 24, CONC); b.box(36, 0, -50, 38, H, 24, CONC);
  b.box(-36, 0.6, -50.0, 36, 2.6, -49.85, WOOD, { collide: false });
  b.box(-36, 0.6, 23.85, 36, 2.6, 24, WOOD, { collide: false });
  // brutalist buttresses along the back wall
  for (let x = -32; x <= 32; x += 8) b.box(x - 0.6, 0, -50, x + 0.6, H + 0.6, -48.8, CONCD);
  for (let z = -42; z <= 16; z += 8) { b.box(-36, 0, z - 0.6, -34.8, H + 0.6, z + 0.6, CONCD); b.box(34.8, 0, z - 0.6, 36, H + 0.6, z + 0.6, CONCD); }

  // lane dividers
  b.box(-16, 0, -50, -15, 3.2, 4, CONC); b.box(15, 0, -50, 16, 3.2, 4, CONC);
  b.box(-16.05, 3.2, -50, -14.95, 3.4, 4, WOODL, { collide: true });
  b.box(14.95, 3.2, -50, 16.05, 3.4, 4, WOODL, { collide: true });

  // backstop wall (wood panels) at 56m
  b.box(-15, 0, -49.8, 15, 6, -49.2, WOOD);
  for (let x = -14; x < 15; x += 2) b.box(x - 0.05, 0, -49.25, x + 0.05, 6, -49.1, 0x6e4a2a, { collide: false });

  // shooting counter (concrete base, wood top). Counter front edge = z 8
  b.box(-12, 0, 8, 12, 1.0, 9, CONCD);
  b.box(-12.1, 1.0, 7.9, 12.1, 1.08, 9.1, WOODL);
  // booth uprights
  for (let x = -12; x <= 12; x += 4) b.box(x - 0.08, 1.08, 8.85, x + 0.08, 2.9, 9.05, WOOD, { collide: false });
  b.box(-12.1, 2.9, 8.8, 12.1, 3.05, 9.1, WOOD, { collide: false });
  // console panel (behind the buttons) on the left of the counter
  b.box(-11.6, 1.08, 8.3, -5.4, 1.52, 8.45, 0x2a2f36);
  b.label('TRAINING CONSOLE', -8.5, 1.68, 8.46, 0.2, 0, { fg: '#ece8e1' });
  // Interactive console buttons (shoot them or press E). Centers on the panel face.
  const buttons = [
    { id: 'static', label: 'STATIC', x: -10.7, y: 1.3, z: 8.5 },
    { id: 'strafe', label: 'STRAFE', x: -9.15, y: 1.3, z: 8.5 },
    { id: 'speed', label: '50-BOT', x: -7.6, y: 1.3, z: 8.5 },
    { id: 'start', label: 'START', x: -6.05, y: 1.3, z: 8.5 },
  ];
  for (const bt of buttons) b.label(bt.label, bt.x, bt.y, bt.z + 0.095, 0.15, 0, { fg: '#ffffff' });

  // distance markers (counter line z=8)
  const marks = [[10, -2], [20, -12], [30, -22], [50, -42]];
  for (const [m, z] of marks) {
    b.quad(-14.9, z - 0.12, 14.9, z + 0.12, 0.012, LINE, 0);
    b.label(`${m}m`, 0, 0.02, z + 1.0, 1.3, 0, { flat: true, fg: '#ece8e1' });
    b.label(`${m}m`, -14.93, 2.3, z, 0.9, Math.PI / 2, { fg: '#0f1923', bg: '#ece8e1' });
    b.label(`${m}m`, 14.93, 2.3, z, 0.9, -Math.PI / 2, { fg: '#0f1923', bg: '#ece8e1' });
  }
  // elevated target pads at 30m
  b.box(-9, 0, -24, -5, 1.0, -20, CONCD); b.box(5, 0, -24, 9, 1.0, -20, CONCD);
  b.label('THE RANGE', 0, 5.2, -49.15, 1.6, 0, { fg: '#ff4655' });

  // ---- EAST WING: recoil spray wall ----
  b.box(18, 0, -14.6, 34, 5.2, -14, 0xeeebe4, { jitter: 0 });
  for (let x = 18.5; x < 34; x += 1) b.box(x - 0.01, 0.2, -13.99, x + 0.01, 5.0, -13.98, 0x9a958c, { collide: false, jitter: 0 });
  for (let y = 0.5; y < 5.2; y += 0.5) b.box(18.2, y - 0.01, -13.99, 33.8, y + 0.01, -13.98, 0x9a958c, { collide: false, jitter: 0 });
  b.box(25.9, 1.45, -13.985, 26.1, 1.65, -13.975, RED, { collide: false, jitter: 0 });
  b.label('RECOIL SPRAY WALL', 26, 5.7, -14.0, 0.6, 0, { fg: '#0f1923', bg: '#ece8e1' });
  b.quad(18, -4.15, 34, -3.85, 0.012, LINE, 0);
  b.label('10m', 26, 0.02, -2.9, 1.0, 0, { flat: true });

  // ---- WEST WING: movement course (ramps, gaps, steps) ----
  b.ramp(-33, -6, -28, 2, 'z', 2.4, 0, 0xb0a99c);
  b.box(-33, 0, -14, -28, 2.4, -6, CONCD);
  b.box(-33, 0, -24, -28, 2.4, -17.5, CONCD); // 3.5m gap jump
  b.box(-33, 0, -40, -28, 3.0, -30, CONCD); // higher pad (step from 2.4 with jump)
  b.ramp(-33, -30, -28, -24, 'z', 3.0, 2.4, 0xb0a99c, 0);
  b.box(-33.05, 2.4, -6.1, -27.95, 2.45, -5.9, RED, { collide: false, jitter: 0 });
  for (let i = 0; i < 4; i++) b.box(-25, 0, -10 - i * 2.5, -21, 0.42 * (i + 1), -8 - i * 2.5, i % 2 ? CONC : CONCD);
  b.ramp(-25, -26, -19, -20, 'x', 0, 1.6, 0xb0a99c);
  b.box(-19, 0, -26, -17, 1.6, -20, CONCD);
  b.label('MOVEMENT', -26, 0.02, 4, 1.4, 0, { flat: true, fg: '#ff4655' });
  b.label('BHOP LANE', -26, 0.02, -44, 1.2, 0, { flat: true });

  // player spawn pad
  b.quad(-6, 13, 6, 19, 0.01, 0x2a3440, 0);
  b.label('SPAWN', 0, 0.02, 16, 1.0, 0, { flat: true, fg: '#ff4655' });

  const built = b.build(scene);

  // Target spots: distance bands (z) and lateral spread
  const targetSpots = [];
  for (const z of [-2, -12, -22, -42]) for (let x = -11; x <= 11; x += 2.75) targetSpots.push({ x, y: 0, z: z - 1.5 });
  targetSpots.push({ x: -7, y: 1.0, z: -22 }, { x: 7, y: 1.0, z: -22 });

  const ffa = [];
  for (let x = -5; x <= 5; x += 2.5) ffa.push({ x, y: 0, z: 16, yaw: 0 });
  return {
    id: 'range', ...built,
    sky: 0xbfdcf2, fog: [0xbfdcf2, 60, 160],
    hemi: [0xeaf3ff, 0x8b8070, 0.95], sun: [0xfff1d6, 1.35, [-0.4, 1, 0.55]],
    spawns: { 0: ffa, 1: ffa, ffa },
    buttons, targetSpots,
    waypoints: null,
  };
}
