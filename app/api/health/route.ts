import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';

export async function GET() {
  const startedAt = performance.now();
  try {
    await getDb().get(sql`SELECT 1 AS ok`);
    return NextResponse.json(
      { service: 'hamin-crm', status: 'ok', database: 'connected', responseMs: Math.round(performance.now() - startedAt) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { service: 'hamin-crm', status: 'degraded', database: 'unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
