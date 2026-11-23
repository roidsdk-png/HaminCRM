'use client';

import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AnalysisFilters, AnalysisRun } from '@/lib/analysis/types';
import { Button } from '@/components/ui/button';
import { analysisRequest, errorMessage } from './analysis-api';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  faNumber,
  formatDate,
} from './analysis-primitives';

const kindLabels: Record<string, string> = {
  challenges: 'چالش‌ها و مسئله‌ها',
  emotions: 'تحلیل هیجان',
  experiences: 'بانک تجربه‌ها',
  research: 'تحقیق آزاد',
  content: 'تولید محتوا',
};
const statusLabels: Record<string, string> = {
  queued: 'در صف',
  running: 'در حال بررسی',
  completed: 'تکمیل‌شده',
  failed: 'ناموفق',
  cancelled: 'لغوشده',
};
const roleLabels: Record<string, string> = {
  user: 'مخاطب',
  assistant: 'ربات',
  system: 'سامانه',
};

function scopeSummary(filters?: AnalysisFilters) {
  if (!filters) return 'دامنهٔ این اجرای قدیمی ثبت نشده است.';
  const parts = [
    filters.sourceIds?.length
      ? `${faNumber.format(filters.sourceIds.length)} منبع`
      : 'همهٔ منابع',
  ];
  if (filters.from || filters.to)
    parts.push(
      `${filters.from || 'ابتدای بازه'} تا ${filters.to || 'انتهای بازه'}`,
    );
  if (filters.kinds?.length) {
    const labels = { message: 'پیام', test: 'آزمون', match: 'فرم ازدواج' };
    parts.push(filters.kinds.map((kind) => labels[kind] || kind).join('، '));
  }
  if (filters.roles?.length)
    parts.push(
      filters.roles.map((role) => roleLabels[role] || role).join('، '),
    );
  if (filters.contactId)
    parts.push(
      filters.includeLinkedContacts
        ? 'مخاطب مشخص و پیوندهای تأییدشده'
        : 'مخاطب مشخص',
    );
  if (filters.province) parts.push(filters.province);
  if (filters.gender) parts.push(filters.gender);
  if (filters.ageFrom !== undefined || filters.ageTo !== undefined)
    parts.push(`سن ${filters.ageFrom ?? '—'} تا ${filters.ageTo ?? '—'}`);
  if (filters.testKey) parts.push(`آزمون ${filters.testKey}`);
  if (filters.scoreKey)
    parts.push(
      `نمرهٔ ${filters.scoreKey} از ${filters.scoreFrom ?? '—'} تا ${filters.scoreTo ?? '—'}`,
    );
  if (filters.includeExcluded)
    parts.push('شامل رکوردهای کنارگذاشته‌شده از آمار');
  return parts.join(' · ');
}

export function AnalysisHistory({
  onOpen,
  refreshKey,
}: {
  onOpen: (run: AnalysisRun) => void | Promise<void>;
  refreshKey?: string;
}) {
  const [items, setItems] = useState<AnalysisRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const result = await analysisRequest<{ items: AnalysisRun[] }>('/runs', {
        signal,
      });
      if (!signal?.aborted) setItems(result.items);
    } catch (failure) {
      if (!signal?.aborted) setError(errorMessage(failure));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load, refreshKey]);

  async function open(item: AnalysisRun) {
    setOpening(item.id);
    setError('');
    try {
      const latest = await analysisRequest<AnalysisRun>(
        `/runs/${encodeURIComponent(item.id)}`,
      );
      setItems((current) =>
        current.map((run) => (run.id === latest.id ? latest : run)),
      );
      await onOpen(latest);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setOpening(null);
    }
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold">سابقهٔ تحلیل‌های من</h2>
          <p className="mt-2 text-xs leading-7 text-muted-foreground">
            صد اجرای اخیر این حساب نمایش داده می‌شود. نتیجه و دامنهٔ هر تحلیل را
            می‌توانید دوباره باز کنید.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={loading || opening !== null}
          onClick={() => void load()}
        >
          <RefreshCw />
          تازه‌سازی
        </Button>
      </div>
      <div className="mt-5 space-y-4">
        {error && <ErrorState message={error} retry={() => void load()} />}
        {loading ? (
          <LoadingState label="در حال دریافت سابقهٔ تحلیل" />
        ) : items.length === 0 ? (
          !error && (
            <EmptyState
              title="هنوز تحلیلی در این حساب ثبت نشده است"
              detail="پس از اجرای تحلیل، وضعیت، دامنه و نتیجهٔ آن در این قسمت در دسترس خواهد بود."
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-160 text-right text-xs leading-6">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th scope="col" className="p-3 font-semibold">
                      نوع و دامنه
                    </th>
                    <th scope="col" className="p-3 font-semibold">
                      زمان ثبت
                    </th>
                    <th scope="col" className="p-3 font-semibold">
                      پوشش بررسی
                    </th>
                    <th scope="col" className="p-3 font-semibold">
                      وضعیت
                    </th>
                    <th scope="col" className="p-3 font-semibold">
                      بازکردن
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-t border-border align-top"
                    >
                      <td className="max-w-sm p-3">
                        <p className="font-bold">
                          {kindLabels[item.kind] || 'تحلیل با قالب قدیمی'}
                        </p>
                        <p className="mt-2 break-words text-muted-foreground">
                          {scopeSummary(item.filters)}
                        </p>
                      </td>
                      <td className="whitespace-nowrap p-3">
                        {formatDate(item.createdAt)}
                      </td>
                      <td className="p-3">
                        <p>
                          {faNumber.format(item.processed ?? 0)} از{' '}
                          {faNumber.format(item.eligible ?? 0)}
                        </p>
                        <p className="text-muted-foreground">رکورد بررسی‌شده</p>
                      </td>
                      <td className="p-3">
                        <p>{statusLabels[item.status] || 'وضعیت قدیمی'}</p>
                        {item.stale && (
                          <p className="mt-2 max-w-48 text-amber-700 dark:text-amber-400">
                            دادهٔ مبدأ تغییر کرده است. تحلیل باید دوباره اجرا
                            شود.
                          </p>
                        )}
                        {item.error && (
                          <p className="mt-2 max-w-48 break-words text-rose-600 dark:text-rose-400">
                            {item.error.message}
                          </p>
                        )}
                      </td>
                      <td className="p-3">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={opening !== null || !kindLabels[item.kind]}
                          onClick={() => void open(item)}
                        >
                          <ArrowLeft />
                          {opening === item.id
                            ? 'در حال بازکردن'
                            : item.stale
                              ? 'بازکردن دامنه'
                              : 'بازکردن تحلیل'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {items.some((item) => item.stale) && (
              <p className="text-xs leading-7 text-muted-foreground">
                برای اجرای دارای دادهٔ تغییریافته، فقط وضعیت و دامنه باز می‌شود و
                نتیجهٔ قدیمی به عنوان گزارش معتبر نمایش داده نمی‌شود.
              </p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
