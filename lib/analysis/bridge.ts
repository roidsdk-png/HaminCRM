import { env } from 'cloudflare:workers';
import type { ChatGPTUser } from '@/app/chatgpt-auth';

export class AnalysisError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function analysisConfiguration() {
  const bindings = env as Cloudflare.Env & {
    ANALYTICS_SERVICE_URL?: string;
    ANALYTICS_INTERNAL_TOKEN?: string;
  };
  const serviceUrl = (
    bindings.ANALYTICS_SERVICE_URL ?? process.env.ANALYTICS_SERVICE_URL
  )?.trim();
  const token = (
    bindings.ANALYTICS_INTERNAL_TOKEN ?? process.env.ANALYTICS_INTERNAL_TOKEN
  )?.trim();
  return { serviceUrl, token, serviceConfigured: Boolean(serviceUrl && token) };
}

export function analysisDb(): D1Database {
  if (!env.DB)
    throw new AnalysisError(
      503,
      'database_unavailable',
      'اتصال دیتابیس CRM آماده نیست.',
    );
  return env.DB;
}

export async function pseudonym(value: string): Promise<string> {
  const secret = analysisConfiguration().token;
  if (!secret)
    throw new AnalysisError(
      503,
      'configuration_needed',
      'تنظیمات سرویس تحلیل تکمیل نشده است.',
    );
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export async function callAnalysis(
  path: string,
  user: ChatGPTUser,
  options: {
    method?: string;
    body?: unknown;
    search?: URLSearchParams;
    timeoutMs?: number;
  } = {},
): Promise<unknown> {
  const configuration = analysisConfiguration();
  if (
    !configuration.serviceConfigured ||
    !configuration.serviceUrl ||
    !configuration.token
  ) {
    throw new AnalysisError(
      503,
      'configuration_needed',
      'نشانی سرویس تحلیل و کلید ارتباط داخلی باید در محیط سرور تنظیم شوند.',
    );
  }
  const base = new URL(configuration.serviceUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password
  ) {
    throw new AnalysisError(
      503,
      'configuration_invalid',
      'نشانی سرویس تحلیل معتبر نیست.',
    );
  }
  const target = new URL(`/v1/${path}`, base);
  if (options.search) target.search = options.search.toString();
  let response: Response;
  try {
    response = await fetch(target, {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${configuration.token}`,
        'X-Analytics-Actor': await pseudonym(`actor:${user.userId}`),
        'content-type': 'application/json',
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 25_000),
      cache: 'no-store',
    });
  } catch {
    throw new AnalysisError(
      503,
      'service_unavailable',
      'سرویس تحلیل در دسترس نیست. وضعیت اجرای سرویس را بررسی کنید.',
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AnalysisError(
      502,
      'invalid_service_response',
      'پاسخ سرویس تحلیل قابل خواندن نیست.',
    );
  }
  if (!response.ok) {
    const error = data as {
      error?: { code?: string; message?: string };
      detail?: string;
    };
    throw new AnalysisError(
      response.status,
      error.error?.code ?? 'analysis_failed',
      error.error?.message ?? 'درخواست تحلیل انجام نشد.',
    );
  }
  return data;
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const bindings = env as Cloudflare.Env & {
      ANALYTICS_PUBLIC_ORIGIN?: string;
    };
    const configured =
      bindings.ANALYTICS_PUBLIC_ORIGIN ?? process.env.ANALYTICS_PUBLIC_ORIGIN;
    const expected = configured
      ? new URL(configured).origin
      : new URL(request.url).origin;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

export async function readAnalysisBody(
  request: Request,
): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') ?? 0) > 128_000) {
    throw new AnalysisError(
      413,
      'request_too_large',
      'حجم درخواست بیش از حد مجاز است.',
    );
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 128_000) {
    throw new AnalysisError(
      413,
      'request_too_large',
      'حجم درخواست بیش از حد مجاز است.',
    );
  }
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new AnalysisError(400, 'invalid_request', 'بدنهٔ درخواست معتبر نیست.');
  }
}

export function analysisErrorResponse(error: unknown): Response {
  const known =
    error instanceof AnalysisError
      ? error
      : new AnalysisError(500, 'analysis_failed', 'درخواست تحلیل انجام نشد.');
  return Response.json(
    { error: { code: known.code, message: known.message } },
    {
      status: known.status,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
