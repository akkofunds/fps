// Magebreak admin service (runs on the server only — none of this ships to the browser).
//
//   POST /api/admin  { action, ... }
//     login   { password, pet }           → { session, exp }       (password + dog's name)
//     check   { token }                   → { admin }              (public: is this player token an admin?)
//     list    { session }                 → { admins: [...] }
//     add     { session, token, name? }   → { ok }
//     remove  { session, token }          → { ok }
//
// Players' tokens are long random strings shown in their Settings ("magebreak-…"). Admin rights
// belong to a token, so an admin can grant/revoke them from any device.
//
// Configuration (Vercel → Project → Settings → Environment Variables):
//   ADMIN_PASSWORD, ADMIN_PET   override the built-in password / dog's name
//   ADMIN_SECRET                signs admin sessions (falls back to the storage token)
//   KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + _TOKEN)
//                               the shared admin list (Vercel → Storage → Upstash Redis)
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const sha = (s) => createHash('sha256').update(String(s), 'utf8').digest();
const TOKEN_RE = /^magebreak-[a-z0-9]{40,64}$/;
const KEY = 'magebreak:admins';
const SESSION_DAYS = 60;

function creds() {
  const pw = process.env.ADMIN_PASSWORD, pet = process.env.ADMIN_PET;
  return {
    pw: pw ? sha(pw) : Buffer.from(BUILTIN.pw, 'hex'),
    pet: pet ? sha(pet.trim().toLowerCase()) : Buffer.from(BUILTIN.pet, 'hex'),
  };
}
// sha256 of the original admin code and the (lower-cased) dog's name
const BUILTIN = {
  pw: 'b66d887e3577aa7e8f5cf2f88677f683a857f7b545d8acee9185a1d266bf7347',
  pet: '1a5afeda973d776e31d1d7266f184468f84d99bed311d88d3dcb67015934f9f9',
};

function secret() {
  const s = process.env.ADMIN_SECRET || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (s) return s;
  const c = creds();
  return 'magebreak-local|' + c.pw.toString('hex') + c.pet.toString('hex');
}

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function signSession() {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const body = b64u(JSON.stringify({ exp, v: 1 }));
  const sig = b64u(createHmac('sha256', secret()).update(body).digest());
  return { session: body + '.' + sig, exp };
}
function verifySession(s) {
  if (typeof s !== 'string' || s.length > 400) return false;
  const [body, sig] = s.split('.');
  if (!body || !sig) return false;
  const want = b64u(createHmac('sha256', secret()).update(body).digest());
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return false;
  try { return JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).exp > Date.now(); } catch { return false; }
}

// ---------------------------------------------------------------- storage
function upstash() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  return async (cmd) => {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  };
}
// in-memory store with the same command surface (local dev / preview only)
export function memoryStore() {
  const h = new Map(), n = new Map();
  return async ([cmd, key, ...a]) => {
    if (!h.has(key)) h.set(key, new Map());
    const m = h.get(key);
    switch (cmd) {
      case 'HSET': m.set(a[0], a[1]); return 1;
      case 'HDEL': return m.delete(a[0]) ? 1 : 0;
      case 'HEXISTS': return m.has(a[0]) ? 1 : 0;
      case 'HGETALL': return [...m].flat();
      case 'INCR': n.set(key, (n.get(key) || 0) + 1); return n.get(key);
      case 'EXPIRE': setTimeout(() => n.delete(key), a[0] * 1000).unref?.(); return 1;
      default: throw new Error('unsupported ' + cmd);
    }
  };
}

const NO_STORE = { status: 503, body: { error: 'storage', message: 'The shared admin list needs storage: in Vercel open Storage → Create → Upstash Redis (free), connect it to this project, then redeploy.' } };

// ---------------------------------------------------------------- handler (framework-agnostic)
export async function adminAction(data, { store, ip = '?' } = {}) {
  const kv = store || upstash();
  const action = data && data.action;
  try {
    if (action === 'check') {
      const token = String(data.token || '');
      if (!TOKEN_RE.test(token) || !kv) return { status: 200, body: { admin: false, storage: !!kv } };
      return { status: 200, body: { admin: (await kv(['HEXISTS', KEY, token])) === 1 } };
    }
    if (action === 'login') {
      const failKey = 'magebreak:fail:' + ip;
      if (kv) {
        const n = await kv(['INCR', failKey]);
        if (n === 1) await kv(['EXPIRE', failKey, 900]);
        if (n > 12) return { status: 429, body: { error: 'locked', message: 'Too many attempts. Try again in 15 minutes.' } };
      }
      const c = creds();
      const pwOk = timingSafeEqual(sha(String(data.password || '')), c.pw);
      const petOk = timingSafeEqual(sha(String(data.pet || '').trim().toLowerCase()), c.pet);
      if (!pwOk || !petOk) { await new Promise((r) => setTimeout(r, 400)); return { status: 401, body: { error: 'denied', message: 'Incorrect password or answer.' } }; }
      return { status: 200, body: { ...signSession(), storage: !!kv } };
    }
    if (!verifySession(data && data.session)) return { status: 401, body: { error: 'session', message: 'Admin session expired. Sign in again.' } };
    if (!kv) return NO_STORE;
    if (action === 'list') {
      const flat = (await kv(['HGETALL', KEY])) || [];
      const admins = [];
      for (let i = 0; i + 1 < flat.length; i += 2) {
        let meta = {};
        try { meta = JSON.parse(flat[i + 1]); } catch { /* ignore */ }
        admins.push({ token: flat[i], name: meta.name || '', added: meta.added || 0 });
      }
      admins.sort((a, b) => a.added - b.added);
      return { status: 200, body: { admins } };
    }
    if (action === 'add') {
      const token = String(data.token || '').trim();
      if (!TOKEN_RE.test(token)) return { status: 400, body: { error: 'token', message: 'That is not a valid Magebreak token (it starts with "magebreak-").' } };
      const name = String(data.name || '').replace(/[^\w #.\-]/g, '').slice(0, 24);
      await kv(['HSET', KEY, token, JSON.stringify({ name, added: Date.now() })]);
      return { status: 200, body: { ok: true } };
    }
    if (action === 'remove') {
      await kv(['HDEL', KEY, String(data.token || '')]);
      return { status: 200, body: { ok: true } };
    }
    return { status: 400, body: { error: 'action' } };
  } catch (e) {
    return { status: 500, body: { error: 'server', message: String(e.message || e).slice(0, 200) } };
  }
}

// Connect-style middleware for the Vite dev / preview servers (in-memory admin list)
export function devMiddleware() {
  const store = memoryStore();
  return (req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e4) req.destroy(); });
    req.on('end', async () => {
      let data = {};
      try { data = JSON.parse(raw || '{}'); } catch { /* ignore */ }
      const out = await adminAction(data, { store, ip: req.socket.remoteAddress });
      res.statusCode = out.status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(out.body));
    });
  };
}
