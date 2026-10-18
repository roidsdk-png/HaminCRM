import { NextResponse } from 'next/server';
import { createSessionToken, getSessionCookieName } from '@/lib/auth-session';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { administrators } from '@/db/schema';
import { secureTextEqual, verifyPassword } from '@/lib/password';

const attempts = new Map<string, { failures: number; blockedUntil: number }>();
const MAX_FAILURES = 5;
const BLOCK_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host && !isSameOrigin(origin, host)) {
    return NextResponse.json({ error: 'درخواست از مبدأ نامعتبر است' }, { status: 403 });
  }

  const clientKey = getClientKey(request);
  const currentAttempt = attempts.get(clientKey);
  if (currentAttempt && currentAttempt.blockedUntil > Date.now()) {
    return NextResponse.json({ error: 'تلاش‌های ناموفق بیش از حد مجاز بود؛ ۱۵ دقیقه دیگر دوباره تلاش کنید.' }, { status: 429, headers: { 'retry-after': String(Math.ceil((currentAttempt.blockedUntil - Date.now()) / 1000)) } });
  }

  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const password = body.password?.trim() || '';
    const requestedEmail = body.email?.trim().toLowerCase() || '';
    const bootstrapEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() || 'owner@hamin.local';

    const expectedPassword = process.env.ADMIN_PASSWORD;
    if (!expectedPassword || expectedPassword.length < 12) {
      return NextResponse.json(
        { error: 'رمز مدیریت در تنظیمات سرور تعریف نشده یا کوتاه است.' },
        { status: 503 },
      );
    }

    let identity: { userId: string; email: string; displayName: string; role: 'owner' | 'manager' | 'viewer'; accessVersion?: number } | null = null;
    if (!requestedEmail || requestedEmail === bootstrapEmail) {
      if (password && await secureTextEqual(password, expectedPassword)) identity = { userId: bootstrapEmail, email: bootstrapEmail, displayName: 'مدیر سامانه', role: 'owner' };
    } else {
      const [admin] = await getDb().select().from(administrators).where(eq(administrators.email, requestedEmail)).limit(1);
      if (admin?.active && admin.passwordHash && await verifyPassword(password, admin.passwordHash)) {
        identity = { userId: admin.userId, email: admin.email, displayName: admin.email, role: admin.role, accessVersion: admin.updatedAt.getTime() };
      }
    }

    if (!identity) {
      recordFailure(clientKey);
      return NextResponse.json({ error: 'رمز عبور اشتباه است' }, { status: 401 });
    }

    attempts.delete(clientKey);

    const token = await createSessionToken({
      ...identity,
    });

    const cookieName = getSessionCookieName();
    const response = NextResponse.json({ ok: true });
    response.headers.set(
      'Set-Cookie',
      `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600; Priority=High${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    );

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'خطا در ورود' },
      { status: 500 },
    );
  }
}

function recordFailure(key: string) {
  const previous = attempts.get(key);
  const failures = (previous?.blockedUntil && previous.blockedUntil > Date.now() ? previous.failures : 0) + 1;
  attempts.set(key, { failures, blockedUntil: failures >= MAX_FAILURES ? Date.now() + BLOCK_MS : 0 });
  if (attempts.size > 5_000) {
    for (const [entryKey, value] of attempts) if (!value.blockedUntil || value.blockedUntil < Date.now()) attempts.delete(entryKey);
  }
}

function getClientKey(request: Request) {
  return request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
}

function isSameOrigin(origin: string, host: string) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
