import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorage, localEndpoint } from '../src/adapters/storage.js';
import { csvCell, safeEqual } from '../src/security.js';
import { matchOwner, validateEvidence } from '../src/meetings.js';
import type { Minutes } from '@mane/shared';
const minutes: Minutes = {
  title: 'Planning',
  held_at: null,
  attendees: [],
  summary: 'A planning discussion.',
  agenda: [],
  decisions: [],
  action_items: [],
  open_questions: [],
  risks: [],
  next_meeting: null,
  confidence_notes: [],
};
test('local storage isolates keys and round-trips arbitrary bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mane-storage-'));
  try {
    const storage = new LocalStorage(root);
    for (const key of ['../escape', '/etc/passwd', 'a/../../escape', ''])
      assert.throws(() => storage.path(key));
    await storage.put('media/test.bin', Buffer.from([0, 1, 2, 255]));
    assert.deepEqual(await storage.get('media/test.bin'), Buffer.from([0, 1, 2, 255]));
    await symlink(tmpdir(), join(root, 'escape'));
    await assert.rejects(storage.put('escape/outside.bin', Buffer.from('bad')));
    await assert.rejects(storage.get('escape/outside.bin'));
    await storage.delete('media/test.bin');
    await assert.rejects(storage.get('media/test.bin'));
    await storage.delete('media/test.bin');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('runtime endpoints reject external destinations and unsafe protocols', () => {
  for (const url of [
    'https://example.com',
    'http://localhost.evil.com',
    'file:///etc/passwd',
    'http://user:pass@localhost',
    'http://minio:9000',
  ])
    assert.throws(() => localEndpoint(url));
  assert.equal(localEndpoint('http://localhost:11434').hostname, 'localhost');
  assert.equal(localEndpoint('http://minio:9000', ['minio']).hostname, 'minio');
});
test('evidence must have both timestamps within transcript segments', () => {
  validateEvidence(minutes, []);
  const content = { ...minutes, decisions: [{ text: 'Ship', evidence: [{ start_s: 1, end_s: 4 }] }] };
  validateEvidence(content, [{ start_s: 0, end_s: 5 }]);
  assert.throws(() => validateEvidence(content, [{ start_s: 10, end_s: 15 }]));
});
test('owner matching handles exact names and refuses ambiguity', () => {
  const users = [
    { id: 'a', displayName: 'Priya Sharma', email: 'priya@example.test' },
    { id: 'b', displayName: 'Daniel Kim', email: 'daniel@example.test' },
  ];
  assert.equal(matchOwner('Priya Sharma', users), 'a');
  assert.equal(matchOwner('priya', users), 'a');
  assert.equal(matchOwner('Unknown person', users), null);
  assert.equal(
    matchOwner('Priya', [...users, { id: 'c', displayName: 'Priya', email: 'priya2@example.test' }]),
    null,
  );
});
test('CSV formula injection and constant-time token comparison', () => {
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abcd'), false);
});
