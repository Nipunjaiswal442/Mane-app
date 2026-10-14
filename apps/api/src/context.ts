import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Server } from 'socket.io';
import { readFile } from 'node:fs/promises';
import { verifyLicense, evaluationStatus } from '@mane/license';
import { one, rows, pool, type Queryable } from './db/client.js';
import { fail, hashToken, publicUser } from './security.js';
declare module 'fastify' {
  interface FastifyRequest {
    user: any;
    session: any;
  }
}
export type Context = { app: FastifyInstance; io: Server };
export async function audit(
  req: FastifyRequest,
  action: string,
  targetType?: string,
  targetId?: string,
  metadata = {},
  client: Queryable = pool,
) {
  await client.query(
    'INSERT INTO audit_log(org_id,actor_id,action,target_type,target_id,metadata,ip) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      req.user?.orgId || null,
      req.user?.id || null,
      action,
      targetType || null,
      targetId || null,
      JSON.stringify(metadata),
      req.ip,
    ],
  );
}
export function admin(req: FastifyRequest) {
  if (req.user?.role !== 'admin') fail(403, 'Organisation administrator access is required.');
}
export async function spaceAccess(
  req: FastifyRequest,
  spaceId: string,
  write = false,
  client: Queryable = pool,
) {
  const space = await one(
    'SELECT s.*,sm.role AS membership_role FROM spaces s LEFT JOIN space_members sm ON sm.space_id=s.id AND sm.user_id=$2 WHERE s.id=$1 AND s.org_id=$3',
    [spaceId, req.user.id, req.user.orgId],
    client,
  );
  if (
    !space ||
    (req.user.role !== 'admin' && (space.visibility === 'private' || write) && !space.membershipRole)
  )
    fail(404, 'Space not found or membership required.');
  return space;
}
export async function spaceOwner(req: FastifyRequest, spaceId: string, client: Queryable = pool) {
  const space = await spaceAccess(req, spaceId, true, client);
  if (req.user.role !== 'admin' && space.membershipRole !== 'owner')
    fail(403, 'Space owner access is required.');
  return space;
}
export async function threadAccess(req: FastifyRequest, threadId: string, client: Queryable = pool) {
  const thread = await one(
    'SELECT t.* FROM dm_threads t JOIN dm_participants p ON p.thread_id=t.id WHERE t.id=$1 AND p.user_id=$2 AND t.org_id=$3',
    [threadId, req.user.id, req.user.orgId],
    client,
  );
  if (!thread) fail(404, 'Conversation not found.');
  return thread;
}
export async function meetingAccess(
  req: FastifyRequest,
  meetingId: string,
  review = false,
  client: Queryable = pool,
) {
  const meeting = await one(
    'SELECT * FROM meetings WHERE id=$1 AND org_id=$2',
    [meetingId, req.user.orgId],
    client,
  );
  if (!meeting) fail(404, 'Meeting not found.');
  await spaceAccess(req, meeting.spaceId, false, client);
  if (review && req.user.role !== 'admin' && meeting.reviewerId !== req.user.id)
    fail(403, 'Only the assigned reviewer can edit or approve these minutes.');
  return meeting;
}
export async function notify(
  io: Server,
  userId: string,
  kind: string,
  title: string,
  href: string,
  client: Queryable = pool,
) {
  const notification = await one(
    'INSERT INTO notifications(user_id,kind,title,href) VALUES($1,$2,$3,$4) RETURNING *',
    [userId, kind, title, href],
    client,
  );
  io.to(`user:${userId}`).emit('notification', notification);
}
export async function licenseState(client: Queryable = pool) {
  const org = await one('SELECT * FROM orgs LIMIT 1', [], client);
  const count = await one('SELECT count(*)::int AS count FROM users WHERE is_active', [], client);
  const current = await one('SELECT * FROM licenses LIMIT 1', [], client);
  if (!current)
    return org
      ? evaluationStatus(new Date(org.createdAt), count.count)
      : { mode: 'evaluation', seatBand: 25, activeSeats: 0, expired: false, updatesAvailable: true };
  try {
    const parsed = verifyLicense(current.raw, await licenseKey());
    return { mode: 'licensed', seatBand: parsed.seat_band, activeSeats: count.count, ...parsed };
  } catch {
    return {
      mode: 'invalid',
      seatBand: 0,
      activeSeats: count.count,
      updatesAvailable: false,
      error: 'Stored license verification failed. Install a valid signed license.',
    };
  }
}
export async function licenseKey() {
  if (process.env.LICENSE_PUBLIC_KEY) return process.env.LICENSE_PUBLIC_KEY.replaceAll('\\n', '\n');
  if (process.env.LICENSE_PUBLIC_KEY_PATH) return readFile(process.env.LICENSE_PUBLIC_KEY_PATH, 'utf8');
  throw new Error('License public key is not configured.');
}
export async function sessionUser(raw: string | undefined) {
  if (!raw) return;
  const session = await one('SELECT * FROM sessions WHERE token_hash=$1 AND expires_at>now()', [
    hashToken(raw),
  ]);
  if (!session) return;
  const user = await one('SELECT * FROM users WHERE id=$1 AND is_active', [session.userId]);
  return user ? { user: publicUser(user), session } : undefined;
}
