const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) {
  console.error('Falta la variable DATABASE_URL.');
  process.exit(1);
}

const useSsl = process.env.PGSSLMODE === 'disable' ? false
  : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: useSsl, max: 10 });
pool.on('error', (e) => console.error('[pg] error inesperado:', e.message));

async function migrate() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}

module.exports = { pool, migrate };
