'use client';

import { ChevronDown, Filter, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type {
  AnalysisFilters,
  AnalysisRecordKind,
  AnalysisRole,
  AnalysisSource,
} from '@/lib/analysis/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AnalysisContactPicker } from './analysis-contact-picker';
import { Field, selectClass } from './analysis-primitives';

const kindChoices: { value: AnalysisRecordKind; label: string }[] = [
  { value: 'message', label: 'گفتگوها' },
  { value: 'test', label: 'آزمون‌ها' },
  { value: 'match', label: 'فرم‌های ازدواج' },
];
const roleChoices: { value: AnalysisRole; label: string }[] = [
  { value: 'user', label: 'مخاطب' },
  { value: 'assistant', label: 'ربات' },
  { value: 'system', label: 'سیستم' },
];

export function defaultFilters(): AnalysisFilters {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString().slice(0, 10), to: today, roles: ['user'] };
}

export function filtersQuery(filters: AnalysisFilters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    )
      continue;
    query.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return query;
}

function toggleValue<T extends string>(values: T[] | undefined, item: T) {
  return values?.includes(item)
    ? values.filter((value) => value !== item)
    : [...(values ?? []), item];
}

export function AnalysisFilterBar({
  filters,
  sources,
  onApply,
  disabled,
}: {
  filters: AnalysisFilters;
  sources: AnalysisSource[];
  onApply: (filters: AnalysisFilters) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(filters);
  const [validation, setValidation] = useState('');
  const selectedCount = draft.sourceIds?.length ?? 0;

  function apply(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      setValidation('تاریخ شروع باید پیش از پایان بازه باشد.');
      return;
    }
    if (
      draft.ageFrom !== undefined &&
      draft.ageTo !== undefined &&
      draft.ageFrom > draft.ageTo
    ) {
      setValidation('حداقل سن باید از حداکثر سن کمتر باشد.');
      return;
    }
    if (
      (draft.scoreFrom !== undefined && !Number.isFinite(draft.scoreFrom)) ||
      (draft.scoreTo !== undefined && !Number.isFinite(draft.scoreTo))
    ) {
      setValidation('نمرهٔ واردشده معتبر نیست.');
      return;
    }
    if (
      draft.scoreFrom !== undefined &&
      draft.scoreTo !== undefined &&
      draft.scoreFrom > draft.scoreTo
    ) {
      setValidation('حداقل نمره باید از حداکثر نمره کمتر باشد.');
      return;
    }
    if (
      (draft.scoreFrom !== undefined || draft.scoreTo !== undefined) &&
      !draft.scoreKey?.trim()
    ) {
      setValidation('برای فیلتر نمره، نام مقیاس آزمون را وارد کنید.');
      return;
    }
    setValidation('');
    onApply({ ...draft, scoreKey: draft.scoreKey?.trim() || undefined });
  }

  return (
    <form
      onSubmit={apply}
      className="rounded-2xl border border-border bg-card p-5 shadow-xs"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.5fr_auto]">
        <Field label="از تاریخ">
          <Input
            type="date"
            dir="ltr"
            className="h-10 rounded-xl"
            value={draft.from ?? ''}
            max={draft.to}
            onChange={(event) =>
              setDraft({ ...draft, from: event.target.value })
            }
          />
        </Field>
        <Field label="تا تاریخ">
          <Input
            type="date"
            dir="ltr"
            className="h-10 rounded-xl"
            value={draft.to ?? ''}
            min={draft.from}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </Field>
        <div className="space-y-2">
          <p className="text-xs font-semibold">منابع</p>
          <details className="relative">
            <summary className="flex h-10 cursor-pointer list-none items-center justify-between rounded-xl border border-border bg-background px-3 text-sm">
              <span>
                {selectedCount
                  ? `${new Intl.NumberFormat('fa-IR').format(selectedCount)} منبع انتخاب‌شده`
                  : 'همهٔ منابع'}
                <span className="sr-only">انتخاب منابع تحقیق</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </summary>
            <div className="absolute inset-x-0 top-12 z-20 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-xl">
              <button
                type="button"
                className="w-full rounded-lg px-3 py-2 text-right text-xs text-primary hover:bg-muted"
                onClick={() => setDraft({ ...draft, sourceIds: [] })}
              >
                انتخاب همهٔ منابع
              </button>
              {sources.map((source) => (
                <label
                  key={source.id}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 text-xs hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-primary"
                    checked={draft.sourceIds?.includes(source.id) ?? false}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        sourceIds: toggleValue(draft.sourceIds, source.id),
                      })
                    }
                  />
                  <span className="flex-1 leading-5">
                    {source.name}
                    <span
                      className="block text-[10px] text-muted-foreground"
                      dir="ltr"
                    >
                      {source.slug}
                    </span>
                  </span>
                </label>
              ))}
              {sources.length === 0 && (
                <p className="px-3 py-4 text-xs text-muted-foreground">
                  پس از دریافت فهرست منابع، انتخاب فعال می‌شود.
                </p>
              )}
            </div>
          </details>
        </div>
        <div className="flex items-end gap-2">
          <Button
            type="submit"
            className="h-10 rounded-xl px-5"
            disabled={disabled}
          >
            <Filter />
            اعمال فیلتر
          </Button>
          <Button
            variant="outline"
            type="button"
            size="icon"
            className="size-10 rounded-xl"
            aria-label="بازنشانی فیلترها"
            onClick={() => {
              const next = defaultFilters();
              setDraft(next);
              setValidation('');
              onApply(next);
            }}
            disabled={disabled}
          >
            <RotateCcw />
          </Button>
        </div>
      </div>
      <details className="mt-4 border-t border-border pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
          نوع داده، نویسنده و مشخصات مخاطب
        </summary>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <fieldset>
            <legend className="mb-2 text-xs font-semibold">نوع داده</legend>
            <div className="flex flex-wrap gap-3">
              {kindChoices.map((choice) => (
                <label
                  key={choice.value}
                  className="flex items-center gap-2 text-xs"
                >
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={draft.kinds?.includes(choice.value) ?? false}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        kinds: toggleValue(draft.kinds, choice.value),
                      })
                    }
                  />
                  {choice.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              انتخاب خالی، همهٔ انواع داده را پوشش می‌دهد.
            </p>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-xs font-semibold">نویسندهٔ پیام</legend>
            <div className="flex flex-wrap gap-3">
              {roleChoices.map((choice) => (
                <label
                  key={choice.value}
                  className="flex items-center gap-2 text-xs"
                >
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={draft.roles?.includes(choice.value) ?? false}
                    onChange={() =>
                      setDraft({
                        ...draft,
                        roles: toggleValue(draft.roles, choice.value),
                      })
                    }
                  />
                  {choice.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              برای تحلیل زبان مخاطب، نویسنده را «مخاطب» انتخاب کنید.
            </p>
          </fieldset>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="جنسیت ثبت‌شده">
            <select
              className={selectClass}
              value={draft.gender ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, gender: event.target.value || undefined })
              }
            >
              <option value="">همه</option>
              <option value="female">زن</option>
              <option value="male">مرد</option>
            </select>
          </Field>
          <Field label="استان ثبت‌شده">
            <Input
              className="h-10 rounded-xl"
              value={draft.province ?? ''}
              placeholder="مثلاً تهران"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  province: event.target.value || undefined,
                })
              }
            />
          </Field>
          <Field label="حداقل سن">
            <Input
              className="h-10 rounded-xl"
              type="number"
              min={0}
              max={120}
              value={draft.ageFrom ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  ageFrom:
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                })
              }
            />
          </Field>
          <Field label="حداکثر سن">
            <Input
              className="h-10 rounded-xl"
              type="number"
              min={0}
              max={120}
              value={draft.ageTo ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  ageTo:
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                })
              }
            />
          </Field>
          <AnalysisContactPicker
            value={draft.contactId}
            onChange={(contactId) => setDraft({ ...draft, contactId })}
            disabled={disabled}
          />
          <label className="flex items-start gap-2 text-xs leading-6 sm:col-span-2">
            <input
              type="checkbox"
              className="mt-1 accent-primary"
              disabled={!draft.contactId || disabled}
              checked={draft.includeLinkedContacts ?? false}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  includeLinkedContacts: event.target.checked,
                })
              }
            />
            <span>
              سوابق هویت‌های تأییدشدهٔ این مخاطب در منابع دیگر هم بررسی شوند. سایر
              فیلترهای انتخاب‌شده همچنان اعمال می‌شوند.
            </span>
          </label>
          <Field label="شناسهٔ آزمون" hint="برای بررسی پاسخ‌ها و نتایج یک آزمون">
            <Input
              className="h-10 rounded-xl"
              dir="ltr"
              value={draft.testKey ?? ''}
              placeholder="testKey"
              onChange={(event) =>
                setDraft({ ...draft, testKey: event.target.value || undefined })
              }
            />
          </Field>
          <Field
            label="مقیاس نمرهٔ آزمون"
            hint="نام مقیاس ثبت‌شده در نتیجهٔ آزمون"
          >
            <Input
              className="h-10 rounded-xl"
              dir="ltr"
              value={draft.scoreKey ?? ''}
              maxLength={200}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  scoreKey: event.target.value || undefined,
                })
              }
            />
          </Field>
          <Field label="حداقل نمره">
            <Input
              className="h-10 rounded-xl"
              type="number"
              step="any"
              value={draft.scoreFrom ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  scoreFrom:
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                })
              }
            />
          </Field>
          <Field label="حداکثر نمره">
            <Input
              className="h-10 rounded-xl"
              type="number"
              step="any"
              value={draft.scoreTo ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  scoreTo:
                    event.target.value === ''
                      ? undefined
                      : Number(event.target.value),
                })
              }
            />
          </Field>
        </div>
        <label className="mt-5 flex items-start gap-2 text-xs leading-6">
          <input
            type="checkbox"
            className="mt-1 accent-primary"
            checked={draft.includeExcluded ?? false}
            disabled={disabled}
            onChange={(event) =>
              setDraft({ ...draft, includeExcluded: event.target.checked })
            }
          />
          بررسی سوابقی که از آمار جاری آزمون‌ها و فرم‌ها کنار گذاشته شده‌اند
        </label>
      </details>
      {validation && (
        <p className="mt-3 text-xs text-rose-600" role="alert">
          {validation}
        </p>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">
        بازه بر اساس زمان تهران است. فیلترها پس از «اعمال فیلتر» در گزارش و
        درخواست بعدی استفاده می‌شوند.
      </p>
    </form>
  );
}
