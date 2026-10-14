import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = await readFile(path.join(root, '.env.example'), 'utf8');
try {
  await writeFile(
    path.join(root, '.env'),
    template.replace(
      'WORKER_TOKEN=GENERATE_WITH_MAKE_SETUP',
      `WORKER_TOKEN=${randomBytes(32).toString('hex')}`,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  console.log('Created private .env with a fresh worker token. Review model paths before make dev.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Existing .env preserved.');
}
