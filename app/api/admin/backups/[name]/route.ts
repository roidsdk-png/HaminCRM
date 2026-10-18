import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getAdminRole, can } from '@/lib/admin-access';
import { backupService, sameOrigin } from '@/lib/backup-service';
import { writeAudit } from '@/lib/audit';

type Context = { params: Promise<{ name: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await getChatGPTUser();
  if (!can(await getAdminRole(user), 'owner')) return NextResponse.json({ error: 'فقط مالک می‌تواند بکاپ CRM را دانلود کند.' }, { status: 403 });
  try {
    const { name } = await context.params;
    const upstream = await backupService('GET', name);
    if (upstream.status === 404) return NextResponse.json({ error: 'بکاپ پیدا نشد.' }, { status: 404 });
    if (!upstream.ok) throw new Error('دانلود بکاپ ناموفق بود.');
    await writeAudit(user, 'backup.snapshot_downloaded', 'database', name);
    return new Response(upstream.body, { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'خطا در دانلود بکاپ' }, { status: 503 });
  }
}

export async function DELETE(request: Request, context: Context) {
  const user = await getChatGPTUser();
  if (!can(await getAdminRole(user), 'owner')) return NextResponse.json({ error: 'فقط مالک می‌تواند بکاپ CRM را حذف کند.' }, { status: 403 });
  if (!sameOrigin(request)) return NextResponse.json({ error: 'مبدأ نامعتبر است.' }, { status: 403 });
  try {
    const { name } = await context.params;
    const upstream = await backupService('DELETE', name);
    if (upstream.status === 404) return NextResponse.json({ error: 'بکاپ پیدا نشد.' }, { status: 404 });
    if (!upstream.ok) throw new Error('حذف بکاپ ناموفق بود.');
    await writeAudit(user, 'backup.snapshot_deleted', 'database', name);
    return NextResponse.json({ deleted: name }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'خطا در حذف بکاپ' }, { status: 503 });
  }
}
