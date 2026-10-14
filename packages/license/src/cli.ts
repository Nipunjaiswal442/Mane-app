import { generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { issueLicense } from './index.js';

const args = process.argv.slice(2);
const arg = (key: string, fallback: string) =>
  args.includes(key) ? (args[args.indexOf(key) + 1] ?? fallback) : fallback;
const out = resolve(arg('--out', '../../data/dev-license'));
await mkdir(out, { recursive: true });
let privateKey: string;
try {
  privateKey = await readFile(resolve(out, 'private.pem'), 'utf8');
} catch {
  const keys = generateKeyPairSync('ed25519');
  privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  await writeFile(resolve(out, 'private.pem'), privateKey, { mode: 0o600 });
  await writeFile(resolve(out, 'public.pem'), keys.publicKey.export({ type: 'spki', format: 'pem' }));
}
const raw = issueLicense(
  {
    issued_to: arg('--to', 'Development appliance'),
    seat_band: Number(arg('--seats', '100')),
    tier: 'starter',
    issued_at: new Date().toISOString(),
    maintenance_expires_at: new Date(Date.now() + 365 * 86400000).toISOString(),
  },
  privateKey,
);
await writeFile(resolve(out, 'license.json'), raw, { mode: 0o600 });
console.log(
  `Development license written to ${out}/license.json. Set LICENSE_PUBLIC_KEY_PATH=${out}/public.pem. Keep private.pem outside appliance distribution.`,
);
