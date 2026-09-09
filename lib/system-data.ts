import { sql } from 'drizzle-orm';
import { getDb } from '@/db';

export async function getSystemData() {
  try {
    const db = getDb();
    const [health, errors, audits] = await Promise.all([
      db.all<{ id: string; name: string; status: string; lastSeen: string; processed: number; failed: number }>(sql`SELECT s.id,s.name,s.status,COALESCE(datetime(s.last_seen_at,'unixepoch','localtime'),'—') lastSeen,SUM(CASE WHEN e.processing_status='processed' AND e.received_at>=unixepoch('now','-1 day') THEN 1 ELSE 0 END) processed,SUM(CASE WHEN e.processing_status='failed' AND e.received_at>=unixepoch('now','-1 day') THEN 1 ELSE 0 END) failed FROM sources s LEFT JOIN ingestion_events e ON e.source_id=s.id GROUP BY s.id ORDER BY s.name`),
      db.all<{ source: string; type: string; error: string; received: string }>(sql`SELECT s.name source,e.type,COALESCE(e.processing_error,'خطای نامشخص') error,datetime(e.received_at,'unixepoch','localtime') received FROM ingestion_events e JOIN sources s ON s.id=e.source_id WHERE e.processing_status='failed' ORDER BY e.received_at DESC LIMIT 50`),
      db.all<{ email: string; action: string; entity: string; created: string }>(sql`SELECT COALESCE(admin_email,admin_user_id) email,action,COALESCE(entity_id,entity_type) entity,datetime(created_at,'unixepoch','localtime') created FROM audit_logs ORDER BY created_at DESC LIMIT 50`),
    ]);
    return { health, errors, audits };
  } catch { return { health: [], errors: [], audits: [] }; }
}
