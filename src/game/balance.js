// Match balance: defaults for public play, overridable from /admin for games YOU host
// (Custom and Practice). The host sends its balance inside the match config so every client
// in that lobby simulates the same numbers. Public FFA always uses the defaults.

export const DEFAULT_BALANCE = {
  hp: 150, // max health
  speed: 1, // movement speed multiplier
  gravity: 1, // gravity multiplier
  dmg: 1, // damage multiplier (all abilities)
  cd: 1, // cooldown multiplier (abilities + dash recharge)
  ult: 1, // ultimate charge rate multiplier
  respawn: 3, // seconds
  noCooldowns: false, // practice cheats
  infiniteUlt: false,
  godMode: false,
};

export const BAL = { ...DEFAULT_BALANCE };

// Admin perks for the unlocked admin client (set from main/admin panel). ult: ultimate always
// ready — no charge, no cooldown, no exhaustion — in every mode.
export const ADMIN = { ult: false };

const KEY = 'magebreak.balance';
export function loadBalance() {
  try { return { ...DEFAULT_BALANCE, ...(JSON.parse(localStorage.getItem(KEY) || '{}')) }; } catch { return { ...DEFAULT_BALANCE }; }
}
export function saveBalance(b) { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* ignore */ } }

const clamp = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d);
// apply (sanitized: values can come from another player's host)
export function applyBalance(b) {
  const s = b || DEFAULT_BALANCE;
  BAL.hp = clamp(s.hp, 25, 2000, 150);
  BAL.speed = clamp(s.speed, 0.4, 2.5, 1);
  BAL.gravity = clamp(s.gravity, 0.3, 2.5, 1);
  BAL.dmg = clamp(s.dmg, 0, 5, 1);
  BAL.cd = clamp(s.cd, 0.1, 5, 1);
  BAL.ult = clamp(s.ult, 0, 20, 1);
  BAL.respawn = clamp(s.respawn, 0.5, 15, 3);
  BAL.noCooldowns = !!s.noCooldowns;
  BAL.infiniteUlt = !!s.infiniteUlt;
  BAL.godMode = !!s.godMode;
}
