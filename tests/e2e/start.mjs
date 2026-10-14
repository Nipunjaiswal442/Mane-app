import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Pool } = require('pg');
const base = process.env.DATABASE_URL || 'postgres://mane:mane@127.0.0.1:5432/mane';
const db = new Pool({ connectionString: base });
const schema = `mane_e2e_${process.pid}_${Date.now()}`;
await db.query(`CREATE SCHEMA "${schema}"`);
const url = new URL(base);
url.searchParams.set('options', `-c search_path=${schema}`);
const directory = await mkdtemp(path.join(tmpdir(), 'mane-e2e-'));
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  DATA_DIR: directory,
  STORAGE_PATH: directory,
  API_URL: 'http://127.0.0.1:4000',
  PORT: '4000',
  HOST: '127.0.0.1',
  CSRF_ORIGIN: 'http://localhost:3000',
  AUTH_PROVIDER: 'local',
  WORKER_TOKEN: 'isolated-e2e-fixture-worker-secret-32chars',
  NEXT_TELEMETRY_DISABLED: '1',
  MANE_E2E_FIXTURES: '1',
  NODE_ENV: 'test',
};
const children = [];
let stopping = false;
function launch(bin, args, cwd = process.cwd(), overrides = {}) {
  const child = spawn(bin, args, { cwd, env: { ...env, ...overrides }, stdio: 'inherit' });
  children.push(child);
  child.on('error', (e) => {
    console.error(e);
    void stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) void stop(code || 1);
  });
  return child;
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  await Promise.all(
    children.map((c) =>
      c.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => {
            c.once('exit', resolve);
            setTimeout(() => {
              c.kill('SIGKILL');
              resolve();
            }, 4000).unref();
          }),
    ),
  );
  await db.query(`DROP SCHEMA "${schema}" CASCADE`);
  await db.end();
  await rm(directory, { recursive: true, force: true });
  process.exit(code);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
launch(process.execPath, ['--import', 'tsx', 'src/index.ts'], path.resolve('apps/api'));
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch('http://127.0.0.1:4000/health')).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
  if (i === 79) throw new Error('API not ready');
}
launch(process.execPath, ['tests/e2e/fixture-worker.mjs']);
launch(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3000'],
  path.resolve('apps/web'),
  { NODE_ENV: 'production' },
);
