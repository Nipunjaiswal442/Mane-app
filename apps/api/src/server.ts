import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { Server } from 'socket.io';
import { ZodError } from 'zod';
import { authRoutes } from './auth.js';
import { chatRoutes } from './chat.js';
import { mediaRoutes } from './media.js';
import { meetingRoutes } from './meetings.js';
import { adminRoutes } from './admin.js';
import { sessionUser, spaceAccess, threadAccess } from './context.js';
import { fail, safeEqual, uuid } from './security.js';
import { pool } from './db/client.js';
export async function buildApp(options: { logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 2 * 1024 * 1024, trustProxy: false });
  const origins = (process.env.CSRF_ORIGIN || process.env.WEB_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim());
  await app.register(cookie);
  await app.register(cors, {
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-csrf-token'],
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 8 } });
  app.decorateRequest('user', null);
  app.decorateRequest('session', null);
  const io = new Server(app.server, {
    cors: { origin: origins, credentials: true },
    maxHttpBufferSize: 16384,
  });
  const publicPaths = new Set([
    '/health',
    '/auth/status',
    '/auth/setup',
    '/auth/login',
    '/auth/oidc/start',
    '/auth/oidc/callback',
  ]);
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'same-origin')
      .header('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return;
    const path = req.url.split('?')[0]!;
    if (path.startsWith('/internal/')) {
      const configured = process.env.WORKER_TOKEN || '';
      const supplied = String(req.headers['x-worker-token'] || '');
      if (configured.length < 32) fail(503, 'Worker authentication is not configured.');
      if (!safeEqual(configured, supplied)) fail(401, 'Worker authentication failed.');
      return;
    }
    const mutating = !['GET', 'HEAD'].includes(req.method);
    if (mutating && req.headers.origin && !origins.includes(req.headers.origin))
      fail(403, 'Request origin is not allowed.');
    if (publicPaths.has(path)) return;
    const auth = await sessionUser(req.cookies.mane_session);
    if (!auth) fail(401, 'Please sign in to continue.');
    req.user = auth.user;
    req.session = auth.session;
    if (mutating && !safeEqual(String(req.headers['x-csrf-token'] || ''), auth.session.csrfToken))
      fail(403, 'Your security token is missing or expired. Refresh and try again.');
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(422).send({
        error: error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '),
      });
    if ((error as { code?: string }).code === '23505')
      return reply.code(409).send({ error: 'This record already exists.' });
    const known = error as { statusCode?: number; message: string };
    const status = known.statusCode && known.statusCode >= 400 ? known.statusCode : 500;
    if (status >= 500) req.log.error({ err: error }, 'Request failed');
    return reply.code(status).send({
      error: status >= 500 ? 'The service could not complete this request. Please try again.' : known.message,
    });
  });
  app.get('/health', async (req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', service: 'mane-api', database: 'connected' };
    } catch {
      return reply.code(503).send({ status: 'degraded', service: 'mane-api', database: 'unavailable' });
    }
  });
  const context = { app, io };
  authRoutes(context);
  chatRoutes(context);
  mediaRoutes(context);
  meetingRoutes(context);
  adminRoutes(context);
  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && !origins.includes(origin)) throw new Error('Origin not allowed');
      const auth = await sessionUser(app.parseCookie(socket.handshake.headers.cookie || '').mane_session);
      if (!auth || !safeEqual(String(socket.handshake.auth?.csrfToken || ''), auth.session.csrfToken))
        throw new Error('Authentication required');
      socket.data.auth = auth;
      next();
    } catch {
      next(new Error('Authentication required'));
    }
  });
  io.on('connection', async (socket) => {
    const { user, session } = socket.data.auth;
    socket.join(`user:${user.id}`);
    socket.join(`session:${session.id}`);
    const expiry = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, new Date(session.expiresAt).getTime() - Date.now()),
    );
    expiry.unref();
    socket.on('disconnect', () => clearTimeout(expiry));
    let lastTyping = 0;
    socket.on('subscribe', async (payload, ack) => {
      try {
        const auth = await sessionUser(app.parseCookie(socket.handshake.headers.cookie || '').mane_session);
        if (!auth) throw new Error('Session expired');
        const req = { user: auth.user } as any;
        if (payload?.spaceId) {
          const spaceId = uuid.parse(payload.spaceId);
          await spaceAccess(req, spaceId);
          await socket.join(`space:${spaceId}`);
        }
        if (payload?.threadId) {
          const threadId = uuid.parse(payload.threadId);
          await threadAccess(req, threadId);
          await socket.join(`thread:${threadId}`);
        }
        if (typeof ack === 'function') ack({ ok: true });
      } catch {
        if (typeof ack === 'function') ack({ error: 'Access denied' });
      }
    });
    socket.on('typing', async (payload) => {
      try {
        if (Date.now() - lastTyping < 1000) return;
        lastTyping = Date.now();
        const threadId = uuid.parse(payload?.threadId);
        const fresh = await sessionUser(app.parseCookie(socket.handshake.headers.cookie || '').mane_session);
        if (!fresh) {
          socket.disconnect(true);
          return;
        }
        await threadAccess({ user: fresh.user } as any, threadId);
        socket
          .to(`thread:${threadId}`)
          .emit('typing', { threadId, userId: user.id, displayName: user.displayName });
      } catch {
        /* Unauthorized room requests reveal no state. */
      }
    });
  });
  app.addHook('onClose', async () => {
    io.disconnectSockets(true);
    io.close();
  });
  return app;
}
