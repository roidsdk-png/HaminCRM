'use client';

import { AnalysisGuideReferences } from './analysis-guide-references';

import { BookOpen, Download, PenLine, X } from 'lucide-react';
import { useState } from 'react';
import type {
  AnalysisContentFormat,
  AnalysisEvidence,
  AnalysisFilters,
} from '@/lib/analysis/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { downloadText } from './analysis-api';
import {
  CopyText,
  EmptyState,
  faNumber,
  Field,
  Panel,
  selectClass,
} from './analysis-primitives';
import { RunProgress, type AnalysisRunController } from './analysis-run';

const formats: { value: AnalysisContentFormat; label: string }[] = [
  { value: 'article', label: 'مقاله' },
  { value: 'story', label: 'داستان اقتباسی' },
  { value: 'instagram', label: 'محتوای اینستاگرام' },
  { value: 'podcast', label: 'پادکست' },
  { value: 'ideas', label: 'ایده و تیتر' },
];

export function AnalysisContent({
  filters,
  controller,
  canRun,
  selected,
  onRemove,
  onEvidence,
}: {
  filters: AnalysisFilters;
  controller: AnalysisRunController;
  canRun: boolean;
  selected: AnalysisEvidence[];
  onRemove: (id: string) => void;
  onEvidence: (ids: string[]) => void;
}) {
  const [format, setFormat] = useState<AnalysisContentFormat>('article');
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState('');
  const [length, setLength] = useState('');
  const run = controller.run?.kind === 'content' ? controller.run : null;

  async function generate(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await controller.launch('/content', {
        prompt,
        format,
        filters,
        evidenceIds: selected.map((item) => item.id),
        tone,
        length,
      });
    } catch {
      /* The run controller presents request failures. */
    }
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="space-y-5">
        <Panel>
          <h2 className="text-base font-bold">کارگاه محتوا</h2>
          <p className="mt-2 text-xs leading-7 text-muted-foreground">
            از شواهد انتخاب‌شده یا داده‌های مرتبط با درخواست، متن و ایده بسازید.
          </p>
          <form onSubmit={generate} className="mt-5 space-y-4">
            <Field label="قالب خروجی">
              <select
                className={selectClass}
                value={format}
                onChange={(event) =>
                  setFormat(event.target.value as AnalysisContentFormat)
                }
              >
                {formats.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="موضوع و درخواست">
              <Textarea
                required
                maxLength={20_000}
                value={prompt}
                className="min-h-36 leading-8"
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="مثلاً از تجربه‌های انتخاب‌شده یک مقاله برای جوانانی بنویس که در تصمیم ازدواج تردید دارند."
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="لحن و مخاطب">
                <Input
                  value={tone}
                  maxLength={1_000}
                  className="h-10 rounded-xl"
                  onChange={(event) => setTone(event.target.value)}
                  placeholder="همدلانه، برای جوانان"
                />
              </Field>
              <Field label="طول یا تعداد">
                <Input
                  value={length}
                  maxLength={1_000}
                  className="h-10 rounded-xl"
                  onChange={(event) => setLength(event.target.value)}
                  placeholder="۸۰۰ کلمه یا ۱۰ ایده"
                />
              </Field>
            </div>
            <Button
              type="submit"
              className="h-10 w-full rounded-xl"
              disabled={!canRun || controller.busy || !prompt.trim()}
            >
              <PenLine />
              ساخت محتوا
            </Button>
          </form>
          {format === 'story' && (
            <p className="mt-4 text-xs leading-7 text-muted-foreground">
              متن با عنوان داستان اقتباسی تولید می‌شود و عناصر ترکیبی یا تخیلی
              باید در آن مشخص باشند.
            </p>
          )}
        </Panel>
        <Panel>
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" />
            <h2 className="text-sm font-bold">شواهد انتخاب‌شده</h2>
            <span className="text-xs text-muted-foreground">
              {faNumber.format(selected.length)}
            </span>
          </div>
          {selected.length === 0 ? (
            <p className="mt-3 text-xs leading-7 text-muted-foreground">
              در پنل شواهد، موارد دلخواه را برای محتوا انتخاب کنید. با انتخاب
              خالی، داده‌های مرتبط در دامنهٔ فیلترها بررسی می‌شوند.
            </p>
          ) : (
            <div className="mt-4 max-h-80 space-y-3 overflow-auto">
              {selected.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-border bg-background p-3"
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      className="flex-1 text-right text-xs leading-7 hover:text-primary"
                      onClick={() => onEvidence([item.id])}
                    >
                      {item.quote.slice(0, 220)}
                      {item.quote.length > 220 ? '…' : ''}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="حذف از شواهد محتوا"
                      onClick={() => onRemove(item.id)}
                    >
                      <X />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <div className="space-y-5">
        <RunProgress
          run={run}
          error={controller.error}
          onCancel={controller.cancel}
        />
        <Panel>
          {run?.result?.answer ? (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                <h2 className="text-sm font-bold">متن آماده‌شده</h2>
                <div className="flex gap-2">
                  <CopyText text={run.result.answer} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadText('audience-content.txt', run.result!.answer)
                    }
                  >
                    <Download />
                    دریافت
                  </Button>
                </div>
              </div>
              <article className="whitespace-pre-wrap break-words text-sm leading-9">
                {run.result.answer}
              </article>
              <AnalysisGuideReferences items={run.result.guideReferences} />
              {run.result.evidence.length > 0 && (
                <div className="mt-5 border-t border-border pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onEvidence(run.result!.evidence.map((item) => item.id))
                    }
                  >
                    <BookOpen />
                    شواهد متن
                  </Button>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              title="محتوا در این بخش آماده می‌شود"
              detail="موضوع، قالب و مخاطب را مشخص کنید. پس از تولید می‌توانید متن را کپی یا دریافت کنید."
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
