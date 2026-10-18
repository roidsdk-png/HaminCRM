import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import locations from '@/lib/data/iran-locations.json';

export type ReportFilters = { source?: string; section?: string; from?: string; to?: string; province?: string; gender?: string; ageFrom?: string; ageTo?: string };
type AppliedFilters = { source: string; section: string; province: string; gender: string; ageFrom: number | null; ageTo: number | null };
export type ReportData = {
  totals: { users: number; conversations: number; userMessages: number; ai: number; tests: number; matches: number };
  daily: { day: string; users: number; userMessages: number; ai: number; tests: number; matches: number }[];
  sources: { slug: string; name: string }[];
  provinces: string[];
  breakdown: { name: string; kind: string; platform: string; users: number; conversations: number; userMessages: number; ai: number; tests: number; matches: number; total: number }[];
  range: { from: string; to: string; days: number };
  applied: AppliedFilters;
  notice?: string;
};

export async function getReportData(filters: ReportFilters): Promise<ReportData> {
  const normalized = normalizeRange(filters);
  const applied = normalizeDimensions(filters);
  const empty: ReportData = { totals: { users: 0, conversations: 0, userMessages: 0, ai: 0, tests: 0, matches: 0 }, daily: [], sources: [], provinces: locations.map((item) => item.name), breakdown: [], range: normalized.range, applied, notice: [normalized.notice, ageNotice(filters)].filter(Boolean).join(' ') };
  try {
    const db = getDb(); const { from, to } = normalized.range;
    const sourceWhere = sourceFilter(applied);
    const personWhere = demographicFilter(applied);
    const [totals, daily, sources, breakdown] = await Promise.all([
      db.get<ReportData['totals']>(sql`SELECT
        (SELECT COUNT(*) FROM contacts c JOIN sources s ON s.id=c.source_id WHERE ${sourceWhere} AND ${personWhere} AND date(c.first_seen_at,'unixepoch') BETWEEN ${from} AND ${to}) users,
        (SELECT COUNT(*) FROM conversations v JOIN sources s ON s.id=v.source_id LEFT JOIN contacts c ON c.id=v.contact_id WHERE ${sourceWhere} AND ${personWhere} AND date(v.started_at,'unixepoch') BETWEEN ${from} AND ${to}) conversations,
        (SELECT COUNT(*) FROM messages m JOIN sources s ON s.id=m.source_id LEFT JOIN conversations v ON v.id=m.conversation_id LEFT JOIN contacts c ON c.id=COALESCE(m.contact_id,v.contact_id) WHERE ${sourceWhere} AND ${personWhere} AND m.role='user' AND date(m.occurred_at,'unixepoch') BETWEEN ${from} AND ${to}) userMessages,
        (SELECT COUNT(*) FROM messages m JOIN sources s ON s.id=m.source_id LEFT JOIN conversations v ON v.id=m.conversation_id LEFT JOIN contacts c ON c.id=COALESCE(m.contact_id,v.contact_id) WHERE ${sourceWhere} AND ${personWhere} AND m.role='assistant' AND date(m.occurred_at,'unixepoch') BETWEEN ${from} AND ${to}) ai,
        (SELECT COUNT(*) FROM test_attempts a JOIN sources s ON s.id=a.source_id LEFT JOIN contacts c ON c.id=a.contact_id WHERE ${sourceWhere} AND ${personWhere} AND date(a.completed_at,'unixepoch') BETWEEN ${from} AND ${to}) tests,
        (SELECT COUNT(*) FROM match_profiles p JOIN sources s ON s.id=p.source_id LEFT JOIN contacts c ON c.id=p.contact_id WHERE ${sourceWhere} AND ${personWhere} AND date(COALESCE(p.completed_at,p.created_at),'unixepoch') BETWEEN ${from} AND ${to}) matches`),
      db.all<ReportData['daily'][number]>(sql`WITH RECURSIVE days(day) AS (SELECT date(${from}) UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<date(${to})),
        u AS (SELECT date(c.first_seen_at,'unixepoch') day,COUNT(*) count FROM contacts c JOIN sources s ON s.id=c.source_id WHERE ${sourceWhere} AND ${personWhere} AND date(c.first_seen_at,'unixepoch') BETWEEN ${from} AND ${to} GROUP BY day),
        m AS (SELECT date(m.occurred_at,'unixepoch') day,SUM(CASE WHEN m.role='user' THEN 1 ELSE 0 END) userMessages,SUM(CASE WHEN m.role='assistant' THEN 1 ELSE 0 END) ai FROM messages m JOIN sources s ON s.id=m.source_id LEFT JOIN conversations v ON v.id=m.conversation_id LEFT JOIN contacts c ON c.id=COALESCE(m.contact_id,v.contact_id) WHERE ${sourceWhere} AND ${personWhere} AND date(m.occurred_at,'unixepoch') BETWEEN ${from} AND ${to} GROUP BY day),
        t AS (SELECT date(a.completed_at,'unixepoch') day,COUNT(*) count FROM test_attempts a JOIN sources s ON s.id=a.source_id LEFT JOIN contacts c ON c.id=a.contact_id WHERE ${sourceWhere} AND ${personWhere} AND date(a.completed_at,'unixepoch') BETWEEN ${from} AND ${to} GROUP BY day),
        p AS (SELECT date(COALESCE(p.completed_at,p.created_at),'unixepoch') day,COUNT(*) count FROM match_profiles p JOIN sources s ON s.id=p.source_id LEFT JOIN contacts c ON c.id=p.contact_id WHERE ${sourceWhere} AND ${personWhere} AND date(COALESCE(p.completed_at,p.created_at),'unixepoch') BETWEEN ${from} AND ${to} GROUP BY day)
        SELECT days.day,COALESCE(u.count,0) users,COALESCE(m.userMessages,0) userMessages,COALESCE(m.ai,0) ai,COALESCE(t.count,0) tests,COALESCE(p.count,0) matches FROM days LEFT JOIN u ON u.day=days.day LEFT JOIN m ON m.day=days.day LEFT JOIN t ON t.day=days.day LEFT JOIN p ON p.day=days.day ORDER BY days.day`),
      db.all<{ slug: string; name: string }>(sql`SELECT slug,name FROM sources ORDER BY name`),
      db.all<Omit<ReportData['breakdown'][number], 'total'>>(sql`SELECT s.name,s.kind,s.platform,
        (SELECT COUNT(*) FROM contacts c WHERE c.source_id=s.id AND ${personWhere} AND date(c.first_seen_at,'unixepoch') BETWEEN ${from} AND ${to}) users,
        (SELECT COUNT(*) FROM conversations v LEFT JOIN contacts c ON c.id=v.contact_id WHERE v.source_id=s.id AND ${personWhere} AND date(v.started_at,'unixepoch') BETWEEN ${from} AND ${to}) conversations,
        (SELECT COUNT(*) FROM messages m LEFT JOIN conversations v ON v.id=m.conversation_id LEFT JOIN contacts c ON c.id=COALESCE(m.contact_id,v.contact_id) WHERE m.source_id=s.id AND ${personWhere} AND m.role='user' AND date(m.occurred_at,'unixepoch') BETWEEN ${from} AND ${to}) userMessages,
        (SELECT COUNT(*) FROM messages m LEFT JOIN conversations v ON v.id=m.conversation_id LEFT JOIN contacts c ON c.id=COALESCE(m.contact_id,v.contact_id) WHERE m.source_id=s.id AND ${personWhere} AND m.role='assistant' AND date(m.occurred_at,'unixepoch') BETWEEN ${from} AND ${to}) ai,
        (SELECT COUNT(*) FROM test_attempts a LEFT JOIN contacts c ON c.id=a.contact_id WHERE a.source_id=s.id AND ${personWhere} AND date(a.completed_at,'unixepoch') BETWEEN ${from} AND ${to}) tests,
        (SELECT COUNT(*) FROM match_profiles p LEFT JOIN contacts c ON c.id=p.contact_id WHERE p.source_id=s.id AND ${personWhere} AND date(COALESCE(p.completed_at,p.created_at),'unixepoch') BETWEEN ${from} AND ${to}) matches
        FROM sources s WHERE ${sourceWhere} ORDER BY s.name`),
    ]);
    const num = (value: unknown) => Number(value ?? 0);
    const normalizedBreakdown = breakdown.map((item) => {
      const row = { ...item, users: num(item.users), conversations: num(item.conversations), userMessages: num(item.userMessages), ai: num(item.ai), tests: num(item.tests), matches: num(item.matches) };
      return { ...row, total: row.userMessages + row.ai + row.tests + row.matches };
    }).sort((a, b) => b.total - a.total || b.users - a.users);
    return {
      totals: { users: num(totals?.users), conversations: num(totals?.conversations), userMessages: num(totals?.userMessages), ai: num(totals?.ai), tests: num(totals?.tests), matches: num(totals?.matches) },
      daily: daily.map((item) => ({ day: item.day, users: num(item.users), userMessages: num(item.userMessages), ai: num(item.ai), tests: num(item.tests), matches: num(item.matches) })),
      sources, provinces: empty.provinces, breakdown: normalizedBreakdown, range: normalized.range, applied, notice: empty.notice,
    };
  } catch (error) { console.error('Report query failed', error); return { ...empty, notice: 'گزارش بارگیری نشد. لطفاً بعداً دوباره تلاش کنید.' }; }
}

