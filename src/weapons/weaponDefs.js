import { UNIT } from '../config.js';

// AK spray: cumulative [yaw°, pitch°] offset per shot. Shots 1-10 climb straight up,
// then the pattern drifts left, swings right and settles back left (deterministic).
const AK_PATTERN = [
  [0, 0], [0.0, 0.42], [0.04, 1.05], [-0.05, 1.85], [0.08, 2.75], [0.12, 3.6], [0.0, 4.4], [-0.15, 5.1], [-0.08, 5.7], [0.25, 6.1],
  [0.85, 6.35], [1.55, 6.45], [2.05, 6.55], [2.35, 6.5], [2.15, 6.65],
  [1.4, 6.75], [0.5, 6.85], [-0.55, 6.8], [-1.5, 6.88], [-2.3, 6.95], [-2.8, 7.0], [-2.95, 7.05],
  [-2.35, 7.1], [-1.35, 7.15], [-0.25, 7.15], [0.75, 7.2], [1.55, 7.25], [2.05, 7.25], [2.25, 7.3], [2.15, 7.35],
];

export const WEAPONS = [
  null,
  {
    id: 'ak', slot: 1, name: 'AK-47', short: 'AK', mag: 30, reserve: 90,
    interval: 0.1, auto: true, head: 160, body: 40, leg: 32,
    speed: 225 * UNIT, reload: 2.45, draw: 0.5, pen: 0.55,
    spreadBase: 0, spreadMove: 5.5, spreadAir: 9, spreadCrouch: 0.75,
    pattern: AK_PATTERN, punch: 0.5, kick: 0.07,
    adsTime: 0.2, adsZoom: 1.25, adsSpeed: 0.76, inspect: 2.6,
    price: 2700, desc: 'One-tap headshots. Iron-sight ADS tightens the spray. Pull down, then left-right.',
  },
  {
    id: 'glock', slot: 2, name: 'GLOCK-17', short: 'GLOCK', mag: 20, reserve: 120,
    interval: 0.13, auto: false, head: 56, body: 24, leg: 18,
    speed: 250 * UNIT, reload: 2.1, draw: 0.3, pen: 0.4,
    spreadBase: 0.3, spreadMove: 2.6, spreadAir: 5, spreadCrouch: 0.8,
    burst: { count: 3, gap: 0.055, cooldown: 0.42, spread: 0.9 },
    kickPitch: 0.75, punch: 0.6, kick: 0.04,
    adsTime: 0.15, adsZoom: 1.12, adsSpeed: 0.82, inspect: 2.2,
    price: 200, desc: 'Fastest movement. Red-dot ADS. Press X for a tight 3-round burst.',
  },
  {
    id: 'sniper', slot: 3, name: 'SNIPER', short: 'SNIPER', mag: 5, reserve: 20,
    interval: 1.45, auto: false, head: 150, body: 150, leg: 95,
    speed: 200 * UNIT, scopedSpeed: 110 * UNIT, reload: 3.3, draw: 0.75, pen: 0.85,
    spreadBase: 7.5, spreadScoped: 0, spreadMove: 4.5, spreadAir: 14, spreadCrouch: 0.9,
    zooms: [1.5, 3.0], kickPitch: 3.2, punch: 0.7, kick: 0.14,
    adsTime: 0.24, adsZoom: 1.5, adsSpeed: 0.55, inspect: 2.6,
    price: 4700, desc: 'Bolt-action one-shot. Right-click: scope 1.5x → 3.0x → hip.',
  },
];
