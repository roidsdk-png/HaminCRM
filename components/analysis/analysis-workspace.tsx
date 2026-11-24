'use client';

import {
  Activity,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  ChevronLeft,
  Cloud,
  Database,
  FilePenLine,
  History,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Search,
  Settings2,
  Square,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  AnalysisCatalog,
  AnalysisEvidence,
  AnalysisFilters,
  AnalysisOverview,
  AnalysisRun,
  AnalysisSyncResponse,
} from '@/lib/analysis/types';
import { Button } from '@/components/ui/button';
import { analysisRequest, errorMessage } from './analysis-api';
import { AnalysisContent } from './analysis-content';
import { EvidenceDrawer } from './analysis-evidence';
import { AnalysisExperiences } from './analysis-experiences';
import {
  AnalysisFilterBar,
  defaultFilters,
  filtersQuery,
} from './analysis-filters';
import { AnalysisInsights, runKindTitle } from './analysis-insights';
import { AnalysisOverviewPanel } from './analysis-overview';
import {
  EmptyState,
  ErrorState,
  faNumber,
  formatDate,
  LoadingState,
  Panel,
} from './analysis-primitives';
import { AnalysisResearch } from './analysis-research';
import { RunProgress, useAnalysisRun } from './analysis-run';
import { AnalysisWordsPanel } from './analysis-words';
import { AnalysisSettings } from './analysis-settings';
import { AnalysisHistory } from './analysis-history';

type Tab =
  | 'overview'
  | 'words'
  | 'challenges'
  | 'emotions'
  | 'experiences'
  | 'research'
  | 'content'
  | 'history'
  | 'settings';
const tabs = [
  { id: 'overview' as Tab, label: 'نمای کلی', icon: Database },
  { id: 'words' as Tab, label: 'ادبیات مخاطب', icon: Cloud },
  { id: 'challenges' as Tab, label: 'چالش‌ها', icon: BrainCircuit },
  { id: 'emotions' as Tab, label: 'هیجان‌ها', icon: Activity },
  { id: 'experiences' as Tab, label: 'تجربه‌ها', icon: Search },
  { id: 'research' as Tab, label: 'دستیار تحقیق', icon: MessageSquareText },
  { id: 'content' as Tab, label: 'کارگاه محتوا', icon: FilePenLine },
  { id: 'history' as Tab, label: 'سابقهٔ تحلیل‌ها', icon: History },
  { id: 'settings' as Tab, label: 'منابع و تنظیمات', icon: Settings2 },
];

