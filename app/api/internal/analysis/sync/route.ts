import {
  AnalysisError,
  analysisConfiguration,
  analysisDb,
  analysisErrorResponse,
  callAnalysis,
  readAnalysisBody,
} from '@/lib/analysis/bridge';
import { synchronizeAnalysis } from '@/lib/analysis/sync';
import type { ChatGPTUser } from '@/app/chatgpt-auth';

export const dynamic = 'force-dynamic';

const syncActor: ChatGPTUser = {
  userId: 'system-analytics-sync',
  displayName: 'Analytics sync',
  email: 'analytics@local',
  fullName: null,
};

async function authenticate(request: Request) {
  const token = analysisConfiguration().token;
  if (!token || token.length < 24)
    throw new AnalysisError(
      503,
      'configuration_needed',
      'کلید ارتباط داخلی باید حداقل ۲۴ کاراکتر باشد.',
    );
  const incoming =
    request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const encoder = new TextEncoder();
  const [expected, actual] = await Promise.all(
    [token, incoming].map((value) =>
      crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
  );
  const expectedBytes = new Uint8Array(expected);
  const actualBytes = new Uint8Array(actual);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index++)
    difference |= expectedBytes[index] ^ actualBytes[index];
  if (difference !== 0)
    throw new AnalysisError(403, 'forbidden', 'دسترسی مجاز نیست.');
}

export async function GET(request: Request) {
  try {
    await authenticate(request);
    const db = analysisDb();
    const state = await db
      .prepare(
        'SELECT generation,change_sequence,last_synced_at FROM analysis_bridge_state WHERE id=1',
      )
      .first<{
        generation: string;
        change_sequence: number;
        last_synced_at: number | null;
      }>();
    if (!state)
      throw new AnalysisError(
        503,
        'migration_needed',
        'مهاجرت تحلیل اجرا نشده است.',
      );
    const pending =
      (await db
        .prepare(
          'SELECT COUNT(*) AS total FROM analysis_changes WHERE sequence>?',
        )
        .bind(state.change_sequence)
        .first<number>('total')) ?? 0;
    const overview = (await callAnalysis('overview', syncActor)) as {
      dataset?: { generation: string } | null;
    };
    const full =
      !state.last_synced_at ||
      !overview.dataset ||
      overview.dataset.generation !== state.generation;
    return Response.json(
      { needed: full || pending > 0, mode: full ? 'full' : 'delta', pending },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return analysisErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await authenticate(request);
    return Response.json(
      await synchronizeAnalysis(syncActor, await readAnalysisBody(request)),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return analysisErrorResponse(error);
  }
}
