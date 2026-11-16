// Admin access on the client.
//
// Every player has a long random token (Settings → Account). Admins are a list of tokens kept by
// the server (/api/admin). A device is admin when its token is on that list (checked on load and
// cached, so it survives reloads and works offline for a while) or when the owner has signed in to
// the admin panel with the password + dog's name (that session is remembered for 60 days).
const TOKEN_KEY = 'magebreak.token';
const GRANT_KEY = 'magebreak.adminGrant';
const SESSION_KEY = 'magebreak.adminSession';
const API = (import.meta.env.BASE_URL || '/') + 'api/admin';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

export function myToken() {
  let t = null;
  try { t = localStorage.getItem(TOKEN_KEY); } catch { /* ignore */ }
  if (!t || !/^magebreak-[a-z0-9]{40,64}$/.test(t)) {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const r = new Uint8Array(48);
    crypto.getRandomValues(r);
    t = 'magebreak-' + Array.from(r, (b) => abc[b % 36]).join('');
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
  }
  return t;
}
export const maskToken = (t) => (t && t.length > 24 ? `${t.slice(0, 16)}…${t.slice(-6)}` : t || '');

export function adminSession() {
  const s = read(SESSION_KEY);
  return s && s.session && s.exp > Date.now() ? s.session : null;
}
export function saveSession(s) { write(SESSION_KEY, s ? { session: s.session, exp: s.exp } : null); }

// admin on this device: token granted (cached) or signed in to the admin panel
export function isAdmin() {
  const g = read(GRANT_KEY);
  return !!adminSession() || !!(g && g.ok && g.t === myToken());
}

export async function api(action, data = {}) {
  let r;
  try {
    r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }) });
  } catch {
    return { ok: false, status: 0, error: 'network', message: 'Could not reach the admin server.' };
  }
  let body = {};
  try { body = await r.json(); } catch { body = { error: 'bad', message: r.status === 404 ? 'The admin server is not deployed here.' : 'Unexpected server response.' }; }
  return { ok: r.ok, status: r.status, ...body };
}

// ask the server whether this device's token is an admin; keeps the cached answer on network errors
export async function refreshGrant() {
  const t = myToken();
  const res = await api('check', { token: t });
  if (res.ok) write(GRANT_KEY, { t, ok: !!res.admin, at: Date.now() });
  return isAdmin();
}
export function setLocalGrant(ok) { write(GRANT_KEY, { t: myToken(), ok, at: Date.now() }); }
