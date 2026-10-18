'use client';

import { useState } from 'react';
import { Check, Copy, KeyRound, Link2, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function MagicAccessSettings({ initialActive, initialCreatedAt }: { initialActive: boolean; initialCreatedAt: string | null }) {
  const [active, setActive] = useState(initialActive);
  const [createdAt, setCreatedAt] = useState(initialCreatedAt);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');

  async function generate() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/magic-access', { method: 'POST' });
      const result = await response.json() as { error?: string; link?: string; createdAt?: string };
      if (!response.ok || !result.link) throw new Error(result.error ?? 'ساخت لینک ناموفق بود.');
      setLink(result.link);
      setCreatedAt(result.createdAt ?? new Date().toISOString());
      setActive(true);
      setMessage('لینک ساخته شد. اکنون آن را کپی و در محل امن نگهداری کنید؛ بعداً قابل بازیابی نیست.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'خطا در ساخت لینک');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!window.confirm('این لینک و تمام نشست‌هایی که با آن ساخته شده‌اند فوراً لغو شوند؟')) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/magic-access', { method: 'DELETE' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'لغو لینک ناموفق بود.');
      setActive(false);
      setLink('');
      setCreatedAt(null);
      setMessage('لینک اختصاصی و نشست‌های وابسته با موفقیت لغو شدند.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'خطا در لغو لینک');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="surface rounded-3xl border border-border bg-card p-6 shadow-xs md:p-8">
      <div className="flex flex-col justify-between gap-4 border-b border-border pb-5 md:flex-row md:items-center">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-400">
            <KeyRound size={21} />
          </span>
          <div>
            <h2 className="text-base font-black text-foreground">لینک ورود اختصاصی بدون رمز</h2>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">ورود مستقیم با دسترسی کامل مالک؛ قابل ساخت مجدد و لغو فوری</p>
          </div>
        </div>
        <span className={`w-fit rounded-full border px-3 py-1 text-xs font-bold ${active ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-border bg-muted text-muted-foreground'}`}>
          {active ? 'لینک فعال است' : 'لینک فعالی وجود ندارد'}
        </span>
      </div>

      <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs leading-6 text-amber-800 dark:text-amber-300">
        <div className="flex gap-2"><TriangleAlert size={17} className="mt-1 shrink-0" /><p>هرکس این لینک را داشته باشد، به تمام اطلاعات و قابلیت‌های سامانه دسترسی مالک خواهد داشت. لینک را در پیام عمومی یا دستگاه مشترک قرار ندهید.</p></div>
      </div>

      {link && (
        <div className="mt-5 rounded-2xl border border-primary/25 bg-primary/5 p-4">
          <p className="mb-2 text-xs font-bold text-foreground">این لینک فقط همین حالا نمایش داده می‌شود:</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <code dir="ltr" className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-border bg-background px-3 py-3 text-left text-xs text-foreground">{link}</code>
            <Button type="button" onClick={copy} className="gap-2 rounded-xl font-bold"><Copy size={16} />{copied ? 'کپی شد' : 'کپی لینک'}</Button>
          </div>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" disabled={busy} onClick={generate} className="gap-2 rounded-xl font-bold">
          {busy ? <RefreshCw size={16} className="animate-spin" /> : active ? <RefreshCw size={16} /> : <Link2 size={16} />}
          {active ? 'ساخت لینک جدید و لغو قبلی' : 'ساخت لینک اختصاصی'}
        </Button>
        {active && <Button type="button" variant="outline" disabled={busy} onClick={revoke} className="gap-2 rounded-xl border-red-500/30 font-bold text-red-600 hover:bg-red-500/10 dark:text-red-400"><Trash2 size={16} />حذف و لغو لینک</Button>}
        {createdAt && <span className="text-xs text-muted-foreground">زمان ساخت: {new Date(createdAt).toLocaleString('fa-IR')}</span>}
      </div>
      {message && <p className="mt-4 flex items-center gap-2 text-xs font-bold text-muted-foreground"><Check size={15} className="text-emerald-500" />{message}</p>}
    </section>
  );
}
