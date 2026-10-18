'use client';

import { useState } from 'react';
import { RotateCw } from 'lucide-react';

export function CacheManager() {
  const [message, setMessage] = useState('');
  async function clearLocalCache() {
    let removed = 0;
    if ('caches' in window) {
      const names = await window.caches.keys();
      for (const name of names) {
        if (await window.caches.delete(name)) removed++;
      }
    }
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (const key of Object.keys(storage)) {
        if (/^(hamin-crm|crm-|theme$)/i.test(key)) { storage.removeItem(key); removed++; }
      }
    }
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) if (await registration.unregister()) removed++;
    }
    setMessage(`${removed} مورد کش محلی CRM پاک شد. داده‌های دیتابیس و ورود مدیر تغییر نکردند.`);
  }
  return <section className="rounded-3xl border border-border bg-card p-5 md:p-6">
    <h2 className="text-sm font-black text-foreground">وضعیت کش</h2>
    <p className="mt-2 text-xs leading-6 text-muted-foreground">گزارش‌ها، منابع و بکاپ‌ها همیشه از دیتابیس مرکزی خوانده می‌شوند. این گزینه Cache Storage، داده‌های موقت CRM و سرویس‌ورکر همین دامنه را پاک می‌کند؛ اطلاعات دیتابیس، نشست ورود و کش CDN/Cloudflare تغییر نمی‌کنند.</p>
    <button type="button" onClick={() => void clearLocalCache()} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-xs font-bold text-foreground"><RotateCw size={15} />پاک‌سازی کش محلی CRM</button>
    {message && <output className="mt-3 block text-xs text-emerald-700 dark:text-emerald-400">{message}</output>}
  </section>;
}
