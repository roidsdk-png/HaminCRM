import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { contacts, conversations, ingestionEvents, matchAnswers, matchProfiles, messages, sources, testAnswers, testAttempts } from '@/db/schema';
import locations from '@/lib/data/iran-locations.json';

type InputEvent = { eventId: string; type: string; occurredAt: string; payload: Record<string, unknown> };
type AnyRecord = Record<string, unknown>;

export class IngestionProcessingError extends Error {}

export async function authenticateSource(slug: string, key: string) {
  const db = getDb();
  const [source] = await db.select().from(sources).where(and(eq(sources.slug, slug), eq(sources.status, 'active'))).limit(1);
  if (!source?.credentialHash) return null;
  return (await sha256(key)) === source.credentialHash ? source : null;
}

export async function ingest(sourceId: string, event: InputEvent) {
  validateEvent(event);
  const db = getDb(); let eventRowId = crypto.randomUUID();
  const inserted = await db.insert(ingestionEvents).values({ id: eventRowId, sourceId, externalEventId: event.eventId, type: event.type, payload: event.payload, occurredAt: asDate(event.occurredAt) }).onConflictDoNothing().returning({ id: ingestionEvents.id });
  if (!inserted.length) {
    const [saved] = await db.select().from(ingestionEvents).where(and(eq(ingestionEvents.sourceId, sourceId), eq(ingestionEvents.externalEventId, event.eventId))).limit(1);
    if (!saved) throw new Error('Event conflict could not be resolved');
    if (saved.processingStatus === 'processed') return 'duplicate' as const;
    if (saved.type !== event.type || JSON.stringify(saved.payload) !== JSON.stringify(event.payload)) throw new Error('Event ID was previously used for different data');
    eventRowId = saved.id;
    await db.update(ingestionEvents).set({ processingStatus: 'received', processingError: null }).where(eq(ingestionEvents.id, eventRowId));
  }
  try {
    if (event.type === 'message.created') await ingestMessage(sourceId, event, eventRowId);
    else if (event.type === 'test.completed') await ingestTest(sourceId, event);
    else if (event.type === 'test.analysis.updated') await ingestTestAnalysis(sourceId, event);
    else if (event.type === 'matchmaking.profile.completed') await ingestMatchProfile(sourceId, event);
    else if (event.type === 'matchmaking.profile.imported') await ingestImportedMatchProfile(sourceId, event);
    else if (event.type === 'matchmaking.profile.updated') await updateMatchProfile(sourceId, event);
    // Any other event types are durably preserved in ingestionEvents table without failing
    await db.update(ingestionEvents).set({ processingStatus: 'processed', processingError: null }).where(eq(ingestionEvents.id, eventRowId));
    await db.update(sources).set({ lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(sources.id, sourceId));
    return 'processed' as const;
  } catch (error) {
    await db.update(ingestionEvents).set({ processingStatus: 'failed', processingError: error instanceof Error ? error.message : 'Unknown error' }).where(eq(ingestionEvents.id, eventRowId));
    throw new IngestionProcessingError(error instanceof Error ? error.message : 'Event processing failed');
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
  if (event.type === 'matchmaking.profile.completed' || event.type === 'matchmaking.profile.imported') {
    requiredString(p.profileId, 'payload.profileId');
    requiredIdentity(asRecord(p.profile));
    validateAnswers(p.answers);
    if (event.type === 'matchmaking.profile.imported' && typeof p.completed !== 'boolean') throw new Error('payload.completed must be a boolean');
    return;
  }
  if (event.type === 'matchmaking.profile.updated') {
    requiredIdentity(asRecord(p.profile));
    if (typeof p.consent !== 'boolean') throw new Error('payload.consent must be a boolean');
    return;
  }
  // Allow other informational event types with valid payloads
  return;
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

async function ingestMessage(sourceId: string, event: InputEvent, eventRowId: string) {
  const db = getDb(); const p = event.payload; const sessionId = requiredString(p.sessionId, 'payload.sessionId'); const contactId = await resolveContact(sourceId, p);
  const conversationIdentity = and(eq(conversations.sourceId, sourceId), eq(conversations.contactId, contactId), eq(conversations.externalSessionId, sessionId));
  let [conversation] = await db.select().from(conversations).where(conversationIdentity).limit(1);
  if (!conversation) { const id = crypto.randomUUID(); await db.insert(conversations).values({ id, sourceId, contactId, externalSessionId: sessionId, startedAt: asDate(event.occurredAt), lastMessageAt: asDate(event.occurredAt), messageCount: 0 }).onConflictDoNothing(); [conversation] = await db.select().from(conversations).where(conversationIdentity).limit(1); }
  if (!conversation) throw new Error('Conversation could not be resolved');
  const inserted = await db.insert(messages).values({ id: eventRowId, sourceId, conversationId: conversation.id, contactId, externalMessageId: optionalString(p.messageId), role: role(p.role), content: requiredString(p.content, 'payload.content'), model: optionalString(p.model), inputTokens: optionalNumber(p.inputTokens), outputTokens: optionalNumber(p.outputTokens), latencyMs: optionalNumber(p.latencyMs), occurredAt: asDate(event.occurredAt) }).onConflictDoNothing().returning({ id: messages.id });
  if (inserted.length) await db.update(conversations).set({ lastMessageAt: asDate(event.occurredAt), messageCount: sql`${conversations.messageCount} + 1`, updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
}

async function ingestTest(sourceId: string, event: InputEvent) {
  const db = getDb(); const p = event.payload; const contactId = await resolveContact(sourceId, asRecord(p.profile)); const id = crypto.randomUUID();
  await db.insert(testAttempts).values({ id, sourceId, contactId, externalAttemptId: requiredString(p.attemptId, 'payload.attemptId'), testKey: requiredString(p.testKey, 'payload.testKey'), trackingCode: optionalString(p.trackingCode), profile: asRecord(p.profile), scores: numberRecord(p.scores), result: asRecord(p.result), aiAnalysis: optionalString(p.aiAnalysis), startedAt: optionalDate(p.startedAt), completedAt: asDate(event.occurredAt) }).onConflictDoNothing();
  const [attempt] = await db.select({ id: testAttempts.id }).from(testAttempts).where(and(eq(testAttempts.sourceId, sourceId), eq(testAttempts.externalAttemptId, requiredString(p.attemptId, 'payload.attemptId')))).limit(1);
  if (!attempt) throw new Error('Test attempt could not be resolved');
  const answers = Array.isArray(p.answers) ? p.answers : [];
  for (let i = 0; i < answers.length; i++) { const a = asRecord(answers[i]); await db.insert(testAnswers).values({ id: crypto.randomUUID(), attemptId: attempt.id, position: i + 1, questionKey: optionalString(a.questionKey), questionText: requiredString(a.questionText, `answers[${i}].questionText`), answerValue: stringifyValue(a.value), answerLabel: optionalString(a.label), score: optionalNumber(a.score), metadata: asRecord(a.metadata) }).onConflictDoNothing(); }
}

async function ingestTestAnalysis(sourceId: string, event: InputEvent) {
  const db = getDb(); const p = event.payload; const attemptId = requiredString(p.attemptId, 'payload.attemptId');
  const result = await db.update(testAttempts).set({ aiAnalysis: requiredString(p.aiAnalysis, 'payload.aiAnalysis') }).where(and(eq(testAttempts.sourceId, sourceId), eq(testAttempts.externalAttemptId, attemptId))).returning({ id: testAttempts.id });
  if (!result.length) throw new Error('Test attempt not found');
}

async function ingestMatchProfile(sourceId: string, event: InputEvent) {
  const db = getDb(); const p = event.payload; const profile = enrichLocation(asRecord(p.profile)); const contactId = await resolveContact(sourceId, profile); const id = crypto.randomUUID();
  await db.insert(matchProfiles).values({ id, sourceId, contactId, externalProfileId: requiredString(p.profileId, 'payload.profileId'), attemptNumber: optionalNumber(p.attemptNumber) ?? 1, profile, traits: numberRecord(p.traits), archetype: optionalString(p.archetype), consent: p.consent === true, completedAt: asDate(event.occurredAt) }).onConflictDoNothing();
  const [saved] = await db.select({ id: matchProfiles.id }).from(matchProfiles).where(and(eq(matchProfiles.sourceId, sourceId), eq(matchProfiles.externalProfileId, requiredString(p.profileId, 'payload.profileId')), eq(matchProfiles.attemptNumber, optionalNumber(p.attemptNumber) ?? 1))).limit(1);
  if (!saved) throw new Error('Match profile could not be resolved');
  const answers = Array.isArray(p.answers) ? p.answers : [];
  for (let i = 0; i < answers.length; i++) { const a = asRecord(answers[i]); await db.insert(matchAnswers).values({ id: crypto.randomUUID(), profileId: saved.id, position: i + 1, questionText: requiredString(a.questionText, `answers[${i}].questionText`), answerValue: stringifyValue(a.value), answerLabel: optionalString(a.label) }).onConflictDoNothing(); }
}

async function ingestImportedMatchProfile(sourceId: string, event: InputEvent) {
  const db = getDb();
  const p = event.payload;
  const profile = enrichLocation(asRecord(p.profile));
  const profileId = requiredString(p.profileId, 'payload.profileId');
  const participantCode = optionalString(profile.participantCode);
  const contactId = await resolveContact(sourceId, profile);
  const candidates = await db.select().from(matchProfiles).where(and(eq(matchProfiles.sourceId, sourceId), eq(matchProfiles.contactId, contactId))).orderBy(desc(matchProfiles.completedAt), desc(matchProfiles.createdAt));
  const existing = candidates.find((item) => {
    if (item.externalProfileId === profileId) return true;
    const savedCode = optionalString(asRecord(item.profile).participantCode);
    return Boolean(participantCode && savedCode === participantCode);
  });
  const completedAt = p.completed === true ? optionalDate(p.completedAt) ?? asDate(event.occurredAt) : null;
  const createdAt = optionalDate(p.startedAt) ?? asDate(event.occurredAt);
  const lastSeenAt = completedAt ?? createdAt;
  const [savedContact] = await db.select({ firstSeenAt: contacts.firstSeenAt, lastSeenAt: contacts.lastSeenAt }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (savedContact) await db.update(contacts).set({
    firstSeenAt: new Date(Math.min(savedContact.firstSeenAt.getTime(), createdAt.getTime())),
    lastSeenAt: new Date(Math.max(savedContact.lastSeenAt.getTime(), lastSeenAt.getTime())),
  }).where(eq(contacts.id, contactId));
  let id = existing?.id;

  if (existing) {
    await db.update(matchProfiles).set({
      profile: { ...asRecord(existing.profile), ...profile },
      traits: numberRecord(p.traits),
      archetype: optionalString(p.archetype),
      consent: p.consent === true,
      completedAt,
    }).where(eq(matchProfiles.id, existing.id));
  } else {
    id = crypto.randomUUID();
    await db.insert(matchProfiles).values({
      id,
      sourceId,
      contactId,
      externalProfileId: profileId,
      attemptNumber: optionalNumber(p.attemptNumber) ?? 1,
      profile,
      traits: numberRecord(p.traits),
      archetype: optionalString(p.archetype),
      consent: p.consent === true,
      completedAt,
      createdAt,
    });
  }

  if (!id) throw new Error('Imported matchmaking profile could not be resolved');
  const answers = Array.isArray(p.answers) ? p.answers : [];
  // Historical imports are full snapshots. Clear any older answer rows first so
  // a reset/incomplete source profile cannot retain stale CRM-only answers.
  await db.delete(matchAnswers).where(eq(matchAnswers.profileId, id));
  for (let i = 0; i < answers.length; i++) {
    const answer = asRecord(answers[i]);
    const values = {
      questionText: requiredString(answer.questionText, `answers[${i}].questionText`),
      answerValue: stringifyValue(answer.value),
      answerLabel: optionalString(answer.label),
    };
    await db.insert(matchAnswers).values({ id: crypto.randomUUID(), profileId: id, position: i + 1, ...values }).onConflictDoUpdate({
      target: [matchAnswers.profileId, matchAnswers.position],
      set: values,
    });
  }
}

async function updateMatchProfile(sourceId: string, event: InputEvent) {
  const db = getDb(); const p = event.payload; const profile = enrichLocation(asRecord(p.profile)); const contactId = await resolveContact(sourceId, profile);
  const [latest] = await db.select().from(matchProfiles).where(and(eq(matchProfiles.sourceId, sourceId), eq(matchProfiles.contactId, contactId))).orderBy(desc(matchProfiles.completedAt), desc(matchProfiles.createdAt)).limit(1);
  // Some users created their profile before CRM integration. Their first event
  // can therefore be a consent/profile update with no imported profile row.
  // The raw event and contact data are already stored; accept it instead of
  // marking a valid legacy-user event as failed. A later completed event will
  // create the full profile normally.
  if (!latest) return;
  await db.update(matchProfiles).set({ profile: { ...latest.profile, ...profile }, consent: p.consent === true }).where(eq(matchProfiles.id, latest.id));
}

const uniqueCityProvince = (() => {
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const province of locations) {
    for (const city of province.cities) {
      const key = normalizeLocation(city);
      if (map.has(key) && map.get(key) !== province.name) ambiguous.add(key);
      else map.set(key, province.name);
    }
  }
  for (const key of ambiguous) map.delete(key);
  return map;
})();

function enrichLocation(profile: AnyRecord) {
  if (optionalString(profile.province)) return profile;
  const city = optionalString(profile.city);
  if (!city) return profile;
  const province = uniqueCityProvince.get(normalizeLocation(city));
  return province ? { ...profile, province } : profile;
}

function normalizeLocation(value: string) {
  return value.trim().replaceAll('ي', 'ی').replaceAll('ك', 'ک').replace(/\s+/g, ' ');
}

async function resolveContact(sourceId: string, p: AnyRecord) {
  const db = getDb(); const external = optionalString(p.userId) ?? optionalString(p.externalUserId); const anonymous = optionalString(p.anonymousId); const ipHash = optionalString(p.ipHash); const phone = optionalString(p.phone); let found;
  // Web chatbots can reuse a cookie/session across different visitors. When an
  // IP hash is supplied it is therefore the primary anonymous identity.
  if (ipHash) [found] = await db.select().from(contacts).where(and(eq(contacts.sourceId, sourceId), eq(contacts.ipHash, ipHash))).limit(1);
  if (!found && external) [found] = await db.select().from(contacts).where(and(eq(contacts.sourceId, sourceId), eq(contacts.externalUserId, external))).limit(1);
  if (!found && anonymous) [found] = await db.select().from(contacts).where(and(eq(contacts.sourceId, sourceId), eq(contacts.anonymousId, anonymous))).limit(1);
  if (!found && phone) [found] = await db.select().from(contacts).where(and(eq(contacts.sourceId, sourceId), eq(contacts.phone, phone))).limit(1);
  if (found) { await db.update(contacts).set({ externalUserId: found.externalUserId ?? external, anonymousId: found.anonymousId ?? anonymous, ipHash: found.ipHash ?? ipHash, lastSeenAt: new Date(), name: optionalString(p.name) ?? found.name, phone: phone ?? found.phone, province: optionalString(p.province) ?? found.province, city: optionalString(p.city) ?? found.city, gender: optionalString(p.gender) ?? found.gender, age: optionalNumber(p.age) ?? found.age, education: optionalString(p.education) ?? found.education, updatedAt: new Date() }).where(eq(contacts.id, found.id)); return found.id; }
  const id = crypto.randomUUID(); await db.insert(contacts).values({ id, sourceId, externalUserId: external, anonymousId: anonymous, ipHash, name: optionalString(p.name), phone, province: optionalString(p.province), city: optionalString(p.city), gender: optionalString(p.gender), age: optionalNumber(p.age), education: optionalString(p.education), metadata: asRecord(p.metadata) }).onConflictDoNothing();
  if (ipHash) { const [saved] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.sourceId, sourceId), eq(contacts.ipHash, ipHash))).limit(1); if (saved) return saved.id; }
  return id;
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
