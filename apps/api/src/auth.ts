import argon2 from 'argon2';
import { z } from 'zod';
import * as oidc from 'openid-client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { audit, licenseState, type Context } from './context.js';
import { one, rows, transaction } from './db/client.js';
import { fail, hashToken, publicUser, slugify, token } from './security.js';
import { localEndpoint } from './adapters/storage.js';
const credentials = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(12).max(256),
});
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
  maxAge: 7 * 86400,
};
export async function signIn(user: any, reply: FastifyReply) {
  const raw = token(),
    csrfToken = token();
  await one(
    "INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '7 days') RETURNING id",
    [user.id, hashToken(raw), csrfToken],
  );
  reply.setCookie('mane_session', raw, cookieOptions);
  return {
    data: {
      user: publicUser(user),
      org: await one('SELECT * FROM orgs WHERE id=$1', [user.orgId]),
      csrfToken,
      license: await licenseState(),
    },
  };
}
export function authRoutes({ app, io }: Context) {
  app.get('/auth/status', async () => ({
    data: {
      setupRequired: !(await one('SELECT id FROM orgs LIMIT 1')),
      authProvider: process.env.AUTH_PROVIDER || 'local',
    },
  }));
  app.post(
    '/auth/setup',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (process.env.AUTH_PROVIDER === 'oidc')
        fail(
          400,
          'For OIDC first run, provision the organisation with the local setup mode, then enable OIDC.',
        );
      const input = credentials
        .extend({
          orgName: z.string().trim().min(2).max(100),
          displayName: z.string().trim().min(1).max(100),
        })
        .parse(req.body);
      const passwordHash = await argon2.hash(input.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      const user = await transaction(async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(72619692)');
        if (await one('SELECT id FROM orgs LIMIT 1', [], c))
          fail(409, 'This organisation is already configured.');
        const org = await one(
          'INSERT INTO orgs(name,slug) VALUES($1,$2) RETURNING *',
          [input.orgName, slugify(input.orgName)],
          c,
        );
        const u = await one(
          "INSERT INTO users(org_id,email,display_name,role,password_hash) VALUES($1,$2,$3,'admin',$4) RETURNING *",
          [org.id, input.email, input.displayName, passwordHash],
          c,
        );
        const space = await one(
          "INSERT INTO spaces(org_id,name,slug,description,created_by) VALUES($1,'General','general','A shared space for your organisation.',$2) RETURNING id",
          [org.id, u.id],
          c,
        );
        await c.query("INSERT INTO space_members(space_id,user_id,role) VALUES($1,$2,'owner')", [
          space.id,
          u.id,
        ]);
        req.user = publicUser(u);
        await audit(req, 'org.setup', 'org', org.id, {}, c);
        return u;
      });
      return signIn(user, reply);
    },
  );
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (process.env.AUTH_PROVIDER === 'oidc') fail(400, 'This appliance uses organisation single sign-on.');
      const input = z
        .object({
          email: z
            .string()
            .email()
            .transform((s) => s.toLowerCase()),
          password: z.string().max(256),
        })
        .parse(req.body);
      const user = await one('SELECT * FROM users WHERE email=$1 AND is_active', [input.email]);
      // A fixed valid hash performs the same expensive verification for unknown accounts.
      const hash = user?.passwordHash || (await dummyPasswordHash);
      const ok = await argon2.verify(hash, input.password).catch(() => false);
      if (!user || !user.passwordHash || !ok) fail(401, 'Email or password is incorrect.');
      req.user = publicUser(user);
      await audit(req, 'auth.login', 'user', user.id);
      return signIn(user, reply);
    },
  );
  app.get('/auth/me', async (req) => ({
    data: {
      user: req.user,
      org: await one('SELECT * FROM orgs WHERE id=$1', [req.user.orgId]),
      csrfToken: req.session.csrfToken,
      license: await licenseState(),
    },
  }));
  app.post('/auth/logout', async (req, reply) => {
    await one('DELETE FROM sessions WHERE id=$1 RETURNING id', [req.session.id]);
    io.in(`session:${req.session.id}`).disconnectSockets(true);
    reply.clearCookie('mane_session', { path: '/' });
    return { data: { ok: true } };
  });
  app.get('/users', async (req) => ({
    data: await rows(
      'SELECT id,display_name,email,role,avatar_media_id FROM users WHERE org_id=$1 AND is_active ORDER BY display_name',
      [req.user.orgId],
    ),
  }));
  app.get('/auth/oidc/start', async (req, reply) => {
    const config = await oidcConfiguration();
    const verifier = oidc.randomPKCECodeVerifier(),
      state = oidc.randomState();
    oidcAttempts.set(state, { verifier, expires: Date.now() + 600000 });
    reply.setCookie('mane_oidc_state', state, { ...cookieOptions, maxAge: 600 });
    for (const [state, attempt] of oidcAttempts) if (attempt.expires < Date.now()) oidcAttempts.delete(state);
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: oidcRedirect(),
      scope: 'openid email profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
    });
    localEndpoint(url.toString(), (process.env.INTERNAL_HOSTS || '').split(','));
    return reply.redirect(url.toString());
  });
  app.get('/auth/oidc/callback', async (req, reply) => {
    const query = z.object({ state: z.string(), code: z.string() }).parse(req.query);
    const attempt = oidcAttempts.get(query.state);
    oidcAttempts.delete(query.state);
    if (!attempt || attempt.expires < Date.now() || req.cookies.mane_oidc_state !== query.state)
      fail(400, 'Single sign-on session expired. Please start again.');
    const config = await oidcConfiguration();
    const tokens = await oidc.authorizationCodeGrant(config, new URL(req.url, oidcRedirect()), {
      pkceCodeVerifier: attempt.verifier,
      expectedState: query.state,
    });
    const claims = tokens.claims();
    if (!claims?.sub || typeof claims.email !== 'string' || claims.email_verified !== true)
      fail(403, 'A verified organisation email is required.');
    const user = await one('SELECT * FROM users WHERE email=$1 AND is_active', [claims.email.toLowerCase()]);
    if (!user) fail(403, 'An administrator must invite this account before single sign-on can be used.');
    if (user.oidcSubject && user.oidcSubject !== claims.sub)
      fail(403, 'Identity does not match this account.');
    await one('UPDATE users SET oidc_subject=$2 WHERE id=$1 RETURNING id', [user.id, claims.sub]);
    req.user = publicUser(user);
    await audit(req, 'auth.login.oidc', 'user', user.id);
    await signIn(user, reply);
    reply.clearCookie('mane_oidc_state', { path: '/' });
    return reply.redirect(`${process.env.WEB_ORIGIN || 'http://localhost:3000'}/app`);
  });
}
const dummyPasswordHash = argon2.hash('Mane constant-time nonexistent account password', {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});
const oidcAttempts = new Map<string, { verifier: string; expires: number }>();
function oidcRedirect() {
  return process.env.OIDC_REDIRECT_URI || 'http://localhost:4000/auth/oidc/callback';
}
let oidcConfig: oidc.Configuration | undefined;
async function oidcConfiguration() {
  if (process.env.AUTH_PROVIDER !== 'oidc') fail(404, 'Single sign-on is not configured.');
  if (oidcConfig) return oidcConfig;
  const issuer = localEndpoint(
    process.env.OIDC_ISSUER || 'http://localhost:8080',
    (process.env.INTERNAL_HOSTS || '').split(','),
  );
  oidcConfig = await oidc.discovery(
    issuer,
    process.env.OIDC_CLIENT_ID || 'mane',
    process.env.OIDC_CLIENT_SECRET,
    undefined,
    {
      execute: issuer.protocol === 'http:' ? [oidc.allowInsecureRequests] : [],
      [oidc.customFetch]: async (url, options) => {
        localEndpoint(url.toString(), (process.env.INTERNAL_HOSTS || '').split(','));
        return fetch(url, { ...options, redirect: 'error' } as RequestInit);
      },
    },
  );
  return oidcConfig;
}
