'use client';

import { AnalysisGuideReferences } from './analysis-guide-references';

import { BookOpen, MessageSquarePlus, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  AnalysisFilters,
  AnalysisExperience,
  AnalysisResultPage,
  AnalysisSession,
  AnalysisSessionDetail,
} from '@/lib/analysis/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { analysisRequest, errorMessage } from './analysis-api';
import { AnalysisLabelResults, ExperienceCard } from './analysis-insights';
import { AnalysisStatistics } from './analysis-statistics';
import {
  CopyText,
  EmptyState,
  ErrorState,
  EvidenceButton,
  Field,
  LoadingState,
  Panel,
  selectClass,
} from './analysis-primitives';
import { RunProgress, type AnalysisRunController } from './analysis-run';

const examples = [
  'معضل‌های اصلی مخاطبان این بازه چیست؟ با آمار و شواهد توضیح بده.',
  'تجربه‌های سخت کاربران دربارهٔ تصمیم ازدواج را پیدا کن.',
  'بر اساس پاسخ‌ها و نتایج آزمون انتخاب‌شده، چه الگوهایی دیده می‌شود؟',
  'مخاطبان چه پرسش‌هایی دارند و ربات‌ها چه پاسخ‌هایی داده‌اند؟',
];

export function AnalysisResearch({
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
  const [sessions, setSessions] = useState<AnalysisSession[]>([]);
  const [detail, setDetail] = useState<AnalysisSessionDetail | null>(null);
  const [message, setMessage] = useState('');
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [continuedItems, setContinuedItems] = useState<AnalysisExperience[]>(
    [],
  );
  const [continuing, setContinuing] = useState(false);
  const run =
    detail && controller.run?.sessionId === detail.id ? controller.run : null;
  const activeSessionId = detail?.id;
  const lastRunId = run?.id;
  const lastRunStatus = run?.status;

  useEffect(() => {
    const controller = new AbortController();
    const kickoff = window.setTimeout(() => {
      setLoading(true);
      void analysisRequest<{ items: AnalysisSession[] }>('/sessions', {
        signal: controller.signal,
      })
        .then((response) => {
          setSessions(response.items);
          setError('');
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
  }, [reload]);

  useEffect(() => {
    if (
      !activeSessionId ||
      !lastRunId ||
      !['completed', 'failed', 'cancelled'].includes(lastRunStatus ?? '')
    )
      return;
    const controller = new AbortController();
    void analysisRequest<AnalysisSessionDetail>(
      `/sessions/${encodeURIComponent(activeSessionId)}`,
      { signal: controller.signal },
    )
      .then((session) => {
        if (!controller.signal.aborted) {
          setDetail(session);
          setReload((value) => value + 1);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(errorMessage(failure));
      });
    return () => controller.abort();
  }, [activeSessionId, lastRunId, lastRunStatus]);

  useEffect(() => {
    const abort = new AbortController();
    const kickoff = window.setTimeout(() => {
      setNextCursor(null);
      setContinuedItems([]);
      if (run?.status !== 'completed' || !run.resultSetId) return;
      void analysisRequest<{ nextCursor: string | null }>(
        `/result-sets/${encodeURIComponent(run.resultSetId)}/items?limit=${run.result?.items.length || 3}`,
        { signal: abort.signal },
      )
        .then((response) => {
          if (!abort.signal.aborted) setNextCursor(response.nextCursor);
        })
        .catch((failure) => {
          if (!abort.signal.aborted) setError(errorMessage(failure));
        });
    }, 0);
    return () => {
      window.clearTimeout(kickoff);
      abort.abort();
    };
  }, [run]);

  async function openSession(id: string) {
    setLoading(true);
    setError('');
    try {
      const session = await analysisRequest<AnalysisSessionDetail>(
        `/sessions/${encodeURIComponent(id)}`,
      );
      setDetail(session);
      const last = [...session.messages].reverse().find((item) => item.runId);
      if (last?.runId) await controller.restore(last.runId);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }

  async function send(
    event?: React.SyntheticEvent<HTMLFormElement>,
    continuation?: string,
  ) {
    event?.preventDefault();
    const text = continuation
      ? 'سه مورد بعدی را از همین فهرست بیاور.'
      : message.trim();
    if (!text || controller.busy || continuing || (!continuation && !canRun))
      return;
    setError('');
    try {
      if (continuation && run?.resultSetId) {
        setContinuing(true);
        const query = new URLSearchParams({ cursor: continuation, limit: '3' });
        const page = await analysisRequest<AnalysisResultPage>(
          `/result-sets/${encodeURIComponent(run.resultSetId)}/items?${query}`,
        );
        setContinuedItems((items) => [...items, ...page.items]);
        setNextCursor(page.nextCursor);
        return;
      }
      const session =
        detail ??
        (await analysisRequest<AnalysisSessionDetail>('/sessions', {
          method: 'POST',
          body: JSON.stringify({ title: text.slice(0, 100) }),
        }));
      setDetail({
        ...session,
        messages: [
          ...session.messages,
          { id: crypto.randomUUID(), role: 'user', content: text },
        ],
      });
      setMessage('');
      await controller.launch(
        `/sessions/${encodeURIComponent(session.id)}/messages`,
        {
          message: text,
          filters,
          limit: continuation ? 3 : limit,
          ...(continuation ? { cursor: continuation } : {}),
        },
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setContinuing(false);
    }
  }

  const hasSavedAnswer = detail?.messages.some(
    (item) => item.role === 'assistant' && item.runId === run?.id,
  );
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[240px_minmax(0,1fr)]">
      <Panel className="xl:sticky xl:top-5">
        <Button
          variant="outline"
          className="w-full justify-start"
          disabled={controller.busy}
          onClick={() => {
            setDetail(null);
            setMessage('');
            setError('');
          }}
        >
          <MessageSquarePlus />
          تحقیق تازه
        </Button>
        <h2 className="mt-5 text-xs font-bold text-muted-foreground">
          تحقیق‌های ذخیره‌شده
        </h2>
        {loading && sessions.length === 0 && <LoadingState />}
        {!loading && sessions.length === 0 && (
          <p className="mt-4 text-xs leading-7 text-muted-foreground">
            پس از اولین پرسش، تحقیق در این فهرست ذخیره می‌شود.
          </p>
        )}
        <div className="mt-3 flex max-h-96 flex-col gap-1 overflow-auto">
          {sessions.map((session) => (
            <button
              type="button"
              key={session.id}
              disabled={controller.busy}
              onClick={() => void openSession(session.id)}
              className={`rounded-xl px-3 py-3 text-right text-xs leading-6 transition hover:bg-muted disabled:opacity-50 ${detail?.id === session.id ? 'bg-primary/10 font-bold text-primary' : 'text-muted-foreground'}`}
            >
              {session.title}
            </button>
          ))}
        </div>
      </Panel>
      <div className="min-w-0 space-y-4">
        <Panel>
          <h2 className="text-base font-bold">
            {detail?.title ?? 'از داده‌های CRM بپرسید'}
          </h2>
          {!detail && (
            <>
              <p className="mt-2 text-sm leading-8 text-muted-foreground">
                موضوع، گروه مخاطبان یا خروجی دلخواه را توضیح دهید. فیلترهای بالای
                صفحه دامنهٔ درخواست بعدی را تعیین می‌کنند.
              </p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="rounded-xl border border-border px-4 py-3 text-right text-xs leading-7 transition hover:border-primary/40 hover:bg-primary/5"
                    onClick={() => setMessage(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </>
          )}
          {detail && detail.messages.length === 0 && (
            <div className="mt-4">
              <EmptyState title="اولین سؤال این تحقیق را بپرسید" />
            </div>
          )}
          <div className="mt-5 space-y-5">
            {detail?.messages.map((item) => (
              <article
                key={item.id}
                className={`rounded-2xl p-4 ${item.role === 'user' ? 'mr-4 border border-primary/10 bg-primary/5 sm:mr-10' : 'ml-4 border border-border bg-background sm:ml-10'}`}
              >
                <p className="mb-2 text-[11px] font-bold text-muted-foreground">
                  {item.role === 'user' ? 'پرسش شما' : 'دستیار تحقیق'}
                </p>
                <p className="whitespace-pre-wrap break-words text-sm leading-8">
                  {item.content}
                </p>
                {item.role === 'assistant' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <CopyText text={item.content} />
                    {item.runId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={controller.busy}
                        onClick={() =>
                          void controller
                            .restore(item.runId!)
                            .catch((failure) => setError(errorMessage(failure)))
                        }
                      >
                        <BookOpen />
                        نتیجه و شواهد
                      </Button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          {run && (
            <div className="mt-5">
              <RunProgress
                run={run}
                onCancel={controller.cancel}
                error={controller.error}
              />
            </div>
          )}
          {run?.result && (
            <div className="mt-5 space-y-4">
              <AnalysisGuideReferences items={run.result.guideReferences} />
              <AnalysisStatistics
                calculations={run.result.calculations ?? []}
              />
              {!hasSavedAnswer && run.result.answer && (
                <div className="whitespace-pre-wrap text-sm leading-8">
                  {run.result.answer}
                </div>
              )}
              {[...run.result.items, ...continuedItems].map((item) => (
                <ExperienceCard
                  key={item.id}
                  item={item}
                  onEvidence={onEvidence}
                />
              ))}
              {run.result.evidence.length > 0 && (
                <EvidenceButton
                  count={run.result.evidence.length}
                  onClick={() =>
                    onEvidence(run.result!.evidence.map((item) => item.id))
                  }
                />
              )}
              {nextCursor && (
                <Button
                  variant="outline"
                  disabled={controller.busy || continuing}
                  onClick={() => void send(undefined, nextCursor)}
                >
                  سه مورد بعدی
                </Button>
              )}
            </div>
          )}
          {run?.result?.labels.length ? (
            <div className="mt-5">
              <AnalysisLabelResults run={run} onEvidence={onEvidence} />
            </div>
          ) : null}
        </Panel>
        {error && (
          <ErrorState
            message={error}
            retry={() => setReload((value) => value + 1)}
          />
        )}
        <Panel>
          <form onSubmit={(event) => void send(event)} className="space-y-4">
            <Field label="پرسش یا درخواست شما">
              <Textarea
                value={message}
                maxLength={20_000}
                required
                className="min-h-28 leading-8"
                onChange={(event) => setMessage(event.target.value)}
                placeholder="دربارهٔ یک مسئله تحقیق کن، تجربه پیدا کن یا چند بخش را با هم مقایسه کن…"
                disabled={!canRun}
              />
            </Field>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="w-40">
                <Field label="تعداد موارد استخراج">
                  <select
                    value={limit}
                    className={selectClass}
                    onChange={(event) => setLimit(Number(event.target.value))}
                  >
                    <option value={3}>۳ مورد</option>
                    <option value={10}>۱۰ مورد</option>
                    <option value={100}>۱۰۰ مورد</option>
                  </select>
                </Field>
              </div>
              <Button
                type="submit"
                className="h-10 rounded-xl px-6"
                disabled={!canRun || controller.busy || !message.trim()}
              >
                <Send />
                ارسال درخواست
              </Button>
            </div>
          </form>
          <p className="mt-3 text-[11px] leading-6 text-muted-foreground">
            گروه مبتنی بر آزمون را با فیلتر آزمون و نمره انتخاب کنید. اتصال
            تجربه‌های همان افراد به آزمون، به پیوند هویت معتبر وابسته است.
          </p>
        </Panel>
      </div>
    </div>
  );
}
