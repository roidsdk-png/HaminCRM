'use client';

import { useState } from 'react';
import { Clock, Trash2 } from 'lucide-react';

export type IngestionErrorItem = {
  id: string;
  source: string;
  type: string;
  error: string;
  received: string;
};

export function IngestionErrorList({ initialErrors }: { initialErrors: IngestionErrorItem[] }) {
  const [errors, setErrors] = useState(initialErrors);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  async function dismiss(item: IngestionErrorItem) {
    if (!window.confirm(`خطای ثبت‌شده برای «${item.source}» از فهرست پاک شود؟ این کار داده‌های سالم CRM را حذف نمی‌کند.`)) return;
    setBusyId(item.id);
    setMessage('');
    try {
      const response = await fetch(`/api/admin/ingestion-errors/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'پاک‌کردن خطا ناموفق بود.');
      setErrors((current) => current.filter((error) => error.id !== item.id));
      setMessage('خطای انتخاب‌شده پاک شد و این عملیات در لاگ مدیریتی ثبت شد.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'پاک‌کردن خطا ناموفق بود.');
    } finally {
      setBusyId('');
    }
  }

  return <>
    {message && <output className="mb-3 block rounded-xl border border-border bg-muted/40 p-3 text-[11px] text-foreground">{message}</output>}
    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
      {errors.map((item) => (
        <div key={item.id} className="rounded-2xl border border-red-500/20 bg-red-500/10 p-3.5 text-xs transition hover:bg-red-500/15">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-foreground">{item.source}</span>
            <span className="rounded bg-background px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground border border-border">{item.type}</span>
          </div>
          <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400 leading-6 break-words">{item.error}</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Clock size={12} /><span>{item.received}</span></div>
            <button type="button" disabled={busyId === item.id} onClick={() => void dismiss(item)} className="inline-flex items-center gap-1 rounded-lg border border-red-500/25 bg-background px-2.5 py-1.5 text-[10px] font-bold text-red-600 disabled:opacity-50">
              <Trash2 size={13} />{busyId === item.id ? 'در حال پاک‌کردن...' : 'پاک‌کردن خطا'}
            </button>
          </div>
        </div>
      ))}
      {!errors.length && <div className="py-16 text-center text-xs text-muted-foreground">هیچ خطایی در دریافت رویدادها ثبت نشده است. سامانه پایدار است.</div>}
    </div>
  </>;
}
