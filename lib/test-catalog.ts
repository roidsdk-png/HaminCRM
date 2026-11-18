import { sql } from 'drizzle-orm';

export const REDLINE_TEST_KEY = 'redline-marriage-awareness';
export const REDLINE_TEST_NAME = 'آزمون خط قرمزهای ازدواج';

// Exclusions are reversible settings. Original attempts, answers, contacts and
// ingestion history remain intact for review and backups.
export function countableTestAttempts() {
  return sql`(SELECT * FROM test_attempts WHERE id NOT IN (
    SELECT excluded_attempt.value FROM app_settings test_exclusion_setting,
      json_each(test_exclusion_setting.value, '$.attemptIds') excluded_attempt
    WHERE test_exclusion_setting.key = 'redline-stat-exclusions'
      AND excluded_attempt.value IS NOT NULL
  ))`;
}

// Transport sources retain their credentials and participant identities. The
// test catalogue groups them independently of the messenger they came from.
export function redlineSource() {
  return sql`(s.kind = 'test' AND (s.slug = 'redline' OR s.slug LIKE 'redline-%' OR s.id IN (
    SELECT DISTINCT catalogue_attempt.source_id FROM test_attempts catalogue_attempt
    WHERE catalogue_attempt.test_key = ${REDLINE_TEST_KEY}
  )))`;
}

export function testGroupKey() {
  return sql`CASE WHEN ${redlineSource()} THEN ${REDLINE_TEST_KEY} ELSE s.slug END`;
}

export function testGroupName() {
  return sql`CASE WHEN ${redlineSource()} THEN ${REDLINE_TEST_NAME} ELSE s.name END`;
}

export function normalizeTestFilter(source = '') {
  return source === 'redline' || source.startsWith('redline-') ? REDLINE_TEST_KEY : source;
}

export function testSourceFilter(source = '') {
  if (!source) return sql`1 = 1`;
  return normalizeTestFilter(source) === REDLINE_TEST_KEY ? redlineSource() : sql`s.slug = ${source}`;
}
