import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getAdminRole, can } from '@/lib/admin-access';
import { backupService, sameOrigin } from '@/lib/backup-service';
import { writeAudit } from '@/lib/audit';

async function owner() {
  const user = await getChatGPTUser();
  return { user, allowed: can(await getAdminRole(user), 'owner') };
}

export async function GET() {
  if (!(await owner()).allowed) return NextResponse.json({ error: 'فقط مالک می‌تواند بکاپ‌های CRM را ببیند.' }, { status: 403 });
  try {
    const upstream = await backupService('GET');
    if (!upstream.ok) throw new Error('فهرست بکاپ‌های CRM در دسترس نیست.');
    return new Response(upstream.body, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'خطا در دریافت بکاپ‌ها' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { user, allowed } = await owner();
  if (!allowed) return NextResponse.json({ error: 'فقط مالک می‌تواند بکاپ CRM بسازد.' }, { status: 403 });
  if (!sameOrigin(request)) return NextResponse.json({ error: 'مبدأ نامعتبر است.' }, { status: 403 });
  try {
    const upstream = await backupService('POST');
    if (!upstream.ok) throw new Error('ساخت بکاپ کامل CRM ناموفق بود.');
    const result = await upstream.json() as { backup?: { name?: string } };
    await writeAudit(user, 'backup.snapshot_created', 'database', result.backup?.name);
    return NextResponse.json(result, { status: 201, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'خطا در ساخت بکاپ' }, { status: 503 });
  }
}
