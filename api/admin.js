// Vercel serverless function: the admin service (see server/adminCore.js)
import { adminAction } from '../server/adminCore.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  let data = req.body;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const out = await adminAction(data || {}, { ip });
  res.status(out.status).json(out.body);
}
