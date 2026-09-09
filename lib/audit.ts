import { getDb } from '@/db';
import { auditLogs } from '@/db/schema';
import type { ChatGPTUser } from '@/app/chatgpt-auth';

export async function writeAudit(user: ChatGPTUser | null, action: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>) {
  await getDb().insert(auditLogs).values({ id: crypto.randomUUID(), adminUserId: user?.userId ?? 'local-developer', adminEmail: user?.email ?? 'local', action, entityType, entityId, metadata });
}
