// Global tuning constants. Distances are meters; "UPS" = Source units/sec (1u = 0.0254m).
export const UNIT = 0.0254;
export const toUPS = (ms) => ms / UNIT;

export const TICK = 1 / 60; // fixed physics step
export const NET_HZ = 30; // state sync rate (both directions)
export const INTERP_DELAY = 0.1; // seconds remote entities render in the past

export const PHYS = {
  gravity: 800 * UNIT,
  jumpSpeed: 301.993 * UNIT,
  friction: 5.2,
  stopSpeed: 80 * UNIT,
  accelerate: 5.5,
  airAccelerate: 40,
  airCap: 30 * UNIT,
  maxVelocity: 1600 * UNIT,
  runSpeed: 250 * UNIT,
  walkMul: 0.52,
  crouchMul: 0.34,
  stepHeight: 0.45,
  radius: 0.34,
  heightStand: 1.8,
  heightCrouch: 1.2,
  eyeStand: 1.62,
  eyeCrouch: 1.06,
};

// "Bhop Speed Boost" custom-game toggle
export const PHYS_BOOST = { airAccelerate: 150, airCap: 42 * UNIT };

export const MAX_HP = 100;

export const MODES = {
  duel: { id: 'duel', label: '1v1 DUEL', size: 2, teams: true, perTeam: 1, roundsToWin: 5, roundTime: 90 },
  wingman: { id: 'wingman', label: '2v2 WINGMAN', size: 4, teams: true, perTeam: 2, roundsToWin: 5, roundTime: 100 },
  ffa: { id: 'ffa', label: 'FREE-FOR-ALL', size: 6, teams: false, killsToWin: 20, timeLimit: 300, respawn: 2.5 },
  range: { id: 'range', label: 'THE RANGE', size: 8, teams: false, practice: true },
};

export const MAPS = [
  { id: 'range', name: 'THE RANGE', sub: 'Practice Facility', color: '#c9c2b4' },
  { id: 'piazza', name: 'PIAZZA', sub: 'Tactical 2-Site', color: '#d9a46b' },
  { id: 'atrium', name: 'ATRIUM', sub: 'Open Movement / Sniper', color: '#7fd1c7' },
];

export const QUEUE_FILL_SECONDS = 15;
export const PEER_PREFIX = 'rftl7-'; // namespace on the public PeerJS broker
