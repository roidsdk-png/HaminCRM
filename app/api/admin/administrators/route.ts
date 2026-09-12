import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { administrators } from '@/db/schema';
import { can, getAdminRole } from '@/lib/admin-access';
import { writeAudit } from '@/lib/audit';

async function owner(request: Request) {
  const user = await getChatGPTUser(); const role = await getAdminRole(user);
  if (!can(role, 'owner')) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  const origin = request.headers.get('origin'); const host = request.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return { error: NextResponse.json({ error: 'Invalid origin' }, { status: 403 }) };
  return { user };
}

export async function POST(request: Request) {
  const access = await owner(request); if ('error' in access) return access.error;
  const body = await request.json() as { email?: string; role?: string }; const email = body.email?.trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !['owner', 'manager', 'viewer'].includes(body.role ?? '')) return NextResponse.json({ error: 'اطلاعات نامعتبر است' }, { status: 400 });
  const id = crypto.randomUUID(); await getDb().insert(administrators).values({ id, userId: email, email, role: body.role as 'owner'|'manager'|'viewer' }).onConflictDoUpdate({ target: administrators.email, set: { role: body.role as 'owner'|'manager'|'viewer', active: true, updatedAt: new Date() } });
  await writeAudit(access.user, 'administrator.saved', 'administrator', email, { role: body.role });
  const [saved] = await getDb().select().from(administrators).where(eq(administrators.email, email)).limit(1);
  return NextResponse.json({ ok: true, administrator: saved });
}

export async function PATCH(request: Request) {
  const access = await owner(request); if ('error' in access) return access.error;
  const body = await request.json() as { id?: string; active?: boolean }; if (!body.id || typeof body.active !== 'boolean') return NextResponse.json({ error: 'اطلاعات نامعتبر است' }, { status: 400 });
  const db = getDb(); const [target] = await db.select().from(administrators).where(eq(administrators.id, body.id)).limit(1); if (!target) return NextResponse.json({ error: 'مدیر پیدا نشد' }, { status: 404 });
  if (!body.active && target.role === 'owner') { const remaining = await db.get<{ count: number }>(sql`SELECT COUNT(*) count FROM administrators WHERE role='owner' AND active=1 AND id<>${body.id}`); if (!Number(remaining?.count ?? 0)) return NextResponse.json({ error: 'حداقل یک مالک فعال باید باقی بماند' }, { status: 409 }); }
  await db.update(administrators).set({ active: body.active, updatedAt: new Date() }).where(and(eq(administrators.id, body.id), eq(administrators.email, target.email)));
  await writeAudit(access.user, body.active ? 'administrator.activated' : 'administrator.deactivated', 'administrator', target.email);
  return NextResponse.json({ ok: true });
}
