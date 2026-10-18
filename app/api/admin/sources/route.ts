import { NextResponse } from 'next/server';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { sources } from '@/db/schema';
import { can, getAdminRole } from '@/lib/admin-access';

export async function GET() {
  const user = await getChatGPTUser();
  const role = await getAdminRole(user);
  if (!can(role, 'read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDb();
  const rows = await db.select({
    id: sources.id,
    slug: sources.slug,
    name: sources.name,
    kind: sources.kind,
    platform: sources.platform,
    status: sources.status,
    lastSeenAt: sources.lastSeenAt,
    createdAt: sources.createdAt,
    updatedAt: sources.updatedAt,
  }).from(sources).orderBy(sources.name);
  return NextResponse.json({ sources: rows });
}

export async function POST() {
  return NextResponse.json({ error: 'افزودن منبع از داخل سامانه غیرفعال است و فقط هنگام اتصال فنی سرویس انجام می‌شود.' }, { status: 405, headers: { Allow: 'GET' } });
}
