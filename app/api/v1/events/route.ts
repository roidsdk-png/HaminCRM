import { NextResponse } from 'next/server';
import { authenticateSource, ingest, IngestionProcessingError } from '@/lib/ingestion';

export async function GET() { return NextResponse.json({ service: 'Hamin CRM ingestion', status: 'ok', version: 1 }); }

export async function POST(request: Request) {
  try {
    const sourceSlug = request.headers.get('x-crm-source')?.trim(); const apiKey = request.headers.get('x-crm-key')?.trim();
    if (!sourceSlug || !apiKey) return NextResponse.json({ error: 'Missing source credentials' }, { status: 401 });
    if (Number(request.headers.get('content-length') ?? 0) > 1_000_000) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    const source = await authenticateSource(sourceSlug, apiKey);
    if (!source) return NextResponse.json({ error: 'Invalid source credentials' }, { status: 401 });
    const body = await request.json() as { events?: unknown[] } | Record<string, unknown>; const events = 'events' in body ? body.events : [body];
    if (!Array.isArray(events) || events.length === 0 || events.length > 100) return NextResponse.json({ error: 'Provide 1 to 100 events' }, { status: 400 });
    const results = [];
    for (const item of events) {
      if (!item || typeof item !== 'object') throw new Error('Each event must be an object');
      const event = item as { eventId?: unknown; type?: unknown; occurredAt?: unknown; payload?: unknown };
      if (typeof event.eventId !== 'string' || typeof event.type !== 'string' || typeof event.occurredAt !== 'string' || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new Error('Invalid event envelope');
      results.push({ eventId: event.eventId, status: await ingest(source.id, { eventId: event.eventId, type: event.type, occurredAt: event.occurredAt, payload: event.payload as Record<string, unknown> }) });
    }
    return NextResponse.json({ accepted: results.length, results }, { status: 202 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid request' }, { status: error instanceof IngestionProcessingError ? 503 : 400 }); }
}
