const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { pool } = require('./db');
const { MAPS, fromRow, toRow, cleanText } = require('./mappers');
const { COOKIE, login, optionalAuth, requireAuth } = require('./auth');

const router = express.Router();
router.use(optionalAuth);

const newId = (p) => `${p}-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const limiter = (windowMin, max, msg) => rateLimit({ windowMs: windowMin * 60000, max, standardHeaders: true, legacyHeaders: false, message: { error: msg } });

// ───────── Auth ─────────
router.post('/auth/login', limiter(15, 10, 'Demasiados intentos. Intenta de nuevo en 15 minutos.'), wrap(async (req, res) => {
  const { email, password, remember } = req.body || {};
  const r = await login(email, password, !!remember);
  if (!r) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  res.cookie(COOKIE, r.token, r.opts).json({ user: r.user });
}));
router.post('/auth/logout', (_req, res) => res.clearCookie(COOKIE, { path: '/' }).json({ ok: true }));
router.get('/auth/me', (req, res) => req.user ? res.json({ user: { id: req.user.sub, email: req.user.email } }) : res.status(401).json({ error: 'No autenticado' }));

// ───────── Artículos ─────────
// Público: solo publicados. Con sesión: todos (incluye borradores y papelera).
router.get('/articles', wrap(async (req, res) => {
  const where = req.user ? '' : "WHERE status = 'published'";
  const { rows } = await pool.query(`SELECT * FROM articles ${where} ORDER BY created_at DESC`);
  res.json(rows.map((r) => fromRow('articles', r)));
}));

router.get('/articles/:id', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM articles WHERE id = $1', [req.params.id]);
  if (!rows[0] || (!req.user && rows[0].status !== 'published')) return res.status(404).json({ error: 'No encontrado' });
  res.json(fromRow('articles', rows[0]));
}));

// Contador de vistas (público, atómico)
router.post('/articles/:id/view', limiter(1, 30, 'Demasiadas solicitudes'), wrap(async (req, res) => {
  const { rows } = await pool.query("UPDATE articles SET views = views + 1 WHERE id = $1 AND status = 'published' RETURNING views", [req.params.id]);
  res.json({ views: rows[0] ? rows[0].views : null });
}));

async function upsert(entity, id, body, res) {
  const m = MAPS[entity];
  const { row, extra } = toRow(entity, body);
  delete row.id;
  const now = Date.now();
  if (!row.created_at) row.created_at = now;
  if (entity === 'articles') row.updated_at = now;
  const cols = Object.keys(row);
  const vals = cols.map((c) => row[c]);
  const ins = ['id', ...cols, 'extra'];
  const ph = ins.map((_, i) => `$${i + 1}`).join(',');
  // En conflicto no se pisa created_at
  const upd = [...cols.filter((c) => c !== 'created_at'), 'extra'].map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  const { rows } = await pool.query(
    `INSERT INTO ${m.table} (${ins.join(',')}) VALUES (${ph}) ON CONFLICT (id) DO UPDATE SET ${upd} RETURNING *`,
    [id, ...vals, JSON.stringify(extra)]);
  res.json(fromRow(entity, rows[0]));
}

router.put('/articles/:id', requireAuth, wrap((req, res) => upsert('articles', req.params.id, req.body, res)));
router.post('/articles', requireAuth, wrap((req, res) => upsert('articles', newId('art'), { ...req.body, views: 0 }, res)));

router.post('/articles/:id/restore', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE articles SET status = COALESCE(previous_status,'draft'), previous_status = NULL, trashed_at = NULL, updated_at = $2
     WHERE id = $1 AND status = 'trash' RETURNING *`, [req.params.id, Date.now()]);
  rows[0] ? res.json(fromRow('articles', rows[0])) : res.status(404).json({ error: 'No está en la papelera' });
}));

// DELETE suave (papelera) por defecto; ?permanent=1 elimina de verdad (y sus comentarios por CASCADE)
router.delete('/articles/:id', requireAuth, wrap(async (req, res) => {
  if (req.query.permanent === '1') {
    const r = await pool.query('DELETE FROM articles WHERE id = $1', [req.params.id]);
    return res.json({ ok: r.rowCount > 0 });
  }
  const r = await pool.query(
    `UPDATE articles SET previous_status = status, status = 'trash', trashed_at = $2, updated_at = $2
     WHERE id = $1 AND status <> 'trash'`, [req.params.id, Date.now()]);
  res.json({ ok: r.rowCount > 0 });
}));

