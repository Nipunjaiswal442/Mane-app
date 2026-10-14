import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { assertLoopback } from '../offline-guard.mjs';

test('loopback policy rejects remote, private-LAN, credential-like, and deceptive hosts', () => {
  for (const host of ['localhost', '127.0.0.1', '127.2.3.4', '::1', '[::1]'])
    assert.doesNotThrow(() => assertLoopback(host));
  for (const host of [
    'example.com',
    '8.8.8.8',
    '192.168.1.10',
    '10.0.0.1',
    'localhost.example.com',
    'localhost@evil.example',
    'api',
    '::2',
  ])
    assert.throws(() => assertLoopback(host), /blocked outbound/);
});

test('network sockets cannot bypass the test guard with DNS or direct IP', () => {
  assert.throws(() => net.connect({ host: 'example.com', port: 443 }), { code: 'MANE_OUTBOUND_BLOCKED' });
  assert.throws(() => net.connect(443, '8.8.8.8'), { code: 'MANE_OUTBOUND_BLOCKED' });
});

test('HTTP and fetch cannot contact an external endpoint', async () => {
  await new Promise((resolve, reject) => {
    try {
      const req = http.get('http://example.com', () => reject(new Error('Unexpected external response')));
      req.on('error', (error) => {
        try {
          assert.match(error.message, /blocked outbound/);
          resolve();
        } catch (failure) {
          reject(failure);
        }
      });
    } catch (error) {
      assert.match(error.message, /blocked outbound/);
      resolve();
    }
  });
  await assert.rejects(
    fetch('https://example.com'),
    (error) => error.cause?.code === 'MANE_OUTBOUND_BLOCKED',
  );
});
