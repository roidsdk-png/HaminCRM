import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { administrators, appSettings } from '@/db/schema';
import { can, getAdminRole } from '@/lib/admin-access';
import { writeAudit } from '@/lib/audit';
import {
  createMagicAccessToken,
  getMagicAccessConfig,
  hashMagicAccessToken,
  MAGIC_ACCESS_EMAIL,
  MAGIC_ACCESS_SETTING_KEY,
  MAGIC_ACCESS_USER_ID,
} from '@/lib/magic-access';

async function requireOwner(request: Request) {
  const user = await getChatGPTUser();
  const role = await getAdminRole(user);
  if (!can(role, 'owner')) return { error: NextResponse.json({ error: 'این عملیات فقط برای مالک سامانه مجاز است.' }, { status: 403 }) };
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host && !sameOrigin(origin, host)) return { error: NextResponse.json({ error: 'مبدأ درخواست نامعتبر است.' }, { status: 403 }) };
  return { user };
}

export async function GET(request: Request) {
  const access = await requireOwner(request);
  if ('error' in access) return access.error;
  const config = await getMagicAccessConfig();
  return NextResponse.json({ active: Boolean(config?.active), createdAt: config?.createdAt ?? null });
}

export async function POST(request: Request) {
  const access = await requireOwner(request);
  if ('error' in access) return access.error;

  const token = createMagicAccessToken();
  const tokenHash = await hashMagicAccessToken(token);
  const now = new Date();
  const db = getDb();
  await db.insert(administrators).values({
    id: crypto.randomUUID(),
    userId: MAGIC_ACCESS_USER_ID,
    email: MAGIC_ACCESS_EMAIL,
    role: 'owner',
    active: true,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: administrators.email,
    set: { userId: MAGIC_ACCESS_USER_ID, role: 'owner', active: true, updatedAt: now },
  });
  await db.insert(appSettings).values({
    key: MAGIC_ACCESS_SETTING_KEY,
    value: { active: true, tokenHash, createdAt: now.toISOString(), createdBy: access.user?.email ?? '' },
    updatedBy: access.user?.userId,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: appSettings.key,
    set: {
      value: { active: true, tokenHash, createdAt: now.toISOString(), createdBy: access.user?.email ?? '' },
      updatedBy: access.user?.userId,
      updatedAt: now,
    },
  });
  await writeAudit(access.user, 'magic_access.generated', 'access_link', MAGIC_ACCESS_USER_ID);

  const publicRequestUrl = new URL(request.url);
  if (process.env.NODE_ENV === 'production') publicRequestUrl.protocol = 'https:';
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedHost) publicRequestUrl.host = forwardedHost;
  const link = new URL(`/magic/${encodeURIComponent(token)}`, publicRequestUrl.origin).toString();
  return NextResponse.json({ ok: true, active: true, createdAt: now.toISOString(), link });
}

export async function DELETE(request: Request) {
  const access = await requireOwner(request);
  if ('error' in access) return access.error;
  const db = getDb();
  await db.delete(appSettings).where(eq(appSettings.key, MAGIC_ACCESS_SETTING_KEY));
  await db.update(administrators).set({ active: false, updatedAt: new Date() }).where(eq(administrators.userId, MAGIC_ACCESS_USER_ID));
  await writeAudit(access.user, 'magic_access.revoked', 'access_link', MAGIC_ACCESS_USER_ID);
  return NextResponse.json({ ok: true, active: false });
}

function sameOrigin(origin: string, host: string) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
