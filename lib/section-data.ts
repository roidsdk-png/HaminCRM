import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import locations from '@/lib/data/iran-locations.json';

export type SectionRow = { id: string; cells: string[]; href?: string };
export type SectionResult = {
  rows: SectionRow[];
  sources: { slug: string; name: string }[];
  provinces: string[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export async function getSectionData(section: string, q = '', source = '', requestedPage = 1, requestedPageSize = 20, province = '', sort = 'newest', kind = '', city = '', from = '', to = '', gender = ''): Promise<SectionResult> {
  const pageSize = Math.min(50, Math.max(10, requestedPageSize));
  const page = Math.max(1, requestedPage);
  const offset = (page - 1) * pageSize;
  try {
    const db = getDb(); const pattern = `%${q.trim()}%`; const sourcePattern = source || '%';
    const sourceRows = section === 'matchmaking'
      ? []
      : section === 'conversations'
        ? await db.all<{ slug: string; name: string }>(sql`SELECT slug, name FROM sources WHERE kind='chatbot' ORDER BY name`)
        : section === 'tests'
          ? await db.all<{ slug: string; name: string }>(sql`SELECT slug, name FROM sources WHERE kind='test' ORDER BY name`)
          : await db.all<{ slug: string; name: string }>(sql`SELECT slug, name FROM sources ORDER BY name`);
    const provinces = locations.map((item) => item.name);
    let rows: SectionRow[] = []; let total = 0;
    if (section === 'users') {
      const kindPattern = kind || '%';
      const locationClause = locationFilter(province, city);
      const dateClause = dateFilter(sql`c.last_seen_at`, from, to);
      const userSearch = sql`(COALESCE(c.name,'') LIKE ${pattern} OR COALESCE(c.phone,'') LIKE ${pattern} OR COALESCE(c.external_user_id,'') LIKE ${pattern} OR COALESCE(c.anonymous_id,'') LIKE ${pattern} OR COALESCE(c.province,'') LIKE ${pattern} OR COALESCE(c.city,'') LIKE ${pattern})`;
      const userOrder = sort === 'oldest'
        ? sql`c.last_seen_at ASC`
        : sort === 'name_asc'
          ? sql`COALESCE(c.name,c.external_user_id,c.anonymous_id,'') COLLATE NOCASE ASC`
          : sort === 'name_desc'
            ? sql`COALESCE(c.name,c.external_user_id,c.anonymous_id,'') COLLATE NOCASE DESC`
            : sort === 'source_asc'
              ? sql`s.name COLLATE NOCASE ASC, c.last_seen_at DESC`
              : sql`c.last_seen_at DESC`;
      const count = await db.get<{ count: number }>(sql`SELECT COUNT(*) count FROM contacts c JOIN sources s ON s.id=c.source_id WHERE s.slug LIKE ${sourcePattern} AND s.kind LIKE ${kindPattern} AND ${locationClause} AND ${dateClause} AND ${userSearch}`); total = Number(count?.count ?? 0);
      const result = await db.all<{ id: string; person: string; kind: string; platform: string; source: string; identity: string; activity: string }>(sql`SELECT c.id, COALESCE(NULLIF(TRIM(c.name),''),'کاربر بدون نام') person, s.kind, s.platform, s.name source, COALESCE(NULLIF(TRIM(c.phone),''),NULLIF(TRIM(c.external_user_id),''),NULLIF(TRIM(c.anonymous_id),''),'—') identity, COALESCE(datetime(c.last_seen_at,'unixepoch','localtime'),'—') activity FROM contacts c JOIN sources s ON s.id=c.source_id WHERE s.slug LIKE ${sourcePattern} AND s.kind LIKE ${kindPattern} AND ${locationClause} AND ${dateClause} AND ${userSearch} ORDER BY ${userOrder}, c.id DESC LIMIT ${pageSize} OFFSET ${offset}`);
      rows = result.map((r) => ({ id: r.id, href: `/users/${r.id}`, cells: [r.person, `${kindLabel(r.kind)} · ${platformLabel(r.platform)}`, r.source, r.identity, r.activity] }));
    } else if (section === 'conversations') {
      const dateClause = dateFilter(sql`c.last_message_at`, from, to);
      const conversationSearch = sql`(c.external_session_id LIKE ${pattern} OR COALESCE(u.ip_hash,'') LIKE ${pattern} OR COALESCE(u.external_user_id,'') LIKE ${pattern} OR COALESCE(u.anonymous_id,'') LIKE ${pattern})`;
      const count = await db.get<{ count: number }>(sql`SELECT COUNT(*) count FROM conversations c JOIN sources s ON s.id=c.source_id LEFT JOIN contacts u ON u.id=c.contact_id WHERE s.slug LIKE ${sourcePattern} AND ${dateClause} AND ${conversationSearch}`); total = Number(count?.count ?? 0);
      const result = await db.all<{ id: string; session: string; userIdentity: string; source: string; count: number; activity: string }>(sql`SELECT c.id, c.external_session_id session, COALESCE(NULLIF(SUBSTR(u.ip_hash,1,12),''),NULLIF(u.external_user_id,''),NULLIF(u.anonymous_id,''),c.external_session_id) userIdentity, s.name source, c.message_count count, datetime(c.last_message_at,'unixepoch','localtime') activity FROM conversations c JOIN sources s ON s.id=c.source_id LEFT JOIN contacts u ON u.id=c.contact_id WHERE s.slug LIKE ${sourcePattern} AND ${dateClause} AND ${conversationSearch} ORDER BY c.last_message_at DESC LIMIT ${pageSize} OFFSET ${offset}`);
      rows = result.map((r) => ({ id: r.id, href: `/conversations/${r.id}`, cells: [`${r.userIdentity} · ${r.session}`, r.source, String(r.count), r.activity ?? '—'] }));
    } else if (section === 'tests') {
      const locationClause = locationFilter(province, city);
      const dateClause = dateFilter(sql`a.completed_at`, from, to);
      const count = await db.get<{ count: number }>(sql`SELECT COUNT(*) count FROM test_attempts a JOIN sources s ON s.id=a.source_id LEFT JOIN contacts c ON c.id=a.contact_id WHERE s.slug LIKE ${sourcePattern} AND ${locationClause} AND ${dateClause} AND (COALESCE(c.name,'') LIKE ${pattern} OR COALESCE(c.phone,'') LIKE ${pattern} OR COALESCE(a.tracking_code,'') LIKE ${pattern})`); total = Number(count?.count ?? 0);
      const result = await db.all<{ id: string; test: string; person: string; tracking: string; activity: string }>(sql`SELECT a.id, s.name test, COALESCE(c.name,c.phone,'بدون نام') person, COALESCE(a.tracking_code,'—') tracking, datetime(a.completed_at,'unixepoch','localtime') activity FROM test_attempts a JOIN sources s ON s.id=a.source_id LEFT JOIN contacts c ON c.id=a.contact_id WHERE s.slug LIKE ${sourcePattern} AND ${locationClause} AND ${dateClause} AND (COALESCE(c.name,'') LIKE ${pattern} OR COALESCE(c.phone,'') LIKE ${pattern} OR COALESCE(a.tracking_code,'') LIKE ${pattern}) ORDER BY a.completed_at DESC LIMIT ${pageSize} OFFSET ${offset}`);
      rows = result.map((r) => ({ id: r.id, href: `/tests/${r.id}`, cells: [r.test, r.person, r.tracking, r.activity ?? '—'] }));
    } else if (section === 'matchmaking') {
      const locationClause = locationFilter(province, city);
      const genderClause = genderFilter(gender);
      const dateClause = dateFilter(sql`COALESCE(p.completed_at,p.created_at)`, from, to);
      const searchClause = sql`(COALESCE(c.name,'') LIKE ${pattern} OR COALESCE(c.phone,'') LIKE ${pattern} OR COALESCE(c.external_user_id,'') LIKE ${pattern} OR COALESCE(c.province,'') LIKE ${pattern} OR COALESCE(c.city,'') LIKE ${pattern} OR COALESCE(p.external_profile_id,'') LIKE ${pattern} OR COALESCE(p.archetype,'') LIKE ${pattern})`;
      const orderBy = sort === 'oldest'
        ? sql`COALESCE(p.completed_at,p.created_at) ASC`
        : sort === 'name_asc'
          ? sql`COALESCE(c.name,c.external_user_id,'') COLLATE NOCASE ASC`
          : sort === 'name_desc'
            ? sql`COALESCE(c.name,c.external_user_id,'') COLLATE NOCASE DESC`
            : sort === 'location_asc'
              ? sql`COALESCE(NULLIF(c.province,''),NULLIF(c.city,''),'') COLLATE NOCASE ASC`
              : sql`COALESCE(p.completed_at,p.created_at) DESC`;
      const count = await db.get<{ count: number }>(sql`SELECT COUNT(*) count FROM match_profiles p JOIN sources s ON s.id=p.source_id LEFT JOIN contacts c ON c.id=p.contact_id WHERE s.kind='matchmaking' AND ${locationClause} AND ${genderClause} AND ${dateClause} AND ${searchClause}`); total = Number(count?.count ?? 0);
      const result = await db.all<{ id: string; person: string; location: string; archetype: string; status: string; completed: string }>(sql`SELECT p.id, COALESCE(c.name,c.external_user_id,'بدون نام') person, COALESCE(NULLIF(c.province,''),NULLIF(c.city,''),'—') location, COALESCE(p.archetype,'—') archetype, CASE WHEN p.completed_at IS NULL THEN 'ناتمام' ELSE 'تکمیل‌شده' END status, COALESCE(datetime(p.completed_at,'unixepoch','localtime'),datetime(p.created_at,'unixepoch','localtime'),'—') completed FROM match_profiles p JOIN sources s ON s.id=p.source_id LEFT JOIN contacts c ON c.id=p.contact_id WHERE s.kind='matchmaking' AND ${locationClause} AND ${genderClause} AND ${dateClause} AND ${searchClause} ORDER BY ${orderBy}, p.id DESC LIMIT ${pageSize} OFFSET ${offset}`);
      rows = result.map((r) => ({ id: r.id, href: `/matchmaking/${r.id}`, cells: [r.person, r.location, r.archetype, r.status, r.completed] }));
    } else if (section === 'sources') {
      const result = await db.all<{ id: string; name: string; kind: string; status: string; activity: string }>(sql`SELECT id,name,kind,status,COALESCE(datetime(last_seen_at,'unixepoch','localtime'),'—') activity FROM sources WHERE name LIKE ${pattern} ORDER BY name`); total = result.length;
      rows = result.map((r) => ({ id: r.id, cells: [r.name, kindLabel(r.kind), statusLabel(r.status), r.activity] }));
    } else if (section === 'reports') {
      const result = await db.all<{ id: string; name: string; users: number; messages: number; tests: number }>(sql`SELECT s.id,s.name,(SELECT COUNT(*) FROM contacts c WHERE c.source_id=s.id) users,(SELECT COUNT(*) FROM messages m WHERE m.source_id=s.id) messages,(SELECT COUNT(*) FROM test_attempts a WHERE a.source_id=s.id) tests FROM sources s WHERE s.name LIKE ${pattern} ORDER BY s.name`); total = result.length;
      rows = result.map((r) => ({ id: r.id, cells: [r.name, String(r.users), String(r.messages), String(r.tests)] }));
    }
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return { rows, sources: sourceRows, provinces, total, page: Math.min(page, totalPages), pageSize, totalPages };
  } catch { return { rows: [], sources: [], provinces: [], total: 0, page: 1, pageSize, totalPages: 1 }; }
}

function locationFilter(province: string, city: string) {
  if (city) return sql`TRIM(COALESCE(c.city,'')) = ${city}`;
  if (!province) return sql`1 = 1`;
  const cities = locations.find((item) => item.name === province)?.cities ?? [];
  const cityList = JSON.stringify(cities);
  return sql`(
    TRIM(COALESCE(c.province,'')) = ${province}
    OR TRIM(COALESCE(c.city,'')) = ${province}
    OR TRIM(COALESCE(c.city,'')) IN (SELECT value FROM json_each(${cityList}))
  )`;
}

function dateFilter(column: SQL, from: string, to: string) {
  if (from && to) return sql`date(${column},'unixepoch') BETWEEN ${from} AND ${to}`;
  if (from) return sql`date(${column},'unixepoch') >= ${from}`;
  if (to) return sql`date(${column},'unixepoch') <= ${to}`;
  return sql`1 = 1`;
}

function genderFilter(gender: string) {
  const normalized = gender.trim().toLowerCase();
  if (normalized === 'female') {
    return sql`LOWER(TRIM(COALESCE(c.gender,''))) IN ('female','f','woman','girl','زن','دختر','خانم','مونث','مؤنث','انثی')`;
  }
  if (normalized === 'male') {
    return sql`LOWER(TRIM(COALESCE(c.gender,''))) IN ('male','m','man','boy','مرد','پسر','آقا','مذکر')`;
  }
  return sql`1 = 1`;
}

export async function getRecordDetail(section: string, id: string) {
  try {
    const db = getDb();
    if (section === 'users') return {
      type: 'user',
      header: await db.get<Record<string, unknown>>(sql`SELECT s.name source,s.slug sourceSlug,s.kind sourceKind,s.platform,c.id contactId,COALESCE(NULLIF(TRIM(c.name),''),'کاربر بدون نام') name,c.phone,c.external_user_id externalId,c.anonymous_id anonymousId,c.ip_hash ipHash,c.province,c.city,c.gender,c.age,c.education,c.metadata,datetime(c.first_seen_at,'unixepoch','localtime') firstSeen,datetime(c.last_seen_at,'unixepoch','localtime') lastSeen,(SELECT COUNT(*) FROM conversations x WHERE x.contact_id=c.id) conversations,(SELECT COUNT(*) FROM messages x WHERE x.contact_id=c.id) messages,(SELECT COUNT(*) FROM test_attempts x WHERE x.contact_id=c.id) tests,(SELECT COUNT(*) FROM match_profiles x WHERE x.contact_id=c.id) matchmaking FROM contacts c JOIN sources s ON s.id=c.source_id WHERE c.id=${id}`),
      items: await db.all<Record<string, unknown>>(sql`SELECT m.role,m.content,m.model,datetime(m.occurred_at,'unixepoch','localtime') occurred FROM messages m WHERE m.contact_id=${id} ORDER BY m.occurred_at DESC LIMIT 100`),
      conversations: await db.all<Record<string, unknown>>(sql`SELECT x.id,x.external_session_id session,x.message_count messageCount,datetime(x.started_at,'unixepoch','localtime') started,datetime(x.last_message_at,'unixepoch','localtime') activity FROM conversations x WHERE x.contact_id=${id} ORDER BY x.last_message_at DESC`),
      tests: await db.all<Record<string, unknown>>(sql`SELECT a.id,s.name test,a.tracking_code tracking,datetime(a.completed_at,'unixepoch','localtime') completed FROM test_attempts a JOIN sources s ON s.id=a.source_id WHERE a.contact_id=${id} ORDER BY a.completed_at DESC`),
      matches: await db.all<Record<string, unknown>>(sql`SELECT p.id,p.archetype,CASE WHEN p.completed_at IS NULL THEN 'ناتمام' ELSE 'تکمیل‌شده' END status,datetime(COALESCE(p.completed_at,p.created_at),'unixepoch','localtime') completed FROM match_profiles p WHERE p.contact_id=${id} ORDER BY COALESCE(p.completed_at,p.created_at) DESC`),
    };
    if (section === 'conversations') return { type: 'conversation', header: await db.get<Record<string, unknown>>(sql`SELECT c.external_session_id session,s.name source,c.message_count messages,COALESCE(NULLIF(SUBSTR(u.ip_hash,1,12),''),NULLIF(u.external_user_id,''),NULLIF(u.anonymous_id,''),c.external_session_id) userIdentity,datetime(c.started_at,'unixepoch','localtime') started,datetime(c.last_message_at,'unixepoch','localtime') lastMessage FROM conversations c JOIN sources s ON s.id=c.source_id LEFT JOIN contacts u ON u.id=c.contact_id WHERE c.id=${id}`), items: await db.all<Record<string, unknown>>(sql`SELECT role,content,model,datetime(occurred_at,'unixepoch','localtime') occurred FROM messages WHERE conversation_id=${id} ORDER BY occurred_at`) };
    if (section === 'tests') return { type: 'test', header: await db.get<Record<string, unknown>>(sql`SELECT s.name source,a.test_key testKey,COALESCE(c.name,c.phone,'بدون نام') person,a.tracking_code tracking,a.profile,a.scores,a.result,a.ai_analysis analysis,c.phone,c.province,c.city,c.gender,c.age,c.education,datetime(a.completed_at,'unixepoch','localtime') completed FROM test_attempts a JOIN sources s ON s.id=a.source_id LEFT JOIN contacts c ON c.id=a.contact_id WHERE a.id=${id}`), items: await db.all<Record<string, unknown>>(sql`SELECT position,question_text question,answer_label answer,answer_value value,score FROM test_answers WHERE attempt_id=${id} ORDER BY position`) };
    if (section === 'matchmaking') return { type: 'matchmaking', header: await db.get<Record<string, unknown>>(sql`SELECT COALESCE(c.name,c.external_user_id,'بدون نام') person,c.external_user_id externalId,c.anonymous_id anonymousId,c.phone,c.province,c.city,c.gender,c.age,c.education,c.metadata,p.external_profile_id profileId,p.attempt_number attemptNumber,p.profile,p.archetype,p.traits,p.consent,datetime(COALESCE(p.completed_at,p.created_at),'unixepoch','localtime') completed FROM match_profiles p LEFT JOIN contacts c ON c.id=p.contact_id WHERE p.id=${id}`), items: await db.all<Record<string, unknown>>(sql`SELECT position,question_text question,answer_label answer,answer_value value FROM match_answers WHERE profile_id=${id} ORDER BY position`) };
    return null;
  } catch { return null; }
}
function kindLabel(v: string) { return ({ chatbot: 'چت‌بات', test: 'آزمون', matchmaking: 'همسان‌گزینی' } as Record<string,string>)[v] ?? v; }
function platformLabel(v: string) { return ({ bale: 'بله', eitaa: 'ایتا', web: 'وب‌اپ' } as Record<string,string>)[v] ?? v; }
function statusLabel(v: string) { return ({ pending: 'در انتظار', active: 'فعال', paused: 'متوقف' } as Record<string,string>)[v] ?? v; }
