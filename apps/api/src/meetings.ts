import { z } from 'zod';
import { minutesSchema, transcriptSchema, type Minutes } from '@mane/shared';
import { one, rows, transaction, type Queryable } from './db/client.js';
import { spaceAccess, meetingAccess, audit, notify, type Context } from './context.js';
import { id, uuid, fail } from './security.js';
import { storage } from './adapters/storage.js';
import { createHash } from 'node:crypto';
const artifact = z.object({
  storageKey: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{1,240}$/)
    .refine((s) => !s.split('/').includes('..')),
  mime: z.string(),
  bytes: z
    .number()
    .int()
    .nonnegative()
    .max(50 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export function validateEvidence(content: Minutes, segments: Array<{ start_s: number; end_s: number }>) {
  for (const item of [...content.decisions, ...content.action_items])
    for (const span of item.evidence) {
      if (
        !segments.some((s) => span.start_s >= s.start_s - 0.25 && span.start_s <= s.end_s + 0.25) ||
        !segments.some((s) => span.end_s >= s.start_s - 0.25 && span.end_s <= s.end_s + 0.25)
      )
        fail(422, 'Every evidence span must fall inside the recorded transcript.');
    }
}
export function matchOwner(name: string | null, users: any[]): string | null {
  if (!name) return null;
  const normal = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]/g, '');
  const a = normal(name);
  if (!a) return null;
  const score = (b: string) => {
    b = normal(b);
    if (a === b) return 1;
    const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j]! + 1,
          matrix[i]![j - 1]! + 1,
          matrix[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
    return 1 - matrix[a.length]![b.length]! / Math.max(a.length, b.length);
  };
  const ranked = users
    .map((u) => ({ id: u.id, score: Math.max(score(u.displayName), score(u.email.split('@')[0])) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score >= 0.88 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.08)
    ? ranked[0].id
    : null;
}
export function meetingRoutes({ app, io }: Context) {
  app.get('/meetings', async (req) => ({
    data: await rows(
      "SELECT m.*,s.name AS space_name,u.display_name AS reviewer_name FROM meetings m JOIN spaces s ON s.id=m.space_id JOIN users u ON u.id=m.reviewer_id WHERE m.org_id=$1 AND(s.visibility='open' OR $3 OR EXISTS(SELECT 1 FROM space_members sm WHERE sm.space_id=s.id AND sm.user_id=$2)) ORDER BY m.created_at DESC LIMIT 100",
      [req.user.orgId, req.user.id, req.user.role === 'admin'],
    ),
  }));
  app.post('/meetings', async (req, reply) => {
    const input = z
      .object({
        title: z.string().trim().min(1).max(200),
        spaceId: uuid,
        audioMediaId: uuid,
        reviewerId: uuid.optional(),
        heldAt: z.string().datetime({ offset: true }).nullable().optional(),
        languageHint: z.string().max(30).nullable().optional(),
      })
      .parse(req.body);
    await spaceAccess(req, input.spaceId, true);
    const reviewer = input.reviewerId || req.user.id;
    const member = await one(
      'SELECT u.id FROM users u JOIN space_members sm ON sm.user_id=u.id WHERE u.id=$1 AND sm.space_id=$2 AND u.is_active AND u.org_id=$3',
      [reviewer, input.spaceId, req.user.orgId],
    );
    if (!member) fail(400, 'Reviewer must be an active member of the target space.');
    const media = await one('SELECT * FROM media WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL', [
      input.audioMediaId,
      req.user.id,
    ]);
    if (!media || !(media.mime.startsWith('audio/') || ['video/mp4', 'video/webm'].includes(media.mime)))
      fail(400, 'Upload a supported audio file first.');
    const meeting = await transaction(async (c) => {
      const m = await one(
        'INSERT INTO meetings(org_id,space_id,uploader_id,reviewer_id,title,held_at,language_hint,audio_media_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [
          req.user.orgId,
          input.spaceId,
          req.user.id,
          reviewer,
          input.title,
          input.heldAt || null,
          input.languageHint || null,
          input.audioMediaId,
        ],
        c,
      );
      await c.query("INSERT INTO doc_jobs(meeting_id,kind) VALUES($1,'transcribe')", [m.id]);
      await audit(req, 'meeting.upload', 'meeting', m.id, {}, c);
      return m;
    });
    io.to(`space:${meeting.spaceId}`).emit('meeting', meeting);
    reply.code(201);
    return { data: meeting };
  });
  app.get('/meetings/:id', async (req) => {
    const meeting = await meetingAccess(req, id(req));
    const [transcript, minutes, audio, jobs, actionItems] = await Promise.all([
      one('SELECT * FROM transcripts WHERE meeting_id=$1', [meeting.id]),
      one('SELECT * FROM minutes WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1', [meeting.id]),
      one('SELECT id,mime,original_name,bytes FROM media WHERE id=$1 AND deleted_at IS NULL', [
        meeting.audioMediaId,
      ]),
      rows(
        'SELECT id,kind,status,attempts,error,locked_at,updated_at FROM doc_jobs WHERE meeting_id=$1 ORDER BY created_at',
        [meeting.id],
      ),
      rows('SELECT * FROM action_items WHERE meeting_id=$1', [meeting.id]),
    ]);
    return {
      data: {
        meeting,
        transcript: transcript || null,
        minutes: minutes || null,
        audio: audio || null,
        jobs,
        actionItems,
      },
    };
  });
  app.patch('/meetings/:id/minutes', async (req) => {
    const input = z
      .object({ content: minutesSchema, version: z.number().int().positive().optional() })
      .parse(req.body);
    await meetingAccess(req, id(req), true);
    const minutes = await transaction(async (c) => {
      const meeting = await one('SELECT * FROM meetings WHERE id=$1 FOR UPDATE', [id(req)], c);
      if (meeting.status !== 'review') fail(409, 'Only draft minutes awaiting review can be edited.');
      const current = await one(
        'SELECT * FROM minutes WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1',
        [meeting.id],
        c,
      );
      if (input.version !== undefined && input.version !== current.version)
        fail(409, 'Someone updated this draft. Refresh before saving your changes.');
      const transcript = await one('SELECT segments FROM transcripts WHERE meeting_id=$1', [meeting.id], c);
      validateEvidence(input.content, transcript?.segments || []);
      const next = await one(
        'INSERT INTO minutes(meeting_id,version,content,edited_by) VALUES($1,$2,$3,$4) RETURNING *',
        [meeting.id, current.version + 1, JSON.stringify(input.content), req.user.id],
        c,
      );
      await audit(req, 'minutes.edit', 'meeting', meeting.id, { version: next.version }, c);
      return next;
    });
    return { data: minutes };
  });
  app.post('/meetings/:id/approve', async (req) => {
    await meetingAccess(req, id(req), true);
    const result = await transaction(async (c) => {
      const meeting = await one('SELECT * FROM meetings WHERE id=$1 FOR UPDATE', [id(req)], c);
      if (['approved', 'published'].includes(meeting.status)) return meeting;
      if (meeting.status !== 'review') fail(409, 'Minutes must finish drafting before approval.');
      const minutes = await one(
        'SELECT * FROM minutes WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1',
        [meeting.id],
        c,
      );
      const content = minutesSchema.parse(minutes.content),
        transcript = await one('SELECT segments FROM transcripts WHERE meeting_id=$1', [meeting.id], c);
      validateEvidence(content, transcript?.segments || []);
      await c.query('UPDATE minutes SET approved_by=$2,approved_at=now() WHERE id=$1', [
        minutes.id,
        req.user.id,
      ]);
      await c.query(
        "INSERT INTO doc_jobs(meeting_id,kind) VALUES($1,'render') ON CONFLICT(meeting_id,kind) DO UPDATE SET status='queued',error=NULL,locked_by=NULL,locked_at=NULL,attempts=0",
        [meeting.id],
      );
      await audit(req, 'minutes.approve', 'meeting', meeting.id, { version: minutes.version }, c);
      return one(
        "UPDATE meetings SET status='approved',updated_at=now() WHERE id=$1 RETURNING *",
        [meeting.id],
        c,
      );
    });
    io.to(`space:${result.spaceId}`).emit('meeting', result);
    return { data: result };
  });
  app.post('/meetings/:id/retry', async (req) => {
    const meeting = await meetingAccess(req, id(req));
    if (req.user.role !== 'admin' && req.user.id !== meeting.uploaderId)
      fail(403, 'Only the uploader or administrator can retry a meeting.');
    await transaction(async (c) => {
      const m = await one('SELECT * FROM meetings WHERE id=$1 FOR UPDATE', [meeting.id], c);
      if (m.status !== 'failed') fail(409, 'This meeting has not failed.');
      const job = await one(
        "UPDATE doc_jobs SET status='queued',attempts=0,error=NULL,locked_by=NULL,locked_at=NULL,updated_at=now() WHERE meeting_id=$1 AND status='failed' RETURNING *",
        [m.id],
        c,
      );
      if (!job) fail(409, 'No failed job is available to retry.');
      await c.query('UPDATE meetings SET status=$2,updated_at=now() WHERE id=$1', [
        m.id,
        job.kind === 'render' ? 'approved' : job.kind === 'draft' ? 'drafting' : 'uploaded',
      ]);
    });
    return { data: { ok: true } };
  });
  app.get('/action-items', async (req) => ({
    data: await rows(
      "SELECT a.*,m.title AS meeting_title,m.space_id,m.audio_media_id FROM action_items a JOIN meetings m ON m.id=a.meeting_id JOIN spaces s ON s.id=m.space_id WHERE a.owner_user_id=$1 AND m.status='published' AND(s.visibility='open' OR EXISTS(SELECT 1 FROM space_members sm WHERE sm.space_id=s.id AND sm.user_id=$1) OR $2) ORDER BY a.status,a.due_date NULLS LAST,a.created_at DESC",
      [req.user.id, req.user.role === 'admin'],
    ),
  }));
  app.patch('/action-items/:id', async (req) => {
    const input = z.object({ status: z.enum(['open', 'done']) }).parse(req.body);
    const item = await one('SELECT * FROM action_items WHERE id=$1', [id(req)]);
    if (!item) fail(404, 'Action item not found.');
    await meetingAccess(req, item.meetingId);
    if (item.ownerUserId !== req.user.id && req.user.role !== 'admin')
      fail(403, 'Only the assigned owner may update this action.');
    return {
      data: await one('UPDATE action_items SET status=$2,updated_at=now() WHERE id=$1 RETURNING *', [
        item.id,
        input.status,
      ]),
    };
  });
  app.get('/internal/jobs/:id/context', async (req) => {
    const job = await one('SELECT * FROM doc_jobs WHERE id=$1', [id(req)]);
    if (!job) fail(404, 'Job not found.');
    const meeting = await one('SELECT * FROM meetings WHERE id=$1', [job.meetingId]);
    return {
      data: {
        job,
        meeting,
        audio: await one('SELECT * FROM media WHERE id=$1 AND deleted_at IS NULL', [meeting.audioMediaId]),
        transcript: (await one('SELECT * FROM transcripts WHERE meeting_id=$1', [meeting.id])) || null,
        minutes:
          (await one('SELECT * FROM minutes WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1', [
            meeting.id,
          ])) || null,
        users: await rows('SELECT id,display_name,email FROM users WHERE org_id=$1 AND is_active', [
          meeting.orgId,
        ]),
      },
    };
  });
  app.post('/internal/jobs/:id/complete', async (req) => {
    const input = z
      .object({
        lockToken: z.string().min(1),
        transcript: transcriptSchema.optional(),
        durationS: z.number().nonnegative().optional(),
        content: minutesSchema.optional(),
        docx: artifact.optional(),
        markdown: artifact.optional(),
      })
      .parse(req.body);
    const result = await transaction(async (c) => {
      const job = await one('SELECT * FROM doc_jobs WHERE id=$1 FOR UPDATE', [id(req)], c);
      if (!job) fail(404, 'Job not found.');
      const meeting = await one('SELECT * FROM meetings WHERE id=$1 FOR UPDATE', [job.meetingId], c);
      if (job.status === 'done') return meeting;
      if (job.status !== 'running' || job.lockedBy !== input.lockToken)
        fail(409, 'The job lease is no longer current.');
      if (job.kind === 'transcribe') {
        if (!input.transcript) fail(400, 'Transcript is required.');
        if (input.transcript.segments.some((s) => s.end_s < s.start_s))
          fail(422, 'Transcript timestamps are invalid.');
        await c.query(
          'INSERT INTO transcripts(meeting_id,language,segments) VALUES($1,$2,$3) ON CONFLICT(meeting_id) DO UPDATE SET language=$2,segments=$3,updated_at=now()',
          [meeting.id, input.transcript.language, JSON.stringify(input.transcript.segments)],
        );
        await c.query("INSERT INTO doc_jobs(meeting_id,kind) VALUES($1,'draft') ON CONFLICT DO NOTHING", [
          meeting.id,
        ]);
        await c.query("UPDATE meetings SET status='drafting',duration_s=$2,updated_at=now() WHERE id=$1", [
          meeting.id,
          input.durationS ?? null,
        ]);
      } else if (job.kind === 'draft') {
        if (!input.content) fail(400, 'Minutes content is required.');
        const transcript = await one('SELECT segments FROM transcripts WHERE meeting_id=$1', [meeting.id], c);
        validateEvidence(input.content, transcript?.segments || []);
        await c.query(
          'INSERT INTO minutes(meeting_id,version,content) VALUES($1,1,$2) ON CONFLICT(meeting_id,version) DO NOTHING',
          [meeting.id, JSON.stringify(input.content)],
        );
        await c.query("UPDATE meetings SET status='review',updated_at=now() WHERE id=$1", [meeting.id]);
        await notify(
          io,
          meeting.reviewerId,
          'review',
          `Minutes ready to review: ${meeting.title}`,
          `/app/meetings/${meeting.id}`,
          c,
        );
      } else {
        if (!input.docx || !input.markdown) fail(400, 'Both document artifacts are required.');
        const minutes = await one(
          'SELECT * FROM minutes WHERE meeting_id=$1 AND approved_at IS NOT NULL ORDER BY version DESC LIMIT 1',
          [meeting.id],
          c,
        );
        if (!minutes || meeting.status !== 'approved')
          fail(409, 'Meeting must be approved before publication.');
        const docxId = await saveArtifact(
          input.docx,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          `${meeting.title}.docx`,
          meeting,
          c,
        );
        const mdId = await saveArtifact(input.markdown, 'text/markdown', `${meeting.title}.md`, meeting, c);
        await c.query('UPDATE minutes SET docx_media_id=$2,md_media_id=$3 WHERE id=$1', [
          minutes.id,
          docxId,
          mdId,
        ]);
        const content = minutesSchema.parse(minutes.content);
        const users = await rows(
          'SELECT id,display_name,email FROM users WHERE org_id=$1 AND is_active',
          [meeting.orgId],
          c,
        );
        for (const action of content.action_items) {
          const span = action.evidence[0]!;
          await c.query(
            'INSERT INTO action_items(meeting_id,minutes_version,text,owner_user_id,owner_text,due_date,evidence_start_s,evidence_end_s) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [
              meeting.id,
              minutes.version,
              action.text,
              matchOwner(action.owner, users),
              action.owner,
              action.due_date,
              span.start_s,
              span.end_s,
            ],
          );
        }
        const body = `## ${content.title}\n\n${content.summary}\n\n${content.action_items.length ? '### Action items\n' + content.action_items.map((a) => `- [ ] ${a.text}${a.owner ? ` — ${a.owner}` : ''}${a.due_date ? ` · ${a.due_date}` : ''}`).join('\n') : ''}\n\n[View minutes and evidence](/app/meetings/${meeting.id})`;
        const post = await one(
          'INSERT INTO posts(space_id,author_id,body,meeting_id,attachments) VALUES($1,$2,$3,$4,$5) ON CONFLICT(meeting_id) DO UPDATE SET meeting_id=EXCLUDED.meeting_id RETURNING *',
          [meeting.spaceId, meeting.uploaderId, body, meeting.id, JSON.stringify([docxId, mdId])],
          c,
        );
        await c.query(
          "UPDATE meetings SET status='published',published_post_id=$2,updated_at=now() WHERE id=$1",
          [meeting.id, post.id],
        );
        await c.query(
          "INSERT INTO audit_log(org_id,actor_id,action,target_type,target_id,metadata) VALUES($1,$2,'minutes.publish','meeting',$3,$4)",
          [
            meeting.orgId,
            minutes.approvedBy,
            meeting.id,
            JSON.stringify({ version: minutes.version, postId: post.id }),
          ],
        );
      }
      await c.query("UPDATE doc_jobs SET status='done',error=NULL,updated_at=now() WHERE id=$1", [job.id]);
      return one('SELECT * FROM meetings WHERE id=$1', [meeting.id], c);
    });
    io.to(`space:${result.spaceId}`).emit('meeting', result);
    if (result.status === 'published')
      io.to(`space:${result.spaceId}`).emit(
        'post',
        await one(
          'SELECT p.*,u.display_name AS author_name FROM posts p JOIN users u ON u.id=p.author_id WHERE p.id=$1',
          [result.publishedPostId],
        ),
      );
    return { data: result };
  });
  app.post('/internal/jobs/:id/fail', async (req) => {
    const input = z.object({ lockToken: z.string().min(1), error: z.string().max(4000) }).parse(req.body);
    const result = await transaction(async (c) => {
      const job = await one('SELECT * FROM doc_jobs WHERE id=$1 FOR UPDATE', [id(req)], c);
      if (!job) fail(404, 'Job not found.');
      if (job.status === 'done') return { ok: true };
      if (job.status !== 'running' || job.lockedBy !== input.lockToken)
        fail(409, 'The job lease is no longer current.');
      await c.query("UPDATE doc_jobs SET status='failed',error=$2,updated_at=now() WHERE id=$1", [
        job.id,
        input.error,
      ]);
      const meeting = await one(
        "UPDATE meetings SET status='failed',updated_at=now() WHERE id=$1 RETURNING *",
        [job.meetingId],
        c,
      );
      return meeting;
    });
    if (result.spaceId) io.to(`space:${result.spaceId}`).emit('meeting', result);
    return { data: result };
  });
}
async function saveArtifact(
  input: z.infer<typeof artifact>,
  expectedMime: string,
  name: string,
  meeting: any,
  c: Queryable,
) {
  if (input.mime !== expectedMime) fail(422, 'Generated document has an unexpected content type.');
  const bytes = await storage.get(input.storageKey);
  if (bytes.length !== input.bytes || createHash('sha256').update(bytes).digest('hex') !== input.sha256)
    fail(422, 'Generated document checksum does not match.');
  if (expectedMime.includes('wordprocessingml') && (bytes[0] !== 0x50 || bytes[1] !== 0x4b))
    fail(422, 'Generated Word document is not a valid archive.');
  const m = await one(
    'INSERT INTO media(org_id,owner_id,storage_key,original_name,mime,bytes,sha256) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(storage_key) DO UPDATE SET storage_key=EXCLUDED.storage_key RETURNING id',
    [
      meeting.orgId,
      meeting.uploaderId,
      input.storageKey,
      name.replace(/[^a-zA-Z0-9._ -]/g, '_'),
      input.mime,
      input.bytes,
      input.sha256,
    ],
    c,
  );
  return m.id;
}