export async function getExportRows(type: string, filters: ReportFilters): Promise<{ headers: string[]; rows: unknown[][] }> {
  const db = getDb(); const applied = normalizeDimensions(filters); const sourceWhere = sourceFilter(applied); const personWhere = demographicFilter(applied); const { from, to } = normalizeRange(filters).range;
  if (type === 'users') { const rows = await db.all<Record<string, unknown>>(sql`SELECT c.id,s.name source,s.kind source_kind,s.platform,c.name,c.phone,c.external_user_id,c.anonymous_id,c.ip_hash,c.province,c.city,c.gender,c.age,c.education,c.metadata,datetime(c.first_seen_at,'unixepoch','localtime') first_seen,datetime(c.last_seen_at,'unixepoch','localtime') last_seen FROM contacts c JOIN sources s ON s.id=c.source_id WHERE ${sourceWhere} AND ${personWhere} AND date(c.first_seen_at,'unixepoch') BETWEEN ${from} AND ${to} ORDER BY c.first_seen_at DESC LIMIT 50000`); return objectRows(rows); }
  if (type === 'messages') { const rows = await db.all<Record<string, unknown>>(sql`SELECT m.id,s.name source,v.external_session_id session_id,m.contact_id,m.external_message_id,m.role,m.content,m.model,m.input_tokens,m.output_tokens,m.latency_ms,datetime(m.occurred_at,'unixepoch','localtime') occurred_at FROM messages m JOIN sources s ON s.id=m.source_id LEFT JOIN conversations v ON v.id=m.conversation_id LEFT JOIN contacts c ON c.id=COALESCE(m.contact_id,v.contact_id) WHERE ${sourceWhere} AND ${personWhere} AND date(m.occurred_at,'unixepoch') BETWEEN ${from} AND ${to} ORDER BY m.occurred_at DESC LIMIT 50000`); return objectRows(rows); }
  if (type === 'tests') { const rows = await db.all<Record<string, unknown>>(sql`SELECT a.id,s.name test,c.name,c.phone,c.province,c.city,c.gender,c.age,c.education,a.tracking_code,a.profile,a.scores,a.result,a.ai_analysis,(SELECT json_group_array(json_object('position',x.position,'question',x.question_text,'answer',COALESCE(x.answer_label,x.answer_value),'score',x.score)) FROM test_answers x WHERE x.attempt_id=a.id ORDER BY x.position) answers,datetime(a.started_at,'unixepoch','localtime') started_at,datetime(a.completed_at,'unixepoch','localtime') completed_at FROM test_attempts a JOIN sources s ON s.id=a.source_id LEFT JOIN contacts c ON c.id=a.contact_id WHERE ${sourceWhere} AND ${personWhere} AND date(a.completed_at,'unixepoch') BETWEEN ${from} AND ${to} ORDER BY a.completed_at DESC LIMIT 50000`); return objectRows(rows); }
  if (type === 'matchmaking') { const rows = await db.all<Record<string, unknown>>(sql`SELECT p.id,s.name source,p.external_profile_id,p.attempt_number,COALESCE(c.name,c.external_user_id,'بدون نام') person,c.external_user_id,c.phone,c.province,c.city,c.gender,c.age,c.education,p.profile,p.archetype,p.traits,CASE WHEN p.consent=1 THEN 'بله' ELSE 'خیر' END consent,(SELECT json_group_array(json_object('position',x.position,'question',x.question_text,'answer',COALESCE(x.answer_label,x.answer_value))) FROM match_answers x WHERE x.profile_id=p.id ORDER BY x.position) answers,datetime(p.completed_at,'unixepoch','localtime') completed_at,datetime(p.created_at,'unixepoch','localtime') created_at FROM match_profiles p JOIN sources s ON s.id=p.source_id LEFT JOIN contacts c ON c.id=p.contact_id WHERE ${sourceWhere} AND ${personWhere} AND date(COALESCE(p.completed_at,p.created_at),'unixepoch') BETWEEN ${from} AND ${to} ORDER BY COALESCE(p.completed_at,p.created_at) DESC LIMIT 50000`); return objectRows(rows); }
  throw new Error('نوع گزارش نامعتبر است');
}

