import { getChatGPTUser } from '@/app/chatgpt-auth';
import { can, getAdminRole } from '@/lib/admin-access';
import {
  AnalysisError,
  analysisDb,
  analysisErrorResponse,
  pseudonym,
} from '@/lib/analysis/bridge';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user || !can(await getAdminRole(user), 'read'))
      throw new AnalysisError(403, 'forbidden', 'دسترسی مجاز نیست.');
    const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
    if (query.length < 2)
      return Response.json(
        { items: [] },
        { headers: { 'cache-control': 'no-store' } },
      );
    const pattern = `%${query.slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await analysisDb()
      .prepare(
        "SELECT c.id,c.source_id,c.name,s.name AS source_name FROM contacts c JOIN sources s ON s.id=c.source_id WHERE c.name LIKE ? ESCAPE '\\' ORDER BY c.name,c.id LIMIT 20",
      )
      .bind(pattern)
      .all<{
        id: string;
        source_id: string;
        name: string;
        source_name: string;
      }>();
    const items = await Promise.all(
      rows.results.map(async (row) => ({
        id: await pseudonym(`contact:${row.source_id}:${row.id}`),
        localId: row.id,
        name: row.name,
        sourceName: row.source_name,
      })),
    );
    return Response.json(
      { items },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return analysisErrorResponse(error);
  }
}
