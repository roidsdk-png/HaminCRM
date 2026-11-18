import { sql } from 'drizzle-orm';

// Superseded incomplete snapshots remain available through their original IDs.
export function countableMatchProfiles() {
  return sql`(SELECT * FROM match_profiles WHERE id NOT IN (
    SELECT e.value FROM app_settings x, json_each(x.value, '$.profileIds') e
    WHERE x.key = 'match-profile-stat-exclusions' AND e.value IS NOT NULL
  ))`;
}
