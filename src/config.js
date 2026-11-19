// Global tuning. Distances in meters, times in seconds.
export const PEER_PREFIX = 'mgbk1-'; // namespace on the public PeerJS broker
export const NET_HZ = 20; // state sync rate
export const INTERP_DELAY = 0.11; // remote entities render this far in the past

export const MOVE = {
  run: 6.4,
  accel: 62,
  airAccel: 16,
  friction: 11,
  gravity: 24,
  jump: 8.4,
  radius: 0.38,
  height: 1.8,
  stepUp: 0.5,
  dashSpeed: 21,
  dashTime: 0.17,
  dashCharges: 2,
  dashRecharge: 3.4,
  rollSpeed: 9.4,
  rollTime: 0.55, // landing roll at its natural pace; the back half can be cancelled by jump/dash
  waterSlow: 0.7,
};

export const MAX_HP = 150;
export const REGEN_DELAY = 5;
export const REGEN_RATE = 14;
export const ULT_COST = 100;

export const MODES = {
  // quickplay: drop in / drop out, no score, no kill limit, no clock: just fight
  ffa: { id: 'ffa', label: 'FREE-FOR-ALL', size: 8, minPlayers: 1, killsToWin: 0, timeLimit: 0, respawn: 3, quickplay: true },
  // 1v1, 3 lives each, scoreboard: lose your last life and you lose the duel
  duel: { id: 'duel', label: 'DUEL', size: 2, minPlayers: 2, killsToWin: 3, lives: 3, timeLimit: 360, respawn: 3 },
  custom: { id: 'custom', label: 'CUSTOM', size: 8, minPlayers: 1, killsToWin: 20, timeLimit: 600, respawn: 3 },
  practice: { id: 'practice', label: 'PRACTICE', size: 1, minPlayers: 1, killsToWin: 0, timeLimit: 0, respawn: 2 },
};

// matchmaking: start as soon as the lobby is full, or after this long with >= minPlayers
export const QUEUE_START_SECONDS = 20;

export const MAPS = [{ id: 'sunvale', name: 'SUNVALE', sub: 'Meadow Ruins' }];
