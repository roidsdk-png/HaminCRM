'use client';

import { ArrowUpLeft, BookOpen, Check, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { AnalysisEvidence } from '@/lib/analysis/types';
import { Button } from '@/components/ui/button';
import { analysisRequest, errorMessage } from './analysis-api';
import {
  EmptyState,
  ErrorState,
  formatDate,
  LoadingState,
} from './analysis-primitives';

type Props = {
  ids: string[];
  selected: AnalysisEvidence[];
  onSelect: (item: AnalysisEvidence) => void;
  onClose: () => void;
};

function recordHref(href: string | undefined) {
  if (
    !href ||
    !/^\/(conversations|tests|matchmaking|users)\/[a-zA-Z0-9_-]+(?:[?#].*)?$/.test(
      href,
    )
  )
    return undefined;
  return href;
}

export function EvidenceDrawer({ ids, selected, onSelect, onClose }: Props) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<AnalysisEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const kickoff = window.setTimeout(() => {
      setLoading(true);
      setError('');
      setItems([]);
      void Promise.all(
        ids.map((id) =>
          analysisRequest<AnalysisEvidence>(
            `/evidence/${encodeURIComponent(id)}`,
            { signal: controller.signal },
          ),
        ),
      )
        .then(setItems)
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
  }, [ids, reload]);

  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      className="fixed inset-0 z-50 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-3xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-slate-950/50"
      aria-labelledby={titleId}
    >
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2
          id={titleId}
          className="flex items-center gap-2 text-base font-bold"
        >
          <BookOpen className="size-5 text-primary" />
          شواهد و متن مبدأ
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="بستن شواهد"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="max-h-[72dvh] space-y-4 overflow-y-auto p-5">
        {loading && <LoadingState label="در حال دریافت شواهد" />}
        {error && (
          <ErrorState
            message={error}
            retry={() => setReload((value) => value + 1)}
          />
        )}
        {!loading && !error && items.length === 0 && (
          <EmptyState title="شاهدی ثبت نشده است" />
        )}
        {items.map((item) => {
          const included = selected.some((entry) => entry.id === item.id);
          const href = recordHref(item.href);
          return (
            <article
              key={item.id}
              className="rounded-2xl border border-border bg-background p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>{item.sourceId}</span>
                <time>{formatDate(item.occurredAt)}</time>
              </div>
              <blockquote className="whitespace-pre-wrap border-r-2 border-primary/40 pr-4 text-sm leading-8">
                {item.quote}
              </blockquote>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <Button
                  variant={included ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => onSelect(item)}
                >
                  {included ? <Check /> : <Plus />}
                  {included
                    ? 'انتخاب‌شده برای محتوا'
                    : 'انتخاب برای تولید محتوا'}
                </Button>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                  >
                    مشاهدهٔ رکورد
                    <ArrowUpLeft className="size-3.5" />
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </dialog>
  );
}
