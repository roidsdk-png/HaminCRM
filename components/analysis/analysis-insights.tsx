'use client';

import { Download, Play, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AnalysisExperience,
  AnalysisFilters,
  AnalysisRun,
  AnalysisRunKind,
} from '@/lib/analysis/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { downloadText } from './analysis-api';
import {
  EmptyState,
  EvidenceButton,
  faNumber,
  faPercent,
  Field,
  Panel,
} from './analysis-primitives';
import { RunProgress, type AnalysisRunController } from './analysis-run';

const colors = [
  'var(--primary)',
  'var(--chart-violet)',
  'var(--chart-amber)',
  'var(--chart-rose)',
  'var(--chart-emerald)',
  'var(--chart-cyan)',
];

export function AnalysisInsights({
  kind,
  filters,
  controller,
  canRun,
  onEvidence,
}: {
  kind: 'challenges' | 'emotions';
  filters: AnalysisFilters;
  controller: AnalysisRunController;
  canRun: boolean;
  onEvidence: (ids: string[]) => void;
}) {
  const [instructions, setInstructions] = useState('');
  const [categories, setCategories] = useState('');
  const current = controller.run?.kind === kind ? controller.run : null;
  const isEmotion = kind === 'emotions';
  async function start() {
    try {
      await controller.launch('/runs', {
        kind,
        query: instructions,
        filters,
        categories: categories
          .split('\n')
          .map((value) => value.trim())
          .filter(Boolean),
      });
    } catch {
      /* The controller presents the request error. */
    }
  }

  return (
    <div className="space-y-5">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-bold">
              {isEmotion
                ? 'هیجان‌های بیان‌شده در متن'
                : 'چالش‌ها و مسئله‌های مخاطبان'}
            </h2>
            <p className="mt-2 max-w-2xl text-xs leading-7 text-muted-foreground">
              {isEmotion
                ? 'اضطراب، تردید، ناامیدی، خشم و امیدواری را همراه با زمینه و شواهد بررسی کنید.'
                : 'موضوعات پرتکرار را در دامنهٔ انتخاب‌شده پیدا کنید و متن پشتیبان هر نتیجه را ببینید.'}
            </p>
          </div>
          <Button
            className="h-10 rounded-xl"
            onClick={() => void start()}
            disabled={!canRun || controller.busy}
          >
            <Play />
            {controller.busy ? 'پردازش در جریان است' : 'اجرای تحلیل'}
          </Button>
        </div>
        <details className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
            <SlidersHorizontal className="ml-1 inline size-3.5" />
            تنظیم معیار تحلیل
          </summary>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="توضیح و معیار دلخواه">
              <Textarea
                value={instructions}
                maxLength={20_000}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder={
                  isEmotion
                    ? 'مثلاً هیجان‌های مربوط به تصمیم ازدواج را با توجه به متن گفتگو بررسی کن.'
                    : 'مثلاً مسئله‌های مربوط به روابط خانوادگی را با مثال استخراج کن.'
                }
                className="min-h-28 leading-7"
              />
            </Field>
            <Field
              label="دسته‌های دلخواه"
              hint="هر دسته را در یک سطر بنویسید. انتخاب خالی از دسته‌های پایه استفاده می‌کند."
            >
              <Textarea
                value={categories}
                onChange={(event) => setCategories(event.target.value)}
                placeholder={
                  isEmotion
                    ? 'اضطراب\nامیدواری'
                    : 'ترس از تصمیم ازدواج\nتعارض خانوادگی'
                }
                className="min-h-28 leading-7"
              />
            </Field>
          </div>
        </details>
      </Panel>
      <RunProgress
        run={current}
        error={controller.error}
        onCancel={controller.cancel}
        onRetry={
          current
            ? () => void controller.restore(current.id).catch(() => {})
            : undefined
        }
      />
      {current?.result ? (
        <AnalysisLabelResults run={current} onEvidence={onEvidence} />
      ) : (
        !current && (
          <Panel>
            <EmptyState
              title="تحلیل این دامنه را اجرا کنید"
              detail="نتایج همراه با تعداد، سهم، میزان پوشش پردازش و شواهد واقعی نمایش داده می‌شوند."
            />
          </Panel>
        )
      )}
    </div>
  );
}

