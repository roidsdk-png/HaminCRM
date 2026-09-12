import { sql } from 'drizzle-orm';
import { getDb } from '@/db';

export type ReportFilters = { source?: string; from?: string; to?: string };
export type ReportData = { totals: { users: number; messages: number; ai: number; tests: number }; daily: { day: string; messages: number; tests: number }[]; sources: { slug: string; name: string }[]; breakdown: { name: string; users: number; messages: number; tests: number }[] };

export async function getReportData(filters: ReportFilters): Promise<ReportData> {
  try {
    const db = getDb(); const source = filters.source || '%'; const from = filters.from || '1970-01-01'; const to = filters.to || new Date().toISOString().slice(0, 10);
    const [totals, daily, sources, breakdown] = await Promise.all([
      db.get<ReportData['totals']>(sql`SELECT
        (SELECT COUNT(*) FROM contacts c JOIN sources s ON s.id=c.source_id WHERE s.slug LIKE ${source} AND date(c.first_seen_at,'unixepoch') BETWEEN ${from} AND ${to}) users,
        (SELECT COUNT(*) FROM messages m JOIN sources s ON s.id=m.source_id WHERE s.slug LIKE ${source} AND date(m.occurred_at,'unixepoch') BETWEEN ${from} AND ${to}) messages,
        (SELECT COUNT(*) FROM messages m JOIN sources s ON s.id=m.source_id WHERE s.slug LIKE ${source} AND m.role='assistant' AND date(m.occurred_at,'unixepoch') BETWEEN ${from} AND ${to}) ai,
        (SELECT COUNT(*) FROM test_attempts a JOIN sources s ON s.id=a.source_id WHERE s.slug LIKE ${source} AND date(a.completed_at,'unixepoch') BETWEEN ${from} AND ${to}) tests`),
      db.all<{ day: string; messages: number; tests: number }>(sql`WITH RECURSIVE days(day) AS (SELECT date(${to},'-13 day') UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<date(${to})), m AS (SELECT date(occurred_at,'unixepoch') day,COUNT(*) count FROM messages x JOIN sources s ON s.id=x.source_id WHERE s.slug LIKE ${source} GROUP BY day), t AS (SELECT date(completed_at,'unixepoch') day,COUNT(*) count FROM test_attempts x JOIN sources s ON s.id=x.source_id WHERE s.slug LIKE ${source} GROUP BY day) SELECT days.day,COALESCE(m.count,0) messages,COALESCE(t.count,0) tests FROM days LEFT JOIN m ON m.day=days.day LEFT JOIN t ON t.day=days.day`),
      db.all<{ slug: string; name: string }>(sql`SELECT slug,name FROM sources ORDER BY name`),
      db.all<{ name: string; users: number; messages: number; tests: number }>(sql`SELECT s.name,
        (SELECT COUNT(*) FROM contacts c WHERE c.source_id=s.id AND date(c.first_seen_at,'unixepoch') BETWEEN ${from} AND ${to}) users,
        (SELECT COUNT(*) FROM messages m WHERE m.source_id=s.id AND date(m.occurred_at,'unixepoch') BETWEEN ${from} AND ${to}) messages,
        (SELECT COUNT(*) FROM test_attempts a WHERE a.source_id=s.id AND date(a.completed_at,'unixepoch') BETWEEN ${from} AND ${to}) tests
        FROM sources s WHERE s.slug LIKE ${source} ORDER BY messages DESC,tests DESC,users DESC`),
    ]);
    return { totals: { users: Number(totals?.users ?? 0), messages: Number(totals?.messages ?? 0), ai: Number(totals?.ai ?? 0), tests: Number(totals?.tests ?? 0) }, daily: daily.map((item) => ({ ...item, messages: Number(item.messages), tests: Number(item.tests) })), sources, breakdown: breakdown.map((item) => ({ ...item, users: Number(item.users), messages: Number(item.messages), tests: Number(item.tests) })) };
  } catch { return { totals: { users: 0, messages: 0, ai: 0, tests: 0 }, daily: [], sources: [], breakdown: [] }; }
}

export async function getExportRows(type: string, filters: ReportFilters): Promise<{ headers: string[]; rows: unknown[][] }> {
  const db = getDb(); const source = filters.source || '%'; const from = filters.from || '1970-01-01'; const to = filters.to || '2999-12-31';
  if (type === 'users') { const rows = await db.all<Record<string, unknown>>(sql`SELECT c.id,s.name source,c.name,c.phone,c.external_user_id,c.anonymous_id,c.province,c.city,c.gender,c.age,c.education,datetime(c.first_seen_at,'unixepoch','localtime') first_seen,datetime(c.last_seen_at,'unixepoch','localtime') last_seen FROM contacts c JOIN sources s ON s.id=c.source_id WHERE s.slug LIKE ${source} AND date(c.first_seen_at,'unixepoch') BETWEEN ${from} AND ${to} ORDER BY c.first_seen_at DESC LIMIT 50000`); return objectRows(rows); }
  if (type === 'messages') { const rows = await db.all<Record<string, unknown>>(sql`SELECT m.id,s.name source,m.conversation_id,m.role,m.content,m.model,m.input_tokens,m.output_tokens,m.latency_ms,datetime(m.occurred_at,'unixepoch','localtime') occurred_at FROM messages m JOIN sources s ON s.id=m.source_id WHERE s.slug LIKE ${source} AND date(m.occurred_at,'unixepoch') BETWEEN ${from} AND ${to} ORDER BY m.occurred_at DESC LIMIT 50000`); return objectRows(rows); }
  if (type === 'tests') { const rows = await db.all<Record<string, unknown>>(sql`SELECT a.id,s.name test,c.name,c.phone,a.tracking_code,a.scores,a.result,a.ai_analysis,datetime(a.completed_at,'unixepoch','localtime') completed_at FROM test_attempts a JOIN sources s ON s.id=a.source_id LEFT JOIN contacts c ON c.id=a.contact_id WHERE s.slug LIKE ${source} AND date(a.completed_at,'unixepoch') BETWEEN ${from} AND ${to} ORDER BY a.completed_at DESC LIMIT 50000`); return objectRows(rows); }
  throw new Error('نوع گزارش نامعتبر است');
}
function objectRows(rows: Record<string, unknown>[]) { const headers = rows.length ? Object.keys(rows[0]) : []; return { headers, rows: rows.map((row) => headers.map((h) => row[h])) }; }
