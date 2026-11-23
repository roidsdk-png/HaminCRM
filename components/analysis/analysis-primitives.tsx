'use client';

import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  Inbox,
  LoaderCircle,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export const faNumber = new Intl.NumberFormat('fa-IR');
export const faPercent = new Intl.NumberFormat('fa-IR', {
  maximumFractionDigits: 1,
});
export const selectClass =
  'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50';

export function formatDate(value?: string | number | null) {
  if (!value) return 'ثبت نشده';
  const date = new Date(
    typeof value === 'number' && value < 1_000_000_000_000
      ? value * 1_000
      : value,
  );
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tehran',
  }).format(date);
}

export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block space-y-2 text-xs font-semibold">
      <span>{label}</span>
      {children}
      {hint && (
        <span className="block text-[11px] font-normal leading-5 text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}

export function EmptyState({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border px-5 py-9 text-center">
      <Inbox className="mb-4 size-8 text-muted-foreground/60" />
      <p className="text-sm font-bold">{title}</p>
      {detail && (
        <p className="mt-2 max-w-lg text-xs leading-7 text-muted-foreground">
          {detail}
        </p>
      )}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm"
      role="alert"
    >
      <AlertCircle className="mt-0.5 size-5 shrink-0 text-rose-600 dark:text-rose-400" />
      <div className="flex-1">
        <p className="leading-7">{message}</p>
        {retry && (
          <Button variant="outline" className="mt-3" onClick={retry}>
            تلاش دوباره
          </Button>
        )}
      </div>
    </div>
  );
}

export function LoadingState({
  label = 'در حال دریافت اطلاعات',
}: {
  label?: string;
}) {
  return (
    <output className="flex min-h-36 items-center justify-center gap-3 text-sm text-muted-foreground">
      <LoaderCircle className="size-5 animate-spin" />
      {label}
    </output>
  );
}

export function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-3 text-3xl font-black tabular-nums">
        {faNumber.format(value)}
      </p>
      {hint && (
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setFailed(true);
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={copy}>
        {copied ? <Check /> : <Copy />}
        {copied ? 'کپی شد' : 'کپی متن'}
      </Button>
      {failed && (
        <output className="text-[11px] text-rose-600">
          دسترسی کلیپ‌بورد فعال نیست
        </output>
      )}
    </span>
  );
}

export function EvidenceButton({
  count,
  onClick,
}: {
  count?: number;
  onClick: () => void;
}) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <BookOpen />
      شواهد
      {count !== undefined && (
        <span className="text-muted-foreground">
          ({faNumber.format(count)})
        </span>
      )}
    </Button>
  );
}