export function AnalysisLabelResults({
  run,
  onEvidence,
}: {
  run: AnalysisRun;
  onEvidence: (ids: string[]) => void;
}) {
  const result = run.result;
  const trend = useMemo(() => {
    const rows = new Map<string, Record<string, string | number>>();
    for (const item of result?.trends ?? []) {
      const row = rows.get(item.day) ?? { day: item.day };
      row[item.label] = item.share;
      rows.set(item.day, row);
    }
    return [...rows.values()].sort((a, b) =>
      String(a.day).localeCompare(String(b.day)),
    );
  }, [result?.trends]);
  if (!result) return null;

  function exportLabels() {
    if (!result) return;
    const lines = [
      ['دسته', 'تعداد', 'درصد'],
      ...result.labels.map((item) => [
        item.label,
        String(item.count),
        String(item.share),
      ]),
    ];
    downloadText(
      `${run.kind}-analysis.csv`,
      lines
        .map((line) =>
          line.map((value) => `"${value.replaceAll('"', '""')}"`).join(','),
        )
        .join('\r\n'),
      'text/csv;charset=utf-8',
    );
  }

  return (
    <div className="space-y-5">
      <Panel>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold">سهم دسته‌ها در دادهٔ بررسی‌شده</h2>
          <Button
            variant="outline"
            size="sm"
            disabled={!result.labels.length}
            onClick={exportLabels}
          >
            <Download />
            خروجی جدول
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-6 text-muted-foreground">
          هر واحد می‌تواند چند برچسب داشته باشد و مجموع سهم‌ها ممکن است بیشتر از
          صد درصد شود.
        </p>
        {result.totalAnalyzedUnits !== undefined && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            مبنای درصدها {faNumber.format(result.totalAnalyzedUnits)}{' '}
            {result.unit === 'conversation' ? 'گفتگو' : 'رکورد'} بررسی‌شده است.
          </p>
        )}
        {result.labels.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              title="برچسب قابل اتکایی برای نمایش ثبت نشده است"
              detail="توضیح نتیجه و میزان پوشش را بررسی کنید."
            />
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            {result.labels.map((item, index) => (
              <div key={item.label}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{item.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs tabular-nums">
                      {faNumber.format(item.count)} مورد{' '}
                      <span className="text-muted-foreground">
                        · {faPercent.format(item.share)}٪
                      </span>
                    </span>
                    {item.evidenceIds.length > 0 && (
                      <EvidenceButton
                        onClick={() => onEvidence(item.evidenceIds)}
                      />
                    )}
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, item.share))}%`,
                      background: colors[index % colors.length],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        {result.answer && (
          <div className="mt-6 whitespace-pre-wrap border-t border-border pt-5 text-sm leading-8">
            {result.answer}
          </div>
        )}
      </Panel>
      {trend.length > 0 && (
        <Panel>
          <h2 className="text-sm font-bold">تغییر سهم دسته‌ها در زمان</h2>
          <div className="mt-6 h-72" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ right: 12, left: 0, top: 10 }}>
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                  tickFormatter={(value: string) =>
                    new Intl.DateTimeFormat('fa-IR', {
                      month: 'short',
                      day: 'numeric',
                      timeZone: 'Asia/Tehran',
                    }).format(new Date(`${value}T12:00:00Z`))
                  }
                />
                <YAxis
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                  tickFormatter={(value: number) =>
                    `${faNumber.format(value)}٪`
                  }
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--card)',
                    borderColor: 'var(--border)',
                    borderRadius: 12,
                    color: 'var(--foreground)',
                    direction: 'rtl',
                    fontSize: 12,
                  }}
                  formatter={(value) => `${faPercent.format(Number(value))}٪`}
                />
                <Legend wrapperStyle={{ fontSize: 11, direction: 'rtl' }} />
                {result.labels.map((item, index) => (
                  <Line
                    key={item.label}
                    type="monotone"
                    dataKey={item.label}
                    stroke={colors[index % colors.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              جدول داده‌های نمودار
            </summary>
            <div className="mt-3 max-h-64 overflow-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr>
                    <th className="p-2">روز</th>
                    <th className="p-2">دسته</th>
                    <th className="p-2">تعداد</th>
                    <th className="p-2">سهم</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trends?.map((item) => (
                    <tr
                      key={`${item.day}-${item.label}`}
                      className="border-t border-border"
                    >
                      <td className="p-2">{item.day}</td>
                      <td className="p-2">{item.label}</td>
                      <td className="p-2">{faNumber.format(item.count)}</td>
                      <td className="p-2">{faPercent.format(item.share)}٪</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Panel>
      )}
    </div>
  );
}

export function ExperienceCard({
  item,
  position,
  onEvidence,
}: {
  item: AnalysisExperience;
  position?: number;
  onEvidence: (ids: string[]) => void;
}) {
  const attribution =
    (
      {
        self: 'روایت از تجربهٔ خود فرد',
        other: 'روایت دربارهٔ فرد دیگر',
        hypothetical: 'موقعیت فرضی',
        uncertain: 'انتساب نیازمند بررسی',
        unknown: 'انتساب مشخص نشده',
      } as Record<string, string>
    )[item.attribution] ?? item.attribution;
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-bold leading-7">
          {position !== undefined && (
            <span className="ml-2 text-muted-foreground">
              {faNumber.format(position)}.
            </span>
          )}
          {item.title}
        </h3>
        {item.evidenceIds.length > 0 && (
          <EvidenceButton
            count={item.evidenceIds.length}
            onClick={() => onEvidence(item.evidenceIds)}
          />
        )}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-8">
        {item.summary}
      </p>
      {item.reason && (
        <p className="mt-3 text-xs leading-7 text-muted-foreground">
          {item.reason}
        </p>
      )}
      {attribution && (
        <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">
          {attribution}
        </p>
      )}
    </article>
  );
}

export function runKindTitle(kind: AnalysisRunKind) {
  return {
    challenges: 'تحلیل چالش‌ها',
    emotions: 'تحلیل هیجان‌ها',
    experiences: 'استخراج تجربه‌ها',
    research: 'تحقیق آزاد',
    content: 'تولید محتوا',
  }[kind];
}
