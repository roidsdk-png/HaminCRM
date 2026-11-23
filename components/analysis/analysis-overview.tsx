'use client';

import {
  ArrowLeft,
  Database,
  MessageSquareText,
  RefreshCw,
} from 'lucide-react';
import type { AnalysisCatalog, AnalysisOverview } from '@/lib/analysis/types';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  faNumber,
  formatDate,
  Metric,
  Panel,
} from './analysis-primitives';
import { CoverageSummary } from './analysis-run';

export function AnalysisOverviewPanel({
  overview,
  catalog,
  canManage,
  syncing,
  onSync,
  onResearch,
}: {
  overview: AnalysisOverview;
  catalog: AnalysisCatalog | null;
  canManage: boolean;
  syncing: boolean;
  onSync: () => void;
  onResearch: () => void;
}) {
  const { totals } = overview;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="پیام‌های مخاطبان"
          value={totals.userMessages}
          hint="در دامنهٔ انتخاب‌شده"
        />
        <Metric
          label="گفتگوها"
          value={totals.conversations}
          hint="گفتگوهای دارای رکورد واجد شرایط"
        />
        <Metric label="تلاش‌های آزمون" value={totals.tests} />
        <Metric label="فرم‌های ازدواج" value={totals.matches} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Panel>
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Database className="size-4 text-primary" />
            پوشش داده‌های انتخاب‌شده
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-4 border-b border-border pb-5">
            <div>
              <p className="text-xs text-muted-foreground">کل رکوردها</p>
              <p className="mt-2 text-xl font-bold">
                {faNumber.format(totals.records)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">مخاطب در هر منبع</p>
              <p className="mt-2 text-xl font-bold">
                {faNumber.format(totals.contacts)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">پیام‌های ربات</p>
              <p className="mt-2 text-xl font-bold">
                {faNumber.format(totals.assistantMessages)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">آخرین همگام‌سازی</p>
              <p className="mt-2 text-xs font-semibold leading-6">
                {formatDate(
                  overview.dataset?.syncedAt ?? catalog?.sync?.lastSyncedAt,
                )}
              </p>
            </div>
          </div>
          <div className="mt-4">
            <CoverageSummary coverage={overview.coverage} />
          </div>
          <p className="mt-3 text-[11px] leading-6 text-muted-foreground">
            مخاطبان هر منبع با شناسهٔ همان منبع شمرده می‌شوند. مقایسهٔ فردی میان
            منابع به پیوند هویت تأییدشده نیاز دارد.
          </p>
          {totals.linkedContacts !== undefined && (
            <p className="mt-2 text-xs leading-7 text-muted-foreground">
              {faNumber.format(totals.linkedContacts)} مخاطبِ منبع دارای پیوند
              تأییدشده، مربوط به{' '}
              {faNumber.format(totals.verifiedIdentities ?? 0)} هویت مشترک در
              این دامنه.
            </p>
          )}
          {overview.notice && (
            <p className="mt-3 text-xs leading-7 text-muted-foreground">
              {overview.notice}
            </p>
          )}
        </Panel>
        <Panel>
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <MessageSquareText className="size-4 text-primary" />
            تحقیق در اطلاعات مخاطبان
          </h2>
          <p className="mt-4 text-sm leading-8 text-muted-foreground">
            سؤال را به فارسی بپرسید، دامنهٔ تحقیق را انتخاب کنید و شواهد هر نتیجه
            را ببینید.
          </p>
          <Button className="mt-5 h-10 rounded-xl" onClick={onResearch}>
            شروع تحقیق
            <ArrowLeft />
          </Button>
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-xs leading-7 text-muted-foreground">
              برای واردکردن داده‌های تازهٔ CRM به مخزن تحلیل، همگام‌سازی را اجرا
              کنید.
            </p>
            {canManage && (
              <Button
                variant="outline"
                className="mt-3"
                disabled={syncing}
                onClick={onSync}
              >
                <RefreshCw className={syncing ? 'animate-spin' : ''} />
                {syncing ? 'در حال همگام‌سازی' : 'همگام‌سازی داده‌ها'}
              </Button>
            )}
          </div>
        </Panel>
      </div>
      <Panel>
        <h2 className="mb-4 text-sm font-bold">منابع قابل استفاده</h2>
        {overview.sources.length === 0 ? (
          <EmptyState
            title="منبعی در مخزن تحلیل وجود ندارد"
            detail="با همگام‌سازی، اطلاعات منابع و رکوردهای مجاز CRM دریافت می‌شود."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="pb-3 font-medium">منبع</th>
                  <th className="pb-3 font-medium">بستر</th>
                  <th className="pb-3 font-medium">نوع</th>
                  <th className="pb-3 font-medium">وضعیت اتصال</th>
                </tr>
              </thead>
              <tbody>
                {overview.sources.map((source) => (
                  <tr
                    key={source.id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="py-3 font-semibold">
                      {source.name}
                      <span
                        className="mt-1 block text-[10px] font-normal text-muted-foreground"
                        dir="ltr"
                      >
                        {source.slug}
                      </span>
                    </td>
                    <td className="py-3">
                      {(
                        {
                          bale: 'بله',
                          eitaa: 'ایتا',
                          telegram: 'تلگرام',
                          web: 'وب',
                        } as Record<string, string>
                      )[source.platform] ?? source.platform}
                    </td>
                    <td className="py-3">
                      {(
                        {
                          chatbot: 'چت‌بات',
                          test: 'آزمون',
                          matchmaking: 'فرم ازدواج',
                        } as Record<string, string>
                      )[source.kind] ?? source.kind}
                    </td>
                    <td className="py-3">
                      {(
                        {
                          active: 'فعال',
                          pending: 'در انتظار',
                          paused: 'متوقف',
                        } as Record<string, string>
                      )[source.status] ?? source.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
