import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { sources } from '@/db/schema';
import { sha256 } from '@/lib/ingestion';
import { writeAudit } from '@/lib/audit';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const origin = request.headers.get('origin'); const host = request.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const { id } = await params; const body = await request.json() as { action?: string };
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
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

function createSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `hcrm_${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