function sourceFilter(filters: AppliedFilters): SQL {
  const source = filters.source ? sql`s.slug = ${filters.source}` : sql`1 = 1`;
  const section = filters.section ? sql`s.kind = ${filters.section}` : sql`1 = 1`;
  return sql`${source} AND ${section}`;
}

function demographicFilter(filters: AppliedFilters): SQL {
  const province = filters.province;
  const cities = locations.find((item) => item.name === province)?.cities ?? [];
  const place = province ? sql`(
    TRIM(COALESCE(c.province,'')) = ${province}
    OR TRIM(COALESCE(c.city,'')) = ${province}
    OR TRIM(COALESCE(c.city,'')) IN (SELECT value FROM json_each(${JSON.stringify(cities)}))
  )` : sql`1 = 1`;
  const gender = filters.gender === 'female'
    ? sql`LOWER(TRIM(COALESCE(c.gender,''))) IN ('female','f','woman','girl','زن','دختر','خانم','مونث','مؤنث','انثی')`
    : filters.gender === 'male'
      ? sql`LOWER(TRIM(COALESCE(c.gender,''))) IN ('male','m','man','boy','مرد','پسر','آقا','مذکر')`
      : sql`1 = 1`;
  const lowerAge = filters.ageFrom === null ? sql`1 = 1` : sql`c.age >= ${filters.ageFrom}`;
  const upperAge = filters.ageTo === null ? sql`1 = 1` : sql`c.age <= ${filters.ageTo}`;
  return sql`${place} AND ${gender} AND ${lowerAge} AND ${upperAge}`;
}

