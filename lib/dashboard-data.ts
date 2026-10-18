import { sql } from 'drizzle-orm';
import { getDb } from '@/db';

export type RecentMessage = {
  id: string;
  content: string;
  role: string;
  occurredAt: number;
  conversationId: string;
  contactName: string;
  sourceName: string;
  platform: string;
};

export type RecentTest = {
  id: string;
  testKey: string;
  trackingCode: string | null;
  completedAt: number;
  contactName: string;
  sourceName: string;
  aiAnalysis: string | null;
};

export type RecentProfile = {
  id: string;
  archetype: string | null;
  completedAt: number | null;
  contactName: string;
  city: string | null;
  age: number | null;
  sourceName: string;
};

export type DashboardData = {
  contacts: number; messages: number; aiMessages: number; tests: number; matchProfiles: number;
  activeSources: number; sourceSlugs: string[]; daily: { label: string; count: number }[];
  dailyBreakdown: { label: string; user: number; ai: number; tests: number; matches: number }[];
  sourceActivity: { slug: string; name: string; status: string; messages: number; tests: number; profiles: number }[];
  recentMessages: RecentMessage[];
  recentTests: RecentTest[];
  recentProfiles: RecentProfile[];
};
const labels = ['—', '—', '—', '—', '—', '—', '—'];
const empty: DashboardData = {
  contacts: 0, messages: 0, aiMessages: 0, tests: 0, matchProfiles: 0, activeSources: 0, sourceSlugs: [],
  daily: labels.map((label) => ({ label, count: 0 })),
  dailyBreakdown: labels.map((label) => ({ label, user: 0, ai: 0, tests: 0, matches: 0 })),
  sourceActivity: [],
  recentMessages: [],
  recentTests: [],
  recentProfiles: [],
};

