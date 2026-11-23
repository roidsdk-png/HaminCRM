import { getChatGPTUser } from '@/app/chatgpt-auth';
import { can, getAdminRole } from '@/lib/admin-access';
import {
  AnalysisError,
  analysisConfiguration,
  analysisDb,
  analysisErrorResponse,
  callAnalysis,
} from '@/lib/analysis/bridge';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getChatGPTUser();
    const role = await getAdminRole(user);
    if (!user || !can(role, 'read'))
      throw new AnalysisError(403, 'forbidden', 'دسترسی به تحلیل مجاز نیست.');
    const db = analysisDb();
    const sourceRows = await db
      .prepare(
        'SELECT id,slug,name,kind,platform,status FROM sources ORDER BY name',
      )
      .all();
    const unfinished =
      (await db
        .prepare(
          "SELECT COUNT(*) AS total FROM ingestion_events WHERE processing_status <> 'processed'",
        )
        .first<number>('total')) ?? 0;
    let sync: Record<string, unknown> = {};
    let migrationNeeded = false;
    try {
      const state = await db
        .prepare(
          'SELECT change_sequence,last_synced_at FROM analysis_bridge_state WHERE id=1',
        )
        .first<{ change_sequence: number; last_synced_at: number | null }>();
      const pending = await db
        .prepare('SELECT COUNT(*) FROM analysis_changes WHERE sequence>?')
        .bind(state?.change_sequence ?? 0)
        .first<number>('COUNT(*)');
      sync = {
        changeSequence: state?.change_sequence ?? 0,
        lastSyncedAt: state?.last_synced_at
          ? new Date(state.last_synced_at).toISOString()
          : undefined,
        pendingChanges: pending ?? 0,
      };
    } catch {
      migrationNeeded = true;
    }
    let configuration: Record<string, unknown> = {
      serviceConfigured: analysisConfiguration().serviceConfigured,
      modelConfigured: false,
      embeddingConfigured: false,
    };
    let notice = migrationNeeded
      ? 'مهاجرت دیتابیس بخش تحلیل باید اجرا شود.'
      : undefined;
    if (unfinished)
      notice =
        `${notice ?? ''} ${unfinished.toLocaleString('fa-IR')} رویداد دریافت داده هنوز تکمیل نشده است و در تحلیل نهایی قرار نمی‌گیرد.`.trim();
    if (configuration.serviceConfigured) {
      try {
        const service = (await callAnalysis('overview', user)) as {
          configuration?: Record<string, unknown>;
        };
        configuration = { ...service.configuration, serviceConfigured: true };
      } catch (error) {
        notice =
          error instanceof AnalysisError
            ? error.message
            : 'سرویس تحلیل آماده نیست.';
      }
    }
    return Response.json(
      {
        sources: sourceRows.results,
        configuration,
        access: {
          canManage: can(role, 'manage'),
          canOwner: can(role, 'owner'),
        },
        sync,
        notice,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return analysisErrorResponse(error);
  }
}
