import { sql, type SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { ChatGPTUser } from '@/app/chatgpt-auth';
import { countableTestAttempts } from '@/lib/test-catalog';
import { countableMatchProfiles } from '@/lib/match-data';
import { AnalysisError, analysisDb, callAnalysis, pseudonym } from './bridge';
import type { AnalysisSyncResponse } from './types';
import { maskKnownNames } from './privacy';

type ExportSnapshot = {
  id: string;
  actor_id: string;
  generation: string;
  mode: string;
  sequence: number;
  change_sequence: number;
  sources_json: string;
  created_at: number;
  completed_at: number | null;
  last_cursor: number;
};
type ExportRow = {
  ordinal: number;
  record_id: string;
  record_json: string | null;
};
type CorpusRecord = {
  id: string;
  kind: string;
  sourceId: string;
  contactId: string | null;
  conversationId: string | null;
  role: string;
  occurredAt: number;
  text: string;
  metadata: Record<string, unknown>;
  redactionNames?: string[];
};

const dialect = new SQLiteSyncDialect();

function prepare(statement: SQL): D1PreparedStatement {
  const query = dialect.sqlToQuery(statement);
  return analysisDb()
    .prepare(query.sql)
    .bind(...query.params);
}

function changed(
  snapshotId: string,
  entity: 'message' | 'test' | 'match',
  alias: string,
): SQL {
  const record = sql.raw(`${alias}.id`);
  const source = sql.raw(`${alias}.source_id`);
  const contact = sql.raw(
    entity === 'message'
      ? `COALESCE(${alias}.contact_id,(SELECT contact_id FROM conversations WHERE id=${alias}.conversation_id))`
      : `${alias}.contact_id`,
  );
  return sql`EXISTS (
    SELECT 1 FROM analysis_changes change
    WHERE change.sequence > (SELECT change_sequence FROM analysis_bridge_state WHERE id=1)
      AND change.sequence <= (SELECT change_sequence FROM analysis_exports WHERE id=${snapshotId})
      AND ((change.entity=${entity} AND change.record_id=${record})
        OR (change.entity='contact' AND change.record_id=${contact})
        OR (change.entity='source' AND change.record_id=${source})
        OR change.entity='settings'
        OR (change.entity='event' AND EXISTS (
          SELECT 1 FROM ingestion_events event WHERE event.id=change.record_id AND event.source_id=${source}
            AND (${entity}='message' AND event.id=${record}
              OR ${entity}='test' AND json_extract(event.payload,'$.attemptId')=(SELECT external_attempt_id FROM test_attempts WHERE id=${record})
              OR ${entity}='match' AND json_extract(event.payload,'$.profileId')=(SELECT external_profile_id FROM match_profiles WHERE id=${record}))
        )))
  )`;
}

function demographics(alias: string): SQL {
  return sql.raw(
    `json_object('province',${alias}.province,'city',${alias}.city,'gender',${alias}.gender,'age',${alias}.age,'education',${alias}.education)`,
  );
}

function verifiedIdentity(alias: string): SQL {
  return sql.raw(
    `(SELECT g.id FROM analysis_identity_members im JOIN analysis_identity_groups g ON g.id=im.group_id WHERE im.contact_id=${alias}.id AND g.revoked_at IS NULL)`,
  );
}

function completedIngestion(
  entity: 'message' | 'test' | 'match',
  alias: string,
): SQL {
  if (entity === 'message')
    return sql`NOT EXISTS (SELECT 1 FROM ingestion_events event WHERE event.id=${sql.raw(`${alias}.id`)} AND event.processing_status <> 'processed')`;
  const external = sql.raw(
    `${alias}.${entity === 'test' ? 'external_attempt_id' : 'external_profile_id'}`,
  );
  const key = entity === 'test' ? '$.attemptId' : '$.profileId';
  return sql`NOT EXISTS (
    SELECT 1 FROM ingestion_events event WHERE event.source_id=${sql.raw(`${alias}.source_id`)}
      AND event.type=${entity === 'test' ? 'test.completed' : 'matchmaking.profile.completed'}
      AND json_extract(event.payload,${key})=${external} AND event.processing_status <> 'processed'
      ${entity === 'match' ? sql`AND COALESCE(json_extract(event.payload,'$.attemptNumber'),1)=${sql.raw(`${alias}.attempt_number`)}` : sql``}
  )`;
}

async function createSnapshot(
  user: ChatGPTUser,
  mode: 'full' | 'delta',
): Promise<string> {
  const db = analysisDb();
  const state = await db
    .prepare(
      'SELECT generation,last_synced_at FROM analysis_bridge_state WHERE id=1',
    )
    .first<{ generation: string; last_synced_at: number | null }>();
  if (!state)
    throw new AnalysisError(
      503,
      'migration_needed',
      'مهاجرت دیتابیس بخش تحلیل باید اجرا شود.',
    );
  const id = crypto.randomUUID();
  const actor = await pseudonym(`actor:${user.userId}`);
  const effectiveMode = state.last_synced_at ? mode : 'full';
  const all = effectiveMode === 'full';
  const now = Date.now();
  const queries: SQL[] = [
    sql`DELETE FROM analysis_exports WHERE created_at < ${now - 86_400_000}`,
    sql`INSERT INTO analysis_exports (id,actor_id,generation,mode,sequence,change_sequence,sources_json,created_at)
      SELECT ${id},${actor},generation,${effectiveMode},
        MAX(${now},COALESCE((SELECT MAX(sequence)+1 FROM analysis_exports),0)),
        COALESCE((SELECT MAX(sequence) FROM analysis_changes),0),
        (SELECT COALESCE(json_group_array(json_object('id',id,'slug',slug,'name',name,'kind',kind,'platform',platform,'status',status)),'[]') FROM sources),${now}
      FROM analysis_bridge_state WHERE id=1`,
    sql`INSERT INTO analysis_export_rows(snapshot_id,record_id,record_json)
      SELECT ${id},'message:'||m.id,json_object(
        'id','message:'||m.id,'kind','message','sourceId',m.source_id,'contactId',COALESCE(m.contact_id,v.contact_id),
        'conversationId',m.conversation_id,'role',m.role,'occurredAt',m.occurred_at,'text',m.content,
        'redactionNames',json_array(c.name),'metadata',json_object('countable',json('true'),'demographics',${demographics('c')},'model',m.model,'verifiedIdentityId',${verifiedIdentity('c')}))
      FROM messages m LEFT JOIN conversations v ON v.id=m.conversation_id LEFT JOIN contacts c ON c.id=COALESCE(m.contact_id,v.contact_id)
      WHERE ${completedIngestion('message', 'm')} AND ${all ? sql`1=1` : changed(id, 'message', 'm')}`,
    sql`INSERT INTO analysis_export_rows(snapshot_id,record_id,record_json)
      SELECT ${id},'test:'||a.id,json_object(
        'id','test:'||a.id,'kind','test','sourceId',a.source_id,'contactId',a.contact_id,'conversationId',NULL,'role','user',
        'occurredAt',a.completed_at,'text',COALESCE((SELECT group_concat(question_text||char(10)||COALESCE(answer_label,answer_value,''),char(10)||char(10)) FROM test_answers WHERE attempt_id=a.id),''),
        'redactionNames',json_array(c.name),'metadata',json_object(
          'countable',json(CASE WHEN a.id IN (SELECT id FROM ${countableTestAttempts()}) THEN 'true' ELSE 'false' END),
          'demographics',${demographics('c')},'verifiedIdentityId',${verifiedIdentity('c')},'testKey',a.test_key,
          'testVersion',json_extract(a.profile,'$.metadata.testVersion'),'questionnaireVersion',json_extract(a.profile,'$.metadata.questionnaireVersion'),
          'scores',json(a.scores),'result',json(a.result),
          'aiAnalysis',a.ai_analysis,'freeText',COALESCE(json_extract(a.profile,'$.metadata.userNotes'),''),
          'answers',json((SELECT COALESCE(json_group_array(json_object('position',position,'questionKey',question_key,'questionText',question_text,'answerValue',answer_value,'answerLabel',answer_label,'score',score)),'[]') FROM test_answers WHERE attempt_id=a.id))))
      FROM test_attempts a LEFT JOIN contacts c ON c.id=a.contact_id WHERE ${completedIngestion('test', 'a')} AND ${all ? sql`1=1` : changed(id, 'test', 'a')}`,
    sql`INSERT INTO analysis_export_rows(snapshot_id,record_id,record_json)
      SELECT ${id},'match:'||p.id,json_object(
        'id','match:'||p.id,'kind','match','sourceId',p.source_id,'contactId',p.contact_id,'conversationId',NULL,'role','user',
        'occurredAt',COALESCE(p.completed_at,p.created_at),'text',COALESCE((SELECT group_concat(question_text||char(10)||COALESCE(answer_label,answer_value,''),char(10)||char(10)) FROM match_answers WHERE profile_id=p.id),''),
        'redactionNames',json_array(c.name),'metadata',json_object(
          'countable',json(CASE WHEN p.id IN (SELECT id FROM ${countableMatchProfiles()}) THEN 'true' ELSE 'false' END),
          'demographics',${demographics('c')},'verifiedIdentityId',${verifiedIdentity('c')},'traits',json(p.traits),'archetype',p.archetype,'completed',json(CASE WHEN p.completed_at IS NULL THEN 'false' ELSE 'true' END),
          'freeText',COALESCE(json_extract(p.profile,'$.metadata.userNotes'),''),'answers',json((SELECT COALESCE(json_group_array(json_object('position',position,'questionText',question_text,'answerValue',answer_value,'answerLabel',answer_label)),'[]') FROM match_answers WHERE profile_id=p.id))))
      FROM match_profiles p LEFT JOIN contacts c ON c.id=p.contact_id WHERE ${completedIngestion('match', 'p')} AND ${all ? sql`1=1` : changed(id, 'match', 'p')}`,
  ];
  if (!all) {
    queries.push(sql`INSERT OR IGNORE INTO analysis_export_rows(snapshot_id,record_id,record_json)
      SELECT ${id},entity||':'||record_id,NULL FROM analysis_changes
      WHERE sequence > (SELECT change_sequence FROM analysis_bridge_state WHERE id=1)
        AND sequence <= (SELECT change_sequence FROM analysis_exports WHERE id=${id})
        AND entity IN ('message','test','match') AND operation='delete'
        AND NOT EXISTS(SELECT 1 FROM messages WHERE entity='message' AND id=record_id)
        AND NOT EXISTS(SELECT 1 FROM test_attempts WHERE entity='test' AND id=record_id)
        AND NOT EXISTS(SELECT 1 FROM match_profiles WHERE entity='match' AND id=record_id)`);
  }
  await db.batch(queries.map(prepare));
  return id;
}

async function canonicalRecord(row: ExportRow): Promise<CorpusRecord> {
  const record = JSON.parse(row.record_json!) as CorpusRecord;
  const names = (record.redactionNames ?? [])
    .filter(
      (name): name is string =>
        typeof name === 'string' && name.trim().length > 1,
    )
    .map((name) => name.trim());
  delete record.redactionNames;
  record.text = maskKnownNames(record.text, names) as string;
  record.metadata = maskKnownNames(record.metadata, names) as Record<
    string,
    unknown
  >;
  if (typeof record.metadata.verifiedIdentityId === 'string')
    record.metadata.verifiedIdentityId = await pseudonym(
      `identity:${record.metadata.verifiedIdentityId}`,
    );
  if (record.contactId)
    record.contactId = await pseudonym(
      `contact:${record.sourceId}:${record.contactId}`,
    );
  if (record.conversationId)
    record.conversationId = await pseudonym(
      `conversation:${record.sourceId}:${record.conversationId}`,
    );
  return record;
}

export async function synchronizeAnalysis(
  user: ChatGPTUser,
  body: Record<string, unknown>,
): Promise<AnalysisSyncResponse> {
  const db = analysisDb();
  const actor = await pseudonym(`actor:${user.userId}`);
  const cursor = body.cursor === undefined ? 0 : Number(body.cursor);
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    throw new AnalysisError(
      400,
      'invalid_cursor',
      'نشانگر دریافت داده معتبر نیست.',
    );
  const requestedId =
    typeof body.snapshotId === 'string' ? body.snapshotId : undefined;
  if (requestedId && !/^[\w-]{1,80}$/.test(requestedId))
    throw new AnalysisError(
      400,
      'invalid_snapshot',
      'شناسهٔ همگام‌سازی معتبر نیست.',
    );
  const id =
    requestedId ??
    (await createSnapshot(user, body.mode === 'full' ? 'full' : 'delta'));
  const snapshot = await db
    .prepare('SELECT * FROM analysis_exports WHERE id=? AND actor_id=?')
    .bind(id, actor)
    .first<ExportSnapshot>();
  if (!snapshot)
    throw new AnalysisError(
      404,
      'snapshot_not_found',
      'نسخهٔ همگام‌سازی پیدا نشد یا دسترسی ندارید.',
    );
  const total =
    (await db
      .prepare(
        'SELECT COUNT(*) AS total FROM analysis_export_rows WHERE snapshot_id=?',
      )
      .bind(id)
      .first<number>('total')) ?? 0;
  if (cursor > snapshot.last_cursor)
    throw new AnalysisError(
      409,
      'invalid_cursor',
      'صفحهٔ قبلی همگام‌سازی هنوز دریافت نشده است.',
    );
  if (snapshot.completed_at)
    return {
      snapshotId: id,
      cursor: snapshot.last_cursor,
      nextCursor: null,
      complete: true,
      processed: total,
      total,
      syncedAt: new Date(snapshot.completed_at).toISOString(),
    };
  if (cursor < snapshot.last_cursor) {
    const remainingRows =
      (await db
        .prepare(
          'SELECT COUNT(*) AS total FROM analysis_export_rows WHERE snapshot_id=? AND ordinal>?',
        )
        .bind(id, snapshot.last_cursor)
        .first<number>('total')) ?? 0;
    return {
      snapshotId: id,
      cursor: snapshot.last_cursor,
      nextCursor: snapshot.last_cursor,
      complete: false,
      processed: total - remainingRows,
      total,
    };
  }
  const page = await db
    .prepare(
      'SELECT ordinal,record_id,record_json FROM analysis_export_rows WHERE snapshot_id=? AND ordinal>? ORDER BY ordinal LIMIT 100',
    )
    .bind(id, cursor)
    .all<ExportRow>();
  const rows = page.results;
  const last = rows.at(-1)?.ordinal ?? cursor;
  const remaining =
    (await db
      .prepare(
        'SELECT COUNT(*) AS total FROM analysis_export_rows WHERE snapshot_id=? AND ordinal>?',
      )
      .bind(id, last)
      .first<number>('total')) ?? 0;
  const complete = remaining === 0;
  await callAnalysis('sync', user, {
    method: 'POST',
    body: {
      generation: snapshot.generation,
      snapshotId: snapshot.id,
      sequence: snapshot.sequence,
      mode: snapshot.mode,
      sources: JSON.parse(snapshot.sources_json),
      records: await Promise.all(
        rows.filter((row) => row.record_json).map(canonicalRecord),
      ),
      redactionNames: [
        ...new Set(
          rows
            .filter((row) => row.record_json)
            .flatMap(
              (row) =>
                (JSON.parse(row.record_json!) as CorpusRecord).redactionNames ??
                [],
            )
            .filter(
              (name) => typeof name === 'string' && name.trim().length > 1,
            ),
        ),
      ],
      deletedIds: rows
        .filter((row) => !row.record_json)
        .map((row) => row.record_id),
      complete,
    },
    timeoutMs: 50_000,
  });
  const syncedAt = new Date().toISOString();
  await db
    .prepare(
      'UPDATE analysis_exports SET last_cursor=MAX(last_cursor,?) WHERE id=?',
    )
    .bind(last, id)
    .run();
  if (complete) {
    await db.batch([
      db
        .prepare('UPDATE analysis_exports SET completed_at=? WHERE id=?')
        .bind(Date.now(), id),
      db
        .prepare(
          'UPDATE analysis_bridge_state SET change_sequence=?,snapshot_sequence=?,last_synced_at=? WHERE id=1 AND snapshot_sequence<=?',
        )
        .bind(
          snapshot.change_sequence,
          snapshot.sequence,
          Date.now(),
          snapshot.sequence,
        ),
    ]);
  }
  return {
    snapshotId: id,
    cursor: last,
    nextCursor: complete ? null : last,
    complete,
    total,
    processed: total - remaining,
    syncedAt: complete ? syncedAt : undefined,
  };
}
