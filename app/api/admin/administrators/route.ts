import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { administrators } from '@/db/schema';
import { can, getAdminRole } from '@/lib/admin-access';
import { writeAudit } from '@/lib/audit';
import { hashPassword } from '@/lib/password';

async function owner(request: Request) {
  const user = await getChatGPTUser(); const role = await getAdminRole(user);
  if (!can(role, 'owner')) return { error: NextResponse.json({ error: 'دسترسی فقط برای مالک سامانه مجاز است' }, { status: 403 }) };
  const origin = request.headers.get('origin'); const host = request.headers.get('host');
  if (origin && host && !isSameOrigin(origin, host)) return { error: NextResponse.json({ error: 'Invalid origin' }, { status: 403 }) };
  return { user };
}

export async function POST(request: Request) {
  const access = await owner(request); if ('error' in access) return access.error;
  let body: { email?: string; role?: string; password?: string };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: 'بدنه درخواست نامعتبر است' }, { status: 400 }); }
  const email = body.email?.trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !['owner', 'manager', 'viewer'].includes(body.role ?? '')) return NextResponse.json({ error: 'ایمیل یا نقش واردشده معتبر نیست' }, { status: 400 });
  if (password && (password.length < 12 || password.length > 128)) return NextResponse.json({ error: 'رمز عبور باید بین ۱۲ تا ۱۲۸ کاراکتر باشد' }, { status: 400 });
  const bootstrapOwnerEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() || 'owner@hamin.local';
  if (email === bootstrapOwnerEmail) {
    return NextResponse.json({ error: 'حساب مالک اصلی از طریق تنظیمات امن سرور مدیریت می‌شود.' }, { status: 400 });
  }
  const db = getDb();
  const [existing] = await db.select().from(administrators).where(eq(administrators.email, email)).limit(1);
  if (!existing && !password) return NextResponse.json({ error: 'برای مدیر جدید تعیین رمز عبور الزامی است' }, { status: 400 });
  if (existing && (existing.userId === access.user?.userId || existing.email === access.user?.email.toLowerCase()) && body.role !== 'owner') {
    return NextResponse.json({ error: 'نمی‌توانید نقش حساب فعلی خود را کاهش دهید' }, { status: 409 });
  }
  const role = body.role as 'owner'|'manager'|'viewer';
  const passwordHash = password ? await hashPassword(password) : existing?.passwordHash;
  const id = existing?.id ?? crypto.randomUUID();
  await db.insert(administrators).values({ id, userId: existing?.userId ?? email, email, role, active: true, passwordHash }).onConflictDoUpdate({
    target: administrators.email,
    set: { role, active: true, ...(passwordHash ? { passwordHash } : {}), updatedAt: new Date() },
  });
  await writeAudit(access.user, existing ? 'administrator.updated' : 'administrator.created', 'administrator', email, { role, passwordChanged: Boolean(password) });
  const [saved] = await db.select({ id: administrators.id, email: administrators.email, role: administrators.role, active: administrators.active, updatedAt: administrators.updatedAt, passwordHash: administrators.passwordHash }).from(administrators).where(eq(administrators.email, email)).limit(1);
  return NextResponse.json({ ok: true, administrator: { ...saved, hasPassword: Boolean(saved?.passwordHash), passwordHash: undefined } });
}

export async function PATCH(request: Request) {
  const access = await owner(request); if ('error' in access) return access.error;
  let body: { id?: string; active?: boolean };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: 'بدنه درخواست نامعتبر است' }, { status: 400 }); }
  if (!body.id || typeof body.active !== 'boolean') return NextResponse.json({ error: 'اطلاعات نامعتبر است' }, { status: 400 });
  const db = getDb(); const [target] = await db.select().from(administrators).where(eq(administrators.id, body.id)).limit(1); if (!target) return NextResponse.json({ error: 'مدیر پیدا نشد' }, { status: 404 });
  if (!body.active && (target.userId === access.user?.userId || target.email === access.user?.email.toLowerCase())) return NextResponse.json({ error: 'نمی‌توانید دسترسی حساب فعلی خود را معلق کنید' }, { status: 409 });
  if (!body.active && target.role === 'owner') { const remaining = await db.get<{ count: number }>(sql`SELECT COUNT(*) count FROM administrators WHERE role='owner' AND active=1 AND id<>${body.id}`); if (!Number(remaining?.count ?? 0)) return NextResponse.json({ error: 'حداقل یک مالک فعال باید باقی بماند' }, { status: 409 }); }
  await db.update(administrators).set({ active: body.active, updatedAt: new Date() }).where(and(eq(administrators.id, body.id), eq(administrators.email, target.email)));
  await writeAudit(access.user, body.active ? 'administrator.activated' : 'administrator.deactivated', 'administrator', target.email);
  return NextResponse.json({ ok: true });
}

function isSameOrigin(origin: string, host: string) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
