import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (existsSync('.env')) process.loadEnvFile('.env');
const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://mane:mane@127.0.0.1:5432/mane',
  DATA_DIR: path.resolve(process.env.DATA_DIR || 'data'),
  PYTHONPATH: path.join(root, 'services/doc-worker/src'),
  STORAGE_PATH: path.resolve(process.env.DATA_DIR || 'data'),
  ...(process.env.STT_MODEL_PATH ? { STT_MODEL_PATH: path.resolve(process.env.STT_MODEL_PATH) } : {}),
  ...(process.env.DIARIZATION_MODEL_PATH
    ? { DIARIZATION_MODEL_PATH: path.resolve(process.env.DIARIZATION_MODEL_PATH) }
    : {}),
  ...(process.env.LICENSE_PUBLIC_KEY_PATH
    ? { LICENSE_PUBLIC_KEY_PATH: path.resolve(process.env.LICENSE_PUBLIC_KEY_PATH) }
    : {}),
  STORAGE_BACKEND: process.env.STORAGE_BACKEND || 'local',
  API_URL: process.env.API_URL || 'http://127.0.0.1:4000',
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '/api',
  NEXT_TELEMETRY_DISABLED: '1',
  HF_HUB_OFFLINE: '1',
  TRANSFORMERS_OFFLINE: '1',
};
const children = new Set();
const preparation = new Set();
let stopping = false;
let postgresStarted = false;
function launch(name, bin, args, cwd = root) {
  const child = spawn(bin, args, { cwd, env, stdio: 'inherit', detached: true });
  children.add(child);
  child.once('error', (error) => {
    console.error(`${name}: ${error.message}`);
    shutdown(1);
  });
  child.once('exit', (code) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${name} exited (${code ?? 'signal'}); stopping stack.`);
      shutdown(code || 1);
    }
  });
  return child;
}
function run(bin, args) {
  return new Promise((resolve, reject) => {
    if (stopping) return reject(new Error('Startup cancelled'));
    const child = spawn(bin, args, { cwd: root, env, stdio: 'inherit', detached: true });
    preparation.add(child);
    child.once('error', (error) => {
      preparation.delete(child);
      reject(error);
    });
    child.once('exit', (code) => {
      preparation.delete(child);
      code === 0 && !stopping ? resolve() : reject(new Error(`${bin} exited with ${code}`));
    });
  });
}
async function healthy(url) {
  const deadline = Date.now() + 60000;
  while (!stopping && Date.now() < deadline) {
    try {
      // Retry on a fresh connection: macOS AirPlay can answer on port 5000
      // before the worker binds loopback, leaving a stale pooled connection.
      const r = await fetch(url, {
        signal: AbortSignal.timeout(2000),
        redirect: 'error',
        headers: { connection: 'close' },
      });
      const body = await r.text();
      if (r.ok && JSON.parse(body).status === 'ok') return;
    } catch {
      /* Service is still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(stopping ? 'Startup cancelled' : `Service did not become healthy: ${url}`);
}
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  const running = [...children, ...preparation];
  const exited = running.map((child) => new Promise((resolve) => child.once('exit', resolve)));
  for (const child of running)
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* Already stopped. */
    }
  const force = setTimeout(() => {
    for (const child of [...children, ...preparation])
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* Already stopped. */
      }
  }, 4000);
  force.unref();
  await Promise.all(exited);
  if (postgresStarted)
    await new Promise((resolve) => {
      const child = spawn('docker', ['compose', '-f', 'infra/compose.dev.yml', 'stop'], {
        cwd: root,
        env,
        stdio: 'inherit',
      });
      child.once('error', (error) => {
        console.error(error.message);
        resolve();
      });
      child.once('exit', resolve);
    });
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void shutdown(0);
  });
try {
  await run(process.execPath, ['scripts/doctor.mjs']);
  mkdirSync(env.DATA_DIR, { recursive: true });
  await run('pnpm', ['--filter', 'web', 'export:landing']);
  postgresStarted = true;
  await run('docker', ['compose', '-f', 'infra/compose.dev.yml', 'up', '-d', '--wait']);
  await run('pnpm', ['--filter', 'api', 'db:migrate']);
  launch('api', 'pnpm', ['--filter', 'api', 'dev']);
  launch('web', 'pnpm', ['--filter', 'web', 'dev']);
  launch(
    'worker',
    path.join(root, 'services/doc-worker/.venv/bin/python'),
    ['-m', 'uvicorn', 'mane_worker.app:app', '--host', '127.0.0.1', '--port', '5000'],
    path.join(root, 'services/doc-worker'),
  );
  await Promise.all(
    ['http://127.0.0.1:4000/health', 'http://127.0.0.1:3000/health', 'http://127.0.0.1:5000/health'].map(
      healthy,
    ),
  );
  console.log(
    '\nMane: http://localhost:3000 · API :4000 · worker :5000\nCtrl-C stops app services and Postgres; data volumes are preserved.',
  );
} catch (error) {
  if (!stopping) {
    console.error(error.message);
    await shutdown(1);
  }
}
