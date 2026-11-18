const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const { pool, migrate } = require('./src/db');
const { ensureAdmin } = require('./src/auth');
const { seedData } = require('./src/seed');
const routes = require('./src/routes');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET es obligatorio y debe tener al menos 32 caracteres.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // Render está detrás de un proxy
app.disable('x-powered-by');
// CSP desactivada: el frontend usa Tailwind CDN y scripts en línea (exportados de Stitch).
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '1mb' })); // el perfil admite foto en data: URL
app.use(cookieParser());

// Defensa CSRF adicional: las mutaciones deben ser JSON del mismo origen
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Origen no permitido' });
  }
  next();
});

app.get('/healthz', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});
app.use('/api', routes);
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));
app.use((_req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Contenido demasiado grande' });
  if (err.code === '22P02' || err.code === '23514' || err.code === '23503') return res.status(400).json({ error: 'Datos inválidos' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

(async () => {
  await migrate();
  await ensureAdmin();
  await seedData();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Aula Abierta escuchando en :${port}`));
})().catch((e) => { console.error('Fallo al iniciar:', e); process.exit(1); });
