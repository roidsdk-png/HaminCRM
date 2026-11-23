'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadText } from './analysis-api';
import { ErrorState, Panel } from './analysis-primitives';

const metricLabels = {
  count: 'تعداد رکوردها',
  distinctContacts: 'تعداد مخاطبان یکتا در هر منبع',
  sum: 'مجموع',
  average: 'میانگین',
  min: 'کمترین مقدار',
  max: 'بیشترین مقدار',
};
type Metric = keyof typeof metricLabels;
type Scalar = string | number | boolean | null;
type Summary = {
  eligible: number;
  measured: number;
  missing: number;
  value: number | null;
};
type Group = Partial<Summary> & {
  key: Scalar;
  count?: number;
  share?: number | null;
};
type Calculation = {
  unit?: string;
  metric: Metric;
  field: string | null;
  groupBy: string | null;
  totals: Summary;
  groups: Group[];
};

const numbers = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 12 });
const percentages = new Intl.NumberFormat('fa-IR', {
  maximumFractionDigits: 4,
});
const groupColumns = [
  { key: 'eligible', label: 'رکوردهای واجد شرایط' },
  { key: 'measured', label: 'دارای مقدار معتبر' },
  { key: 'missing', label: 'فاقد مقدار معتبر' },
  { key: 'count', label: 'تعداد' },
  { key: 'value', label: 'نتیجهٔ محاسبه' },
  { key: 'share', label: 'سهم درصدی' },
] as const;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseCalculation(value: unknown): Calculation | null {
  if (
    !object(value) ||
    typeof value.metric !== 'string' ||
    !Object.hasOwn(metricLabels, value.metric)
  )
    return null;
  const totals = value.totals;
  if (
    !object(totals) ||
    !['eligible', 'measured', 'missing'].every(
      (key) => finite(totals[key]) && (totals[key] as number) >= 0,
    )
  )
    return null;
  if (totals.value !== null && !finite(totals.value)) return null;
  if (
    value.field !== null &&
    value.field !== undefined &&
    typeof value.field !== 'string'
  )
    return null;
  if (
    value.groupBy !== null &&
    value.groupBy !== undefined &&
    typeof value.groupBy !== 'string'
  )
    return null;
  if (!Array.isArray(value.groups)) return null;
  for (const group of value.groups) {
    if (!object(group) || !Object.hasOwn(group, 'key')) return null;
    if (
      group.key !== null &&
      !['string', 'number', 'boolean'].includes(typeof group.key)
    )
      return null;
    if (typeof group.key === 'number' && !finite(group.key)) return null;
    for (const { key } of groupColumns) {
      if (
        group[key] !== undefined &&
        group[key] !== null &&
        !finite(group[key])
      )
        return null;
    }
  }
  return {
    unit: typeof value.unit === 'string' ? value.unit : undefined,
    metric: value.metric as Metric,
    field: typeof value.field === 'string' ? value.field : null,
    groupBy: typeof value.groupBy === 'string' ? value.groupBy : null,
    totals: totals as Summary,
    groups: value.groups as Group[],
  };
}

function fieldLabel(field: string | null) {
  if (!field) return '';
  const labels: Record<string, string> = {
    sourceId: 'منبع',
    kind: 'نوع داده',
    role: 'نویسنده',
    contactId: 'مخاطب در منبع',
    occurredAt: 'زمان رخداد',
    day: 'روز به وقت تهران',
    testKey: 'آزمون',
    extractedTopic: 'موضوع مستند استخراج‌شده',
    'demographics.gender': 'جنسیت ثبت‌شده',
    'demographics.province': 'استان ثبت‌شده',
    'demographics.city': 'شهر ثبت‌شده',
    'demographics.age': 'سن ثبت‌شده',
    'demographics.education': 'تحصیلات ثبت‌شده',
  };
  return (
    labels[field] ??
    (field.startsWith('scores.') ? `نمرهٔ ${field.slice(7)}` : field)
  );
}

function groupLabel(value: Scalar, field: string | null) {
  if (value === null) return 'نامشخص';
  if (typeof value === 'number') return numbers.format(value);
  if (typeof value === 'boolean') return value ? 'بله' : 'خیر';
  const labels: Record<string, Record<string, string>> = {
    kind: { message: 'گفتگو', test: 'آزمون', match: 'فرم ازدواج' },
    role: { user: 'مخاطب', assistant: 'ربات', system: 'سامانه' },
    'demographics.gender': { female: 'زن', male: 'مرد' },
  };
  return labels[field ?? '']?.[value] ?? value;
}

