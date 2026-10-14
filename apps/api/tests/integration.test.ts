import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { issueLicense } from '@mane/license';

// Integration tests use a dedicated database and destroy only its public schema.
test(
  'PostgreSQL: auth, isolation, seats, uploads, job idempotency and retention',
  { skip: !process.env.DATABASE_TEST_URL, timeout: 120000 },
  async (t) => {
    const dbUrl = new URL(process.env.DATABASE_TEST_URL!);
    assert.match(dbUrl.pathname, /_test$/, 'DATABASE_TEST_URL must point to a database ending in _test');
    process.env.DATABASE_URL = dbUrl.toString();
    process.env.WORKER_TOKEN = 'test-worker-secret-'.repeat(3);
    process.env.AUTH_PROVIDER = 'local';
    const directory = await mkdtemp(join(tmpdir(), 'mane-integration-'));
    process.env.DATA_DIR = directory;
    const { pool, one } = await import('../src/db/client.js');
    const { migrate } = await import('../src/db/migrate.js');
    const { buildApp } = await import('../src/server.js');
    const { storage } = await import('../src/adapters/storage.js');
    const { purgeRetention } = await import('../src/admin.js');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate();
    const app = await buildApp({ logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const request = async (method: string, url: string, body?: unknown, auth?: any, extra = {}) =>
      app.inject({
        method: method as any,
        url,
        payload: body as any,
        headers: {
          origin: 'http://localhost:3000',
          ...(auth ? { cookie: auth.cookie, 'x-csrf-token': auth.csrf } : {}),
          ...extra,
        },
      });
    let admin: any, member: any, outsider: any, space: any, meetingId: string, adminId: string;
    const login = async (email: string) => {
      const r = await request('POST', '/auth/login', { email, password: 'Valid password 12345' });
      assert.equal(r.statusCode, 200, r.body);
      return {
        cookie:
          r.cookies.find((c) => c.name === 'mane_session')!.name +
          '=' +
          r.cookies.find((c) => c.name === 'mane_session')!.value,
        csrf: r.json().data.csrfToken,
        id: r.json().data.user.id,
      };
    };
    try {
      await t.test('first-run setup and session security', async () => {
        assert.equal((await request('GET', '/auth/status')).json().data.setupRequired, true);
        const r = await request('POST', '/auth/setup', {
          orgName: 'Integration Org',
          displayName: 'Admin Tester',
          email: 'admin@example.test',
          password: 'Valid password 12345',
        });
        assert.equal(r.statusCode, 200, r.body);
        assert.equal(r.cookies[0]!.httpOnly, true);
        admin = {
          cookie: `mane_session=${r.cookies[0]!.value}`,
          csrf: r.json().data.csrfToken,
          id: r.json().data.user.id,
        };
        adminId = admin.id;
        assert.equal(r.json().data.user.passwordHash, undefined);
        assert.equal((await request('POST', '/auth/setup', {})).statusCode, 422);
        assert.equal((await request('GET', '/auth/me')).statusCode, 401);
        assert.equal(
          (await request('POST', '/spaces', { name: 'No token' }, undefined, { cookie: admin.cookie }))
            .statusCode,
          403,
        );
        assert.equal(
          (await request('POST', '/spaces', { name: 'Bad origin' }, admin, { origin: 'https://evil.test' }))
            .statusCode,
          403,
        );
      });
      await t.test('admin provisions members and last admin is protected', async () => {
        for (const [email, displayName] of [
          ['member@example.test', 'Member Tester'],
          ['outsider@example.test', 'Outsider Tester'],
        ]) {
          const r = await request(
            'POST',
            '/admin/users',
            { email, displayName, password: 'Valid password 12345' },
            admin,
          );
          assert.equal(r.statusCode, 201, r.body);
        }
        member = await login('member@example.test');
        outsider = await login('outsider@example.test');
        assert.equal(
          (await request('PATCH', `/admin/users/${admin.id}`, { role: 'member' }, admin)).statusCode,
          409,
        );
        assert.equal((await request('GET', '/admin/users', undefined, member)).statusCode, 403);
      });
      await t.test('private-space access, search, comments, membership invariant', async () => {
        let r = await request('POST', '/spaces', { name: 'Confidential', visibility: 'private' }, admin);
        assert.equal(r.statusCode, 201, r.body);
        space = r.json().data;
        assert.equal(
          (await request('POST', `/spaces/${space.id}/members`, { userId: admin.id, role: 'member' }, admin))
            .statusCode,
          409,
        );
        r = await request('POST', `/spaces/${space.id}/members`, { userId: member.id }, admin);
        assert.equal(r.statusCode, 200, r.body);
        r = await request(
          'POST',
          `/spaces/${space.id}/posts`,
          { body: 'Confidential merger planning' },
          member,
        );
        assert.equal(r.statusCode, 201, r.body);
        const post = r.json().data;
        assert.equal(
          (await request('GET', `/spaces/${space.id}/posts`, undefined, outsider)).statusCode,
          404,
        );
        assert.equal(
          (await request('GET', `/posts/${post.id}/comments`, undefined, outsider)).statusCode,
          404,
        );
        assert.deepEqual((await request('GET', '/search?q=merger', undefined, outsider)).json().data, []);
        r = await request('POST', `/posts/${post.id}/comments`, { body: 'A private reply' }, admin);
        assert.equal(r.statusCode, 201, r.body);
        r = await request(
          'POST',
          '/reactions',
          { targetType: 'post', targetId: post.id, emoji: '👍' },
          member,
        );
        assert.equal(r.statusCode, 200, r.body);
        assert.equal(
          (await request('GET', `/spaces/${space.id}/posts`, undefined, member)).json().data[0].commentCount,
          1,
        );
      });
      await t.test('DM thread isolation and read receipts', async () => {
        let r = await request('POST', '/dm/threads', { userIds: [member.id] }, admin);
        assert.equal(r.statusCode, 201, r.body);
        const thread = r.json().data;
        r = await request(
          'POST',
          `/dm/threads/${thread.id}/messages`,
          { body: 'Private direct message' },
          member,
        );
        assert.equal(r.statusCode, 201, r.body);
        assert.equal(
          (await request('GET', `/dm/threads/${thread.id}/messages`, undefined, outsider)).statusCode,
          404,
        );
        assert.equal((await request('POST', `/dm/threads/${thread.id}/read`, {}, admin)).statusCode, 200);
        assert.equal(
          (await request('GET', `/dm/threads/${thread.id}/messages`, undefined, admin)).json().data[0]
            .readCount,
          1,
        );
      });
      await t.test(
        'WebSockets authorize rooms, revoke tightened visibility and logout sessions',
        async () => {
          const { io: connect } = await import('socket.io-client');
          const url = `http://127.0.0.1:${(app.server.address() as any).port}`;
          const open = async (auth: any) => {
            const socket = connect(url, {
              transports: ['websocket'],
              reconnection: false,
              auth: { csrfToken: auth.csrf },
              extraHeaders: { cookie: auth.cookie, origin: 'http://localhost:3000' },
            });
            await Promise.race([
              new Promise<void>((resolve) => socket.once('connect', resolve)),
              new Promise<never>((_, reject) => socket.once('connect_error', reject)),
            ]);
            return socket;
          };
          const socket = await open(outsider);
          try {
            const denied = await new Promise<any>((resolve) =>
              socket.emit('subscribe', { spaceId: space.id }, resolve),
            );
            assert.equal(denied.error, 'Access denied');
            const created = await request(
              'POST',
              '/spaces',
              { name: 'Initially public', visibility: 'open' },
              admin,
            );
            assert.equal(created.statusCode, 201, created.body);
            const publicSpace = created.json().data;
            assert.equal(
              (
                await new Promise<any>((resolve) =>
                  socket.emit('subscribe', { spaceId: publicSpace.id }, resolve),
                )
              ).ok,
              true,
            );
            const received = new Promise<any>((resolve) => socket.once('post', (post) => resolve([post])));
            await request('POST', `/spaces/${publicSpace.id}/posts`, { body: 'Visible while public' }, admin);
            assert.equal((await received)[0].body, 'Visible while public');
            const changed = await request(
              'PATCH',
              `/spaces/${publicSpace.id}`,
              { name: 'Now private', description: 'Restricted', visibility: 'private' },
              admin,
            );
            assert.equal(changed.statusCode, 200, changed.body);
            let leaked = false;
            socket.on('post', () => {
              leaked = true;
            });
            await request(
              'POST',
              `/spaces/${publicSpace.id}/posts`,
              { body: 'Restricted after privacy change' },
              admin,
            );
            await new Promise((resolve) => setTimeout(resolve, 100));
            assert.equal(leaked, false);
            assert.equal(
              (
                await new Promise<any>((resolve) =>
                  socket.emit('subscribe', { spaceId: publicSpace.id }, resolve),
                )
              ).error,
              'Access denied',
            );
          } finally {
            socket.disconnect();
          }
          const separate = await login('member@example.test'),
            ownSocket = await open(separate);
          const disconnected = new Promise<void>((resolve) => ownSocket.once('disconnect', () => resolve()));
          assert.equal((await request('POST', '/auth/logout', {}, separate)).statusCode, 200);
          await disconnected;
          assert.equal(ownSocket.connected, false);
          assert.equal((await request('GET', '/auth/me', undefined, member)).statusCode, 200);
          ownSocket.disconnect();
        },
      );
      await t.test('license signature and server-side seat enforcement', async () => {
        const keys = generateKeyPairSync('ed25519');
        process.env.LICENSE_PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
        const raw = issueLicense(
          {
            issued_to: 'Integration Org',
            seat_band: 3,
            tier: 'starter',
            issued_at: new Date(Date.now() - 86400000).toISOString(),
            maintenance_expires_at: new Date(Date.now() - 1000).toISOString(),
          },
          keys.privateKey,
        );
        assert.equal(
          (
            await request(
              'POST',
              '/admin/license',
              { raw: raw.replace('Integration Org', 'Tampered Org') },
              admin,
            )
          ).statusCode,
          422,
        );
        assert.equal((await request('POST', '/admin/license', { raw }, admin)).statusCode, 200);
        assert.equal(
          (await request('GET', '/admin/license', undefined, admin)).json().data.updatesAvailable,
          false,
        );
        assert.equal(
          (
            await request(
              'POST',
              '/admin/users',
              { email: 'extra@example.test', displayName: 'Extra', password: 'Valid password 12345' },
              admin,
            )
          ).statusCode,
          403,
        );
        assert.ok(await login('member@example.test'));
      });
      await t.test('content sniffing, upload quota and unauthorized media reads', async () => {
        const boundary = 'mane-test-boundary';
        const upload = async (bytes: Buffer, name: string) =>
          request(
            'POST',
            '/media',
            Buffer.concat([
              Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: audio/wav\r\n\r\n`,
              ),
              bytes,
              Buffer.from(`\r\n--${boundary}--\r\n`),
            ]),
            member,
            { 'content-type': `multipart/form-data; boundary=${boundary}` },
          );
        assert.equal(
          (await upload(Buffer.from('<svg onload="alert(1)"></svg>'), 'fake.wav')).statusCode,
          415,
        );
        const wav = Buffer.alloc(48);
        wav.write('RIFF');
        wav.writeUInt32LE(40, 4);
        wav.write('WAVEfmt ', 8);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(16000, 24);
        wav.writeUInt32LE(32000, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write('data', 36);
        wav.writeUInt32LE(4, 40);
        let r = await upload(wav, 'meeting.wav');
        assert.equal(r.statusCode, 201, r.body);
        const media = r.json().data;
        assert.equal((await request('GET', `/media/${media.id}`, undefined, outsider)).statusCode, 404);
        await pool.query("UPDATE orgs SET settings=jsonb_set(settings,'{userQuotaBytes}','48')");
        assert.equal((await upload(wav, 'over-quota.wav')).statusCode, 413);
        r = await request(
          'POST',
          '/meetings',
          { title: 'Project review', spaceId: space.id, audioMediaId: media.id, reviewerId: member.id },
          member,
        );
        assert.equal(r.statusCode, 201, r.body);
        meetingId = r.json().data.id;
      });
      await t.test('job leases, review evidence, render callback idempotency', async () => {
        const call = async (job: any, body: any) =>
          request('POST', `/internal/jobs/${job.id}/complete`, { lockToken: 'lease-1', ...body }, undefined, {
            'x-worker-token': process.env.WORKER_TOKEN!,
          });
        let job = await one(
          "UPDATE doc_jobs SET status='running',locked_by='lease-1',locked_at=now(),attempts=1 WHERE meeting_id=$1 AND kind='transcribe' RETURNING *",
          [meetingId],
        );
        assert.equal((await request('GET', `/internal/jobs/${job.id}/context`)).statusCode, 401);
        let r = await call(job, { lockToken: 'stale', transcript: { language: 'en', segments: [] } });
        assert.equal(r.statusCode, 409);
        r = await call(job, {
          transcript: {
            language: 'en',
            segments: [
              { start_s: 0, end_s: 10, speaker: null, text: 'Member Tester will prepare the report.' },
            ],
          },
          durationS: 10,
        });
        assert.equal(r.statusCode, 200, r.body);
        job = await one(
          "UPDATE doc_jobs SET status='running',locked_by='lease-1',locked_at=now(),attempts=1 WHERE meeting_id=$1 AND kind='draft' RETURNING *",
          [meetingId],
        );
        const content = {
          title: 'Project review',
          held_at: null,
          attendees: [],
          summary: 'The team reviewed the project.',
          agenda: [],
          decisions: [],
          action_items: [
            {
              text: 'Prepare the report',
              owner: 'Member Tester',
              due_date: null,
              evidence: [{ start_s: 0, end_s: 10 }],
            },
          ],
          open_questions: [],
          risks: [],
          next_meeting: null,
          confidence_notes: [],
        };
        r = await call(job, { content });
        assert.equal(r.statusCode, 200, r.body);
        assert.equal((await request('POST', `/meetings/${meetingId}/approve`, {}, outsider)).statusCode, 404);
        const invalid = structuredClone(content);
        invalid.action_items[0]!.evidence[0]!.end_s = 100;
        r = await request('PATCH', `/meetings/${meetingId}/minutes`, { content: invalid }, member);
        assert.equal(r.statusCode, 422, r.body);
        r = await request('POST', `/meetings/${meetingId}/approve`, {}, member);
        assert.equal(r.statusCode, 200, r.body);
        job = await one(
          "UPDATE doc_jobs SET status='running',locked_by='lease-1',locked_at=now(),attempts=1 WHERE meeting_id=$1 AND kind='render' RETURNING *",
          [meetingId],
        );
        const artifacts: any = {};
        for (const [kind, bytes, mime] of [
          [
            'docx',
            Buffer.from('PK-fixture-docx'),
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          ],
          ['markdown', Buffer.from('# Project review'), 'text/markdown'],
        ] as const) {
          const key = `generated/${meetingId}/${kind}`;
          await storage.put(key, bytes, mime);
          artifacts[kind] = {
            storageKey: key,
            mime,
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          };
        }
        r = await call(job, artifacts);
        assert.equal(r.statusCode, 200, r.body);
        assert.equal(r.json().data.status, 'published');
        assert.equal((await call(job, artifacts)).statusCode, 200);
        assert.equal(
          (await one('SELECT count(*)::int count FROM posts WHERE meeting_id=$1', [meetingId])).count,
          1,
        );
        assert.equal(
          (await one('SELECT count(*)::int count FROM action_items WHERE meeting_id=$1', [meetingId])).count,
          1,
        );
        r = await request('GET', '/action-items', undefined, member);
        assert.equal(r.json().data[0].ownerUserId, member.id);
      });
      await t.test('retention purges old audio and preserves published minutes', async () => {
        await pool.query("UPDATE meetings SET created_at=now()-interval '40 days' WHERE id=$1", [meetingId]);
        const result = await purgeRetention();
        assert.equal(result.audio, 1);
        assert.equal(
          (await one('SELECT count(*)::int count FROM minutes WHERE meeting_id=$1', [meetingId])).count,
          1,
        );
        assert.equal(
          (await request('GET', `/meetings/${meetingId}`, undefined, member)).json().data.audio,
          null,
        );
      });
      await t.test('OIDC against a local mock issuer', async () => {
        const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const jwk = keys.publicKey.export({ format: 'jwk' });
        let issuer = '';
        const server = createServer((req, res) => {
          res.setHeader('Content-Type', 'application/json');
          if (req.url === '/.well-known/openid-configuration')
            return res.end(
              JSON.stringify({
                issuer,
                authorization_endpoint: `${issuer}/authorize`,
                token_endpoint: `${issuer}/token`,
                jwks_uri: `${issuer}/jwks`,
                response_types_supported: ['code'],
                subject_types_supported: ['public'],
                id_token_signing_alg_values_supported: ['RS256'],
              }),
            );
          if (req.url === '/jwks')
            return res.end(JSON.stringify({ keys: [{ ...jwk, kid: 'test', use: 'sig', alg: 'RS256' }] }));
          if (req.url === '/token') {
            const now = Math.floor(Date.now() / 1000);
            const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url'),
              payload = Buffer.from(
                JSON.stringify({
                  iss: issuer,
                  sub: 'local-member',
                  aud: 'mane',
                  iat: now,
                  exp: now + 300,
                  email: 'member@example.test',
                  email_verified: true,
                }),
              ).toString('base64url');
            const signature = sign(
              'RSA-SHA256',
              Buffer.from(`${header}.${payload}`),
              keys.privateKey,
            ).toString('base64url');
            return res.end(
              JSON.stringify({
                access_token: 'local-token',
                token_type: 'Bearer',
                expires_in: 300,
                id_token: `${header}.${payload}.${signature}`,
              }),
            );
          }
          res.statusCode = 404;
          res.end('{}');
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        issuer = `http://127.0.0.1:${(server.address() as any).port}`;
        process.env.AUTH_PROVIDER = 'oidc';
        process.env.OIDC_ISSUER = issuer;
        process.env.OIDC_CLIENT_ID = 'mane';
        try {
          const start = await request('GET', '/auth/oidc/start');
          assert.equal(start.statusCode, 302, start.body);
          const state = new URL(start.headers.location!).searchParams.get('state')!;
          const result = await request(
            'GET',
            `/auth/oidc/callback?code=test-code&state=${state}`,
            undefined,
            undefined,
            { cookie: `mane_oidc_state=${state}` },
          );
          assert.equal(result.statusCode, 302, result.body);
          assert.ok(result.cookies.some((c) => c.name === 'mane_session'));
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
          process.env.AUTH_PROVIDER = 'local';
        }
      });
      await t.test('logout revokes session', async () => {
        assert.equal((await request('POST', '/auth/logout', {}, member)).statusCode, 200);
        assert.equal((await request('GET', '/auth/me', undefined, member)).statusCode, 401);
      });
    } finally {
      await app.close();
      await pool.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
