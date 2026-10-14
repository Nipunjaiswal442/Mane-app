import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
const base = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
export const orgs = pgTable('orgs', {
  ...base(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  settings: jsonb('settings').notNull().default({}),
});
export const users = pgTable('users', {
  ...base(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarMediaId: uuid('avatar_media_id'),
  role: text('role').notNull().default('member'),
  passwordHash: text('password_hash'),
  oidcSubject: text('oidc_subject').unique(),
  isActive: boolean('is_active').notNull().default(true),
});
export const sessions = pgTable('sessions', {
  ...base(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  csrfToken: text('csrf_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const spaces = pgTable('spaces', {
  ...base(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description').notNull().default(''),
  visibility: text('visibility').notNull().default('open'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
});
export const spaceMembers = pgTable(
  'space_members',
  {
    ...base(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role').notNull().default('member'),
  },
  (t) => [uniqueIndex('space_members_unique').on(t.spaceId, t.userId)],
);
export const posts = pgTable('posts', {
  ...base(),
  spaceId: uuid('space_id')
    .notNull()
    .references(() => spaces.id),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  body: text('body').notNull(),
  pinned: boolean('pinned').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  meetingId: uuid('meeting_id'),
  attachments: jsonb('attachments').notNull().default([]),
});
export const comments = pgTable('comments', {
  ...base(),
  postId: uuid('post_id')
    .notNull()
    .references(() => posts.id),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  body: text('body').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
export const reactions = pgTable(
  'reactions',
  {
    ...base(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    emoji: text('emoji').notNull(),
  },
  (t) => [uniqueIndex('reactions_unique').on(t.targetType, t.targetId, t.userId, t.emoji)],
);
export const dmThreads = pgTable('dm_threads', {
  ...base(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id),
});
export const dmParticipants = pgTable(
  'dm_participants',
  {
    ...base(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => dmThreads.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('dm_participants_unique').on(t.threadId, t.userId)],
);
export const messages = pgTable('messages', {
  ...base(),
  threadId: uuid('thread_id')
    .notNull()
    .references(() => dmThreads.id),
  senderId: uuid('sender_id')
    .notNull()
    .references(() => users.id),
  body: text('body').notNull(),
  mediaId: uuid('media_id'),
});
export const messageReads = pgTable(
  'message_reads',
  {
    ...base(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('message_reads_unique').on(t.messageId, t.userId)],
);
export const media = pgTable('media', {
  ...base(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  storageKey: text('storage_key').notNull().unique(),
  originalName: text('original_name').notNull(),
  mime: text('mime').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  width: integer('width'),
  height: integer('height'),
  sha256: text('sha256').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
export const meetings = pgTable('meetings', {
  ...base(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => orgs.id),
  spaceId: uuid('space_id')
    .notNull()
    .references(() => spaces.id),
  uploaderId: uuid('uploader_id')
    .notNull()
    .references(() => users.id),
  reviewerId: uuid('reviewer_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  heldAt: timestamp('held_at', { withTimezone: true }),
  languageHint: text('language_hint'),
  status: text('status').notNull().default('uploaded'),
  audioMediaId: uuid('audio_media_id').references(() => media.id),
  durationS: integer('duration_s'),
  publishedPostId: uuid('published_post_id').references(() => posts.id),
});
export const docJobs = pgTable('doc_jobs', {
  ...base(),
  meetingId: uuid('meeting_id')
    .notNull()
    .references(() => meetings.id),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: text('locked_by'),
});
export const transcripts = pgTable('transcripts', {
  ...base(),
  meetingId: uuid('meeting_id')
    .notNull()
    .unique()
    .references(() => meetings.id),
  language: text('language').notNull(),
  segments: jsonb('segments').notNull(),
  text: text('text').notNull(),
});
export const minutes = pgTable(
  'minutes',
  {
    ...base(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id),
    version: integer('version').notNull(),
    content: jsonb('content').notNull(),
    editedBy: uuid('edited_by').references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    docxMediaId: uuid('docx_media_id').references(() => media.id),
    mdMediaId: uuid('md_media_id').references(() => media.id),
  },
  (t) => [uniqueIndex('minutes_version_unique').on(t.meetingId, t.version)],
);
export const actionItems = pgTable('action_items', {
  ...base(),
  meetingId: uuid('meeting_id')
    .notNull()
    .references(() => meetings.id),
  minutesVersion: integer('minutes_version').notNull(),
  text: text('text').notNull(),
  ownerUserId: uuid('owner_user_id').references(() => users.id),
  ownerText: text('owner_text'),
  dueDate: text('due_date'),
  evidenceStartS: integer('evidence_start_s'),
  evidenceEndS: integer('evidence_end_s'),
  status: text('status').notNull().default('open'),
});
export const licenses = pgTable('licenses', {
  ...base(),
  raw: text('raw').notNull(),
  parsed: jsonb('parsed').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
});
export const auditLog = pgTable('audit_log', {
  ...base(),
  orgId: uuid('org_id').references(() => orgs.id),
  actorId: uuid('actor_id').references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: uuid('target_id'),
  metadata: jsonb('metadata').notNull().default({}),
  ip: text('ip'),
});
export const notifications = pgTable('notifications', {
  ...base(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  href: text('href').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
});
