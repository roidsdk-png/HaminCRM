'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, Download, FileJson, FileUp, Info, Upload } from 'lucide-react';
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

const fa = new Intl.NumberFormat('fa-IR');

export function RestoreBackup({ bare = false }: { bare?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function restore() {
    if (!file) return;
    setBusy(true);
    setStatus('');
    setError('');
    try {
      const response = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: await file.text(),
      });
      const result = (await response.json()) as { inserted?: number; skippedSecurityRecords?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'خطا در بازیابی فایل پشتیبان');
      const securityNote = result.skippedSecurityRecords ? ` ${fa.format(result.skippedSecurityRecords)} تنظیم دسترسی برای حفظ امنیت وارد نشد.` : '';
      setStatus(`${fa.format(result.inserted ?? 0)} رکورد جدید با موفقیت با دیتابیس ادغام شد.${securityNote}`);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطای نامشخص در پردازش فایل');
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs leading-6 text-foreground">
        <Info size={18} className="mt-0.5 shrink-0 text-amber-600" />
        <div>
          <span className="font-bold">سیاست ادغام ایمن: </span>
          <span>
            اطلاعات فایل پشتیبان مستقیماً به بانک داده افزوده می‌شوند. هیچ رکوردی از داده‌های موجود حذف یا رونویسی نخواهد شد
            و رکوردهای تکراری به صورت خودکار نادیده گرفته می‌شوند.
            تنظیمات ورود مدیران و رمزها برای جلوگیری از تغییر ناخواسته سطح دسترسی بازیابی نمی‌شوند.
          </span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
        <Button type="button" variant="outline" onClick={() => window.location.assign('/api/admin/backup')} className="h-11 gap-2 rounded-xl font-bold">
          <Download size={16} /> خروجی JSON برای ادغام (نه بکاپ کامل)
        </Button>
        <div className="min-w-0">
          <Input
            ref={inputRef}
            id="backup-file"
            type="file"
            accept="application/json,.json"
            aria-label="انتخاب فایل پشتیبان JSON"
            onChange={(e) => {
              const selected = e.target.files?.[0] ?? null;
              setError('');
              if (selected && selected.size > 25_000_000) {
                setFile(null);
                setError('حجم فایل پشتیبان نباید بیشتر از ۲۵ مگابایت باشد.');
                e.target.value = '';
                return;
              }
              setFile(selected);
            }}
            className="sr-only"
          />
          <button type="button" onClick={() => inputRef.current?.click()} className="flex h-11 w-full min-w-0 items-center gap-2 rounded-xl border border-border bg-background px-4 text-right text-xs font-bold text-foreground hover:bg-muted">
            <FileJson size={17} className="shrink-0 text-primary" />
            <span className="truncate">{file ? `${file.name} — ${formatFileSize(file.size)}` : 'انتخاب فایل پشتیبان JSON'}</span>
          </button>
        </div>
        <Button
          disabled={!file || busy}
          onClick={() => setConfirmOpen(true)}
          className="h-11 gap-2 rounded-xl bg-primary px-6 font-bold text-primary-foreground shadow-xs transition hover:bg-primary/90 sm:w-auto"
        >
          <Upload size={16} />
          {busy ? 'در حال بازیابی اطلاعات...' : 'بازیابی و ادغام اطلاعات'}
        </Button>
      </div>

      {status && (
        <div aria-live="polite" className="flex items-center gap-2 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
          <span>{status}</span>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3.5 text-xs font-bold text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>فایل پشتیبان با دیتابیس ادغام شود؟</AlertDialogTitle>
            <AlertDialogDescription>رکوردهای جدید افزوده می‌شوند و موارد تکراری نادیده گرفته خواهند شد. این عملیات ممکن است چند دقیقه طول بکشد.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOpen(false); void restore(); }}>تأیید و شروع ادغام</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  return bare ? (
    <div>{content}</div>
  ) : (
    <div className="surface rounded-3xl border border-border bg-card p-6 shadow-xs">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/10 text-amber-700 border border-amber-500/20 dark:text-amber-400">
          <FileUp size={20} />
        </span>
        <h2 className="text-base font-black text-foreground">بازیابی و ادغام نسخه پشتیبان</h2>
      </div>
      {content}
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${fa.format(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${fa.format(Math.round(bytes / 1024))} کیلوبایت`;
  return `${fa.format(Number((bytes / 1024 / 1024).toFixed(1)))} مگابایت`;
}
