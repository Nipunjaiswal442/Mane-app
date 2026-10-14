import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyUpdate } from '../verify-update.mjs';

test('signed updates bind both manifest and payload, reject the wrong trust key', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mane-update-test-'));
  try {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const payload = Buffer.from('opaque release tar payload');
    const manifest = Buffer.from(
      JSON.stringify({
        format: 'mane-update-v1',
        version: '0.1.0',
        archive: 'payload.tar',
        sha256: createHash('sha256').update(payload).digest('hex'),
        images: [`mane/api@sha256:${'a'.repeat(64)}`],
        migration: 'migrations/001.sql',
      }),
    );
    const p = (name) => path.join(dir, name);
    await writeFile(p('payload.tar'), payload);
    await writeFile(p('manifest.json'), manifest);
    await writeFile(
      p('manifest.sig'),
      sign(null, Buffer.concat([Buffer.from('mane-update-v1\n'), manifest]), privateKey),
    );
    await writeFile(p('public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
    assert.equal(
      (await verifyUpdate(p('manifest.json'), p('manifest.sig'), p('public.pem'))).version,
      '0.1.0',
    );
    await writeFile(p('payload.tar'), 'tampered');
    await assert.rejects(
      verifyUpdate(p('manifest.json'), p('manifest.sig'), p('public.pem')),
      /digest mismatch/,
    );
    await writeFile(p('payload.tar'), payload);
    await writeFile(p('manifest.json'), Buffer.from(manifest.toString().replace('0.1.0', '9.0.0')));
    await assert.rejects(verifyUpdate(p('manifest.json'), p('manifest.sig'), p('public.pem')), /signature/);
    await writeFile(p('manifest.json'), manifest);
    await writeFile(
      p('public.pem'),
      generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }),
    );
    await assert.rejects(verifyUpdate(p('manifest.json'), p('manifest.sig'), p('public.pem')), /signature/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
