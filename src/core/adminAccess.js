// Admin access — no server, no database.
//
// OWNER: signs in with the password + dog's name. Those unlock (decrypt) the owner's signing key,
//   which is embedded here encrypted (PBKDF2 310k → AES-GCM), so the password itself is never in
//   the code. The unlocked key is kept only for the current browser tab session (sign in again
//   after closing the tab).
// ADMINS: the owner keeps a list of player tokens (stored as SHA-256 hashes) and signs it. Every
//   game caches the newest correctly-signed list and passes it on to other players over PeerJS
//   (see adminDirectory.js). Nobody but the owner can make a list the games will accept.
//   A listed admin gets Meteora; only the owner gets the admin panel.
const OWNER = {"pub":{"kty":"EC","crv":"P-256","x":"gNS9Dm5NTMDX6H5Jw1WZO2CW1CoFuRct-RKmEnoPV0E","y":"4JL-nXY_GD_yoIK0pW2K9HRKit1N71Tf7VdaccrDoRE"},"salt":"+RAD01wUYp4yj6PnidYm1g==","iv":"Ojzc6/smtYObujuP","data":"BOjdEtP/5OihgavmbE26M/ARnBGz39B4XAcxJn9CH6l4eJ+G9vhC0TlzCqhtqr+n+0gjuAq5qvubygOSz1DKZnzDuV1x84Te4g1oRoubn8AK/NYHnLYwvj4nFLNq7pj2mVrdMDe7iAwwkgSHoY5g4rs9rKVb//lLApbhjJCXoYFIXmjA/OCUUVR8MR/WiUNfB//ZLczJrQnbhw=="};

// Admin lists signed before this moment are ignored everywhere: the list was reset (nobody is an
// admin until the owner adds people again). Bump to reset it again.
const LIST_EPOCH = 1795182819183;

const TOKEN_KEY = 'magebreak.token';
const LIST_KEY = 'magebreak.adminList';
const OWNER_KEY = 'magebreak.ownerKey';
const subtle = globalThis.crypto && globalThis.crypto.subtle;

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
// the owner's unlocked key lives only for this browser tab session: close the tab and you sign in again
const readS = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } };
const writeS = (k, v) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const write = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const ub64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

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
export const TOKEN_RE = /^magebreak-[a-z0-9]{40,64}$/;
export const maskToken = (t) => (t && t.length > 24 ? `${t.slice(0, 16)}…${t.slice(-6)}` : t || '');
export async function tokenHash(t) { return hex(await subtle.digest('SHA-256', new TextEncoder().encode('magebreak-admin|' + t))); }

// ---------------------------------------------------------------- state + change events
// this device's token hash (cached so the check works synchronously at startup)
let myHash = (() => { const c = read('magebreak.tokenHash'); try { return c && c.t === localStorage.getItem(TOKEN_KEY) ? c.h : null; } catch { return null; } })();
let list = read(LIST_KEY); // re-verified in initAdmin()
const listeners = new Set();
export function onAdminChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const changed = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.warn(e); } } };

// owner = this device holds the real owner key. A key in storage is only trusted once it has been
// checked against the owner's public key (initAdmin / ownerSignIn), so writing something into
// localStorage by hand does not make anyone the owner.
let ownerOk = false;
export const isOwner = () => ownerOk;
// Meteora access: the owner, or a token on the signed list
export function isAdmin() { return isOwner() || !!(myHash && list && Array.isArray(list.admins) && list.admins.some((a) => a.h === myHash)); }
export const adminList = () => (list ? list.admins.slice() : []);
export const currentList = () => list;
// owner-signed global settings carried with the list: characters opened to everyone, announcement
export const globalCfg = () => cleanCfg(list && list.cfg);
export const isPublicMage = (id) => globalCfg().open.includes(id);

