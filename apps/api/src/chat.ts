import { z } from 'zod';
import { one, rows, transaction } from './db/client.js';
import { spaceAccess, spaceOwner, threadAccess, audit, notify, type Context } from './context.js';
import { id, uuid, fail, slugify, bodySchema } from './security.js';
import type { FastifyRequest } from 'fastify';
const authorSelect =
  "p.*,u.display_name AS author_name,u.avatar_media_id AS author_avatar,(SELECT count(*)::int FROM comments c WHERE c.post_id=p.id AND c.deleted_at IS NULL) AS comment_count,COALESCE((SELECT jsonb_agg(r) FROM (SELECT emoji,count(*)::int AS count,bool_or(user_id=$2) AS mine FROM reactions WHERE target_type='post' AND target_id=p.id GROUP BY emoji) r),'[]') AS reactions";
async function postAccess(req: FastifyRequest, postId: string, write = false) {
  const post = await one('SELECT * FROM posts WHERE id=$1 AND deleted_at IS NULL', [postId]);
  if (!post) fail(404, 'Post not found.');
  await spaceAccess(req, post.spaceId, write);
  return post;
}
export function chatRoutes({ app, io }: Context) {
  app.get('/spaces', async (req) => ({
    data: await rows(
      "SELECT s.*,sm.role AS membership_role,(SELECT count(*)::int FROM space_members WHERE space_id=s.id) AS member_count FROM spaces s LEFT JOIN space_members sm ON sm.space_id=s.id AND sm.user_id=$1 WHERE s.org_id=$2 AND (s.visibility='open' OR sm.id IS NOT NULL OR $3) ORDER BY s.created_at",
      [req.user.id, req.user.orgId, req.user.role === 'admin'],
    ),
  }));
  app.post('/spaces', async (req, reply) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().max(500).default(''),
        visibility: z.enum(['open', 'private']).default('open'),
      })
      .parse(req.body);
    const result = await transaction(async (c) => {
      const s = await one(
        'INSERT INTO spaces(org_id,name,slug,description,visibility,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [
          req.user.orgId,
          input.name,
          `${slugify(input.name)}-${crypto.randomUUID().slice(0, 6)}`,
          input.description,
          input.visibility,
          req.user.id,
        ],
        c,
      );
      await c.query("INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,'owner')", [
        s.id,
        req.user.id,
      ]);
      await audit(req, 'space.create', 'space', s.id, {}, c);
      return s;
    });
    io.to(`user:${req.user.id}`).emit('space', result);
    reply.code(201);
    return { data: result };
  });
  app.get('/spaces/:id', async (req) => ({ data: await spaceAccess(req, id(req)) }));
  app.patch('/spaces/:id', async (req) => {
    await spaceOwner(req, id(req));
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().max(500),
        visibility: z.enum(['open', 'private']),
      })
      .parse(req.body);
    const result = await one(
      'UPDATE spaces SET name=$2,description=$3,visibility=$4,updated_at=now() WHERE id=$1 RETURNING *',
      [id(req), input.name, input.description, input.visibility],
    );
    if (input.visibility === 'private') io.in(`space:${id(req)}`).socketsLeave(`space:${id(req)}`);
    await audit(req, 'space.update', 'space', id(req));
    return { data: result };
  });
  app.post('/spaces/:id/join', async (req) => {
    const space = await spaceAccess(req, id(req));
    if (space.visibility !== 'open') fail(403, 'Private spaces require an invitation from an owner.');
    await one(
      'INSERT INTO space_members(space_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',
      [space.id, req.user.id],
    );
    return { data: { ok: true } };
  });
  app.get('/spaces/:id/members', async (req) => {
    await spaceAccess(req, id(req));
    return {
      data: await rows(
        'SELECT u.id,u.display_name,u.email,sm.role FROM space_members sm JOIN users u ON u.id=sm.user_id WHERE sm.space_id=$1 AND u.is_active ORDER BY u.display_name',
        [id(req)],
      ),
    };
  });
  app.post('/spaces/:id/members', async (req) => {
    await spaceOwner(req, id(req));
    const input = z
      .object({ userId: uuid, role: z.enum(['owner', 'member']).default('member') })
      .parse(req.body);
    if (
      !(await one('SELECT id FROM users WHERE id=$1 AND org_id=$2 AND is_active', [
        input.userId,
        req.user.orgId,
      ]))
    )
      fail(404, 'User not found.');
    const result = await transaction(async (c) => {
      await c.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [id(req)]);
      const current = await one(
        'SELECT role FROM space_members WHERE space_id=$1 AND user_id=$2',
        [id(req), input.userId],
        c,
      );
      if (
        current?.role === 'owner' &&
        input.role === 'member' &&
        (
          await one(
            "SELECT count(*)::int count FROM space_members WHERE space_id=$1 AND role='owner'",
            [id(req)],
            c,
          )
        ).count <= 1
      )
        fail(409, 'A space must retain at least one owner.');
      return one(
        'INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(space_id,user_id) DO UPDATE SET role=$3 RETURNING *',
        [id(req), input.userId, input.role],
        c,
      );
    });
    await audit(req, 'space.member.add', 'space', id(req), { userId: input.userId });
    return { data: result };
  });
  app.delete('/spaces/:id/members/:userId', async (req) => {
    const spaceId = id(req),
      userId = id(req, 'userId');
    await spaceOwner(req, spaceId);
    await transaction(async (c) => {
      await c.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [spaceId]);
      const target = await one(
        'SELECT * FROM space_members WHERE space_id=$1 AND user_id=$2',
        [spaceId, userId],
        c,
      );
      if (
        target?.role === 'owner' &&
        (
          await one(
            "SELECT count(*)::int count FROM space_members WHERE space_id=$1 AND role='owner'",
            [spaceId],
            c,
          )
        ).count <= 1
      )
        fail(409, 'A space must retain at least one owner.');
      await c.query('DELETE FROM space_members WHERE space_id=$1 AND user_id=$2', [spaceId, userId]);
    });
    io.in(`user:${userId}`).socketsLeave(`space:${spaceId}`);
    return { data: { ok: true } };
  });
  app.get('/spaces/:id/posts', async (req) => {
    await spaceAccess(req, id(req));
    const query = z
      .object({
        before: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(40),
      })
      .parse(req.query);
    return {
      data: await rows(
        `SELECT ${authorSelect} FROM posts p JOIN users u ON u.id=p.author_id WHERE p.space_id=$1 AND p.deleted_at IS NULL AND ($3::timestamptz IS NULL OR p.created_at<$3) ORDER BY p.pinned DESC,p.created_at DESC LIMIT $4`,
        [id(req), req.user.id, query.before || null, query.limit],
      ),
    };
  });
  app.post('/spaces/:id/posts', async (req, reply) => {
    await spaceAccess(req, id(req), true);
    const input = bodySchema.extend({ attachments: z.array(uuid).max(10).default([]) }).parse(req.body);
    for (const mediaId of input.attachments)
      if (
        !(await one('SELECT id FROM media WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL', [
          mediaId,
          req.user.id,
        ]))
      )
        fail(400, 'One of the attachments is unavailable.');
    const post = await one(
      'INSERT INTO posts(space_id,author_id,body,attachments) VALUES($1,$2,$3,$4) RETURNING *',
      [id(req), req.user.id, input.body, JSON.stringify(input.attachments)],
    );
    post.authorName = req.user.displayName;
    post.reactions = [];
    post.commentCount = 0;
    io.to(`space:${id(req)}`).emit('post', post);
    await mentions(req, input.body, id(req), `/app/spaces/${id(req)}`, io);
    reply.code(201);
    return { data: post };
  });
  app.patch('/posts/:id', async (req) => {
    const post = await postAccess(req, id(req), true);
    const input = z
      .object({ body: z.string().trim().min(1).max(20000).optional(), pinned: z.boolean().optional() })
      .parse(req.body);
    if (input.body !== undefined && post.authorId !== req.user.id && req.user.role !== 'admin')
      fail(403, 'You can only edit your own posts.');
    if (input.pinned !== undefined) await spaceOwner(req, post.spaceId);
    const result = await one(
      'UPDATE posts SET body=COALESCE($2,body),pinned=COALESCE($3,pinned),updated_at=now() WHERE id=$1 RETURNING *',
      [post.id, input.body ?? null, input.pinned ?? null],
    );
    io.to(`space:${post.spaceId}`).emit('post.updated', result);
    return { data: result };
  });
  app.delete('/posts/:id', async (req) => {
    const post = await postAccess(req, id(req), true);
    if (post.authorId !== req.user.id) await spaceOwner(req, post.spaceId);
    await one('UPDATE posts SET deleted_at=now() WHERE id=$1 RETURNING id', [post.id]);
    io.to(`space:${post.spaceId}`).emit('post.deleted', { id: post.id });
    return { data: { ok: true } };
  });
  app.get('/posts/:id/comments', async (req) => {
    await postAccess(req, id(req));
    return {
      data: await rows(
        'SELECT c.*,u.display_name AS author_name FROM comments c JOIN users u ON u.id=c.author_id WHERE c.post_id=$1 AND c.deleted_at IS NULL ORDER BY c.created_at',
        [id(req)],
      ),
    };
  });
  app.post('/posts/:id/comments', async (req, reply) => {
    const post = await postAccess(req, id(req), true),
      input = bodySchema.parse(req.body);
    const comment = await one('INSERT INTO comments(post_id,author_id,body) VALUES($1,$2,$3) RETURNING *', [
      post.id,
      req.user.id,
      input.body,
    ]);
    comment.authorName = req.user.displayName;
    io.to(`space:${post.spaceId}`).emit('comment', comment);
    if (post.authorId !== req.user.id)
      await notify(
        io,
        post.authorId,
        'reply',
        `${req.user.displayName} replied to your post`,
        `/app/spaces/${post.spaceId}`,
      );
    await mentions(req, input.body, post.spaceId, `/app/spaces/${post.spaceId}`, io);
    reply.code(201);
    return { data: comment };
  });
  app.post('/reactions', async (req) => {
    const input = z
      .object({
        targetType: z.enum(['post', 'comment', 'message']),
        targetId: uuid,
        emoji: z.enum(['👍', '❤️', '🎉', '👀', '✅', '💡']),
      })
      .parse(req.body);
    let room: string;
    if (input.targetType === 'post') {
      const p = await postAccess(req, input.targetId, true);
      room = `space:${p.spaceId}`;
    } else if (input.targetType === 'comment') {
      const c = await one('SELECT * FROM comments WHERE id=$1 AND deleted_at IS NULL', [input.targetId]);
      if (!c) fail(404, 'Comment not found.');
      const p = await postAccess(req, c.postId, true);
      room = `space:${p.spaceId}`;
    } else {
      const m = await one('SELECT * FROM messages WHERE id=$1', [input.targetId]);
      if (!m) fail(404, 'Message not found.');
      await threadAccess(req, m.threadId);
      room = `thread:${m.threadId}`;
    }
    const removed = await one(
      'DELETE FROM reactions WHERE target_type=$1 AND target_id=$2 AND user_id=$3 AND emoji=$4 RETURNING id',
      [input.targetType, input.targetId, req.user.id, input.emoji],
    );
    if (!removed)
      await one(
        'INSERT INTO reactions(target_type,target_id,user_id,emoji) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',
        [input.targetType, input.targetId, req.user.id, input.emoji],
      );
    io.to(room).emit('reaction', { ...input, userId: req.user.id, active: !removed });
    return { data: { active: !removed } };
  });
  app.get('/dm/threads', async (req) => ({
    data: await rows(
      "SELECT t.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'displayName',u.display_name)) FROM dm_participants dp JOIN users u ON u.id=dp.user_id WHERE dp.thread_id=t.id),'[]') AS participants,(SELECT body FROM messages WHERE thread_id=t.id ORDER BY created_at DESC LIMIT 1) AS last_message,(SELECT count(*)::int FROM messages WHERE thread_id=t.id AND sender_id<>$1 AND created_at>COALESCE(p.last_read_at,'epoch')) AS unread_count FROM dm_threads t JOIN dm_participants p ON p.thread_id=t.id WHERE p.user_id=$1 ORDER BY t.updated_at DESC",
      [req.user.id],
    ),
  }));
  app.post('/dm/threads', async (req, reply) => {
    const input = z.object({ userIds: z.array(uuid).min(1).max(9) }).parse(req.body),
      ids = [...new Set([req.user.id, ...input.userIds])];
    if (ids.length < 2) fail(400, 'Choose at least one other person.');
    const result = await transaction(async (c) => {
      const count = await one(
        'SELECT count(*)::int count FROM users WHERE id=ANY($1::uuid[]) AND org_id=$2 AND is_active',
        [ids, req.user.orgId],
        c,
      );
      if (count.count !== ids.length) fail(400, 'One or more people are unavailable.');
      const thread = await one('INSERT INTO dm_threads(org_id) VALUES($1) RETURNING *', [req.user.orgId], c);
      for (const userId of ids)
        await c.query('INSERT INTO dm_participants(thread_id,user_id) VALUES($1,$2)', [thread.id, userId]);
      return thread;
    });
    reply.code(201);
    return { data: result };
  });
  app.get('/dm/threads/:id/messages', async (req) => {
    await threadAccess(req, id(req));
    return {
      data: await rows(
        'SELECT m.*,u.display_name AS sender_name,(SELECT count(*)::int FROM message_reads WHERE message_id=m.id AND user_id<>m.sender_id) AS read_count FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.thread_id=$1 ORDER BY m.created_at DESC LIMIT 100',
        [id(req)],
      ),
    };
  });
  app.post('/dm/threads/:id/messages', async (req, reply) => {
    await threadAccess(req, id(req));
    const input = bodySchema.extend({ mediaId: uuid.optional() }).parse(req.body);
    if (
      input.mediaId &&
      !(await one('SELECT id FROM media WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL', [
        input.mediaId,
        req.user.id,
      ]))
    )
      fail(400, 'Attachment unavailable.');
    const msg = await one(
      'INSERT INTO messages(thread_id,sender_id,body,media_id) VALUES($1,$2,$3,$4) RETURNING *',
      [id(req), req.user.id, input.body, input.mediaId || null],
    );
    msg.senderName = req.user.displayName;
    await one('UPDATE dm_threads SET updated_at=now() WHERE id=$1 RETURNING id', [id(req)]);
    io.to(`thread:${id(req)}`).emit('message', msg);
    for (const p of await rows('SELECT user_id FROM dm_participants WHERE thread_id=$1 AND user_id<>$2', [
      id(req),
      req.user.id,
    ]))
      await notify(
        io,
        p.userId,
        'dm',
        `${req.user.displayName} sent you a message`,
        `/app/messages?thread=${id(req)}`,
      );
    reply.code(201);
    return { data: msg };
  });
  app.post('/dm/threads/:id/read', async (req) => {
    await threadAccess(req, id(req));
    await transaction(async (c) => {
      await c.query('UPDATE dm_participants SET last_read_at=now() WHERE thread_id=$1 AND user_id=$2', [
        id(req),
        req.user.id,
      ]);
      await c.query(
        'INSERT INTO message_reads(message_id,user_id) SELECT id,$2 FROM messages WHERE thread_id=$1 ON CONFLICT DO NOTHING',
        [id(req), req.user.id],
      );
    });
    io.to(`thread:${id(req)}`).emit('read', { threadId: id(req), userId: req.user.id });
    return { data: { ok: true } };
  });
  app.get('/notifications', async (req) => ({
    data: await rows('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [
      req.user.id,
    ]),
  }));
  app.post('/notifications/read', async (req) => {
    const input = z.object({ id: uuid.optional() }).parse(req.body || {});
    await one(
      'UPDATE notifications SET read_at=now() WHERE user_id=$1 AND ($2::uuid IS NULL OR id=$2) RETURNING id',
      [req.user.id, input.id || null],
    );
    return { data: { ok: true } };
  });
  app.get('/search', async (req) => {
    const input = z.object({ q: z.string().trim().min(1).max(200) }).parse(req.query);
    return {
      data: await rows(
        `WITH allowed_spaces AS (SELECT s.id FROM spaces s WHERE s.org_id=$2 AND (s.visibility='open' OR $3 OR EXISTS(SELECT 1 FROM space_members sm WHERE sm.space_id=s.id AND sm.user_id=$1))) SELECT * FROM (
 SELECT p.id,'post' AS type,p.body AS text,p.space_id::text AS parent_id,p.created_at FROM posts p WHERE p.deleted_at IS NULL AND p.space_id IN(SELECT id FROM allowed_spaces) AND to_tsvector('simple',p.body) @@ plainto_tsquery('simple',$4)
 UNION ALL SELECT c.id,'comment',c.body,p.space_id::text,c.created_at FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.deleted_at IS NULL AND p.deleted_at IS NULL AND p.space_id IN(SELECT id FROM allowed_spaces) AND to_tsvector('simple',c.body) @@ plainto_tsquery('simple',$4)
 UNION ALL SELECT m.id,'message',m.body,m.thread_id::text,m.created_at FROM messages m JOIN dm_participants dp ON dp.thread_id=m.thread_id WHERE dp.user_id=$1 AND to_tsvector('simple',m.body) @@ plainto_tsquery('simple',$4)
 UNION ALL SELECT t.id,'transcript',left(t.text,500),m.id::text,t.created_at FROM transcripts t JOIN meetings m ON m.id=t.meeting_id WHERE m.space_id IN(SELECT id FROM allowed_spaces) AND to_tsvector('simple',t.text) @@ plainto_tsquery('simple',$4)
 UNION ALL SELECT n.id,'minutes',n.content->>'summary',m.id::text,n.created_at FROM minutes n JOIN meetings m ON m.id=n.meeting_id WHERE m.space_id IN(SELECT id FROM allowed_spaces) AND to_tsvector('simple',n.content->>'summary') @@ plainto_tsquery('simple',$4)
 ) results ORDER BY created_at DESC LIMIT 50`,
        [req.user.id, req.user.orgId, req.user.role === 'admin', input.q],
      ),
    };
  });
}
async function mentions(req: FastifyRequest, body: string, spaceId: string, href: string, io: Context['io']) {
  const ids = [...body.matchAll(/@\[([^\]]+)\]\(([a-f0-9-]{36})\)/g)].map((m) => m[2]);
  for (const userId of new Set(ids)) {
    if (userId === req.user.id) continue;
    const member = await one(
      'SELECT u.id FROM users u JOIN space_members sm ON sm.user_id=u.id WHERE u.id=$1 AND sm.space_id=$2 AND u.is_active',
      [userId, spaceId],
    );
    if (member) await notify(io, userId!, 'mention', `${req.user.displayName} mentioned you`, href);
  }
}
