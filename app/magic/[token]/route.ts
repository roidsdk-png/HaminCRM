import { NextResponse } from 'next/server';
import { createSessionToken, getSessionCookieName } from '@/lib/auth-session';
import { validateMagicAccessToken } from '@/lib/magic-access';

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const admin = await validateMagicAccessToken(token);
  if (!admin) {
    return NextResponse.redirect(new URL('/login?magic_link=invalid', request.url), 303);
  }

  const sessionToken = await createSessionToken({
    userId: admin.userId,
    email: admin.email,
    displayName: 'ورود با لینک اختصاصی',
    role: admin.role,
    accessVersion: admin.updatedAt.getTime(),
  });
  const response = NextResponse.redirect(new URL('/', request.url), 303);
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set(
    'Set-Cookie',
    `${getSessionCookieName()}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600; Priority=High${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  );
  return response;
}
