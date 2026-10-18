import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
};

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(), slug: text('slug').notNull(), name: text('name').notNull(),
  kind: text('kind', { enum: ['chatbot', 'test', 'matchmaking'] }).notNull(),
  platform: text('platform', { enum: ['bale', 'eitaa', 'telegram', 'web'] }).notNull(),
  status: text('status', { enum: ['pending', 'active', 'paused'] }).notNull().default('pending'),
  credentialHash: text('credential_hash'), lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }), ...timestamps,
}, (t) => [uniqueIndex('uq_sources_slug').on(t.slug)]);

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(), sourceId: text('source_id').notNull().references(() => sources.id),
  externalUserId: text('external_user_id'), anonymousId: text('anonymous_id'), ipHash: text('ip_hash'),
  name: text('name'), phone: text('phone'), province: text('province'), city: text('city'), gender: text('gender'), age: integer('age'), education: text('education'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()), ...timestamps,
}, (t) => [index('idx_contacts_source_external').on(t.sourceId, t.externalUserId), index('idx_contacts_source_anonymous').on(t.sourceId, t.anonymousId), uniqueIndex('uq_contacts_source_ip').on(t.sourceId, t.ipHash), index('idx_contacts_phone').on(t.phone)]);

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(), sourceId: text('source_id').notNull().references(() => sources.id), contactId: text('contact_id').references(() => contacts.id),
  externalSessionId: text('external_session_id').notNull(), startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  lastMessageAt: integer('last_message_at', { mode: 'timestamp' }).notNull(), messageCount: integer('message_count').notNull().default(0), ...timestamps,
}, (t) => [uniqueIndex('uq_conversations_source_contact_session').on(t.sourceId, t.contactId, t.externalSessionId), index('idx_conversations_last_message').on(t.lastMessageAt)]);

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(), sourceId: text('source_id').notNull().references(() => sources.id), conversationId: text('conversation_id').notNull().references(() => conversations.id),
  contactId: text('contact_id').references(() => contacts.id), externalMessageId: text('external_message_id'), role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(), model: text('model'), inputTokens: integer('input_tokens'), outputTokens: integer('output_tokens'), latencyMs: integer('latency_ms'),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(), createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => [index('idx_messages_conversation_time').on(t.conversationId, t.occurredAt), index('idx_messages_source_role_time').on(t.sourceId, t.role, t.occurredAt)]);

export const testAttempts = sqliteTable('test_attempts', {
  id: text('id').primaryKey(), sourceId: text('source_id').notNull().references(() => sources.id), contactId: text('contact_id').references(() => contacts.id),
  externalAttemptId: text('external_attempt_id').notNull(), testKey: text('test_key').notNull(), trackingCode: text('tracking_code'),
  profile: text('profile', { mode: 'json' }).$type<Record<string, unknown>>(), scores: text('scores', { mode: 'json' }).$type<Record<string, number>>(),
  result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(), aiAnalysis: text('ai_analysis'),
  startedAt: integer('started_at', { mode: 'timestamp' }), completedAt: integer('completed_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => [uniqueIndex('uq_test_attempts_source_external').on(t.sourceId, t.externalAttemptId), index('idx_test_attempts_key_completed').on(t.testKey, t.completedAt)]);

export const testAnswers = sqliteTable('test_answers', {
  id: text('id').primaryKey(), attemptId: text('attempt_id').notNull().references(() => testAttempts.id), position: integer('position').notNull(),
  questionKey: text('question_key'), questionText: text('question_text').notNull(), answerValue: text('answer_value'), answerLabel: text('answer_label'), score: integer('score'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(), createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => [uniqueIndex('uq_test_answers_attempt_position').on(t.attemptId, t.position)]);

export const matchProfiles = sqliteTable('match_profiles', {
  id: text('id').primaryKey(), sourceId: text('source_id').notNull().references(() => sources.id), contactId: text('contact_id').references(() => contacts.id),
  externalProfileId: text('external_profile_id').notNull(), attemptNumber: integer('attempt_number').notNull().default(1),
  profile: text('profile', { mode: 'json' }).$type<Record<string, unknown>>().notNull(), traits: text('traits', { mode: 'json' }).$type<Record<string, number>>(),
  archetype: text('archetype'), consent: integer('consent', { mode: 'boolean' }).notNull().default(false), completedAt: integer('completed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => [uniqueIndex('uq_match_profiles_source_external_attempt').on(t.sourceId, t.externalProfileId, t.attemptNumber)]);

export const matchAnswers = sqliteTable('match_answers', {
  id: text('id').primaryKey(), profileId: text('profile_id').notNull().references(() => matchProfiles.id), position: integer('position').notNull(),
  questionText: text('question_text').notNull(), answerValue: text('answer_value'), answerLabel: text('answer_label'), createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => [uniqueIndex('uq_match_answers_profile_position').on(t.profileId, t.position)]);

export const ingestionEvents = sqliteTable('ingestion_events', {
  id: text('id').primaryKey(), sourceId: text('source_id').notNull().references(() => sources.id), externalEventId: text('external_event_id').notNull(), type: text('type').notNull(),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(), occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
  receivedAt: integer('received_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()), processingStatus: text('processing_status', { enum: ['received', 'processed', 'failed'] }).notNull().default('received'), processingError: text('processing_error'),
}, (t) => [uniqueIndex('uq_ingestion_events_source_external').on(t.sourceId, t.externalEventId), index('idx_ingestion_events_status_received').on(t.processingStatus, t.receivedAt)]);

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(), adminUserId: text('admin_user_id').notNull(), adminEmail: text('admin_email'),
  action: text('action').notNull(), entityType: text('entity_type').notNull(), entityId: text('entity_id'),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => [index('idx_audit_logs_created').on(t.createdAt), index('idx_audit_logs_admin_created').on(t.adminUserId, t.createdAt)]);

export const administrators = sqliteTable('administrators', {
  id: text('id').primaryKey(), userId: text('user_id').notNull(), email: text('email').notNull(),
  role: text('role', { enum: ['owner', 'manager', 'viewer'] }).notNull(), active: integer('active', { mode: 'boolean' }).notNull().default(true),
  passwordHash: text('password_hash'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()), updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),
}, (t) => [uniqueIndex('uq_administrators_user').on(t.userId), uniqueIndex('uq_administrators_email').on(t.email)]);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(), value: text('value', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  updatedBy: text('updated_by'), updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export type Source = typeof sources.$inferSelect;
