import { sql } from 'drizzle-orm';
import { getDb } from '@/db';

export type SectionRow = { id: string; cells: string[]; href?: string };
export type SectionResult = { rows: SectionRow[]; sources: { slug: string; name: string }[]; total: number };

export async function getSectionData(section: string, q = '', source = ''): Promise<SectionResult> {
  try {
    const db = getDb(); const pattern = `%${q.trim()}%`; const sourcePattern = source || '%';
    const sources = await db.all<{ slug: string; name: string }>(sql`SELECT slug, name FROM sources ORDER BY name`);
    let rows: SectionRow[] = [];
    if (section === 'users') {
      const result = await db.all<{ id: string; person: string; source: string; identity: string; activity: string }>(sql`SELECT c.id, COALESCE(c.name,'کاربر بدون نام') person, s.name source, COALESCE(c.phone,c.external_user_id,c.anonymous_id,'—') identity, datetime(c.last_seen_at,'unixepoch','localtime') activity FROM contacts c JOIN sources s ON s.id=c.source_id WHERE s.slug LIKE ${sourcePattern} AND (COALESCE(c.name,'') LIKE ${pattern} OR COALESCE(c.phone,'') LIKE ${pattern} OR COALESCE(c.external_user_id,'') LIKE ${pattern}) ORDER BY c.last_seen_at DESC LIMIT 100`);
      rows = result.map((r) => ({ id: r.id, cells: [r.person, r.source, r.identity, r.activity ?? '—'] }));
    } else if (section === 'conversations') {
      const result = await db.all<{ id: string; session: string; source: string; count: number; activity: string }>(sql`SELECT c.id, c.external_session_id session, s.name source, c.message_count count, datetime(c.last_message_at,'unixepoch','localtime') activity FROM conversations c JOIN sources s ON s.id=c.source_id WHERE s.slug LIKE ${sourcePattern} AND c.external_session_id LIKE ${pattern} ORDER BY c.last_message_at DESC LIMIT 100`);
      rows = result.map((r) => ({ id: r.id, href: `/conversations/${r.id}`, cells: [r.session, r.source, String(r.count), r.activity ?? '—'] }));
    } else if (section === 'tests') {
      const result = await db.all<{ id: string; test: string; person: string; tracking: string; activity: string }>(sql`SELECT a.id, s.name test, COALESCE(c.name,c.phone,'بدون نام') person, COALESCE(a.tracking_code,'—') tracking, datetime(a.completed_at,'unixepoch','localtime') activity FROM test_attempts a JOIN sources s ON s.id=a.source_id LEFT JOIN contacts c ON c.id=a.contact_id WHERE s.slug LIKE ${sourcePattern} AND (COALESCE(c.name,'') LIKE ${pattern} OR COALESCE(c.phone,'') LIKE ${pattern} OR COALESCE(a.tracking_code,'') LIKE ${pattern}) ORDER BY a.completed_at DESC LIMIT 100`);
      rows = result.map((r) => ({ id: r.id, href: `/tests/${r.id}`, cells: [r.test, r.person, r.tracking, r.activity ?? '—'] }));
    } else if (section === 'matchmaking') {
      const result = await db.all<{ id: string; person: string; city: string; archetype: string; status: string }>(sql`SELECT p.id, COALESCE(c.name,c.external_user_id,'بدون نام') person, COALESCE(c.city,'—') city, COALESCE(p.archetype,'—') archetype, CASE WHEN p.completed_at IS NULL THEN 'ناتمام' ELSE 'تکمیل‌شده' END status FROM match_profiles p JOIN sources s ON s.id=p.source_id LEFT JOIN contacts c ON c.id=p.contact_id WHERE s.slug LIKE ${sourcePattern} AND (COALESCE(c.name,'') LIKE ${pattern} OR COALESCE(c.city,'') LIKE ${pattern}) ORDER BY p.created_at DESC LIMIT 100`);
      rows = result.map((r) => ({ id: r.id, href: `/matchmaking/${r.id}`, cells: [r.person, r.city, r.archetype, r.status] }));
    } else if (section === 'sources') {
      const result = await db.all<{ id: string; name: string; kind: string; status: string; activity: string }>(sql`SELECT id,name,kind,status,COALESCE(datetime(last_seen_at,'unixepoch','localtime'),'—') activity FROM sources WHERE name LIKE ${pattern} ORDER BY name`);
      rows = result.map((r) => ({ id: r.id, cells: [r.name, kindLabel(r.kind), statusLabel(r.status), r.activity] }));
    } else if (section === 'reports') {
      const result = await db.all<{ id: string; name: string; users: number; messages: number; tests: number }>(sql`SELECT s.id,s.name,(SELECT COUNT(*) FROM contacts c WHERE c.source_id=s.id) users,(SELECT COUNT(*) FROM messages m WHERE m.source_id=s.id) messages,(SELECT COUNT(*) FROM test_attempts a WHERE a.source_id=s.id) tests FROM sources s WHERE s.name LIKE ${pattern} ORDER BY s.name`);
      rows = result.map((r) => ({ id: r.id, cells: [r.name, String(r.users), String(r.messages), String(r.tests)] }));
    }
    return { rows, sources, total: rows.length };
  } catch { return { rows: [], sources: [], total: 0 }; }
}

export async function getRecordDetail(section: string, id: string) {
  try {
    const db = getDb();
    if (section === 'conversations') return { type: 'conversation', header: await db.get<Record<string, unknown>>(sql`SELECT c.external_session_id session,s.name source,datetime(c.started_at,'unixepoch','localtime') started FROM conversations c JOIN sources s ON s.id=c.source_id WHERE c.id=${id}`), items: await db.all<Record<string, unknown>>(sql`SELECT role,content,model,datetime(occurred_at,'unixepoch','localtime') occurred FROM messages WHERE conversation_id=${id} ORDER BY occurred_at`) };
    if (section === 'tests') return { type: 'test', header: await db.get<Record<string, unknown>>(sql`SELECT s.name source,COALESCE(c.name,c.phone,'بدون نام') person,a.tracking_code tracking,a.scores,a.result,a.ai_analysis analysis,datetime(a.completed_at,'unixepoch','localtime') completed FROM test_attempts a JOIN sources s ON s.id=a.source_id LEFT JOIN contacts c ON c.id=a.contact_id WHERE a.id=${id}`), items: await db.all<Record<string, unknown>>(sql`SELECT position,question_text question,answer_label answer,answer_value value,score FROM test_answers WHERE attempt_id=${id} ORDER BY position`) };
    if (section === 'matchmaking') return { type: 'matchmaking', header: await db.get<Record<string, unknown>>(sql`SELECT COALESCE(c.name,c.external_user_id,'بدون نام') person,c.city,p.archetype,p.traits,p.consent,datetime(p.completed_at,'unixepoch','localtime') completed FROM match_profiles p LEFT JOIN contacts c ON c.id=p.contact_id WHERE p.id=${id}`), items: await db.all<Record<string, unknown>>(sql`SELECT position,question_text question,answer_label answer,answer_value value FROM match_answers WHERE profile_id=${id} ORDER BY position`) };
    return null;
  } catch { return null; }
}
function kindLabel(v: string) { return ({ chatbot: 'چت‌بات', test: 'آزمون', matchmaking: 'همسان‌گزینی' } as Record<string,string>)[v] ?? v; }
function statusLabel(v: string) { return ({ pending: 'در انتظار', active: 'فعال', paused: 'متوقف' } as Record<string,string>)[v] ?? v; }
