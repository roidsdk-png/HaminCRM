import { sql } from 'drizzle-orm';
import { getDb } from '@/db';

export type DashboardData = {
  contacts: number; messages: number; aiMessages: number; tests: number; matchProfiles: number;
  activeSources: number; sourceSlugs: string[]; daily: { label: string; count: number }[];
};
const labels = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
const empty: DashboardData = { contacts: 0, messages: 0, aiMessages: 0, tests: 0, matchProfiles: 0, activeSources: 0, sourceSlugs: [], daily: labels.map((label) => ({ label, count: 0 })) };

export async function getDashboardData(): Promise<DashboardData> {
  try {
    const db = getDb();
    const [counts, sourceRows, dailyRows] = await Promise.all([
      db.get<{ contacts: number; messages: number; aiMessages: number; tests: number; matchProfiles: number; activeSources: number }>(sql`
        SELECT (SELECT COUNT(*) FROM contacts) contacts, (SELECT COUNT(*) FROM messages) messages,
          (SELECT COUNT(*) FROM messages WHERE role = 'assistant') aiMessages,
          (SELECT COUNT(*) FROM test_attempts) tests, (SELECT COUNT(*) FROM match_profiles) matchProfiles,
          (SELECT COUNT(*) FROM sources WHERE status = 'active') activeSources`),
      db.all<{ slug: string }>(sql`SELECT slug FROM sources WHERE status = 'active'`),
      db.all<{ day: string; count: number }>(sql`
        WITH days(day) AS (VALUES (date('now','-6 day')), (date('now','-5 day')), (date('now','-4 day')), (date('now','-3 day')), (date('now','-2 day')), (date('now','-1 day')), (date('now'))),
        activity AS (
          SELECT date(occurred_at, 'unixepoch') day, COUNT(*) count FROM messages WHERE occurred_at >= unixepoch('now','-6 day') GROUP BY day
          UNION ALL SELECT date(completed_at, 'unixepoch') day, COUNT(*) count FROM test_attempts WHERE completed_at >= unixepoch('now','-6 day') GROUP BY day)
        SELECT days.day, COALESCE(SUM(activity.count), 0) count FROM days LEFT JOIN activity ON activity.day = days.day GROUP BY days.day ORDER BY days.day`),
    ]);
    return { contacts: Number(counts?.contacts ?? 0), messages: Number(counts?.messages ?? 0), aiMessages: Number(counts?.aiMessages ?? 0), tests: Number(counts?.tests ?? 0), matchProfiles: Number(counts?.matchProfiles ?? 0), activeSources: Number(counts?.activeSources ?? 0), sourceSlugs: sourceRows.map((row) => row.slug), daily: labels.map((label, index) => ({ label, count: Number(dailyRows[index]?.count ?? 0) })) };
  } catch { return empty; }
}
