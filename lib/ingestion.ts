import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { contacts, conversations, ingestionEvents, matchAnswers, matchProfiles, messages, sources, testAnswers, testAttempts } from '@/db/schema';

type InputEvent = { eventId: string; type: string; occurredAt: string; payload: Record<string, unknown> };
type AnyRecord = Record<string, unknown>;

export async function authenticateSource(slug: string, key: string) {
  const db = getDb();
  const [source] = await db.select().from(sources).where(and(eq(sources.slug, slug), eq(sources.status, 'active'))).limit(1);
  if (!source?.credentialHash) return null;
  return (await sha256(key)) === source.credentialHash ? source : null;
}

export async function ingest(sourceId: string, event: InputEvent) {
  validateEvent(event);
  const db = getDb(); const eventRowId = crypto.randomUUID();
  const inserted = await db.insert(ingestionEvents).values({ id: eventRowId, sourceId, externalEventId: event.eventId, type: event.type, payload: event.payload, occurredAt: asDate(event.occurredAt) }).onConflictDoNothing().returning({ id: ingestionEvents.id });
  if (!inserted.length) return 'duplicate' as const;
  try {
    if (event.type === 'message.created') await ingestMessage(sourceId, event);
    else if (event.type === 'test.completed') await ingestTest(sourceId, event);
    else if (event.type === 'test.analysis.updated') await ingestTestAnalysis(sourceId, event);
    else if (event.type === 'matchmaking.profile.completed') await ingestMatchProfile(sourceId, event);
    else if (event.type === 'matchmaking.profile.updated') await updateMatchProfile(sourceId, event);
    else throw new Error(`Unsupported event type: ${event.type}`);
    await db.update(ingestionEvents).set({ processingStatus: 'processed' }).where(eq(ingestionEvents.id, eventRowId));
    await db.update(sources).set({ lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(sources.id, sourceId));
    return 'processed' as const;
  } catch (error) {
    await db.update(ingestionEvents).set({ processingStatus: 'failed', processingError: error instanceof Error ? error.message : 'Unknown error' }).where(eq(ingestionEvents.id, eventRowId));
    throw error;
  }
}

function validateEvent(event: InputEvent) {
  asDate(event.occurredAt);
  const p = event.payload;
  if (event.type === 'message.created') {
    requiredString(p.sessionId, 'payload.sessionId');
    requiredIdentity(p);
    role(p.role);
    requiredString(p.content, 'payload.content');
    return;
  }
  if (event.type === 'test.completed') {
    requiredString(p.attemptId, 'payload.attemptId');
    requiredString(p.testKey, 'payload.testKey');
    requiredIdentity(asRecord(p.profile));
    validateAnswers(p.answers);
    return;
  }
  if (event.type === 'test.analysis.updated') {
    requiredString(p.attemptId, 'payload.attemptId');
    requiredString(p.aiAnalysis, 'payload.aiAnalysis');
    return;
  }
  if (event.type === 'matchmaking.profile.completed') {
    requiredString(p.profileId, 'payload.profileId');
    requiredIdentity(asRecord(p.profile));
    validateAnswers(p.answers);
    return;
  }
  if (event.type === 'matchmaking.profile.updated') {
    requiredIdentity(asRecord(p.profile));
    if (typeof p.consent !== 'boolean') throw new Error('payload.consent must be a boolean');
    return;
  }
  throw new Error(`Unsupported event type: ${event.type}`);
}

function requiredIdentity(p: AnyRecord) {
  if (!optionalString(p.userId) && !optionalString(p.externalUserId) && !optionalString(p.anonymousId) && !optionalString(p.ipHash) && !optionalString(p.phone)) {
    throw new Error('A userId, externalUserId, anonymousId, ipHash, or phone is required');
  }
}

function validateAnswers(value: unknown) {
  if (!Array.isArray(value)) throw new Error('payload.answers must be an array');
  for (let i = 0; i < value.length; i++) requiredString(asRecord(value[i]).questionText, `answers[${i}].questionText`);
}

async function ingestMessage(sourceId: string, event: InputEvent) {
  const db = getDb(); const p = event.payload; const sessionId = requiredString(p.sessionId, 'payload.sessionId'); const contactId = await resolveContact(sourceId, p);
  let [conversation] = await db.select().from(conversations).where(and(eq(conversations.sourceId, sourceId), eq(conversations.externalSessionId, sessionId))).limit(1);
  if (!conversation) { const id = crypto.randomUUID(); await db.insert(conversations).values({ id, sourceId, contactId, externalSessionId: sessionId, startedAt: asDate(event.occurredAt), lastMessageAt: asDate(event.occurredAt), messageCount: 0 }); [conversation] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1); }
  await db.insert(messages).values({ id: crypto.randomUUID(), sourceId, conversationId: conversation.id, contactId, externalMessageId: optionalString(p.messageId), role: role(p.role), content: requiredString(p.content, 'payload.content'), model: optionalString(p.model), inputTokens: optionalNumber(p.inputTokens), outputTokens: optionalNumber(p.outputTokens), latencyMs: optionalNumber(p.latencyMs), occurredAt: asDate(event.occurredAt) });
  await db.update(conversations).set({ lastMessageAt: asDate(event.occurredAt), messageCount: sql`${conversations.messageCount} + 1`, updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
}

async function ingestTest(sourceId: string, event: InputEvent) {
  const db = getDb(); const p = event.payload; const contactId = await resolveContact(sourceId, asRecord(p.profile)); const id = crypto.randomUUID();
  await db.insert(testAttempts).values({ id, sourceId, contactId, externalAttemptId: requiredString(p.attemptId, 'payload.attemptId'), testKey: requiredString(p.testKey, 'payload.testKey'), trackingCode: optionalString(p.trackingCode), profile: asRecord(p.profile), scores: numberRecord(p.scores), result: asRecord(p.result), aiAnalysis: optionalString(p.aiAnalysis), startedAt: optionalDate(p.startedAt), completedAt: asDate(event.occurredAt) });
  const answers = Array.isArray(p.answers) ? p.answers : [];
  for (let i = 0; i < answers.length; i++) { const a = asRecord(answers[i]); await db.insert(testAnswers).values({ id: crypto.randomUUID(), attemptId: id, position: i + 1, questionKey: optionalString(a.questionKey), questionText: requiredString(a.questionText, `answers[${i}].questionText`), answerValue: stringifyValue(a.value), answerLabel: optionalString(a.label), score: optionalNumber(a.score), metadata: asRecord(a.metadata) }); }
}

async function ingestTestAnalysis(sourceId: string, event: InputEvent) {
  const db = getDb(); const p = event.payload; const attemptId = requiredString(p.attemptId, 'payload.attemptId');
  const result = await db.update(testAttempts).set({ aiAnalysis: requiredString(p.aiAnalysis, 'payload.aiAnalysis') }).where(and(eq(testAttempts.sourceId, sourceId), eq(testAttempts.externalAttemptId, attemptId))).returning({ id: testAttempts.id });
  if (!result.length) throw new Error('Test attempt not found');
}

async function ingestMatchProfile(sourceId: string, event: InputEvent) {
  const db = getDb(); const p = event.payload; const profile = asRecord(p.profile); const contactId = await resolveContact(sourceId, profile); const id = crypto.randomUUID();
  await db.insert(matchProfiles).values({ id, sourceId, contactId, externalProfileId: requiredString(p.profileId, 'payload.profileId'), attemptNumber: optionalNumber(p.attemptNumber) ?? 1, profile, traits: numberRecord(p.traits), archetype: optionalString(p.archetype), consent: p.consent === true, completedAt: asDate(event.occurredAt) });
  const answers = Array.isArray(p.answers) ? p.answers : [];
  for (let i = 0; i < answers.length; i++) { const a = asRecord(answers[i]); await db.insert(matchAnswers).values({ id: crypto.randomUUID(), profileId: id, position: i + 1, questionText: requiredString(a.questionText, `answers[${i}].questionText`), answerValue: stringifyValue(a.value), answerLabel: optionalString(a.label) }); }
}

async function updateMatchProfile(sourceId: string, event: InputEvent) {
  const db = getDb(); const p = event.payload; const profile = asRecord(p.profile); const contactId = await resolveContact(sourceId, profile);
  const [latest] = await db.select().from(matchProfiles).where(and(eq(matchProfiles.sourceId, sourceId), eq(matchProfiles.contactId, contactId))).orderBy(desc(matchProfiles.completedAt), desc(matchProfiles.createdAt)).limit(1);
  if (!latest) throw new Error('Matchmaking profile not found');
  await db.update(matchProfiles).set({ profile: { ...latest.profile, ...profile }, consent: p.consent === true }).where(eq(matchProfiles.id, latest.id));
}

async function resolveContact(sourceId: string, p: AnyRecord) {
  const db = getDb(); const external = optionalString(p.userId) ?? optionalString(p.externalUserId); const anonymous = optionalString(p.anonymousId); const ipHash = optionalString(p.ipHash); const phone = optionalString(p.phone); let found;
  if (external) [found] = await db.select().from(contacts).where(and(eq(contacts.sourceId, sourceId), eq(contacts.externalUserId, external))).limit(1);
  if (!found && anonymous) [found] = await db.select().from(contacts).where(and(eq(contacts.sourceId, sourceId), eq(contacts.anonymousId, anonymous))).limit(1);
  if (!found && phone) [found] = await db.select().from(contacts).where(and(eq(contacts.sourceId, sourceId), eq(contacts.phone, phone))).limit(1);
  if (!found && ipHash) [found] = await db.select().from(contacts).where(and(eq(contacts.sourceId, sourceId), eq(contacts.ipHash, ipHash))).limit(1);
  if (found) { await db.update(contacts).set({ externalUserId: found.externalUserId ?? external, anonymousId: found.anonymousId ?? anonymous, ipHash: found.ipHash ?? ipHash, lastSeenAt: new Date(), name: optionalString(p.name) ?? found.name, phone: phone ?? found.phone, province: optionalString(p.province) ?? found.province, city: optionalString(p.city) ?? found.city, gender: optionalString(p.gender) ?? found.gender, age: optionalNumber(p.age) ?? found.age, education: optionalString(p.education) ?? found.education, updatedAt: new Date() }).where(eq(contacts.id, found.id)); return found.id; }
  const id = crypto.randomUUID(); await db.insert(contacts).values({ id, sourceId, externalUserId: external, anonymousId: anonymous, ipHash, name: optionalString(p.name), phone, province: optionalString(p.province), city: optionalString(p.city), gender: optionalString(p.gender), age: optionalNumber(p.age), education: optionalString(p.education), metadata: asRecord(p.metadata) }); return id;
}

export async function sha256(value: string) { const bytes = new TextEncoder().encode(value); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function asRecord(value: unknown): AnyRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {}; }
function requiredString(value: unknown, path: string) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} is required`); return value.trim(); }
function optionalString(value: unknown) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function optionalNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null; }
function optionalDate(value: unknown) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value) : null; }
function asDate(value: unknown) { const result = optionalDate(value); if (!result) throw new Error('occurredAt must be an ISO date'); return result; }
function numberRecord(value: unknown) { const record = asRecord(value); return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))); }
function stringifyValue(value: unknown) { return value === undefined || value === null ? null : typeof value === 'string' ? value : JSON.stringify(value); }
function role(value: unknown): 'user' | 'assistant' | 'system' { if (value === 'user' || value === 'assistant' || value === 'system') return value; throw new Error('payload.role is invalid'); }
