import { getChatGPTUser } from '@/app/chatgpt-auth';
import { can, getAdminRole } from '@/lib/admin-access';
import {
  AnalysisError,
  analysisErrorResponse,
  readAnalysisBody,
  sameOrigin,
} from '@/lib/analysis/bridge';
import { synchronizeAnalysis } from '@/lib/analysis/sync';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user || !can(await getAdminRole(user), 'manage'))
      throw new AnalysisError(
        403,
        'forbidden',
        'همگام‌سازی به دسترسی مدیر نیاز دارد.',
      );
    if (!sameOrigin(request))
      throw new AnalysisError(
        403,
        'invalid_origin',
        'مبدأ درخواست معتبر نیست.',
      );
    return Response.json(
      await synchronizeAnalysis(user, await readAnalysisBody(request)),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return analysisErrorResponse(error);
  }
}
