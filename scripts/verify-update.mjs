import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function verifyUpdate(manifestPath, signaturePath, publicKeyPath) {
  for (const file of [manifestPath, signaturePath, publicKeyPath])
    if (!(await lstat(file)).isFile()) throw new Error('Inputs must be regular files');
  const manifestBytes = await readFile(manifestPath);
  if (manifestBytes.length > 1024 * 1024) throw new Error('Manifest too large');
  const key = createPublicKey(await readFile(publicKeyPath));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('An Ed25519 trust key is required');
  const signature = await readFile(signaturePath);
  if (
    signature.length !== 64 ||
    !verify(null, Buffer.concat([Buffer.from('mane-update-v1\n'), manifestBytes]), key, signature)
  )
    throw new Error('Invalid update signature');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (
    manifest.format !== 'mane-update-v1' ||
    !/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/i.test(manifest.version || '') ||
    manifest.archive !== 'payload.tar' ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256 || '') ||
    !Array.isArray(manifest.images) ||
    !manifest.images.length ||
    !manifest.images.every((i) => typeof i === 'string' && /^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(i)) ||
    typeof manifest.migration !== 'string' ||
    !/^migrations\/[a-zA-Z0-9_.-]+\.sql$/.test(manifest.migration)
  )
    throw new Error('Invalid update manifest');
  const archive = path.join(path.dirname(manifestPath), manifest.archive);
  if (!(await lstat(archive)).isFile()) throw new Error('Archive must be a regular file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (hash.digest('hex') !== manifest.sha256) throw new Error('Archive digest mismatch');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [manifest, signature, key, action] = process.argv.slice(2);
  if (!manifest || !signature || !key || action) {
    console.error(
      'Usage: node scripts/verify-update.mjs manifest.json manifest.sig trusted-ed25519-public.pem',
    );
    process.exitCode = 1;
  } else
    try {
      const result = await verifyUpdate(manifest, signature, key);
      console.log(`VERIFIED Mane ${result.version}: archive checksum and trusted Ed25519 signature match.`);
      console.log(
        'Application is intentionally not implemented in v0. No files extracted, images loaded, or migrations applied.',
      );
    } catch (error) {
      console.error(`REJECTED: ${error.message}`);
      process.exitCode = 1;
    }
}
