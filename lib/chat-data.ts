import { sql } from 'drizzle-orm';

// Historical conversation rows remain available for audit. Only conversations
// containing messages are active chats; materialize their IDs once per query.
export function activeConversations() {
  return sql`(SELECT * FROM conversations WHERE id IN (SELECT DISTINCT conversation_id FROM messages))`;
}
