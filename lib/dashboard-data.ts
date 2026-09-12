import { sql } from 'drizzle-orm';
import { getDb } from '@/db';

export type DashboardData = {
  contacts: number; messages: number; aiMessages: number; tests: number; matchProfiles: number;
  activeSources: number; sourceSlugs: string[]; daily: { label: string; count: number }[];
  dailyBreakdown: { label: string; user: number; ai: number; tests: number }[];
  sourceActivity: { slug: string; name: string; status: string; messages: number; tests: number; profiles: number }[];
};
const labels = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
const empty: DashboardData = { contacts: 0, messages: 0, aiMessages: 0, tests: 0, matchProfiles: 0, activeSources: 0, sourceSlugs: [], daily: labels.map((label) => ({ label, count: 0 })), dailyBreakdown: labels.map((label) => ({ label, user: 0, ai: 0, tests: 0 })), sourceActivity: [] };

export async function getDashboardData(): Promise<DashboardData> {
  try {
    const db = getDb();
    const [counts, sourceRows, dailyRows, sourceActivity] = await Promise.all([
      db.get<{ contacts: number; messages: number; aiMessages: number; tests: number; matchProfiles: number; activeSources: number }>(sql`
        SELECT (SELECT COUNT(*) FROM contacts) contacts, (SELECT COUNT(*) FROM messages) messages,
          (SELECT COUNT(*) FROM messages WHERE role = 'assistant') aiMessages,
          (SELECT COUNT(*) FROM test_attempts) tests, (SELECT COUNT(*) FROM match_profiles) matchProfiles,
          (SELECT COUNT(*) FROM sources WHERE status = 'active') activeSources`),
      db.all<{ slug: string }>(sql`SELECT slug FROM sources WHERE status = 'active'`),
      db.all<{ day: string; userMessages: number; aiMessages: number; tests: number; count: number }>(sql`
        WITH days(day) AS (VALUES (date('now','-6 day')), (date('now','-5 day')), (date('now','-4 day')), (date('now','-3 day')), (date('now','-2 day')), (date('now','-1 day')), (date('now'))),
        activity AS (SELECT date(occurred_at,'unixepoch') day,
          SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) user_messages,
          SUM(CASE WHEN role='assistant' THEN 1 ELSE 0 END) ai_messages
          FROM messages WHERE occurred_at>=unixepoch('now','-6 day') GROUP BY day),
        tests AS (SELECT date(completed_at,'unixepoch') day,COUNT(*) count FROM test_attempts WHERE completed_at>=unixepoch('now','-6 day') GROUP BY day)
        SELECT days.day,COALESCE(activity.user_messages,0) userMessages,COALESCE(activity.ai_messages,0) aiMessages,COALESCE(tests.count,0) tests,
          COALESCE(activity.user_messages,0)+COALESCE(activity.ai_messages,0)+COALESCE(tests.count,0) count
        FROM days LEFT JOIN activity ON activity.day=days.day LEFT JOIN tests ON tests.day=days.day ORDER BY days.day`),
      db.all<{ slug: string; name: string; status: string; messages: number; tests: number; profiles: number }>(sql`
        SELECT s.slug, s.name, s.status,
          (SELECT COUNT(*) FROM messages m WHERE m.source_id=s.id) messages,
          (SELECT COUNT(*) FROM test_attempts a WHERE a.source_id=s.id) tests,
          (SELECT COUNT(*) FROM match_profiles p WHERE p.source_id=s.id) profiles
        FROM sources s ORDER BY s.name`),
    ]);
    return { contacts: Number(counts?.contacts ?? 0), messages: Number(counts?.messages ?? 0), aiMessages: Number(counts?.aiMessages ?? 0), tests: Number(counts?.tests ?? 0), matchProfiles: Number(counts?.matchProfiles ?? 0), activeSources: Number(counts?.activeSources ?? 0), sourceSlugs: sourceRows.map((row) => row.slug), daily: labels.map((label, index) => ({ label, count: Number(dailyRows[index]?.count ?? 0) })), dailyBreakdown: labels.map((label, index) => ({ label, user: Number(dailyRows[index]?.userMessages ?? 0), ai: Number(dailyRows[index]?.aiMessages ?? 0), tests: Number(dailyRows[index]?.tests ?? 0) })), sourceActivity: sourceActivity.map((item) => ({ ...item, messages: Number(item.messages), tests: Number(item.tests), profiles: Number(item.profiles) })) };
  } catch { return empty; }
}
