'use client';

import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, KeyRound, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function AddSourceDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [kind, setKind] = useState<'chatbot' | 'test' | 'matchmaking'>('chatbot');
  const [platform, setPlatform] = useState<'bale' | 'eitaa' | 'telegram' | 'web'>('bale');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate(e: SyntheticEvent) {
    e.preventDefault();
    const normalizedSlug = slug.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name.trim() || !normalizedSlug) {
      setError('لطفاً نام و شناسه انگلیسی منبع را وارد کنید.');
      return;
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(normalizedSlug)) {
      setError('شناسه باید ۲ تا ۶۳ نویسه و فقط شامل حروف انگلیسی کوچک، عدد و خط تیره باشد.');
      return;
    }
    setBusy(true);
    setError('');

    try {
      const res = await fetch('/api/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: normalizedSlug,
          kind,
          platform,
        }),
      });

      const data = (await res.json()) as { ok?: boolean; secret?: string; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'خطا در ثبت منبع');
      }

      if (data.secret) {
        setSlug(normalizedSlug);
        setCreatedSecret(data.secret);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطای ارتباط با سرور');
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('کپی خودکار انجام نشد؛ کلید را به‌صورت دستی انتخاب و کپی کنید.');
    }
  }

  function handleClose(isOpen: boolean) {
    if (!isOpen) {
      setName('');
      setSlug('');
      setError('');
      setCreatedSecret(null);
      setOpen(false);
      router.refresh();
    } else {
      setOpen(true);
    }
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="gap-2 bg-primary font-bold text-primary-foreground hover:bg-primary/90"
      >
        <Plus size={18} />
        افزودن منبع جدید
      </Button>

      <AlertDialog open={open} onOpenChange={handleClose}>
        <AlertDialogContent dir="rtl" className="max-w-lg border border-border bg-card text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              {createdSecret ? 'کلید اتصال تولید شد' : 'ثبت منبع جدید'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {createdSecret
                ? 'این کلید اختصاصی را در متغیرهای محیطی منبع جدید قرار دهید. به دلایل امنیتی، این کلید دیگر نمایش داده نخواهد شد.'
                : 'این فرم فقط منبع و کلید اتصال را در CRM ثبت می‌کند. برای دریافت داده، برنامه مبدأ باید رویدادها را به API سامانه ارسال کند.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {createdSecret ? (
            <div className="space-y-4 py-2">
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-400">
                  <KeyRound size={16} />
                  کلید اتصال اختصاصی (X-CRM-Key)
                </div>
                <div className="mt-3 flex gap-2">
                  <code dir="ltr" className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-background border border-border p-2.5 text-xs font-mono font-bold text-foreground">
                    {createdSecret}
                  </code>
                  <Button onClick={copySecret} variant="outline" size="icon" className="border-border bg-card">
                    {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                  </Button>
                </div>
              </div>
              <p className="text-xs leading-6 text-muted-foreground">
                شناسه منبع (X-CRM-Source): <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-bold text-foreground">{slug}</code>
              </p>
              <p className="text-xs leading-6 text-muted-foreground">نشانی ارسال: <code dir="ltr">https://crm.haminyar.ir/api/v1/events</code>. کلید را با هدر X-CRM-Key و شناسه را با X-CRM-Source بفرستید. تا زمانی که کد ارسال رویداد در منبع نصب نشود، داده‌ای دریافت نمی‌شود.</p>
            </div>
          ) : (
            <form id="create-source-form" onSubmit={handleCreate} className="space-y-4 py-2">
              <div>
                <label htmlFor="source-name" className="block text-xs font-bold text-muted-foreground">نام نمایشی منبع</label>
                <Input
                  id="source-name"
                  required
                  maxLength={100}
                  placeholder="مثال: مشاور هوشمند خانواده"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1.5 h-10 border-border bg-background text-foreground"
                />
              </div>

              <div>
                <label htmlFor="source-slug" className="block text-xs font-bold text-muted-foreground">شناسه انگلیسی یکتا (Slug)</label>
                <Input
                  id="source-slug"
                  required
                  minLength={2}
                  maxLength={63}
                  placeholder="مثال: family-advisor"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="mt-1.5 h-10 text-left font-mono"
                  dir="ltr"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="source-kind" className="block text-xs font-bold text-muted-foreground">نوع منبع</label>
                  <select
                    id="source-kind"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as 'chatbot' | 'test' | 'matchmaking')}
                    className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                  >
                    <option value="chatbot">چت‌بات</option>
                    <option value="test">آزمون</option>
                    <option value="matchmaking">همسان‌گزینی</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="source-platform" className="block text-xs font-bold text-muted-foreground">پلتفرم</label>
                  <select
                    id="source-platform"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value as 'bale' | 'eitaa' | 'telegram' | 'web')}
                    className="mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                  >
                    <option value="bale">بله</option>
                    <option value="eitaa">ایتا</option>
                    <option value="telegram">تلگرام</option>
                    <option value="web">وب‌اپ</option>
                  </select>
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-2.5 text-xs font-bold text-red-600 dark:text-red-400">
                  {error}
                </div>
              )}
            </form>
          )}

          <AlertDialogFooter>
            {createdSecret ? (
              <AlertDialogCancel onClick={() => handleClose(false)}>
                بستن و تکمیل
              </AlertDialogCancel>
            ) : (
              <>
                <AlertDialogCancel disabled={busy}>انصراف</AlertDialogCancel>
                <Button
                  type="submit"
                  form="create-source-form"
                  disabled={busy}
                  className="bg-primary font-bold text-primary-foreground hover:bg-primary/90"
                >
                  {busy ? 'در حال ایجاد...' : 'ساخت و دریافت کلید'}
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
