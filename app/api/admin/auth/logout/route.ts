import { NextResponse } from 'next/server';
import { getSessionCookieName } from '@/lib/auth-session';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host && !isSameOrigin(origin, host)) {
    return NextResponse.json({ error: 'درخواست از مبدأ نامعتبر است' }, { status: 403 });
  }

  const cookieName = getSessionCookieName();
  const response = NextResponse.json({ ok: true });
  response.headers.set(
    'Set-Cookie',
    `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Priority=High${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
  return response;
}

function isSameOrigin(origin: string, host: string) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
