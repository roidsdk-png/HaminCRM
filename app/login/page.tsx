'use client';

import { Suspense, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Lock, LogIn, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BrandLogo } from '@/components/brand-logo';

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedReturnTo = searchParams.get('return_to');
  const returnTo = requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//')
    ? requestedReturnTo
    : '/';

  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin(e: SyntheticEvent) {
    e.preventDefault();
    if (!password) {
      setError('لطفاً رمز عبور را وارد کنید.');
      return;
    }
    setBusy(true);
    setError('');

    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'رمز عبور اشتباه است');
      }

      router.push(returnTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ورود به سامانه');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground" dir="rtl">
      <section className="w-full max-w-md rounded-3xl bg-card border border-border p-8 shadow-2xl">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
          <BrandLogo className="h-8 w-8 text-primary" />
        </div>
        <h1 className="mt-5 text-center text-2xl font-black text-foreground">حامین چارت</h1>
        <p className="mt-2 text-center text-sm leading-6 text-muted-foreground">
          با ایمیل و رمز اختصاصی خود وارد شوید. مالک اصلی می‌تواند بخش ایمیل را خالی بگذارد.
        </p>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <div>
            <label htmlFor="admin-email" className="block text-xs font-bold text-muted-foreground">ایمیل مدیر <span className="font-normal">(برای مالک اصلی اختیاری)</span></label>
            <div className="relative mt-1.5">
              <Mail className="absolute right-3 top-3 text-muted-foreground" size={17} />
              <Input
                id="admin-email"
                type="email"
                autoComplete="username"
                placeholder="manager@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 pr-10 text-left font-mono border-border bg-background text-foreground"
                dir="ltr"
              />
            </div>
          </div>
          <div>
            <label htmlFor="admin-password" className="block text-xs font-bold text-muted-foreground">رمز عبور مدیریت</label>
            <div className="relative mt-1.5">
              <Lock className="absolute right-3 top-3 text-muted-foreground" size={17} />
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 pr-10 text-left font-mono border-border bg-background text-foreground"
                dir="ltr"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs font-bold text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={busy}
            className="h-11 w-full gap-2 bg-primary font-bold text-primary-foreground hover:bg-primary/90"
          >
            <LogIn size={17} />
            {busy ? 'در حال ورود...' : 'ورود به سامانه'}
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck size={15} className="text-primary" />
          <span>اتصال رمزگذاری‌شده و دسترسی امن</span>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center bg-[#102a35] text-white">
          در حال بارگذاری...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
