import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool, transaction } from './client.js';
export async function migrate() {
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(72619691)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const name = '001_initial';
    if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount) return;
    await client.query(await readFile(new URL('./001_initial.sql', import.meta.url), 'utf8'));
    await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await migrate();
    console.log('Database migrations applied.');
  } finally {
    await pool.end();
  }
}