function normalizeDimensions(filters: ReportFilters): AppliedFilters {
  const province = locations.some((item) => item.name === filters.province) ? filters.province! : '';
  const gender = filters.gender === 'male' || filters.gender === 'female' ? filters.gender : '';
  const section = ['chatbot', 'test', 'matchmaking'].includes(filters.section ?? '') ? filters.section! : '';
  const ageFrom = ageValue(filters.ageFrom);
  const ageTo = ageValue(filters.ageTo);
  const reversed = ageFrom !== null && ageTo !== null && ageFrom > ageTo;
  return { source: (filters.source ?? '').trim().slice(0, 100), section, province, gender, ageFrom: reversed ? null : ageFrom, ageTo: reversed ? null : ageTo };
}
function ageValue(value: string | undefined): number | null {
  if (!value || !/^\d{1,3}$/.test(value)) return null;
  const number = Number(value);
  return number <= 120 ? number : null;
}
function ageNotice(filters: ReportFilters) {
  const from = ageValue(filters.ageFrom); const to = ageValue(filters.ageTo);
  return from !== null && to !== null && from > to ? 'بازهٔ سن نامعتبر بود؛ فیلتر سن اعمال نشد.' : '';
}

function normalizeRange(filters: ReportFilters) {
  const today = new Date().toISOString().slice(0, 10); const defaultFrom = addUtcDays(today, -29);
  const requestedFrom = validDate(filters.from) ? filters.from! : defaultFrom; const requestedTo = validDate(filters.to) ? filters.to! : today;
  if (requestedFrom > requestedTo) return { range: { from: defaultFrom, to: today, days: 30 }, notice: 'تاریخ شروع بعد از تاریخ پایان بود؛ گزارش روی ۳۰ روز گذشته تنظیم شد.' };
  const days = Math.floor((Date.parse(`${requestedTo}T00:00:00Z`) - Date.parse(`${requestedFrom}T00:00:00Z`)) / 86400000) + 1;
  if (days > 366) { const from = addUtcDays(requestedTo, -365); return { range: { from, to: requestedTo, days: 366 }, notice: 'برای حفظ خوانایی نمودار، بازه به ۳۶۶ روز اخیر محدود شد.' }; }
  return { range: { from: requestedFrom, to: requestedTo, days } };
}
function validDate(value: string | undefined) { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))); }
function addUtcDays(date: string, amount: number) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10); }
function objectRows(rows: Record<string, unknown>[]) { const headers = rows.length ? Object.keys(rows[0]) : []; return { headers, rows: rows.map((row) => headers.map((header) => row[header])) }; }
