import { getChatGPTUser } from '@/app/chatgpt-auth';
import { can, getAdminRole } from '@/lib/admin-access';
import {
  AnalysisError,
  analysisDb,
  analysisErrorResponse,
  callAnalysis,
  readAnalysisBody,
  sameOrigin,
} from '@/lib/analysis/bridge';
import { maskKnownNames } from '@/lib/analysis/privacy';
import { hydrateEvidenceLinks } from '@/lib/analysis/evidence';

export const dynamic = 'force-dynamic';

const readablePaths = [
  /^overview$/,
  /^words$/,
  /^word-evidence$/,
  /^config$/,
  /^provider-settings$/,
  /^lexicon$/,
  /^guides$/,
  /^runs$/,
  /^runs\/[\w-]+$/,
  /^sessions$/,
  /^sessions\/[\w-]+$/,
  /^evidence\/[\w:-]+$/,
  /^result-sets\/[\w-]+\/items$/,
  /^content\/[\w-]+$/,
];
const writablePaths = [
  /^provider-settings$/,
  /^lexicon$/,
  /^guides$/,
  /^runs$/,
  /^sessions$/,
  /^sessions\/[\w-]+\/messages$/,
  /^content$/,
];
const cancellablePaths = [/^runs\/[\w-]+$/, /^guides$/];

async function dispatch(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const user = await getChatGPTUser();
    const role = await getAdminRole(user);
    if (!user || !can(role, 'read'))
      throw new AnalysisError(403, 'forbidden', 'دسترسی به تحلیل مجاز نیست.');
    const { path: parts } = await context.params;
    const path = parts.join('/');
    const method = request.method;
    const allowed =
      method === 'GET'
        ? readablePaths
        : method === 'POST'
          ? writablePaths
          : cancellablePaths;
    if (!allowed.some((pattern) => pattern.test(path)))
      throw new AnalysisError(404, 'not_found', 'مسیر تحلیل پیدا نشد.');
    if (
      ['lexicon', 'guides', 'provider-settings'].includes(path) &&
      !can(role, 'owner')
    )
      throw new AnalysisError(
        403,
        'forbidden',
        'مدیریت منابع تحلیل به دسترسی مالک نیاز دارد.',
      );
    if (method !== 'GET') {
      if (!can(role, 'manage'))
        throw new AnalysisError(
          403,
          'forbidden',
          'اجرای تحلیل به دسترسی مدیر نیاز دارد.',
        );
      if (!sameOrigin(request))
        throw new AnalysisError(
          403,
          'invalid_origin',
          'مبدأ درخواست معتبر نیست.',
        );
    }
    let body = method === 'POST' ? await readAnalysisBody(request) : undefined;
    if (body && path !== 'provider-settings') {
      const names = await analysisDb()
        .prepare(
          'SELECT DISTINCT name FROM contacts WHERE name IS NOT NULL AND length(trim(name))>1',
        )
        .all<{ name: string }>();
      body = maskKnownNames(
        body,
        names.results.map((item) => item.name),
      );
    }
    const data = await callAnalysis(path, user, {
      method,
      search: new URL(request.url).searchParams,
      body,
    });
    return Response.json(await hydrateEvidenceLinks(data), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return analysisErrorResponse(error);
  }
}

export const GET = dispatch;
export const POST = dispatch;
export const DELETE = dispatch;