export async function getDashboardData(): Promise<DashboardData> {
  try {
    const db = getDb();
    const [counts, sourceRows, dailyRows, sourceActivity, recentMessages, recentTests, recentProfiles] = await Promise.all([
      db.get<{ contacts: number; messages: number; aiMessages: number; tests: number; matchProfiles: number; activeSources: number }>(sql`
        SELECT (SELECT COUNT(*) FROM contacts) contacts, (SELECT COUNT(*) FROM messages) messages,
          (SELECT COUNT(*) FROM messages WHERE role = 'assistant') aiMessages,
          (SELECT COUNT(*) FROM test_attempts) tests, (SELECT COUNT(*) FROM match_profiles) matchProfiles,
          (SELECT COUNT(*) FROM sources WHERE status = 'active') activeSources`),
      db.all<{ slug: string }>(sql`SELECT slug FROM sources WHERE status = 'active'`),
      db.all<{ day: string; userMessages: number; aiMessages: number; tests: number; matches: number; count: number }>(sql`
        WITH days(day) AS (VALUES (date('now','-6 day')), (date('now','-5 day')), (date('now','-4 day')), (date('now','-3 day')), (date('now','-2 day')), (date('now','-1 day')), (date('now'))),
        activity AS (SELECT date(occurred_at,'unixepoch') day,
          SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) user_messages,
          SUM(CASE WHEN role='assistant' THEN 1 ELSE 0 END) ai_messages
          FROM messages WHERE occurred_at>=unixepoch('now','-6 day') GROUP BY day),
        tests AS (SELECT date(completed_at,'unixepoch') day,COUNT(*) count FROM test_attempts WHERE completed_at>=unixepoch('now','-6 day') GROUP BY day),
        matches AS (SELECT date(COALESCE(completed_at,created_at),'unixepoch') day,COUNT(*) count FROM match_profiles WHERE COALESCE(completed_at,created_at)>=unixepoch('now','-6 day') GROUP BY day)
        SELECT days.day,COALESCE(activity.user_messages,0) userMessages,COALESCE(activity.ai_messages,0) aiMessages,COALESCE(tests.count,0) tests,COALESCE(matches.count,0) matches,
          COALESCE(activity.user_messages,0)+COALESCE(activity.ai_messages,0)+COALESCE(tests.count,0)+COALESCE(matches.count,0) count
        FROM days LEFT JOIN activity ON activity.day=days.day LEFT JOIN tests ON tests.day=days.day LEFT JOIN matches ON matches.day=days.day ORDER BY days.day`),
      db.all<{ slug: string; name: string; status: string; messages: number; tests: number; profiles: number }>(sql`
        SELECT s.slug, s.name, s.status,
          (SELECT COUNT(*) FROM messages m WHERE m.source_id=s.id) messages,
          (SELECT COUNT(*) FROM test_attempts a WHERE a.source_id=s.id) tests,
          (SELECT COUNT(*) FROM match_profiles p WHERE p.source_id=s.id) profiles
        FROM sources s ORDER BY s.name`),
      db.all<{ id: string; content: string; role: string; occurredAt: number; conversationId: string; contactName: string; sourceName: string; platform: string }>(sql`
        SELECT m.id, m.content, m.role, m.occurred_at as occurredAt, m.conversation_id as conversationId,
          COALESCE(c.name, c.phone, 'کاربر مهمان') as contactName,
          COALESCE(s.name, 'نامشخص') as sourceName,
          COALESCE(s.platform, 'web') as platform
        FROM messages m
        LEFT JOIN contacts c ON m.contact_id = c.id
        LEFT JOIN sources s ON m.source_id = s.id
        ORDER BY m.occurred_at DESC
        LIMIT 6`),
      db.all<{ id: string; testKey: string; trackingCode: string | null; completedAt: number; contactName: string; sourceName: string; aiAnalysis: string | null }>(sql`
        SELECT t.id, t.test_key as testKey, t.tracking_code as trackingCode, t.completed_at as completedAt,
          COALESCE(c.name, c.phone, 'کاربر ناشناس') as contactName,
          COALESCE(s.name, 'وب‌اپلیکیشن') as sourceName,
          t.ai_analysis as aiAnalysis
        FROM test_attempts t
        LEFT JOIN contacts c ON t.contact_id = c.id
        LEFT JOIN sources s ON t.source_id = s.id
        ORDER BY t.completed_at DESC
        LIMIT 6`),
      db.all<{ id: string; archetype: string | null; completedAt: number | null; contactName: string; city: string | null; age: number | null; sourceName: string }>(sql`
        SELECT p.id, p.archetype, p.completed_at as completedAt,
          COALESCE(c.name, 'متقاضی ازدواج') as contactName,
          c.city, c.age,
          COALESCE(s.name, 'ربات همسان‌گزینی') as sourceName
        FROM match_profiles p
        LEFT JOIN contacts c ON p.contact_id = c.id
        LEFT JOIN sources s ON p.source_id = s.id
        ORDER BY p.completed_at DESC
        LIMIT 6`),
    ]);
    return {
      contacts: Number(counts?.contacts ?? 0),
      messages: Number(counts?.messages ?? 0),
      aiMessages: Number(counts?.aiMessages ?? 0),
      tests: Number(counts?.tests ?? 0),
      matchProfiles: Number(counts?.matchProfiles ?? 0),
      activeSources: Number(counts?.activeSources ?? 0),
      sourceSlugs: sourceRows.map((row) => row.slug),
      daily: dailyRows.map((row) => ({ label: shortDate(row.day), count: Number(row.count ?? 0) })),
      dailyBreakdown: dailyRows.map((row) => ({
        label: shortDate(row.day),
        user: Number(row.userMessages ?? 0),
        ai: Number(row.aiMessages ?? 0),
        tests: Number(row.tests ?? 0),
        matches: Number(row.matches ?? 0),
      })),
      sourceActivity: sourceActivity.map((item) => ({
        ...item,
        messages: Number(item.messages),
        tests: Number(item.tests),
        profiles: Number(item.profiles),
      })),
      recentMessages: recentMessages ?? [],
      recentTests: recentTests ?? [],
      recentProfiles: recentProfiles ?? [],
    };
  } catch { return empty; }
}

function shortDate(value: string) {
  const [, month = '', day = ''] = value.split('-');
  return `${month}/${day}`;
}
