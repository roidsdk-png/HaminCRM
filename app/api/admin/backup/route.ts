import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { auditLogs, contacts, conversations, ingestionEvents, matchAnswers, matchProfiles, messages, sources, testAnswers, testAttempts } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import { can, getAdminRole } from '@/lib/admin-access';

export async function GET() {
  const user = await getChatGPTUser(); const role = await getAdminRole(user);
  if (!can(role, 'manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const db = getDb();
  const [sourceRows, contactRows, conversationRows, messageRows, attemptRows, answerRows, profileRows, matchAnswerRows, eventRows, auditRows] = await Promise.all([
    db.select({ id: sources.id, slug: sources.slug, name: sources.name, kind: sources.kind, platform: sources.platform, status: sources.status, lastSeenAt: sources.lastSeenAt }).from(sources),
    db.select().from(contacts), db.select().from(conversations), db.select().from(messages), db.select().from(testAttempts), db.select().from(testAnswers), db.select().from(matchProfiles), db.select().from(matchAnswers), db.select().from(ingestionEvents), db.select().from(auditLogs),
  ]);
  await writeAudit(user, 'backup.downloaded', 'database', undefined, { messages: messageRows.length, contacts: contactRows.length });
  const backup = { format: 'hamin-crm-backup', version: 1, createdAt: new Date().toISOString(), tables: { sources: sourceRows, contacts: contactRows, conversations: conversationRows, messages: messageRows, testAttempts: attemptRows, testAnswers: answerRows, matchProfiles: profileRows, matchAnswers: matchAnswerRows, ingestionEvents: eventRows, auditLogs: auditRows } };
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(backup), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="hamin-crm-backup-${date}.json"`, 'cache-control': 'no-store' } });
}
