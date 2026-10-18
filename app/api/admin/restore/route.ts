import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { administrators, appSettings, auditLogs, contacts, conversations, ingestionEvents, matchAnswers, matchProfiles, messages, sources, testAnswers, testAttempts } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import { can, getAdminRole } from '@/lib/admin-access';

type Row = Record<string, unknown>;
export async function POST(request: Request) {
  const user = await getChatGPTUser(); const role = await getAdminRole(user);
  if (!can(role, 'owner')) return NextResponse.json({ error: 'بازیابی نسخه پشتیبان فقط برای مالک سامانه مجاز است' }, { status: 403 });
  const origin = request.headers.get('origin'); const host = request.headers.get('host');
  if (origin && host && !isSameOrigin(origin, host)) return NextResponse.json({ error: 'درخواست از مبدأ نامعتبر است' }, { status: 403 });
  if (Number(request.headers.get('content-length') ?? 0) > 25_000_000) return NextResponse.json({ error: 'فایل بزرگ‌تر از حد مجاز است' }, { status: 413 });
  try {
    const body = await request.json() as { format?: string; version?: number; tables?: Record<string, unknown> };
    if (body.format !== 'hamin-crm-backup' || body.version !== 1 || !body.tables) throw new Error('فایل پشتیبان معتبر نیست');
    const db = getDb(); let inserted = 0;
    inserted += await merge(db, sources, rows(body.tables.sources), ['lastSeenAt','createdAt','updatedAt']);
    inserted += await merge(db, contacts, rows(body.tables.contacts), ['firstSeenAt','lastSeenAt','createdAt','updatedAt']);
    inserted += await merge(db, conversations, rows(body.tables.conversations), ['startedAt','lastMessageAt','createdAt','updatedAt']);
    inserted += await merge(db, messages, rows(body.tables.messages), ['occurredAt','createdAt']);
    inserted += await merge(db, testAttempts, rows(body.tables.testAttempts), ['startedAt','completedAt','createdAt']);
    inserted += await merge(db, testAnswers, rows(body.tables.testAnswers), ['createdAt']);
    inserted += await merge(db, matchProfiles, rows(body.tables.matchProfiles), ['completedAt','createdAt']);
    inserted += await merge(db, matchAnswers, rows(body.tables.matchAnswers), ['createdAt']);
    inserted += await merge(db, ingestionEvents, rows(body.tables.ingestionEvents), ['occurredAt','receivedAt']);
    inserted += await merge(db, auditLogs, rows(body.tables.auditLogs), ['createdAt']);
    const skippedSecurityRecords = rows(body.tables.administrators).length;
    if (body.tables.appSettings) {
      for (const row of rows(body.tables.appSettings)) {
        const item = revive(row, ['updatedAt']);
        const res = await db.insert(appSettings).values(item as never).onConflictDoNothing().returning({ key: appSettings.key });
        inserted += res.length;
      }
    }
    await writeAudit(user, 'backup.restored', 'database', undefined, { inserted });
    return NextResponse.json({ inserted, skippedSecurityRecords, mode: 'merge' });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'بازیابی ناموفق بود' }, { status: 400 }); }
}
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.filter((r): r is Row => Boolean(r) && typeof r === 'object' && !Array.isArray(r)) : []; }
function revive(row: Row, fields: string[]) { const copy = { ...row }; for (const field of fields) if (typeof copy[field] === 'string') copy[field] = new Date(copy[field] as string); return copy; }
async function merge(db: ReturnType<typeof getDb>, table: typeof sources | typeof contacts | typeof conversations | typeof messages | typeof testAttempts | typeof testAnswers | typeof matchProfiles | typeof matchAnswers | typeof ingestionEvents | typeof auditLogs | typeof administrators, input: Row[], dateFields: string[]) { let count = 0; for (const row of input) { const result = await db.insert(table).values(revive(row, dateFields) as never).onConflictDoNothing().returning({ id: table.id }); count += result.length; } return count; }

function isSameOrigin(origin: string, host: string) {
  try { return new URL(origin).host === host; } catch { return false; }
}
