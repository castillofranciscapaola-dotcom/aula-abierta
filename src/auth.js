const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const COOKIE = 'aa_session';
const isProd = process.env.NODE_ENV === 'production';
const secret = () => process.env.JWT_SECRET;

function cookieOpts(remember) {
  return { httpOnly: true, secure: isProd, sameSite: 'strict', path: '/',
    maxAge: (remember ? 30 * 24 : 8) * 3600 * 1000 };
}

async function login(email, password, remember) {
  const { rows } = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [String(email || '').trim().toLowerCase()]);
  const u = rows[0];
  // compara siempre contra un hash para no revelar si el correo existe
  const hash = u ? u.password_hash : '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const ok = await bcrypt.compare(String(password || ''), hash);
  if (!u || !ok) return null;
  const token = jwt.sign({ sub: u.id, email: u.email }, secret(), { expiresIn: remember ? '30d' : '8h' });
  return { token, user: { id: u.id, email: u.email }, opts: cookieOpts(remember) };
}

function readUser(req) {
  const t = req.cookies && req.cookies[COOKIE];
  if (!t) return null;
  try { return jwt.verify(t, secret()); } catch { return null; }
}

// Adjunta req.user si hay sesión válida (no bloquea)
function optionalAuth(req, _res, next) { req.user = readUser(req); next(); }

function requireAuth(req, res, next) {
  req.user = req.user || readUser(req);
  if (!req.user) return res.status(401).json({ error: 'No autenticado' });
  next();
}

async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || '';
  if (!email || !pass) { console.warn('[auth] ADMIN_EMAIL/ADMIN_PASSWORD no definidos: no se creó usuario.'); return; }
  const { rows } = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (rows.length) return;
  if (pass.length < 10) throw new Error('ADMIN_PASSWORD debe tener al menos 10 caracteres');
  await pool.query('INSERT INTO users (email, password_hash, created_at) VALUES ($1,$2,$3)', [email, await bcrypt.hash(pass, 12), Date.now()]);
  console.log('[auth] Usuario administrador creado:', email);
}

module.exports = { COOKIE, login, optionalAuth, requireAuth, ensureAdmin };
