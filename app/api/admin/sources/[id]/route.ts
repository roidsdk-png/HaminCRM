import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { sources } from '@/db/schema';
import { sha256 } from '@/lib/ingestion';
import { writeAudit } from '@/lib/audit';
import { can, getAdminRole } from '@/lib/admin-access';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  const role = await getAdminRole(user);
  if (!can(role, 'manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const origin = request.headers.get('origin'); const host = request.headers.get('host');
  if (origin && host && !isSameOrigin(origin, host)) return NextResponse.json({ error: 'درخواست از مبدأ نامعتبر است' }, { status: 403 });
  const { id } = await params;
  let body: { action?: string };
  try {
    body = await request.json() as { action?: string };
  } catch {
    return NextResponse.json({ error: 'بدنه درخواست نامعتبر است' }, { status: 400 });
  }
  const db = getDb(); const [source] = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
  if (!source) return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  if (body.action === 'rotate') {
    const secret = createSecret();
    await db.update(sources).set({ credentialHash: await sha256(secret), status: 'active', updatedAt: new Date() }).where(eq(sources.id, id));
    await writeAudit(user, 'source.key_rotated', 'source', id, { slug: source.slug });
    return NextResponse.json({ status: 'active', secret });
  }
  if (body.action === 'pause' || body.action === 'activate') {
    if (body.action === 'activate' && !source.credentialHash) return NextResponse.json({ error: 'ابتدا کلید اتصال بسازید' }, { status: 400 });
    const status = body.action === 'pause' ? 'paused' : 'active';
    await db.update(sources).set({ status, updatedAt: new Date() }).where(eq(sources.id, id));
    await writeAudit(user, `source.${status}`, 'source', id, { slug: source.slug });
    return NextResponse.json({ status });
  }
  return NextResponse.json({ error: 'عملیات درخواستی نامعتبر است' }, { status: 400 });
}

function isSameOrigin(origin: string, host: string) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function createSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `hcrm_${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
