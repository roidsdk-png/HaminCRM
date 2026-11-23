import { analysisDb } from './bridge';

export async function hydrateEvidenceLinks(data: unknown): Promise<unknown> {
  const links = new Map<string, string | undefined>();
  async function visit(value: unknown): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map(visit));
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    const result = Object.fromEntries(
      await Promise.all(
        Object.entries(record).map(async ([key, item]) => [
          key,
          await visit(item),
        ]),
      ),
    );
    if (typeof record.recordId !== 'string' || typeof record.quote !== 'string')
      return result;
    const match = /^(message|test|match):([\w-]+)$/.exec(record.recordId);
    if (!match) return { ...result, href: undefined };
    if (!links.has(record.recordId)) {
      const [, kind, id] = match;
      let href: string | undefined;
      if (kind === 'message') {
        const row = await analysisDb()
          .prepare('SELECT conversation_id FROM messages WHERE id=?')
          .bind(id)
          .first<{ conversation_id: string }>();
        if (row)
          href = `/conversations/${encodeURIComponent(row.conversation_id)}`;
      } else {
        const table = kind === 'test' ? 'test_attempts' : 'match_profiles';
        const row = await analysisDb()
          .prepare(`SELECT id FROM ${table} WHERE id=?`)
          .bind(id)
          .first<{ id: string }>();
        if (row)
          href = `/${kind === 'test' ? 'tests' : 'matchmaking'}/${encodeURIComponent(row.id)}`;
      }
      links.set(record.recordId, href);
    }
    return { ...result, href: links.get(record.recordId) };
  }
  return visit(data);
}