// ---------------------------------------------------------------- signatures
const cleanCfg = (c) => ({ open: Array.isArray(c && c.open) ? c.open.filter((x) => /^[a-z]{2,20}$/.test(x)).slice(0, 12) : [], motd: String((c && c.motd) || '').slice(0, 200) });
const canon = (L) => JSON.stringify({ v: L.v, admins: L.admins.map((a) => [a.h, a.n || '', a.m || '', a.a || 0]), cfg: cleanCfg(L.cfg) });
let pubKey = null;
async function pub() { return pubKey || (pubKey = await subtle.importKey('jwk', OWNER.pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])); }
export async function verifyList(L) {
  try {
    if (!L || typeof L.v !== 'number' || L.v < LIST_EPOCH || !Array.isArray(L.admins) || typeof L.sig !== 'string' || L.admins.length > 500) return false;
    if (!L.admins.every((a) => a && /^[0-9a-f]{64}$/.test(a.h))) return false;
    return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await pub(), ub64(L.sig), new TextEncoder().encode(canon(L)));
  } catch { return false; }
}
// take a list from anywhere (cache, another player): only if correctly signed and newer
export async function adoptList(L) {
  if (!L || (list && L.v <= list.v)) return false;
  if (!(await verifyList(L))) return false;
  list = { v: L.v, admins: L.admins.map((a) => ({ h: a.h, n: String(a.n || '').slice(0, 24), m: String(a.m || '').slice(0, 30), a: +a.a || 0 })), cfg: cleanCfg(L.cfg), sig: L.sig };
  write(LIST_KEY, list);
  changed();
  return true;
}

// ---------------------------------------------------------------- owner
async function ownerKey() {
  const k = readS(OWNER_KEY);
  if (!k) return null;
  try { return await subtle.importKey('pkcs8', ub64(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); } catch { return null; }
}
// returns true when the password + dog's name unlock the owner key
export async function ownerSignIn(password, pet) {
  try {
    const base = await subtle.importKey('raw', new TextEncoder().encode(password + '\n' + String(pet).trim().toLowerCase()), 'PBKDF2', false, ['deriveKey']);
    const aes = await subtle.deriveKey({ name: 'PBKDF2', salt: ub64(OWNER.salt), iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pkcs8 = await subtle.decrypt({ name: 'AES-GCM', iv: ub64(OWNER.iv) }, aes, ub64(OWNER.data));
    writeS(OWNER_KEY, b64(pkcs8));
    ownerOk = await keyMatchesOwner();
    changed();
    return ownerOk;
  } catch { return false; }
}
export function ownerSignOut() { writeS(OWNER_KEY, null); ownerOk = false; changed(); }
// the stored key really is the owner's: it signs a challenge that the owner's public key accepts
async function keyMatchesOwner() {
  try {
    const key = await ownerKey();
    if (!key) return false;
    const msg = new TextEncoder().encode('magebreak-owner-check|' + Math.random());
    const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, msg);
    return await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await pub(), sig, msg);
  } catch { return false; }
}

async function publish(admins, cfg = globalCfg()) {
  const key = await ownerKey();
  if (!key) throw new Error('Owner is not signed in on this device.');
  const L = { v: Math.max(Date.now(), list ? list.v + 1 : 0, LIST_EPOCH), admins, cfg: cleanCfg(cfg) };
  L.sig = b64(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(canon(L))));
  await adoptList(L);
  return L;
}
export async function addAdmin(token, name = '') {
  token = String(token).trim();
  if (!TOKEN_RE.test(token)) throw new Error('That is not a Magebreak token (it starts with "magebreak-").');
  const h = await tokenHash(token);
  const rest = adminList().filter((a) => a.h !== h);
  return publish(rest.concat([{ h, n: String(name).replace(/[^\w #.\-]/g, '').slice(0, 24), m: maskToken(token), a: Date.now() }]));
}
export async function removeAdmin(h) { return publish(adminList().filter((a) => a.h !== h)); }
export async function removeAllAdmins() { return publish([]); }
export async function setGlobalCfg(patch) { return publish(adminList(), { ...globalCfg(), ...patch }); }

// ---------------------------------------------------------------- boot
export async function initAdmin() {
  if (!subtle) return;
  ownerOk = await keyMatchesOwner();
  if (!ownerOk && readS(OWNER_KEY)) writeS(OWNER_KEY, null); // not the real key: forget it
  write(OWNER_KEY, null); // sign-ins used to be remembered on the device for good: no longer
  const t = myToken();
  myHash = await tokenHash(t);
  write('magebreak.tokenHash', { t, h: myHash });
  const cached = read(LIST_KEY);
  list = null;
  if (cached && (await verifyList(cached))) list = cached; else write(LIST_KEY, null);
  changed();
}
