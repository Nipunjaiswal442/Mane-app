import { randomUUID, createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { storage } from './adapters/storage.js';
import { one, transaction } from './db/client.js';
import { id, fail } from './security.js';
import type { Context } from './context.js';
const allowed = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'video/mp4',
  'video/webm',
  'audio/webm',
]);
export function mediaRoutes({ app }: Context) {
  app.post('/media', async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 8 } });
    if (!file) fail(400, 'Choose a file to upload.');
    let buffer = await file.toBuffer();
    if (file.file.truncated) fail(413, 'Files must be smaller than 100 MB.');
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !allowed.has(detected.mime))
      fail(415, 'This file type is not supported. Upload an image or meeting audio.');
    let mime = detected.mime,
      width: number | null = null,
      height: number | null = null;
    if (mime.startsWith('image/')) {
      const resized = await sharp(buffer, { limitInputPixels: 40000000 })
        .rotate()
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      buffer = resized.data;
      width = resized.info.width;
      height = resized.info.height;
      mime = 'image/webp';
    }
    const key = `${mime.startsWith('image/') ? 'media' : 'audio'}/${randomUUID()}.${mime === 'image/webp' ? 'webp' : detected.ext}`;
    let wrote = false;
    try {
      const result = await transaction(async (c) => {
        await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
        const org = await one('SELECT settings FROM orgs WHERE id=$1', [req.user.orgId], c);
        const used = await one(
          'SELECT COALESCE(sum(bytes),0)::bigint bytes FROM media WHERE owner_id=$1 AND deleted_at IS NULL',
          [req.user.id],
          c,
        );
        const quota = Number(org.settings.userQuotaBytes || 104857600);
        if (Number(used.bytes) + buffer.length > quota)
          fail(
            413,
            `Your storage quota of ${Math.round(quota / 1048576)} MB would be exceeded. Ask your administrator for more space.`,
          );
        await storage.put(key, buffer, mime);
        wrote = true;
        return one(
          'INSERT INTO media(org_id,owner_id,storage_key,original_name,mime,bytes,width,height,sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
          [
            req.user.orgId,
            req.user.id,
            key,
            file.filename.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 150),
            mime,
            buffer.length,
            width,
            height,
            createHash('sha256').update(buffer).digest('hex'),
          ],
          c,
        );
      });
      reply.code(201);
      return { data: result };
    } catch (error) {
      if (wrote) await storage.delete(key).catch(() => {});
      throw error;
    }
  });
  app.get('/media/:id', async (req, reply) => {
    const media = await one('SELECT * FROM media WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL', [
      id(req),
      req.user.orgId,
    ]);
    if (!media) fail(404, 'File not found.');
    if (media.ownerId !== req.user.id) {
      const permission = await one(
        `WITH allowed_spaces AS(SELECT s.id FROM spaces s WHERE s.org_id=$2 AND(s.visibility='open' OR $3 OR EXISTS(SELECT 1 FROM space_members sm WHERE sm.space_id=s.id AND sm.user_id=$1))) SELECT 1 WHERE
   EXISTS(SELECT 1 FROM posts p WHERE p.deleted_at IS NULL AND p.space_id IN(SELECT id FROM allowed_spaces) AND p.attachments ? $4)
   OR EXISTS(SELECT 1 FROM meetings m WHERE m.space_id IN(SELECT id FROM allowed_spaces) AND m.audio_media_id=$4::uuid)
   OR EXISTS(SELECT 1 FROM minutes n JOIN meetings m ON m.id=n.meeting_id WHERE m.space_id IN(SELECT id FROM allowed_spaces) AND(n.docx_media_id=$4::uuid OR n.md_media_id=$4::uuid))
   OR EXISTS(SELECT 1 FROM messages m JOIN dm_participants dp ON dp.thread_id=m.thread_id WHERE dp.user_id=$1 AND m.media_id=$4::uuid)`,
        [req.user.id, req.user.orgId, req.user.role === 'admin', media.id],
      );
      if (!permission) fail(404, 'File not found.');
    }
    const buffer = await storage
      .get(media.storageKey)
      .catch(() => fail(404, 'This file is no longer available.'));
    reply
      .header('Content-Type', media.mime)
      .header('Content-Disposition', `attachment; filename="${media.originalName.replace(/["\r\n]/g, '_')}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=3600')
      .header('Accept-Ranges', 'bytes');
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) {
        reply.header('Content-Range', `bytes */${buffer.length}`);
        return reply.code(416).send();
      }
      const start = Number(match[1]),
        end = match[2] ? Math.min(Number(match[2]), buffer.length - 1) : buffer.length - 1;
      if (start > end || start >= buffer.length) {
        reply.header('Content-Range', `bytes */${buffer.length}`);
        return reply.code(416).send();
      }
      return reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${buffer.length}`)
        .send(buffer.subarray(start, end + 1));
    }
    return reply.send(buffer);
  });
}
