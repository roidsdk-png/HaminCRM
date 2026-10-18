'use client';

import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import {
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Pencil,
  Shield,
  ShieldCheck,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type Admin = {
  id: string;
  email: string;
  role: 'owner' | 'manager' | 'viewer';
  active: boolean;
  hasPassword: boolean;
  updatedAt: string;
};

const fa = new Intl.NumberFormat('fa-IR');

export function AccessSettings({ initialAdmins, bootstrapOwnerEmail }: { initialAdmins: Admin[]; bootstrapOwnerEmail: string }) {
  const [admins, setAdmins] = useState(initialAdmins);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Admin['role']>('viewer');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [busy, setBusy] = useState('');
  const [pendingToggle, setPendingToggle] = useState<Admin | null>(null);

  async function save(event: SyntheticEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const existing = admins.find((item) => item.email.toLowerCase() === normalizedEmail);
    if (!normalizedEmail) return;
    if ((!existing || password) && (password.length < 12 || password.length > 128)) {
      setMessageType('error');
      setMessage('برای مدیر جدید یا تغییر رمز، یک رمز ۱۲ تا ۱۲۸ کاراکتری وارد کنید.');
      return;
    }
    setBusy('new');
    setMessage('');
    try {
      const response = await fetch('/api/admin/administrators', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, role, password: password || undefined }),
      });
      const result = (await response.json()) as { error?: string; administrator?: Admin };
      if (!response.ok) throw new Error(result.error ?? 'خطا در ذخیره دسترسی');
      const saved = result.administrator;
      if (saved) {
        const normalized: Admin = {
          ...saved,
          active: Boolean(saved.active),
          hasPassword: Boolean(saved.hasPassword),
          updatedAt: new Date(saved.updatedAt).toLocaleString('fa-IR'),
        };
        setAdmins((current) => [...current.filter((item) => item.id !== normalized.id), normalized]);
      }
      setEmail('');
      setPassword('');
      setRole('viewer');
      setMessageType('success');
      setMessage('دسترسی مدیر با موفقیت افزوده یا به‌روزرسانی شد.');
    } catch (error) {
      setMessageType('error');
      setMessage(error instanceof Error ? error.message : 'خطا');
    } finally {
      setBusy('');
    }
  }

  async function toggle(admin: Admin) {
    setBusy(admin.id);
    setMessage('');
    try {
      const response = await fetch('/api/admin/administrators', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: admin.id, active: !admin.active }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'خطا در تغییر وضعیت');
      setAdmins((current) =>
        current.map((item) =>
          item.id === admin.id
            ? { ...item, active: !item.active, updatedAt: new Date().toLocaleString('fa-IR') }
            : item,
        ),
      );
      setMessageType('success');
      setMessage('وضعیت حساب مدیر به‌روزرسانی شد.');
    } catch (error) {
      setMessageType('error');
      setMessage(error instanceof Error ? error.message : 'خطا');
    } finally {
      setBusy('');
    }
  }

  const activeCount = admins.filter((item) => item.active).length + 1;

  function edit(admin: Admin) {
    setEmail(admin.email);
    setRole(admin.role);
    setPassword('');
    setMessage('برای تغییر نقش، نقش جدید را انتخاب کنید؛ برای تعویض رمز نیز رمز تازه را وارد کنید.');
    setMessageType('success');
    document.getElementById('admin-email')?.focus();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
      {/* Add Administrator Card */}
      <section className="surface rounded-3xl border border-border bg-card p-6 shadow-xs">
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20">
            <UserPlus size={19} />
          </span>
          <div>
            <h2 className="text-base font-black text-foreground">افزودن یا تغییر سطح مدیر</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">مشخص کردن آدرس ایمیل و نقش مجاز در سامانه</p>
          </div>
        </div>

        <form onSubmit={save} className="mt-5 space-y-4">
          <div>
            <label htmlFor="admin-email" className="block text-xs font-bold text-muted-foreground">
              آدرس ایمیل مدیر
            </label>
            <Input
              id="admin-email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
              maxLength={254}
              autoComplete="username"
              placeholder="admin@example.com"
              dir="ltr"
              className="mt-1.5 h-11 text-xs md:text-sm font-mono"
            />
          </div>

          <div>
            <label htmlFor="admin-password" className="block text-xs font-bold text-muted-foreground">
              رمز ورود اختصاصی
            </label>
            <div className="relative mt-1.5">
              <Input
                id="admin-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? 'text' : 'password'}
                minLength={password ? 12 : undefined}
                maxLength={128}
                autoComplete="new-password"
                placeholder="برای مدیر جدید حداقل ۱۲ کاراکتر"
                dir="ltr"
                className="h-11 pl-11 text-left font-mono"
              />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'پنهان‌کردن رمز' : 'نمایش رمز'} className="absolute left-3 top-3 text-muted-foreground hover:text-foreground">
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">برای مدیر جدید الزامی است؛ هنگام ویرایش مدیر موجود، خالی بگذارید تا رمز قبلی حفظ شود.</p>
          </div>

          <div>
            <label htmlFor="admin-role" className="block text-xs font-bold text-muted-foreground">
              نقش و سطح دسترسی
            </label>
            <select
              id="admin-role"
              value={role}
              onChange={(event) => setRole(event.target.value as Admin['role'])}
              className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 text-xs md:text-sm font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="viewer">مشاهده‌گر (فقط خواندن گزارش‌ها و فهرست‌ها)</option>
              <option value="manager">مدیر عملیاتی (مدیریت منابع، آزمون‌ها و لاگ‌ها)</option>
              <option value="owner">مالک ارشد (دسترسی کامل، تعیین مدیران و بکاپ)</option>
            </select>
          </div>

          <Button
            type="submit"
            disabled={!email || Boolean(busy)}
            className="h-11 w-full gap-2 rounded-xl bg-primary font-bold text-primary-foreground shadow-xs transition hover:bg-primary/90"
          >
            <ShieldCheck size={16} />
            {busy === 'new' ? 'در حال ذخیره‌سازی...' : 'ثبت دسترسی مدیر'}
          </Button>
        </form>

        {message && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-2xl p-3.5 text-xs font-bold ${
              messageType === 'success'
                ? 'border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'border border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400'
            }`}
          >
            {messageType === 'success' ? <CheckCircle2 size={16} className="shrink-0" /> : <UserRoundX size={16} className="shrink-0" />}
            <span>{message}</span>
          </div>
        )}
      </section>

      {/* Existing Administrators List */}
      <section className="surface rounded-3xl border border-border bg-card p-6 shadow-xs">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Shield size={19} />
            </span>
            <div>
              <h2 className="text-base font-black text-foreground">مدیران دارای دسترسی</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">فهرست مدیران تعریف‌شده در سامانه</p>
            </div>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
            {fa.format(activeCount)} دسترسی فعال
          </span>
        </div>

        <div className="mt-5 space-y-3">
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p dir="ltr" className="truncate font-mono text-xs font-bold text-foreground">{bootstrapOwnerEmail}</p>
                <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">فعال</span>
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[10px] font-bold text-primary">مالک اصلی سرور</span>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">این حساب از تنظیمات امن سرور مدیریت می‌شود و از این صفحه قابل تعلیق نیست.</p>
            </div>
          </div>

          {admins.map((admin) => (
            <div
              key={admin.id}
              className="flex flex-col justify-between gap-4 rounded-2xl border border-border bg-muted/40 p-4 transition sm:flex-row sm:items-center hover:bg-muted/70"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-card border border-border text-xs font-mono font-bold text-foreground">
                    {admin.email.charAt(0).toUpperCase()}
                  </span>
                  <p dir="ltr" className="truncate text-xs md:text-sm font-bold text-foreground font-mono">
                    {admin.email}
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                      admin.active
                        ? 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20 dark:text-emerald-400'
                        : 'bg-muted text-muted-foreground border border-border'
                    }`}
                  >
                    {admin.active ? 'فعال' : 'معلق'}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-bold text-foreground">{roleLabel(admin.role)}</span>
                  <span>·</span>
                  <span className={admin.hasPassword ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>{admin.hasPassword ? 'رمز ورود تنظیم شده' : 'نیازمند تعیین رمز'}</span>
                  <span>·</span>
                  <span className="flex items-center gap-1 text-[11px]">
                    <Clock size={12} />
                    به‌روزرسانی: {admin.updatedAt}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={Boolean(busy)} onClick={() => edit(admin)} className="shrink-0 gap-1.5 rounded-xl text-xs font-bold">
                  <Pencil size={14} /> ویرایش نقش یا رمز
                </Button>
                <Button
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => setPendingToggle(admin)}
                  className={`shrink-0 gap-1.5 rounded-xl text-xs font-bold ${
                  admin.active
                    ? 'border-amber-500/30 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400'
                }`}
              >
                {admin.active ? <UserRoundX size={15} /> : <UserRoundCheck size={15} />}
                {admin.active ? 'تعلیق دسترسی' : 'فعال‌سازی مجدد'}
                </Button>
              </div>
            </div>
          ))}

          {!admins.length && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              هنوز مدیر دیگری ثبت نشده است.
            </p>
          )}
        </div>
      </section>

      <AlertDialog open={Boolean(pendingToggle)} onOpenChange={(open) => !open && setPendingToggle(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingToggle?.active ? 'دسترسی این مدیر معلق شود؟' : 'دسترسی این مدیر دوباره فعال شود؟'}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingToggle?.active ? 'نشست‌های فعلی این مدیر در اولین درخواست بعدی بی‌اعتبار می‌شوند و دیگر به داده‌ها دسترسی نخواهد داشت.' : 'این مدیر دوباره می‌تواند با ایمیل و رمز اختصاصی خود وارد سامانه شود.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const target = pendingToggle; setPendingToggle(null); if (target) void toggle(target); }}>تأیید</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function roleLabel(role: Admin['role']) {
  return role === 'owner' ? 'مالک ارشد سامانه' : role === 'manager' ? 'مدیر عملیاتی' : 'مشاهده‌گر گزارش‌ها';
}
