// localStorage-backed identity + settings. Every access is guarded (private mode / blocked storage).
const KEY_ID = 'riftline.identity';
const KEY_SET = 'riftline.settings';

function read(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } }
function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }

export function randomTag() { return String(1000 + Math.floor(Math.random() * 9000)); }

export function sanitizeName(n) {
  return String(n || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 14);
}

export function loadIdentity() {
  const id = read(KEY_ID);
  if (id && id.name && /^\d{4}$/.test(id.tag)) return id;
  return null;
}
export function saveIdentity(id) { write(KEY_ID, id); }

export const DEFAULT_SETTINGS = {
  sens: 1.0, // mouse sensitivity multiplier
  touchSens: 1.0,
  fov: 90, // horizontal-ish FOV (applied as vertical via conversion)
  speedometer: true,
  renderScale: 1.0,
  volume: 0.7,
  autoFire: false,
  adsToggle: false, // right-click ADS: hold (false) or toggle (true)
  crosshairColor: '#00ffaa',
};
export function loadSettings() { return { ...DEFAULT_SETTINGS, ...(read(KEY_SET) || {}) }; }
export function saveSettings(s) { write(KEY_SET, s); }

export function parseTag(str) {
  const m = String(str || '').trim().match(/^([A-Za-z0-9_]{1,14})\s*#\s*(\d{4})$/);
  return m ? { name: m[1], tag: m[2] } : null;
}
