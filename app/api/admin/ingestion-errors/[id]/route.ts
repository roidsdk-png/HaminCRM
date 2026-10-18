import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { ingestionEvents } from '@/db/schema';
import { can, getAdminRole } from '@/lib/admin-access';
import { writeAudit } from '@/lib/audit';

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context) {
  const user = await getChatGPTUser();
  if (!can(await getAdminRole(user), 'manage')) return NextResponse.json({ error: 'دسترسی کافی ندارید.' }, { status: 403 });
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && (!host || new URL(origin).host !== host)) return NextResponse.json({ error: 'مبدأ درخواست نامعتبر است.' }, { status: 403 });

  const { id } = await context.params;
  const db = getDb();
  const [failed] = await db.select({ id: ingestionEvents.id, sourceId: ingestionEvents.sourceId, type: ingestionEvents.type })
    .from(ingestionEvents)
    .where(and(eq(ingestionEvents.id, id), eq(ingestionEvents.processingStatus, 'failed')))
    .limit(1);
  if (!failed) return NextResponse.json({ error: 'خطای ثبت‌شده پیدا نشد یا قبلاً پاک شده است.' }, { status: 404 });

  await db.delete(ingestionEvents).where(and(eq(ingestionEvents.id, id), eq(ingestionEvents.processingStatus, 'failed')));
  await writeAudit(user, 'ingestion.error.dismissed', 'ingestion_event', id, { sourceId: failed.sourceId, type: failed.type });
  return NextResponse.json({ deleted: id }, { headers: { 'cache-control': 'no-store' } });
}
