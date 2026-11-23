'use client';

import { ArrowLeft, ArrowRight, Download, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AnalysisFilters, AnalysisResultPage } from '@/lib/analysis/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { analysisRequest, downloadText, errorMessage } from './analysis-api';
import { ExperienceCard } from './analysis-insights';
import {
  EmptyState,
  ErrorState,
  faNumber,
  Field,
  LoadingState,
  Panel,
  selectClass,
} from './analysis-primitives';
import { RunProgress, type AnalysisRunController } from './analysis-run';

export function AnalysisExperiences({
  filters,
  controller,
  canRun,
  onEvidence,
}: {
  filters: AnalysisFilters;
  controller: AnalysisRunController;
  canRun: boolean;
  onEvidence: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [requestedCount, setRequestedCount] = useState(100);
  const [pageSize, setPageSize] = useState(3);
  const [pages, setPages] = useState<AnalysisResultPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const run = controller.run?.kind === 'experiences' ? controller.run : null;
  const setId = run?.status === 'completed' ? run.resultSetId : undefined;
  const currentPage = pages[pageIndex];

  useEffect(() => {
    const controller = new AbortController();
    const kickoff = window.setTimeout(() => {
      setPages([]);
      setPageIndex(0);
      setError('');
      if (!setId) return;
      setLoading(true);
      void analysisRequest<AnalysisResultPage>(
        `/result-sets/${encodeURIComponent(setId)}/items?limit=${pageSize}`,
        { signal: controller.signal },
      )
        .then((page) => {
          if (!controller.signal.aborted) setPages([page]);
        })
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
  }, [setId, pageSize]);

  async function start(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await controller.launch('/runs', {
        kind: 'experiences',
        query,
        filters,
        limit: requestedCount,
      });
    } catch {
      /* The run controller presents failures. */
    }
  }

  async function nextPage() {
    if (pages[pageIndex + 1]) {
      setPageIndex((value) => value + 1);
      return;
    }
    if (!setId || !currentPage?.nextCursor) return;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({
        limit: String(pageSize),
        cursor: currentPage.nextCursor,
      });
      const page = await analysisRequest<AnalysisResultPage>(
        `/result-sets/${encodeURIComponent(setId)}/items?${query}`,
      );
      setPages((previous) => [...previous, page]);
      setPageIndex((value) => value + 1);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }

  async function exportAll() {
    if (!setId) return;
    setExporting(true);
    setError('');
    try {
      let cursor: string | null = null;
      const text: string[] = [];
      const seen = new Set<string>();
      do {
        const query = new URLSearchParams({ limit: '100' });
        if (cursor) query.set('cursor', cursor);
        const page = await analysisRequest<AnalysisResultPage>(
          `/result-sets/${encodeURIComponent(setId)}/items?${query}`,
        );
        for (const item of page.items) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          text.push(
            `${text.length + 1}. ${item.title}\n\n${item.summary}\n\n${item.reason}\n\nشناسه‌های شواهد\n${item.evidenceIds.join('\n')}`,
          );
        }
        cursor = page.nextCursor;
      } while (cursor);
      downloadText('audience-experiences.txt', text.join('\n\n————————\n\n'));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      <Panel>
        <h2 className="text-base font-bold">کشف تجربه‌های واقعی</h2>
        <p className="mt-2 text-xs leading-7 text-muted-foreground">
          موضوع و معیار تجربه را بنویسید. هر نتیجه با خلاصه، زمینه و شواهد
          گفته‌های مخاطب ارائه می‌شود.
        </p>
        <form onSubmit={start} className="mt-5 space-y-4">
          <Field label="چه تجربه‌هایی را پیدا کنیم؟">
            <Textarea
              value={query}
              required
              maxLength={20_000}
              className="min-h-28 leading-8"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="مثلاً تجربه‌های سخت و غیرمنتظرهٔ کاربران از دخالت خانواده در تصمیم ازدواج را استخراج کن."
            />
          </Field>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="w-44">
              <Field label="تعداد مورد درخواستی">
                <select
                  className={selectClass}
                  value={requestedCount}
                  onChange={(event) =>
                    setRequestedCount(Number(event.target.value))
                  }
                >
                  <option value={3}>۳ تجربه</option>
                  <option value={10}>۱۰ تجربه</option>
                  <option value={25}>۲۵ تجربه</option>
                  <option value={100}>۱۰۰ تجربه</option>
                </select>
              </Field>
            </div>
            <Button
              type="submit"
              className="h-10 rounded-xl"
              disabled={!canRun || controller.busy || !query.trim()}
            >
              <Search />
              استخراج تجربه‌ها
            </Button>
          </div>
        </form>
        <p className="mt-4 text-[11px] leading-6 text-muted-foreground">
          تعداد نهایی به تجربه‌های مستقل و مستند موجود در دامنهٔ انتخاب‌شده بستگی
          دارد.
        </p>
      </Panel>
      <RunProgress
        run={run}
        error={controller.error}
        onCancel={controller.cancel}
      />
      {run?.result?.answer && (
        <Panel>
          <p className="whitespace-pre-wrap text-sm leading-8">
            {run.result.answer}
          </p>
        </Panel>
      )}
      {setId && (
        <Panel>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold">تجربه‌های استخراج‌شده</h2>
              {currentPage && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {faNumber.format(currentPage.total)} تجربه در این فهرست
                </p>
              )}
            </div>
            <div className="flex items-end gap-2">
              <Field label="نمایش در هر صفحه">
                <select
                  className={selectClass}
                  value={pageSize}
                  disabled={loading}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                >
                  <option value={3}>سه‌تایی</option>
                  <option value={10}>ده‌تایی</option>
                  <option value={100}>صدتایی</option>
                </select>
              </Field>
              <Button
                variant="outline"
                className="h-10"
                onClick={() => void exportAll()}
                disabled={exporting || !currentPage?.total}
              >
                <Download />
                {exporting ? 'آماده‌سازی…' : 'دریافت فهرست'}
              </Button>
            </div>
          </div>
        </Panel>
      )}
      {error && <ErrorState message={error} />}
      {loading && <LoadingState label="در حال دریافت فهرست تجربه‌ها" />}
      {!loading && currentPage && (
        <>
          <div className="space-y-4">
            {currentPage.items.map((item, index) => (
              <ExperienceCard
                key={item.id}
                item={item}
                position={pageIndex * pageSize + index + 1}
                onEvidence={onEvidence}
              />
            ))}
          </div>
          {currentPage.items.length === 0 ? (
            <EmptyState
              title="تجربه‌ای با معیار انتخاب‌شده پیدا نشد"
              detail="پوشش پردازش را بررسی کنید یا موضوع، بازه و منابع را تغییر دهید."
            />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <span className="text-xs text-muted-foreground">
                نمایش {faNumber.format(pageIndex * pageSize + 1)} تا{' '}
                {faNumber.format(
                  pageIndex * pageSize + currentPage.items.length,
                )}{' '}
                از {faNumber.format(currentPage.total)}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pageIndex === 0}
                  onClick={() => setPageIndex((value) => value - 1)}
                >
                  <ArrowRight />
                  قبلی
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!currentPage.nextCursor && !pages[pageIndex + 1]}
                  onClick={() => void nextPage()}
                >
                  موارد بعدی
                  <ArrowLeft />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      {!run && (
        <Panel>
          <EmptyState
            title="موضوع تحقیق را وارد کنید"
            detail="می‌توانید ابتدا صد تجربه استخراج کنید و سپس آن‌ها را سه‌تایی مرور کنید."
          />
        </Panel>
      )}
    </div>
  );
}