export function AnalysisWorkspace({
  canManage,
  canConfigure,
}: {
  canManage: boolean;
  canConfigure: boolean;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [filters, setFilters] = useState<AnalysisFilters>(defaultFilters);
  const [catalog, setCatalog] = useState<AnalysisCatalog | null>(null);
  const [overview, setOverview] = useState<AnalysisOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [overviewError, setOverviewError] = useState('');
  const [reload, setReload] = useState(0);
  const [selectedEvidence, setSelectedEvidence] = useState<AnalysisEvidence[]>(
    [],
  );
  const [evidenceIds, setEvidenceIds] = useState<string[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<AnalysisSyncResponse | null>(
    null,
  );
  const [syncError, setSyncError] = useState('');
  const syncController = useRef<AbortController | null>(null);
  const runController = useAnalysisRun();
  const configuration = overview?.configuration ?? catalog?.configuration;
  const canRun = canManage && !!configuration?.modelConfigured && !syncing;

  useEffect(() => {
    const controller = new AbortController();
    const kickoff = window.setTimeout(() => {
      setLoading(true);
      setCatalogError('');
      setOverviewError('');
      void Promise.allSettled([
        analysisRequest<AnalysisCatalog>('/catalog', {
          signal: controller.signal,
        }),
        analysisRequest<AnalysisOverview>(
          `/overview?${filtersQuery(filters)}`,
          {
            signal: controller.signal,
          },
        ),
      ]).then(([catalogResult, overviewResult]) => {
        if (controller.signal.aborted) return;
        if (catalogResult.status === 'fulfilled')
          setCatalog(catalogResult.value);
        else setCatalogError(errorMessage(catalogResult.reason));
        if (overviewResult.status === 'fulfilled')
          setOverview(overviewResult.value);
        else {
          setOverview(null);
          setOverviewError(errorMessage(overviewResult.reason));
        }
        setLoading(false);
      });
    }, 0);
    return () => {
      window.clearTimeout(kickoff);
      controller.abort();
    };
  }, [filters, reload]);

  useEffect(() => () => syncController.current?.abort(), []);

  async function synchronize() {
    if (syncing || !canManage) return;
    const controller = new AbortController();
    syncController.current = controller;
    setSyncing(true);
    setSyncError('');
    setSyncProgress(null);
    try {
      let progress: AnalysisSyncResponse;
      let request: { mode: 'full'; snapshotId?: string; cursor?: number } = {
        mode: 'full',
      };
      do {
        progress = await analysisRequest<AnalysisSyncResponse>('/sync', {
          method: 'POST',
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        setSyncProgress(progress);
        if (
          !progress.complete &&
          (progress.nextCursor === null ||
            progress.nextCursor === request.cursor)
        )
          throw new Error(
            'دریافت صفحهٔ بعدی داده پیش نرفت. همگام‌سازی را دوباره اجرا کنید.',
          );
        request = {
          mode: 'full',
          snapshotId: progress.snapshotId,
          cursor: progress.nextCursor ?? undefined,
        };
      } while (!progress.complete && !controller.signal.aborted);
      if (!controller.signal.aborted) {
        setSelectedEvidence([]);
        setReload((value) => value + 1);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setSyncError(errorMessage(failure));
    } finally {
      setSyncing(false);
      syncController.current = null;
    }
  }

  async function openSavedRun(run: AnalysisRun) {
    await runController.restore(run.id);
    setFilters({ ...defaultFilters(), ...run.filters });
    setTab(run.sessionId ? 'research' : run.kind);
  }

  function toggleEvidence(item: AnalysisEvidence) {
    setSelectedEvidence((items) =>
      items.some((value) => value.id === item.id)
        ? items.filter((value) => value.id !== item.id)
        : [...items, item],
    );
  }

  const lastSync = overview?.dataset?.syncedAt ?? catalog?.sync?.lastSyncedAt;
  const runningElsewhere =
    runController.busy &&
    runController.run &&
    tab !== runController.run.kind &&
    !(tab === 'research' && runController.run.sessionId);

  return (
    <div className="mx-auto max-w-[1480px] space-y-5 p-4 md:p-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>داده‌های CRM</span>
            <ChevronLeft className="size-3" />
            <span>تحلیل و هوش مصنوعی</span>
          </div>
          <h1 className="mt-3 text-xl font-black tracking-tight md:text-2xl">
            از گفته‌های مخاطب تا بینش و محتوا
          </h1>
          <p className="mt-2 text-xs leading-7 text-muted-foreground">
            {lastSync
              ? `داده‌ها همگام‌شده تا ${formatDate(lastSync)}`
              : 'برای شروع، داده‌های CRM را به مخزن تحلیل وارد کنید.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedEvidence.length > 0 && (
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              onClick={() => setTab('content')}
            >
              <BookOpen />
              {faNumber.format(selectedEvidence.length)} شاهد انتخاب‌شده
            </Button>
          )}
          {canManage && (
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              disabled={
                syncing ||
                runController.busy ||
                !catalog?.configuration.serviceConfigured
              }
              onClick={() => void synchronize()}
            >
              <RefreshCw className={syncing ? 'animate-spin' : ''} />
              همگام‌سازی
            </Button>
          )}
        </div>
      </header>
      <AnalysisFilterBar
        key={JSON.stringify(filters)}
        filters={filters}
        sources={catalog?.sources ?? []}
        onApply={setFilters}
        disabled={syncing}
      />
      {catalogError && (
        <ErrorState
          message={catalogError}
          retry={() => setReload((value) => value + 1)}
        />
      )}
      {catalog?.notice && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs leading-7 text-amber-800 dark:text-amber-200">
          {catalog.notice}
        </div>
      )}
      {configuration && !configuration.modelConfigured && (
        <Panel>
          <div className="flex items-start gap-3">
            <Settings2 className="mt-1 size-5 shrink-0 text-primary" />
            <div>
              <h2 className="text-sm font-bold">
                اتصال مدل هوش مصنوعی نیازمند تنظیم است
              </h2>
              <p className="mt-2 text-xs leading-7 text-muted-foreground">
                پس از تنظیم مدل، تحقیق، استخراج تجربه و تولید محتوا فعال می‌شوند.
                آمار و واژه‌های موجود از داده‌های همگام‌شده قابل بررسی‌اند.
              </p>
              {canConfigure && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-primary">
                    راهنمای اتصال مدل
                  </summary>
                  <p className="mt-3 text-xs leading-7 text-muted-foreground">
                    در زبانهٔ «منابع و تنظیمات»، ارائه‌دهنده، شناسهٔ مدل و کلید API
                    را ثبت کنید. انتخاب OpenAI، Google AI Studio، OpenRouter،
                    AvalAI، GapGPT و سرویس سفارشی در دسترس است.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-3"
                    onClick={() => setTab('settings')}
                  >
                    تنظیم اتصال مدل
                  </Button>
                  <div
                    className="mt-2 overflow-x-auto rounded-lg bg-background px-3 py-2 text-[11px] leading-7 text-muted-foreground"
                    dir="ltr"
                  >
                    <code>
                      ANALYTICS_SERVICE_URL · ANALYTICS_INTERNAL_TOKEN
                      <br />
                      ANALYTICS_API_BASE_URL · ANALYTICS_API_KEY ·
                      ANALYTICS_MODEL · ANALYTICS_EMBEDDING_MODEL
                    </code>
                  </div>
                </details>
              )}
            </div>
          </div>
        </Panel>
      )}
      {configuration?.modelConfigured && !configuration.embeddingConfigured && (
        <p className="text-xs leading-7 text-muted-foreground">
          جست‌وجوی معنایی با تنظیم مدل بردارسازی فعال می‌شود. وضعیت روش بازیابی در
          نتیجهٔ تحقیق مشخص است.
        </p>
      )}
      {!canManage && (
        <p className="rounded-xl border border-border bg-card p-4 text-xs leading-7 text-muted-foreground">
          نقش شما امکان مشاهدهٔ گزارش‌ها را دارد. اجرای تحلیل و تولید محتوا به نقش
          مدیر عملیاتی یا مالک نیاز دارد.
        </p>
      )}
      {syncError && (
        <ErrorState message={syncError} retry={() => void synchronize()} />
      )}
      {syncing && (
        <Panel>
          <div className="flex items-center justify-between">
            <output className="flex items-center gap-2 text-xs font-semibold">
              <LoaderCircle className="size-4 animate-spin text-primary" />
              دریافت داده‌های CRM
            </output>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => syncController.current?.abort()}
            >
              <Square />
              لغو دریافت
            </Button>
          </div>
          {syncProgress && (
            <>
              <progress
                className="mt-4 h-1.5 w-full accent-primary"
                max={Math.max(1, syncProgress.total)}
                value={syncProgress.processed}
                aria-label="پیشرفت همگام‌سازی"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {faNumber.format(syncProgress.processed)} از{' '}
                {faNumber.format(syncProgress.total)} رکورد
              </p>
            </>
          )}
        </Panel>
      )}
      {!syncing && syncProgress?.complete && (
        <p className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4" />
          همگام‌سازی {faNumber.format(syncProgress.total)} رکورد تکمیل شد.
        </p>
      )}
      <nav
        className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1.5"
        aria-label="بخش‌های تحلیل"
      >
        {tabs
          .filter((item) => item.id !== 'settings' || canConfigure)
          .map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-xs font-semibold transition ${tab === id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
      </nav>
      {runningElsewhere && (
        <div className="space-y-2">
          <button
            type="button"
            className="text-xs font-semibold text-primary"
            onClick={() =>
              setTab(
                runController.run!.sessionId
                  ? 'research'
                  : (runController.run!.kind as Tab),
              )
            }
          >
            بازگشت به {runKindTitle(runController.run!.kind)}
          </button>
          <RunProgress
            run={runController.run}
            onCancel={runController.cancel}
            error={runController.error}
          />
        </div>
      )}
      {loading && <LoadingState />}
      {!loading && tab === 'settings' && canConfigure && (
        <AnalysisSettings
          onConfigurationChange={() => setReload((value) => value + 1)}
        />
      )}
      {!loading && tab === 'history' && (
        <AnalysisHistory
          onOpen={openSavedRun}
          refreshKey={runController.run?.id}
        />
      )}
      {!loading &&
        tab === 'overview' &&
        (overview ? (
          <AnalysisOverviewPanel
            overview={overview}
            catalog={catalog}
            canManage={canManage}
            syncing={syncing}
            onSync={() => void synchronize()}
            onResearch={() => setTab('research')}
          />
        ) : (
          <Panel>
            {overviewError ? (
              <ErrorState
                message={overviewError}
                retry={() => setReload((value) => value + 1)}
              />
            ) : (
              <EmptyState title="مخزن تحلیل آمادهٔ دریافت داده است" />
            )}
          </Panel>
        ))}
      {!loading && tab === 'words' && (
        <AnalysisWordsPanel filters={filters} onEvidence={setEvidenceIds} />
      )}
      {(tab === 'challenges' || tab === 'emotions') && (
        <AnalysisInsights
          key={tab}
          kind={tab}
          filters={filters}
          controller={runController}
          canRun={canRun}
          onEvidence={setEvidenceIds}
        />
      )}
      {tab === 'experiences' && (
        <AnalysisExperiences
          filters={filters}
          controller={runController}
          canRun={canRun}
          onEvidence={setEvidenceIds}
        />
      )}
      {tab === 'research' && (
        <AnalysisResearch
          filters={filters}
          controller={runController}
          canRun={canRun}
          onEvidence={setEvidenceIds}
        />
      )}
      {tab === 'content' && (
        <AnalysisContent
          filters={filters}
          controller={runController}
          canRun={canRun}
          selected={selectedEvidence}
          onRemove={(id) =>
            setSelectedEvidence((items) =>
              items.filter((item) => item.id !== id),
            )
          }
          onEvidence={setEvidenceIds}
        />
      )}
      {evidenceIds && (
        <EvidenceDrawer
          ids={evidenceIds}
          selected={selectedEvidence}
          onSelect={toggleEvidence}
          onClose={() => setEvidenceIds(null)}
        />
      )}
    </div>
  );
}
