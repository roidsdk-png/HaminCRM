'use client';

import { BookOpen, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AnalysisEvidence,
  AnalysisFilters,
  AnalysisWords,
} from '@/lib/analysis/types';
import { Button } from '@/components/ui/button';
import { analysisRequest, downloadText, errorMessage } from './analysis-api';
import { filtersQuery } from './analysis-filters';
import {
  EmptyState,
  ErrorState,
  faNumber,
  Field,
  LoadingState,
  Panel,
  selectClass,
} from './analysis-primitives';

export function AnalysisWordsPanel({
  filters,
  onEvidence,
}: {
  filters: AnalysisFilters;
  onEvidence: (ids: string[]) => void;
}) {
  const [length, setLength] = useState('1');
  const [metric, setMetric] = useState<
    'conversations' | 'messages' | 'occurrences'
  >('conversations');
  const [sort, setSort] = useState<{
    key: 'term' | 'conversations' | 'messages' | 'occurrences';
    ascending: boolean;
  }>({ key: 'conversations', ascending: false });
  const [data, setData] = useState<AnalysisWords | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [pendingTerm, setPendingTerm] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const query = filtersQuery(filters);
    query.set('ngram', length);
    query.set('limit', '80');
    query.set('metric', metric);
    const kickoff = window.setTimeout(() => {
      setLoading(true);
      setError('');
      setData(null);
      void analysisRequest<AnalysisWords>(`/words?${query}`, {
        signal: controller.signal,
      })
        .then(setData)
        .catch((failure) => {
          if (!controller.signal.aborted) setError(errorMessage(failure));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(kickoff);
      controller.abort();
    };
  }, [filters, length, metric, reload]);

  async function openTerm(term: string) {
    setPendingTerm(term);
    try {
      const query = new URLSearchParams({
        term,
        filters: JSON.stringify(filters),
        limit: '5',
      });
      const result = await analysisRequest<{ items: AnalysisEvidence[] }>(
        `/word-evidence?${query}`,
      );
      if (result.items.length === 0) {
        setError('برای این عبارت شاهد قابل نمایش پیدا نشد.');
        return;
      }
      onEvidence(result.items.map((item) => item.id));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setPendingTerm('');
    }
  }

  function exportWords() {
    if (!data) return;
    const rows = [
      ['معیار رتبه‌بندی', data.metric],
      ['نسخهٔ واژه‌نامه', data.lexiconVersion ?? ''],
      ['دامنهٔ محاسبه', JSON.stringify(filters)],
      ['تعداد رکورد واجد شرایط', String(data.totalRecords)],
      [],
      ['عبارت', 'تعداد وقوع', 'پیام‌ها', 'گفتگوها'],
      ...data.items.map((item) => [
        item.term,
        String(item.occurrences),
        String(item.messages),
        String(item.conversations),
      ]),
    ];
    downloadText(
      'audience-language.csv',
      rows
        .map((row) =>
          row.map((value) => `"${value.replaceAll('"', '""')}"`).join(','),
        )
        .join('\r\n'),
      'text/csv;charset=utf-8',
    );
  }

  const metricTitle = {
    conversations: 'گفتگوها',
    messages: 'پیام‌ها',
    occurrences: 'تعداد وقوع',
  }[metric];
  const tableItems = [...(data?.items ?? [])].sort((a, b) => {
    const difference =
      sort.key === 'term'
        ? a.term.localeCompare(b.term, 'fa')
        : Number(a[sort.key]) - Number(b[sort.key]);
    return (
      (sort.ascending ? 1 : -1) * difference ||
      a.term.localeCompare(b.term, 'fa')
    );
  });
  function sortBy(key: typeof sort.key) {
    setSort((previous) => ({
      key,
      ascending: previous.key === key ? !previous.ascending : key === 'term',
    }));
  }
  const maximum = Math.max(
    1,
    ...(data?.items.map((item) => item[metric]) ?? []),
  );
  return (
    <Panel>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-bold">زبان واقعی مخاطب</h2>
          <p className="mt-2 text-xs leading-7 text-muted-foreground">
            اندازه و ترتیب عبارت‌ها بر اساس معیار انتخاب‌شده است. روی عبارت کلیک
            کنید تا متن مبدأ را ببینید.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="معیار فراوانی">
            <select
              className={selectClass}
              value={metric}
              onChange={(event) =>
                setMetric(event.target.value as typeof metric)
              }
            >
              <option value="conversations">گفتگوها</option>
              <option value="messages">پیام‌ها</option>
              <option value="occurrences">تعداد وقوع</option>
            </select>
          </Field>
          <Field label="طول عبارت">
            <select
              className={selectClass}
              value={length}
              onChange={(event) => setLength(event.target.value)}
            >
              <option value="1">واژه</option>
              <option value="2">دو واژه</option>
              <option value="3">سه واژه</option>
            </select>
          </Field>
          <Button
            variant="outline"
            className="h-10"
            disabled={!data?.items.length}
            onClick={exportWords}
          >
            <Download />
            خروجی جدول
          </Button>
        </div>
      </div>
      {loading && <LoadingState />}
      {error && (
        <div className="mt-5">
          <ErrorState
            message={error}
            retry={() => setReload((value) => value + 1)}
          />
        </div>
      )}
      {!loading && data?.items.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title="عبارتی در دامنهٔ انتخاب‌شده پیدا نشد"
            detail="بازه و منابع را بررسی کنید یا داده‌های CRM را همگام‌سازی کنید."
          />
        </div>
      )}
      {!loading && !!data?.items.length && (
        <>
          <div
            className="mt-6 flex min-h-64 flex-wrap items-center justify-center gap-x-5 gap-y-3 rounded-2xl bg-primary/[0.035] px-5 py-8"
            aria-label="ابر واژه و عبارت"
          >
            {data.items.slice(0, 45).map((item, index) => (
              <button
                key={item.term}
                type="button"
                disabled={!!pendingTerm}
                onClick={() => void openTerm(item.term)}
                className="rounded-lg px-1 py-0.5 font-bold transition hover:bg-primary/10 focus-visible:outline-primary disabled:opacity-60"
                style={{
                  fontSize: `${13 + 22 * Math.sqrt(item[metric] / maximum)}px`,
                  color: [
                    'var(--primary)',
                    'var(--chart-indigo)',
                    'var(--chart-teal)',
                    'var(--chart-violet)',
                  ][index % 4],
                }}
                title={`${faNumber.format(item[metric])} ${metricTitle}`}
              >
                {item.term}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            محاسبه روی {faNumber.format(data.totalRecords)} رکورد واجد شرایط
            انجام شده است. حداکثر ۸۰ عبارت نخست نمایش داده می‌شود.
          </p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[460px] text-right text-xs">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  {(
                    [
                      { key: 'term', label: 'واژه یا عبارت' },
                      { key: 'occurrences', label: 'تعداد وقوع' },
                      { key: 'messages', label: 'پیام‌ها' },
                      { key: 'conversations', label: 'گفتگوها' },
                    ] as const
                  ).map((column) => (
                    <th
                      key={column.key}
                      className="pb-3 font-medium"
                      aria-sort={
                        sort.key === column.key
                          ? sort.ascending
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button type="button" onClick={() => sortBy(column.key)}>
                        {column.label}
                        {sort.key === column.key
                          ? sort.ascending
                            ? ' ↑'
                            : ' ↓'
                          : ''}
                      </button>
                    </th>
                  ))}
                  <th className="pb-3 font-medium">
                    <span className="sr-only">بررسی شواهد</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tableItems.map((item) => (
                  <tr
                    key={item.term}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="py-3 font-semibold">{item.term}</td>
                    <td className="py-3 tabular-nums">
                      {faNumber.format(item.occurrences)}
                    </td>
                    <td className="py-3 tabular-nums">
                      {faNumber.format(item.messages)}
                    </td>
                    <td className="py-3 tabular-nums">
                      {faNumber.format(item.conversations)}
                    </td>
                    <td className="py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!!pendingTerm}
                        onClick={() => void openTerm(item.term)}
                      >
                        <BookOpen />
                        {pendingTerm === item.term ? 'دریافت…' : 'شواهد'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