function numericLabel(value: number | null | undefined, percentage = false) {
  if (value === null || value === undefined) return 'نامشخص';
  return percentage ? `${percentages.format(value)}٪` : numbers.format(value);
}

function csvCell(value: Scalar | undefined) {
  let text = value === null || value === undefined ? 'نامشخص' : String(value);
  if (typeof value === 'string' && /^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCalculation(calculation: Calculation, index: number) {
  const rows: (Scalar | undefined)[][] = [
    ['معیار', metricLabels[calculation.metric]],
    ['واحد', calculation.unit],
    ['فیلد', calculation.field],
    ['گروه‌بندی', calculation.groupBy],
    [],
    ['کل دامنه', ...groupColumns.map(({ label }) => label)],
    [
      'کل',
      ...groupColumns.map(({ key }) =>
        key in calculation.totals
          ? calculation.totals[key as keyof Summary]
          : undefined,
      ),
    ],
    [],
    ['گروه', ...groupColumns.map(({ label }) => label)],
    ...calculation.groups.map((group) => [
      group.key,
      ...groupColumns.map(({ key }) => group[key]),
    ]),
  ];
  downloadText(
    `analysis-calculation-${index + 1}.csv`,
    rows.map((row) => row.map(csvCell).join(',')).join('\r\n'),
    'text/csv;charset=utf-8',
  );
}

export function AnalysisStatistics({
  calculations,
}: {
  calculations: unknown[];
}) {
  if (calculations.length === 0) return null;
  return (
    <div className="space-y-4">
      {calculations.map((raw, index) => {
        const calculation = parseCalculation(raw);
        if (!calculation)
          return (
            <ErrorState
              key={index}
              message="ساختار یکی از نتایج محاسباتی قابل نمایش نیست. نتیجهٔ تحقیق را دوباره بررسی کنید."
            />
          );
        const columns = groupColumns.filter(({ key }) =>
          calculation.groups.some((group) => group[key] !== undefined),
        );
        const title = [
          calculation.metric === 'count' && calculation.unit === 'conversation'
            ? 'تعداد گفتگوها'
            : metricLabels[calculation.metric],
          fieldLabel(calculation.field),
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <Panel key={index}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">{title}</h3>
                {calculation.groupBy && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    گروه‌بندی بر اساس {fieldLabel(calculation.groupBy)}
                  </p>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => exportCalculation(calculation, index)}
              >
                <Download className="size-4" />
                دریافت جدول
              </Button>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {(
                [
                  ['eligible', 'رکوردهای واجد شرایط'],
                  ['measured', 'دارای مقدار معتبر'],
                  ['missing', 'فاقد مقدار معتبر'],
                  ['value', metricLabels[calculation.metric]],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <dt className="text-xs leading-6 text-muted-foreground">
                    {label}
                  </dt>
                  <dd
                    className="mt-1 break-words text-xl font-bold tabular-nums"
                    title={String(calculation.totals[key])}
                  >
                    {numericLabel(calculation.totals[key])}
                  </dd>
                </div>
              ))}
            </dl>
            {calculation.metric === 'distinctContacts' && (
              <p className="mt-4 text-xs leading-6 text-muted-foreground">
                شمارش مخاطب با شناسهٔ او در همان منبع انجام شده است. تعداد
                رکوردهای دارای شناسه در پوشش محاسبه آمده است.
              </p>
            )}
            {calculation.groups.length > 0 && (
              <div className="mt-5 overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[520px] text-right text-sm">
                  <caption className="sr-only">
                    {title} بر اساس {fieldLabel(calculation.groupBy)}
                  </caption>
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        {fieldLabel(calculation.groupBy) || 'گروه'}
                      </th>
                      {columns.map(({ key, label }) => (
                        <th key={key} scope="col" className="px-4 py-3">
                          {key === 'value'
                            ? metricLabels[calculation.metric]
                            : label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {calculation.groups.map((group, rowIndex) => (
                      <tr key={rowIndex} className="border-t border-border">
                        <th
                          scope="row"
                          className="max-w-72 break-words px-4 py-3 font-medium"
                        >
                          {groupLabel(group.key, calculation.groupBy)}
                        </th>
                        {columns.map(({ key }) => (
                          <td
                            key={key}
                            className="whitespace-nowrap px-4 py-3 tabular-nums"
                            title={
                              group[key] === undefined
                                ? undefined
                                : String(group[key])
                            }
                          >
                            {numericLabel(group[key], key === 'share')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {calculation.groupBy && calculation.groups.length === 0 && (
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                گروهی در دامنهٔ این محاسبه وجود ندارد.
              </p>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
