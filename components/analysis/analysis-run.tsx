'use client';

import { CircleCheck, LoaderCircle, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisCoverage, AnalysisRun } from '@/lib/analysis/types';
import { Button } from '@/components/ui/button';
import { analysisRequest, errorMessage } from './analysis-api';
import { ErrorState, faNumber } from './analysis-primitives';

export function useAnalysisRun() {
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const activeId = useRef<string | null>(null);
  const busy =
    submitting || run?.status === 'queued' || run?.status === 'running';

  const runId = run?.id;
  const runStatus = run?.status;

  useEffect(() => {
    if (!runId || !runStatus || !['queued', 'running'].includes(runStatus))
      return;
    const controller = new AbortController();
    const id = runId;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void analysisRequest<AnalysisRun>(`/runs/${encodeURIComponent(id)}`, {
        signal: controller.signal,
      })
        .then((next) => {
          if (activeId.current === id) {
            setRun(next);
            setError('');
          }
        })
        .catch((failure) => {
          if (!controller.signal.aborted) setError(errorMessage(failure));
        })
        .finally(() => {
          inFlight = false;
        });
    }, 2_000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [runId, runStatus]);

  const restore = useCallback(async (id: string) => {
    activeId.current = id;
    const next = await analysisRequest<AnalysisRun>(
      `/runs/${encodeURIComponent(id)}`,
    );
    if (activeId.current === id) {
      setRun(next);
      setError('');
    }
    return next;
  }, []);

  async function launch(path: string, body: unknown) {
    setSubmitting(true);
    setError('');
    try {
      const next = await analysisRequest<AnalysisRun>(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      activeId.current = next.id;
      setRun(next);
      return next;
    } catch (failure) {
      setError(errorMessage(failure));
      throw failure;
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    if (!run) return;
    try {
      const next = await analysisRequest<AnalysisRun>(
        `/runs/${encodeURIComponent(run.id)}`,
        { method: 'DELETE' },
      );
      setRun(next);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }

  return { run, busy, submitting, error, launch, restore, cancel };
}

export type AnalysisRunController = ReturnType<typeof useAnalysisRun>;

export function CoverageSummary({ coverage }: { coverage: AnalysisCoverage }) {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-2 text-[11px] leading-6 text-muted-foreground">
      <div className="flex gap-1">
        <dt>واجد شرایط</dt>
        <dd className="font-bold text-foreground">
          {faNumber.format(coverage.eligible)}
        </dd>
      </div>
      <div className="flex gap-1">
        <dt>بررسی‌شده</dt>
        <dd className="font-bold text-foreground">
          {faNumber.format(coverage.processed)}
        </dd>
      </div>
      <div className="flex gap-1">
        <dt>در انتظار</dt>
        <dd>{faNumber.format(coverage.pending)}</dd>
      </div>
      <div className="flex gap-1">
        <dt>ناموفق</dt>
        <dd
          className={coverage.failed ? 'text-rose-600 dark:text-rose-400' : ''}
        >
          {faNumber.format(coverage.failed)}
        </dd>
      </div>
    </dl>
  );
}

export function RunProgress({
  run,
  onCancel,
  error,
  onRetry,
}: {
  run: AnalysisRun | null;
  onCancel?: () => void;
  error?: string;
  onRetry?: () => void;
}) {
  if (!run)
    return error ? <ErrorState message={error} retry={onRetry} /> : null;
  const active = run.status === 'queued' || run.status === 'running';
  const progress = Math.max(0, Math.min(100, run.progress));
  const labels = {
    queued: 'در صف پردازش',
    running: 'در حال بررسی داده‌ها',
    completed: 'بررسی تکمیل شد',
    failed: 'پردازش نیازمند بررسی است',
    cancelled: 'پردازش لغو شد',
  };
  return (
    <div
      className="space-y-3 rounded-xl border border-border bg-background p-4"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold">
          {active ? (
            <LoaderCircle className="size-4 animate-spin text-primary" />
          ) : (
            <CircleCheck className="size-4 text-muted-foreground" />
          )}
          <span>{labels[run.status]}</span>
        </div>
        {active && onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <Square />
            لغو
          </Button>
        )}
      </div>
      {active && (
        <>
          <progress
            className="h-1.5 w-full overflow-hidden rounded-full accent-primary"
            max={100}
            value={progress}
            aria-label="پیشرفت بررسی"
          />
          <p className="text-[11px] text-muted-foreground">
            {faNumber.format(run.processed)} از {faNumber.format(run.eligible)}{' '}
            واحد بررسی‌شده
          </p>
        </>
      )}
      {run.stale && (
        <p className="text-xs leading-6 text-amber-700 dark:text-amber-300">
          پس از این اجرا داده‌ها تغییر کرده‌اند. برای گزارش تازه، تحلیل را دوباره
          اجرا کنید.
        </p>
      )}
      {run.error && <ErrorState message={run.error.message} />}
      {error && <ErrorState message={error} retry={onRetry} />}
      {run.result?.coverage && (
        <CoverageSummary coverage={run.result.coverage} />
      )}
      {run.result?.notice && (
        <p className="text-xs leading-7 text-muted-foreground">
          {run.result.notice}
        </p>
      )}
    </div>
  );
}
