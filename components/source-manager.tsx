'use client';

import { useState } from 'react';
import {
  Activity,
  Check,
  Clock,
  Copy,
  KeyRound,
  Pause,
  Play,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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

type Props = {
  source: {
    id: string;
    slug: string;
    name: string;
    kind: string;
    platform: string;
    status: string;
    hasKey: boolean;
    hasReceivedEvents: boolean;
    lastSeen: string;
    lastSeenAgeHours: number | null;
    totalEvents: number;
    events24h: number;
    failed24h: number;
    storedRecords: number;
  };
  canManage: boolean;
};

const fa = new Intl.NumberFormat('fa-IR');

export function SourceManager({ source, canManage }: Props) {
  const [status, setStatus] = useState(source.status);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [pendingAction, setPendingAction] = useState<'rotate' | 'pause' | null>(null);

  async function act(action: 'rotate' | 'pause' | 'activate') {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/sources/${source.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = (await response.json()) as { status?: string; secret?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'خطا در انجام عملیات');
      if (result.status) setStatus(result.status);
      if (result.secret) setSecret(result.secret);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('کپی خودکار انجام نشد؛ کلید را به‌صورت دستی انتخاب و کپی کنید.');
    }
  }

  const isActive = status === 'active';
  const isPaused = status === 'paused';
  const hasUsableKey = source.hasKey || Boolean(secret);
  const possiblyDelayed = isActive && source.lastSeenAgeHours !== null && source.lastSeenAgeHours >= 48;

  return (
    <article className="group rounded-3xl border border-border bg-card p-6 shadow-xs transition-all hover:border-primary/40 hover:shadow-md">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
        {/* Left / Main Details */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-base font-black text-foreground">{source.name}</h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-bold ${
                isActive
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                  : isPaused
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                  : 'bg-muted text-muted-foreground border border-border'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isActive && hasUsableKey ? 'bg-emerald-500' : isPaused ? 'bg-amber-500' : 'bg-muted-foreground'
                }`}
              />
              {isActive && !hasUsableKey
                ? 'فعال؛ نیازمند کلید اتصال'
                : isActive && source.hasReceivedEvents
                  ? 'کلید فعال؛ رویداد API دریافت شده'
                  : isActive && source.storedRecords > 0
                    ? 'کلید فعال؛ داده تاریخی موجود، منتظر رویداد API'
                  : isActive
                    ? 'کلید فعال؛ هنوز رویداد API دریافت نشده'
                    : isPaused
                      ? 'دریافت داده متوقف است'
                      : 'در انتظار اتصال'}
            </span>

            <span className="rounded-lg bg-muted px-2.5 py-0.5 font-mono text-[11px] font-bold text-muted-foreground" dir="ltr">
              {source.slug}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              پلتفرم: {platformLabel(source.platform)}
            </span>
            <span>·</span>
            <span className="font-semibold text-foreground">نوع: {kindLabel(source.kind)}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Clock size={13} className="text-muted-foreground" />
              آخرین رویداد: {source.lastSeen}
            </span>
          </div>

          {possiblyDelayed && (
            <output className="mt-3 block rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-6 text-amber-800 dark:text-amber-300">
              بیش از ۴۸ ساعت رویداد جدیدی از این منبع نرسیده است. ممکن است منبع کم‌ترافیک باشد یا ارسال با تأخیر انجام شود؛ این پیام به‌تنهایی به معنی قطع بودن سرور نیست.
            </output>
          )}

          {/* Authentication Badge */}
          <div className="mt-3.5 flex items-center gap-2">
            {source.hasKey || secret ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 text-[11px] font-bold text-blue-600 dark:text-blue-400">
                <ShieldCheck size={14} className="text-primary" />
                کلید امنیتی فعال (X-CRM-Key)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                <ShieldAlert size={14} className="text-amber-500" />
                نیازمند تولید کلید اتصال
              </span>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-bold">
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-muted px-3 py-1.5 text-muted-foreground">
              <Activity size={13} /> کل رویدادها: <b className="text-foreground">{fa.format(source.totalEvents)}</b>
            </span>
            <span className="rounded-xl border border-border bg-muted px-3 py-1.5 text-muted-foreground">رکوردهای موجود در CRM: <b className="text-foreground">{fa.format(source.storedRecords)}</b></span>
            <span className="rounded-xl border border-border bg-muted px-3 py-1.5 text-muted-foreground">
              ۲۴ ساعت اخیر: <b className="text-foreground">{fa.format(source.events24h)}</b>
            </span>
            <span className={`rounded-xl border px-3 py-1.5 ${source.failed24h ? 'border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'}`}>
              خطای ۲۴ ساعت: {fa.format(source.failed24h)}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        {canManage && <div className="flex flex-wrap items-center gap-2.5">
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => (source.hasKey || secret ? setPendingAction('rotate') : act('rotate'))}
            className="gap-2 rounded-xl border-border bg-card text-xs font-bold text-foreground hover:bg-muted"
          >
            <RotateCw size={15} className={busy ? 'animate-spin' : ''} />
            {source.hasKey || secret ? 'تولید مجدد کلید' : 'ساخت کلید اتصال'}
          </Button>

          {isActive ? (
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => setPendingAction('pause')}
              className="gap-2 rounded-xl border-amber-500/30 text-xs font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
            >
              <Pause size={15} />
              توقف دریافت داده
            </Button>
          ) : (
            <Button
            disabled={busy || !hasUsableKey}
              variant="outline"
              onClick={() => act('activate')}
              className="gap-2 rounded-xl border-emerald-500/30 bg-emerald-500/10 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
            >
              <Play size={15} />
              فعال‌سازی منبع
            </Button>
          )}
        </div>}
      </div>

      {/* Secret Reveal Box */}
      {secret && (
        <div aria-live="polite" className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
          <div className="flex items-center gap-2 text-xs font-black text-amber-700 dark:text-amber-400">
            <KeyRound size={17} className="text-amber-600" />
            <span>کلید اختصاصی تولید شد — این کلید فقط یک‌بار نمایش داده می‌شود!</span>
          </div>
          <p className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-400/80">
            لطفاً این مقدار را فوراً در فایل کانفیگ یا متغیر محیطی منبع (`X-CRM-Key`) قرار دهید.
          </p>
          <div className="mt-3 flex gap-2">
            <code
              dir="ltr"
              className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-border bg-background p-3 font-mono text-xs font-bold text-foreground shadow-2xs"
            >
              {secret}
            </code>
            <Button
              onClick={copy}
              variant="outline"
              className="h-11 gap-1.5 rounded-xl border-border bg-card px-4 text-xs font-bold text-foreground shadow-2xs hover:bg-muted"
            >
              {copied ? (
                <>
                  <Check size={16} className="text-emerald-600" />
                  <span>کپی شد</span>
                </>
              ) : (
                <>
                  <Copy size={16} />
                  <span>کپی کلید</span>
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs font-bold text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Confirmation Modal */}
      <AlertDialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => !open && setPendingAction(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction === 'rotate' ? 'کلید اتصال جدید تولید شود؟' : 'دریافت داده از این منبع متوقف شود؟'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction === 'rotate'
                ? 'با ساخت کلید جدید، کلید قبلی فوراً نامعتبر می‌شود و ربات یا وب‌اپ تا زمان تنظیم کلید جدید قادر به ارسال داده نخواهد بود.'
                : 'با توقف این منبع، داده‌های قبلی حفظ می‌شوند اما رویدادهای جدید ورودی موقتاً رد خواهند شد.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              className={pendingAction === 'pause' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-teal-600 hover:bg-teal-700'}
              onClick={() => {
                const action = pendingAction;
                setPendingAction(null);
                if (action) void act(action);
              }}
            >
              تأیید عملیات
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

function platformLabel(value: string) {
  return ({ bale: 'پیام‌رسان بله', eitaa: 'پیام‌رسان ایتا', telegram: 'تلگرام', web: 'وب‌اپلیکیشن' } as Record<string, string>)[value] ?? value;
}

function kindLabel(value: string) {
  return ({ chatbot: 'چت‌بات هوشمند', test: 'ارزیابی و آزمون', matchmaking: 'همسان‌گزینی' } as Record<string, string>)[value] ?? value;
}
