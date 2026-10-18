'use client';

import { useEffect, useState } from 'react';
import { DatabaseBackup, Download, RotateCw, Trash2 } from 'lucide-react';

type Backup = { name: string; bytes: number; createdAt: string };
const fa = new Intl.NumberFormat('fa-IR');

export function BackupManager() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    try {
      const response = await fetch('/api/admin/backups', { cache: 'no-store' });
      const result = await response.json() as { backups?: Backup[]; error?: string };
      if (!response.ok) throw new Error(result.error || 'فهرست بکاپ‌ها در دسترس نیست.');
      setError('');
      setBackups(result.backups ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'خطا در دریافت بکاپ‌ها');
    }
  }

  useEffect(() => {
    fetch('/api/admin/backups', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json() as { backups?: Backup[]; error?: string };
        if (!response.ok) throw new Error(result.error || 'فهرست بکاپ‌ها در دسترس نیست.');
        setBackups(result.backups ?? []);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'خطا در دریافت بکاپ‌ها'));
  }, []);

  async function create() {
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await fetch('/api/admin/backups', { method: 'POST' });
      const result = await response.json() as { backup?: Backup; error?: string };
      if (!response.ok) throw new Error(result.error || 'ساخت بکاپ ناموفق بود.');
      setNotice('نسخه کامل دیتابیس CRM ساخته شد.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'خطا در ساخت بکاپ');
    } finally { setBusy(false); }
  }

  async function remove(name: string) {
    if (!window.confirm(`بکاپ ${name} از سرور CRM حذف شود؟ این کار قابل بازگشت نیست.`)) return;
    setBusy(true); setNotice(''); setError('');
    try {
      const response = await fetch(`/api/admin/backups/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'حذف بکاپ ناموفق بود.');
      setNotice(`بکاپ ${name} حذف شد؛ دیتابیس فعال CRM تغییر نکرد.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'خطا در حذف بکاپ');
    } finally { setBusy(false); }
  }

  return <section className="rounded-3xl border border-border bg-card p-5 shadow-xs md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div>
        <h2 className="text-sm font-black text-foreground">بکاپ‌های کامل دیتابیس CRM</h2>
        <p className="mt-1 text-xs leading-6 text-muted-foreground">فایل SQLite فشرده با کپی سازگار از دیتابیس مرکزی؛ شامل داده‌های ثبت‌شده ربات‌ها، آزمون‌ها و وب‌اپ‌ها در CRM. دیتابیس‌های مستقل برنامه‌های مبدأ در این بکاپ نیستند.</p>
      </div>
      <button type="button" disabled={busy} onClick={() => void create()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-50"><DatabaseBackup size={16} />{busy ? 'در حال انجام...' : 'ساخت بکاپ جدید'}</button>
    </div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
    {notice && <output className="mt-4 block rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400">{notice}</output>}
    <div className="mt-4 space-y-2">
      {backups.map((backup) => <div key={backup.name} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
        <div className="min-w-0"><p dir="ltr" className="break-all text-xs font-bold text-foreground">{backup.name}</p><p className="mt-1 text-[11px] text-muted-foreground">{new Date(backup.createdAt).toLocaleString('fa-IR')} · {fa.format(Math.round(backup.bytes / 1024))} کیلوبایت</p></div>
        <div className="flex gap-2">
          <a href={`/api/admin/backups/${encodeURIComponent(backup.name)}`} className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-2 text-xs font-bold text-foreground"><Download size={14} />دانلود</a>
          <button type="button" disabled={busy} onClick={() => void remove(backup.name)} className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-bold text-red-600 disabled:opacity-50"><Trash2 size={14} />حذف</button>
        </div>
      </div>)}
      {!backups.length && !error && <p className="py-6 text-center text-xs text-muted-foreground">بکاپی برای نمایش وجود ندارد.</p>}
    </div>
    <button type="button" onClick={() => void load()} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary"><RotateCw size={13} />بازخوانی فهرست</button>
  </section>;
}
