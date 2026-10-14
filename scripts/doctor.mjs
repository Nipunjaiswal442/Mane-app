import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const color = process.stdout.isTTY;
let failures = 0;
function row(label, ok, detail) {
  if (!ok) failures++;
  const badge = ok ? 'PASS' : 'FAIL';
  console.log(`${color ? `\x1b[${ok ? 32 : 31}m${badge}\x1b[0m` : badge}  ${label.padEnd(23)} ${detail}`);
}
function command(command, args = ['--version']) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10000 });
  return {
    ok: result.status === 0,
    text: (result.stdout || result.stderr || result.error?.message || 'not available').trim().split('\n')[0],
  };
}
function cli(name, args) {
  const r = command(name, args);
  row(name, r.ok, r.text);
  return r;
}
console.log('Mane development preflight (read-only; nothing is installed or downloaded)\n');
if (process.platform === 'darwin') {
  cli('brew');
  const version = command('sw_vers', ['-productVersion']);
  row('macOS 15+', version.ok && parseInt(version.text) >= 15, version.text);
} else row('Homebrew / macOS', true, 'Mac developer prerequisite; not required on Linux CI/appliances');
const nodeMajor = Number(process.versions.node.split('.')[0]);
row(
  'Node.js',
  nodeMajor >= 22,
  `${process.versions.node}; target 22 LTS${nodeMajor !== 22 ? ' (version differs from target)' : ''}`,
);
const pnpm = command('pnpm');
row(
  'pnpm',
  pnpm.ok && parseInt(pnpm.text) >= 9,
  `${pnpm.text}; target 9${parseInt(pnpm.text) !== 9 ? ' (version differs from target)' : ''}`,
);
const python = command('python3.12');
row('Python 3.12', python.ok && /^Python 3\.12\./.test(python.text), python.text);
cli('uv');
cli('ffmpeg', ['-version']);
cli('docker');
const compose = command('docker', ['compose', 'version']);
row('Docker Compose', compose.ok, compose.text);
const daemon = command('docker', ['info', '--format', '{{.ServerVersion}}']);
row(
  'Docker engine',
  daemon.ok,
  daemon.ok ? daemon.text : 'Start OrbStack (preferred) or Docker Desktop, and allow socket access',
);
const postgres = command('docker', ['image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}']);
row(
  'Postgres 16 image',
  postgres.ok,
  postgres.ok ? 'cached: offline startup ready' : 'Prepare once: docker pull postgres:16-alpine',
);
cli('ollama');
const llmModel = process.env.LLM_MODEL || 'qwen2.5:3b-instruct';
const ollamaUrl = process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
try {
  const url = new URL(ollamaUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('Ollama must use loopback in development');
  const response = await fetch(new URL('/api/tags', url), {
    signal: AbortSignal.timeout(4000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  row('Ollama service', true, ollamaUrl);
  row(
    'Local LLM model',
    data.models?.some((m) => m.name === llmModel || m.model === llmModel),
    `${llmModel}; prepare once with: ollama pull ${llmModel}`,
  );
} catch (error) {
  row('Ollama service', false, error.message);
  row('Local LLM model', false, 'Cannot verify until Ollama is running');
}
const sttPath = process.env.STT_MODEL_PATH || process.env.STT_MODEL;
const cacheRoot = path.join(
  process.env.HF_HOME || path.join(homedir(), '.cache/huggingface'),
  'hub',
  'models--mlx-community--whisper-large-v3-turbo',
  'snapshots',
);
const candidates =
  sttPath && existsSync(sttPath)
    ? [sttPath]
    : existsSync(cacheRoot)
      ? readdirSync(cacheRoot).map((p) => path.join(cacheRoot, p))
      : [];
const localStt = candidates.find(
  (p) =>
    existsSync(path.join(p, 'config.json')) &&
    ['weights.safetensors', 'model.safetensors', 'weights.npz'].some((f) => existsSync(path.join(p, f))),
);
row(
  'Local speech weights',
  !!localStt && !!sttPath,
  localStt
    ? `${localStt}${!sttPath ? '; set STT_MODEL_PATH to this directory in .env' : ''}`
    : 'Cache mlx-community/whisper-large-v3-turbo once; see docs/models.md (runtime cannot download)',
);
row(
  'Workspace dependencies',
  existsSync(path.join(root, 'node_modules')),
  'pnpm install --frozen-lockfile during preparation',
);
const workerPython = path.join(root, 'services/doc-worker/.venv/bin/python');
const worker = command(workerPython, [
  '-c',
  'import fastapi, psycopg, docx; print("worker environment ready")',
]);
row(
  'Worker dependencies',
  worker.ok,
  worker.ok
    ? worker.text
    : 'uv sync --project services/doc-worker --extra mlx --extra test during preparation',
);
if (process.platform === 'darwin') {
  const mlx = command(workerPython, ['-c', 'import mlx_whisper; print("MLX speech adapter ready")']);
  row('MLX speech dependency', mlx.ok, mlx.ok ? mlx.text : 'Prepare the mlx extra with make setup');
}
row(
  'Worker shared secret',
  (process.env.WORKER_TOKEN || '').length >= 32,
  'WORKER_TOKEN must contain at least 32 characters in .env',
);
console.log(
  `\n${failures ? `${failures} check(s) require attention. Full-stack acceptance is blocked until these pass.` : 'All checks passed. Run make dev.'}`,
);
process.exitCode = failures ? 1 : 0;
