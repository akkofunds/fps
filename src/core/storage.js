// localStorage-backed identity, settings and recent players. Every access is guarded.
const KEY_ID = 'magebreak.identity';
const KEY_SET = 'magebreak.settings';
const KEY_RECENT = 'magebreak.recent';

function read(key) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } }
function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }

export function randomTag() { return String(1000 + Math.floor(Math.random() * 9000)); }
export function sanitizeName(n) { return String(n || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 14); }

export function loadIdentity() {
  const id = read(KEY_ID);
  if (id && id.name && /^\d{4}$/.test(id.tag)) return id;
  return null;
}
export function saveIdentity(id) { write(KEY_ID, id); }

export const DEFAULT_SETTINGS = {
  sens: 1.0,
  fov: 80,
  volume: 0.7,
  quality: 'auto',
  shoulder: 1, // 1 = right shoulder, -1 = left
  crosshairColor: '#ffffff',
  invertY: false,
};
export function loadSettings() { return { ...DEFAULT_SETTINGS, ...(read(KEY_SET) || {}) }; }
export function saveSettings(s) { write(KEY_SET, s); }

export function parseTag(str) {
  const m = String(str || '').trim().match(/^([A-Za-z0-9_]{1,14})\s*#\s*(\d{4})$/);
  return m ? { name: m[1], tag: m[2] } : null;
}

export function loadRecent() { const r = read(KEY_RECENT); return Array.isArray(r) ? r : []; }
export function addRecent(list) {
  const r = loadRecent();
  for (const p of list) {
    const i = r.findIndex((x) => x.name === p.name && x.tag === p.tag);
    if (i >= 0) r.splice(i, 1);
    r.unshift({ name: p.name, tag: p.tag, t: Date.now() });
  }
  write(KEY_RECENT, r.slice(0, 20));
}