// ───────── Comentarios ─────────
router.get('/articles/:id/comments', wrap(async (req, res) => {
  const all = req.user && req.query.all === '1';
  const { rows } = await pool.query(
    `SELECT * FROM comments WHERE article_id = $1 ${all ? '' : "AND status = 'approved'"} ORDER BY created_at DESC`, [req.params.id]);
  res.json(rows.map((r) => fromRow('comments', r)));
}));

// Público: siempre entra como "pending" y con campos de moderación forzados
router.post('/articles/:id/comments', limiter(10, 5, 'Has enviado muchos comentarios. Intenta más tarde.'), wrap(async (req, res) => {
  const b = req.body || {};
  const content = cleanText(b.content, 2000).trim();
  if (content.length < 2) return res.status(400).json({ error: 'El comentario está vacío' });
  const art = await pool.query("SELECT 1 FROM articles WHERE id = $1 AND status = 'published'", [req.params.id]);
  if (!art.rowCount) return res.status(404).json({ error: 'Artículo no encontrado' });
  const types = ['teacher', 'family', 'student', 'guest'];
  const authorType = types.includes(b.authorType) ? b.authorType : 'guest';
  const looksSpam = /https?:\/\/|hxxp|www\./i.test(content);
  const { rows } = await pool.query(
    `INSERT INTO comments (id, article_id, author_name, author_type, author_badge, school_info, content, status, is_spam_alert, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9) RETURNING *`,
    [newId('comm'), req.params.id, cleanText(b.authorName, 80) || 'Visitante', authorType,
     authorType === 'guest' ? 'Anónimo' : '', cleanText(b.schoolInfo, 120), content, looksSpam, Date.now()]);
  res.status(201).json(fromRow('comments', rows[0]));
}));

router.get('/comments', requireAuth, wrap(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM comments ORDER BY created_at DESC');
  res.json(rows.map((r) => fromRow('comments', r)));
}));

router.patch('/comments/:id', requireAuth, wrap(async (req, res) => {
  const { status, teacherReply } = req.body || {};
  if (status && !['pending', 'approved', 'rejected', 'spam'].includes(status)) return res.status(400).json({ error: 'Estado inválido' });
  const { rows } = await pool.query(
    `UPDATE comments SET status = COALESCE($2, status), teacher_reply = CASE WHEN $4 THEN $3 ELSE teacher_reply END
     WHERE id = $1 RETURNING *`,
    [req.params.id, status || null, teacherReply == null ? null : cleanText(teacherReply, 2000), teacherReply !== undefined]);
  rows[0] ? res.json(fromRow('comments', rows[0])) : res.status(404).json({ error: 'No encontrado' });
}));

router.delete('/comments/:id', requireAuth, wrap(async (req, res) => {
  const r = await pool.query('DELETE FROM comments WHERE id = $1', [req.params.id]);
  res.json({ ok: r.rowCount > 0 });
}));

// ───────── Biblioteca multimedia (admin) ─────────
router.get('/media', requireAuth, wrap(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM media ORDER BY created_at DESC');
  res.json(rows.map((r) => fromRow('media', r)));
}));
router.post('/media', requireAuth, wrap((req, res) => upsert('media', newId('media'), req.body, res)));
router.put('/media/:id', requireAuth, wrap((req, res) => upsert('media', req.params.id, req.body, res)));
router.delete('/media/:id', requireAuth, wrap(async (req, res) => {
  const r = await pool.query('DELETE FROM media WHERE id = $1', [req.params.id]);
  res.json({ ok: r.rowCount > 0 });
}));

// ───────── Perfil docente ─────────
const PROFILE_FIELDS = ['name', 'title', 'role', 'specialty', 'school', 'yearsExperience', 'bio', 'photoUrl'];
router.get('/profile', wrap(async (_req, res) => {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'teacherProfile'");
  res.json(rows[0] ? { key: 'teacherProfile', ...rows[0].value } : null);
}));
router.put('/profile', requireAuth, wrap(async (req, res) => {
  const cur = (await pool.query("SELECT value FROM settings WHERE key = 'teacherProfile'")).rows[0]?.value || {};
  const next = { ...cur };
  for (const f of PROFILE_FIELDS) {
    if (req.body && f in req.body) {
      next[f] = f === 'yearsExperience' ? Math.max(0, Math.trunc(+req.body[f]) || 0)
        : cleanText(req.body[f], f === 'photoUrl' ? 500000 : 600); // photoUrl admite data: URL
    }
  }
  next.updatedAt = Date.now();
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('teacherProfile', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`, [JSON.stringify(next), next.updatedAt]);
  res.json({ key: 'teacherProfile', ...next });
}));

router.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
module.exports = router;
