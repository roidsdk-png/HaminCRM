import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { administrators, appSettings, auditLogs, contacts, conversations, ingestionEvents, matchAnswers, matchProfiles, messages, sources, testAnswers, testAttempts } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import { can, getAdminRole } from '@/lib/admin-access';

export async function GET() {
  const user = await getChatGPTUser(); const role = await getAdminRole(user);
  if (!can(role, 'owner')) return NextResponse.json({ error: 'دریافت نسخه پشتیبان فقط برای مالک سامانه مجاز است' }, { status: 403 });
  const db = getDb();
  const [sourceRows, contactRows, conversationRows, messageRows, attemptRows, answerRows, profileRows, matchAnswerRows, eventRows, auditRows, adminRows, settingRows] = await Promise.all([
    db.select({ id: sources.id, slug: sources.slug, name: sources.name, kind: sources.kind, platform: sources.platform, status: sources.status, lastSeenAt: sources.lastSeenAt }).from(sources),
    db.select().from(contacts), db.select().from(conversations), db.select().from(messages), db.select().from(testAttempts), db.select().from(testAnswers), db.select().from(matchProfiles), db.select().from(matchAnswers), db.select().from(ingestionEvents), db.select().from(auditLogs),
    db.select({ id: administrators.id, userId: administrators.userId, email: administrators.email, role: administrators.role, active: administrators.active, createdAt: administrators.createdAt, updatedAt: administrators.updatedAt }).from(administrators), db.select().from(appSettings),
  ]);
  await writeAudit(user, 'backup.downloaded', 'database', undefined, { messages: messageRows.length, contacts: contactRows.length });
  const backup = { format: 'hamin-crm-backup', version: 1, createdAt: new Date().toISOString(), security: { credentialsExcluded: true }, tables: { sources: sourceRows, contacts: contactRows, conversations: conversationRows, messages: messageRows, testAttempts: attemptRows, testAnswers: answerRows, matchProfiles: profileRows, matchAnswers: matchAnswerRows, ingestionEvents: eventRows, auditLogs: auditRows, administrators: adminRows, appSettings: settingRows } };
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(backup), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="hamin-crm-backup-${date}.json"`, 'cache-control': 'no-store' } });
}
