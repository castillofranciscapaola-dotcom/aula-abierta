const { pool } = require('./db');
const { toRow } = require('./mappers');
const seed = require('./seed.json');

async function insert(table, entity, item) {
  const { row, extra } = toRow(entity, item);
  row.id = item.id;
  const cols = [...Object.keys(row), 'extra'];
  await pool.query(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT (id) DO NOTHING`,
    [...Object.keys(row).map((c) => row[c]), JSON.stringify(extra)]);
}

async function seedData() {
  // Perfil: siempre se crea uno por defecto si no existe (editable desde perfil.html)
  const profile = seed.settings.find((s) => s.key === 'teacherProfile');
  const { key, ...value } = profile;
  await pool.query("INSERT INTO settings (key, value, updated_at) VALUES ('teacherProfile',$1,$2) ON CONFLICT (key) DO NOTHING", [JSON.stringify(value), Date.now()]);

  if (process.env.SEED_DEMO !== 'true') return;
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM articles');
  if (rows[0].n > 0) return;
  for (const a of seed.articles) await insert('articles', 'articles', a);
  for (const c of seed.comments) await insert('comments', 'comments', c);
  for (const m of seed.media) await insert('media', 'media', m);
  console.log('[seed] Datos de ejemplo cargados.');
}
module.exports = { seedData };
