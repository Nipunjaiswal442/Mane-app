import { z } from 'zod';
import argon2 from 'argon2';
import { verifyLicense, canAddSeat } from '@mane/license';
import { one, rows, transaction } from './db/client.js';
import { admin, audit, licenseKey, licenseState, type Context } from './context.js';
import { csvCell, fail, id, publicUser } from './security.js';
import { hardwareStatus } from './adapters/hardware.js';
import { storage } from './adapters/storage.js';
export const retentionSchema = z.object({
  audioRetentionDays: z.number().int().min(0).max(3650),
  transcriptRetentionDays: z.number().int().min(0).max(3650),
  minutesRetentionDays: z.number().int().min(0).max(3650),
  userQuotaBytes: z.number().int().min(1048576).max(107374182400).optional(),
  defaultLanguage: z.string().min(2).max(30).optional(),
});
export function adminRoutes({ app, io }: Context) {
  app.get('/admin/users', async (req) => {
    admin(req);
    return {
      data: (await rows('SELECT * FROM users WHERE org_id=$1 ORDER BY created_at', [req.user.orgId])).map(
        publicUser,
      ),
    };
  });
  app.post('/admin/users', async (req, reply) => {
    admin(req);
    const input = z
      .object({
        email: z
          .string()
          .email()
          .max(254)
          .transform((s) => s.toLowerCase()),
        displayName: z.string().trim().min(1).max(100),
        password: z.string().min(12).max(256).optional(),
        role: z.enum(['admin', 'member']).default('member'),
      })
      .parse(req.body);
    if (!input.password && process.env.AUTH_PROVIDER !== 'oidc')
      fail(400, 'A temporary password of at least 12 characters is required.');
    const passwordHash = input.password
      ? await argon2.hash(input.password, {
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        })
      : null;
    const user = await transaction(async (c) => {
      await c.query('SELECT id FROM orgs WHERE id=$1 FOR UPDATE', [req.user.orgId]);
      const license = await licenseState(c);
      if ('expired' in license && license.expired)
        fail(
          403,
          'The 14-day evaluation has ended. Install a license to add people. Existing accounts can still sign in.',
        );
      if (!canAddSeat(license.activeSeats, license.seatBand))
        fail(
          403,
          `Your license allows ${license.seatBand} active people. Deactivate a person or install a larger license.`,
        );
      const u = await one(
        'INSERT INTO users(org_id,email,display_name,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [req.user.orgId, input.email, input.displayName, passwordHash, input.role],
        c,
      );
      await c.query(
        "INSERT INTO space_members(space_id,user_id) SELECT id,$1 FROM spaces WHERE org_id=$2 AND slug='general' ON CONFLICT DO NOTHING",
        [u.id, req.user.orgId],
      );
      await audit(req, 'user.create', 'user', u.id, { role: u.role }, c);
      return u;
    });
    reply.code(201);
    return { data: publicUser(user) };
  });
  app.patch('/admin/users/:id', async (req) => {
    admin(req);
    const input = z
      .object({
        displayName: z.string().trim().min(1).max(100).optional(),
        role: z.enum(['admin', 'member']).optional(),
        isActive: z.boolean().optional(),
        password: z.string().min(12).max(256).optional(),
      })
      .parse(req.body);
    const passwordHash = input.password
      ? await argon2.hash(input.password, {
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        })
      : null;
    const result = await transaction(async (c) => {
      await c.query('SELECT id FROM orgs WHERE id=$1 FOR UPDATE', [req.user.orgId]);
      const target = await one(
        'SELECT * FROM users WHERE id=$1 AND org_id=$2 FOR UPDATE',
        [id(req), req.user.orgId],
        c,
      );
      if (!target) fail(404, 'User not found.');
      if (
        target.role === 'admin' &&
        target.isActive &&
        (input.role === 'member' || input.isActive === false)
      ) {
        const count = await one(
          "SELECT count(*)::int count FROM users WHERE org_id=$1 AND role='admin' AND is_active",
          [req.user.orgId],
          c,
        );
        if (count.count <= 1) fail(409, 'The organisation must retain an active administrator.');
      }
      if (input.isActive === true && !target.isActive) {
        const license = await licenseState(c);
        if (!canAddSeat(license.activeSeats, license.seatBand) || ('expired' in license && license.expired))
          fail(403, 'The license does not allow another active person.');
      }
      const user = await one(
        'UPDATE users SET display_name=COALESCE($3,display_name),role=COALESCE($4,role),is_active=COALESCE($5,is_active),password_hash=COALESCE($6,password_hash),updated_at=now() WHERE id=$1 AND org_id=$2 RETURNING *',
        [
          target.id,
          req.user.orgId,
          input.displayName ?? null,
          input.role ?? null,
          input.isActive ?? null,
          passwordHash,
        ],
        c,
      );
      if (input.isActive === false || passwordHash || input.role)
        await c.query('DELETE FROM sessions WHERE user_id=$1', [target.id]);
      await audit(
        req,
        input.isActive === false ? 'user.deactivate' : input.role ? 'user.role.change' : 'user.update',
        'user',
        target.id,
        { role: input.role, isActive: input.isActive },
        c,
      );
      return user;
    });
    if (input.isActive === false || input.role || passwordHash)
      io.in(`user:${result.id}`).disconnectSockets(true);
    return { data: publicUser(result) };
  });
  app.get('/admin/license', async (req) => {
    admin(req);
    return { data: await licenseState() };
  });
  app.post('/admin/license', async (req) => {
    admin(req);
    const input = z.object({ raw: z.string().max(20000) }).parse(req.body);
    let parsed: ReturnType<typeof verifyLicense>;
    try {
      parsed = verifyLicense(input.raw, await licenseKey());
    } catch (error) {
      fail(422, error instanceof Error ? error.message : 'Invalid license.');
    }
    await transaction(async (c) => {
      await c.query('SELECT id FROM orgs WHERE id=$1 FOR UPDATE', [req.user.orgId]);
      const old = await one('SELECT id FROM licenses LIMIT 1', [], c);
      if (old)
        await c.query('UPDATE licenses SET raw=$1,parsed=$2,verified_at=now(),updated_at=now() WHERE id=$3', [
          input.raw,
          JSON.stringify(parsed),
          old.id,
        ]);
      else
        await c.query('INSERT INTO licenses(raw,parsed,verified_at) VALUES($1,$2,now())', [
          input.raw,
          JSON.stringify(parsed),
        ]);
      await audit(req, 'license.upload', 'org', req.user.orgId, { seatBand: parsed!.seat_band }, c);
    });
    return { data: await licenseState() };
  });
  app.get('/admin/retention', async (req) => {
    admin(req);
    return { data: (await one('SELECT settings FROM orgs WHERE id=$1', [req.user.orgId])).settings };
  });
  app.patch('/admin/retention', async (req) => {
    admin(req);
    const input = retentionSchema.parse(req.body);
    const result = await one(
      'UPDATE orgs SET settings=settings || $2::jsonb,updated_at=now() WHERE id=$1 RETURNING settings',
      [req.user.orgId, JSON.stringify(input)],
    );
    await audit(req, 'retention.update', 'org', req.user.orgId, input);
    return { data: result.settings };
  });
  app.get('/admin/audit', async (req, reply) => {
    admin(req);
    const query = z
      .object({
        action: z.string().max(100).optional(),
        format: z.enum(['json', 'csv']).default('json'),
        limit: z.coerce.number().int().min(1).max(1000).default(100),
      })
      .parse(req.query);
    const result = await rows(
      'SELECT a.*,u.display_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE a.org_id=$1 AND($2::text IS NULL OR a.action=$2) ORDER BY a.created_at DESC LIMIT $3',
      [req.user.orgId, query.action || null, query.limit],
    );
    if (query.format === 'csv') {
      const keys = ['createdAt', 'actorName', 'action', 'targetType', 'targetId', 'ip'];
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="mane-audit.csv"');
      return keys.join(',') + '\n' + result.map((r) => keys.map((k) => csvCell(r[k])).join(',')).join('\n');
    }
    return { data: result };
  });
  app.get('/admin/hardware', async (req) => {
    admin(req);
    return { data: await hardwareStatus() };
  });
}
/** Scheduled once per day. Zero days means retain indefinitely. In-flight jobs are never purged. */
export async function purgeRetention() {
  return transaction(async (c) => {
    const lock = await one('SELECT pg_try_advisory_xact_lock(72619693) AS acquired', [], c);
    if (!lock.acquired) return { audio: 0, transcripts: 0, minutes: 0 };
    const org = await one('SELECT * FROM orgs LIMIT 1', [], c);
    if (!org) return { audio: 0, transcripts: 0, minutes: 0 };
    const settings = org.settings;
    let audio = 0,
      transcripts = 0,
      minutes = 0;
    if (settings.audioRetentionDays > 0) {
      const media = await rows(
        "SELECT DISTINCT md.* FROM media md JOIN meetings m ON m.audio_media_id=md.id WHERE m.org_id=$1 AND md.deleted_at IS NULL AND m.status='published' AND m.created_at<now()-($2::int*interval '1 day') AND NOT EXISTS(SELECT 1 FROM doc_jobs j WHERE j.meeting_id=m.id AND j.status IN('queued','running'))",
        [org.id, settings.audioRetentionDays],
        c,
      );
      for (const item of media) {
        await storage.delete(item.storageKey);
        await c.query('UPDATE media SET deleted_at=now(),updated_at=now() WHERE id=$1', [item.id]);
        audio++;
      }
    }
    if (settings.transcriptRetentionDays > 0) {
      const result = await c.query(
        "DELETE FROM transcripts t USING meetings m WHERE t.meeting_id=m.id AND m.org_id=$1 AND t.created_at<now()-($2::int*interval '1 day') AND m.status='published' AND NOT EXISTS(SELECT 1 FROM doc_jobs j WHERE j.meeting_id=m.id AND j.status IN('queued','running'))",
        [org.id, settings.transcriptRetentionDays],
      );
      transcripts = result.rowCount || 0;
    }
    if (settings.minutesRetentionDays > 0) {
      const old = await rows(
        "SELECT n.* FROM minutes n JOIN meetings m ON m.id=n.meeting_id WHERE m.org_id=$1 AND n.created_at<now()-($2::int*interval '1 day') AND m.status='published'",
        [org.id, settings.minutesRetentionDays],
        c,
      );
      for (const minute of old) {
        for (const mediaId of [minute.docxMediaId, minute.mdMediaId]) {
          if (!mediaId) continue;
          const media = await one('SELECT * FROM media WHERE id=$1 AND deleted_at IS NULL', [mediaId], c);
          if (media) {
            await storage.delete(media.storageKey);
            await c.query('UPDATE media SET deleted_at=now() WHERE id=$1', [mediaId]);
          }
        }
        await c.query('DELETE FROM minutes WHERE id=$1', [minute.id]);
        minutes++;
      }
    }
    await c.query('DELETE FROM sessions WHERE expires_at<now()');
    if (audio || transcripts || minutes)
      await c.query(
        "INSERT INTO audit_log(org_id,action,target_type,target_id,metadata) VALUES($1,'retention.purge','org',$1,$2)",
        [org.id, JSON.stringify({ audio, transcripts, minutes })],
      );
    return { audio, transcripts, minutes };
  });
}
