'use client';

export class AnalysisRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'AnalysisRequestError';
  }
}

export async function analysisRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('content-type', 'application/json');
  const response = await fetch(`/api/admin/analysis${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => null)) as
    | (T & {
        error?: string | { code?: string; message?: string };
        message?: string;
        code?: string;
      })
    | null;
  if (!response.ok) {
    const failure = data?.error;
    const message = typeof failure === 'string' ? failure : failure?.message;
    const code = typeof failure === 'object' ? failure.code : data?.code;
    throw new AnalysisRequestError(
      message ?? data?.message ?? 'دریافت اطلاعات انجام نشد. دوباره تلاش کنید.',
      response.status,
      code,
    );
  }
  if (data === null)
    throw new AnalysisRequestError(
      'پاسخ سرویس تحلیل قابل خواندن نیست.',
      response.status,
    );
  return data;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'عملیات انجام نشد. دوباره تلاش کنید.';
}

export function downloadText(
  name: string,
  content: string,
  type = 'text/plain;charset=utf-8',
) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
