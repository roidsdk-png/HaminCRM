'use client';

import { Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { analysisRequest, errorMessage } from './analysis-api';
import { AnalysisProviderSettings } from './analysis-provider-settings';
import {
  AnalysisContactPicker,
  type AnalysisContact,
} from './analysis-contact-picker';
import {
  ErrorState,
  Field,
  LoadingState,
  Panel,
  faNumber,
  formatDate,
} from './analysis-primitives';

type IdentityGroup = {
  id: string;
  basis: string;
  verifiedAt: number;
  revokedAt: number | null;
  members: { id: string; name: string; sourceName: string }[];
};
type Guide = {
  testKey: string;
  version: string;
  source: string | { title?: string; reference?: string; url?: string };
};
type GuideCatalog = {
  guides: Guide[];
  ambiguous?: { testKey: string; version: string }[];
};
type Lexicon = { stopwords: string[]; version: string };
type Configuration = {
  modelConfigured: boolean;
  embeddingConfigured: boolean;
  model?: string;
  embeddingModel?: string;
  limits: { monthlyTokens: number; maxRunRecords: number; maxRunCalls: number };
  usage: {
    month: string;
    inputTokens: number;
    outputTokens: number;
    calls: number;
    unreportedCalls?: number;
  };
};

export function AnalysisSettings({
  onConfigurationChange,
}: {
  onConfigurationChange?: () => void;
}) {
  const [identities, setIdentities] = useState<IdentityGroup[]>([]);
  const [guides, setGuides] = useState<GuideCatalog>({ guides: [] });
  const [configuration, setConfiguration] = useState<Configuration | null>(
    null,
  );
  const [lexiconVersion, setLexiconVersion] = useState('');
  const [stopwords, setStopwords] = useState('');
  const [contacts, setContacts] = useState<AnalysisContact[]>([]);
  const [basis, setBasis] = useState('');
  const [verified, setVerified] = useState(false);
  const [guideText, setGuideText] = useState('');
  const [guideConfirmed, setGuideConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const [identityData, lexiconData, guideData, configurationData] =
        await Promise.all([
          analysisRequest<{ items: IdentityGroup[] }>('/identities', {
            signal,
          }),
          analysisRequest<Lexicon>('/lexicon', { signal }),
          analysisRequest<GuideCatalog>('/guides', { signal }),
          analysisRequest<Configuration>('/config', { signal }),
        ]);
      if (signal?.aborted) return;
      setIdentities(identityData.items);
      setStopwords(lexiconData.stopwords.join('\n'));
      setLexiconVersion(lexiconData.version);
      setGuides(guideData);
      setConfiguration(configurationData);
    } catch (failure) {
      if (!signal?.aborted) setError(errorMessage(failure));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  async function mutate(
    action: () => Promise<unknown>,
    message: string,
    reset?: () => void,
  ) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      reset?.();
      await load();
      setNotice(message);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function addContact(contact: AnalysisContact) {
    setContacts((current) =>
      current.some((item) => item.localId === contact.localId)
        ? current
        : [...current, contact],
    );
  }

  function saveGuide() {
    let guide: unknown;
    try {
      guide = JSON.parse(guideText);
    } catch {
      setError('متن راهنما JSON معتبر نیست. ساختار فایل را بررسی کنید.');
      return;
    }
    void mutate(
      () =>
        analysisRequest('/guides', {
          method: 'POST',
          body: JSON.stringify({ guide, confirmed: true }),
        }),
      'راهنمای آزمون ذخیره شد.',
      () => {
        setGuideText('');
        setGuideConfirmed(false);
      },
    );
  }

  if (loading && !busy)
    return <LoadingState label="در حال دریافت تنظیمات تحلیل" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-7 text-muted-foreground">
          مدیریت این بخش به دسترسی مالک سامانه نیاز دارد.
        </p>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          <RefreshCw />
          تازه‌سازی
        </Button>
      </div>
      {error && <ErrorState message={error} retry={() => void load()} />}
      {notice && (
        <output className="block rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm leading-7">
          {notice}
        </output>
      )}
      <AnalysisProviderSettings
        onSaved={() => {
          void load();
          onConfigurationChange?.();
        }}
      />
      {configuration && (
        <Panel>
          <h2 className="text-sm font-bold">وضعیت مدل و مصرف پردازش</h2>
          <div className="mt-4 grid gap-4 text-xs leading-7 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <p className="text-muted-foreground">مدل تحلیل</p>
              <p>
                {configuration.modelConfigured
                  ? 'پیکربندی شده'
                  : 'در انتظار اتصال API'}
              </p>
              <p className="break-all" dir="ltr">
                {configuration.model || '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">جست‌وجوی معنایی</p>
              <p>
                {configuration.embeddingConfigured
                  ? 'پیکربندی شده'
                  : 'در انتظار اتصال API'}
              </p>
              <p className="break-all" dir="ltr">
                {configuration.embeddingModel || '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">
                مصرف ماه <span dir="ltr">{configuration.usage.month}</span>
              </p>
              <p>
                {faNumber.format(
                  configuration.usage.inputTokens +
                    configuration.usage.outputTokens,
                )}{' '}
                توکن از {faNumber.format(configuration.limits.monthlyTokens)}
              </p>
              <p>{faNumber.format(configuration.usage.calls)} فراخوانی</p>
              {!!configuration.usage.unreportedCalls && (
                <p className="text-amber-700 dark:text-amber-300">
                  گزارش مصرف توکن برای{' '}
                  {faNumber.format(configuration.usage.unreportedCalls)} تلاش
                  دریافت نشده است؛ جمع نمایش‌داده‌شده کامل نیست.
                </p>
              )}
            </div>
            <div>
              <p className="text-muted-foreground">حداکثر رکورد در هر تحقیق</p>
              <p>{faNumber.format(configuration.limits.maxRunRecords)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">
                حداکثر فراخوانی در هر تحقیق
              </p>
              <p>{faNumber.format(configuration.limits.maxRunCalls)}</p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-7 text-muted-foreground">
            ارائه‌دهنده و کلید مدل را در فرم اتصال همین بخش تنظیم کنید.
            پیکربندی‌شدن مدل به معنی تأیید کیفیت پاسخ‌ها نیست. مصرف ثبت‌شده بر اساس
            پاسخ ارائه‌دهنده محاسبه می‌شود و صورت‌حساب نهایی را باید در پنل همان
            سرویس بررسی کنید.
          </p>
        </Panel>
      )}
      <Panel>
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <ShieldCheck className="size-4 text-primary" />
          پیوند تأییدشدهٔ مخاطبان
        </h2>
        <p className="mt-3 text-xs leading-7 text-muted-foreground">
          برای تحلیل چت و آزمون یک فرد در چند منبع، مخاطبان همان فرد را انتخاب و
          مبنای تأیید را ثبت کنید. شباهت نام به تنهایی برای تأیید کافی نیست.
          نام‌ها در همین CRM نمایش داده می‌شوند و مدل شناسهٔ مستعار دریافت می‌کند.
        </p>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <AnalysisContactPicker
              disabled={busy || contacts.length >= 50}
              onChange={() => {}}
              onSelect={addContact}
            />
            <ul className="space-y-2" aria-label="مخاطبان انتخاب‌شده برای پیوند">
              {contacts.map((contact) => (
                <li
                  key={contact.localId}
                  className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2 text-xs"
                >
                  <span>
                    {contact.name}
                    <span className="mr-2 text-muted-foreground">
                      {contact.sourceName}
                    </span>
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`حذف ${contact.name} از انتخاب`}
                    onClick={() =>
                      setContacts((current) =>
                        current.filter(
                          (item) => item.localId !== contact.localId,
                        ),
                      )
                    }
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
            <Field
              label="مبنای تأیید یکسان‌بودن فرد"
              hint="مثلاً تأیید مستقیم صاحب اطلاعات یا شناسهٔ مشترک معتبر را همراه با شرح کافی ثبت کنید."
            >
              <Textarea
                value={basis}
                maxLength={2000}
                disabled={busy}
                onChange={(event) => setBasis(event.target.value)}
              />
            </Field>
            <label className="flex items-start gap-3 text-xs leading-7">
              <input
                type="checkbox"
                className="mt-2"
                checked={verified}
                disabled={busy}
                onChange={(event) => setVerified(event.target.checked)}
              />
              <span>
                بررسی کرده‌ام که همهٔ مخاطبان انتخاب‌شده متعلق به یک فرد هستند و
                مجوز ثبت این پیوند را دارم.
              </span>
            </label>
            <Button
              disabled={
                busy ||
                contacts.length < 2 ||
                basis.trim().length < 10 ||
                !verified
              }
              onClick={() =>
                void mutate(
                  () =>
                    analysisRequest('/identities', {
                      method: 'POST',
                      body: JSON.stringify({
                        contactIds: contacts.map((item) => item.localId),
                        basis: basis.trim(),
                        confirmed: true,
                      }),
                    }),
                  'پیوند ثبت شد. با همگام‌سازی بعدی، دادهٔ تحلیلی به‌روز می‌شود.',
                  () => {
                    setContacts([]);
                    setBasis('');
                    setVerified(false);
                  },
                )
              }
            >
              <Plus />
              ثبت پیوند تأییدشده
            </Button>
          </div>
          <div className="space-y-3">
            <h3 className="text-xs font-bold">
              پیوندهای ثبت‌شده ({faNumber.format(identities.length)})
            </h3>
            {identities.length === 0 && (
              <p className="text-xs leading-7 text-muted-foreground">
                هنوز پیوند تأییدشده‌ای ثبت نشده است.
              </p>
            )}
            <div className="max-h-96 space-y-3 overflow-y-auto">
              {identities.map((group) => (
                <div
                  key={group.id}
                  className="rounded-xl border border-border p-4 text-xs leading-7"
                >
                  <p className="font-semibold">
                    {group.revokedAt ? 'پیوند لغوشده' : 'پیوند فعال'}
                  </p>
                  <ul>
                    {group.members.map((member) => (
                      <li key={member.id}>
                        {member.name} · {member.sourceName}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                    {group.basis}
                  </p>
                  <p className="text-muted-foreground">
                    ثبت در {formatDate(group.verifiedAt)}
                  </p>
                  {group.revokedAt ? (
                    <p className="text-muted-foreground">
                      لغو در {formatDate(group.revokedAt)}
                    </p>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () =>
                            analysisRequest(
                              `/identities?id=${encodeURIComponent(group.id)}`,
                              { method: 'DELETE' },
                            ),
                          'پیوند لغو شد. با همگام‌سازی بعدی، دادهٔ تحلیلی به‌روز می‌شود.',
                        )
                      }
                    >
                      <Trash2 />
                      لغو پیوند
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>
      <Panel>
        <h2 className="text-sm font-bold">
          واژه‌های نادیده‌گرفته‌شده در ابر کلمات
        </h2>
        <p className="mt-3 text-xs leading-7 text-muted-foreground">
          هر واژه را در یک خط وارد کنید. این تنظیم به شما کمک می‌کند واژه‌های
          عمومی و کم‌معنا را از ابر کلمات کنار بگذارید.
        </p>
        <div className="mt-4 space-y-4">
          <Field label="فهرست واژه‌ها">
            <Textarea
              className="min-h-40"
              value={stopwords}
              disabled={busy}
              onChange={(event) => setStopwords(event.target.value)}
            />
          </Field>
          {lexiconVersion && (
            <p className="break-all text-xs text-muted-foreground">
              نسخهٔ فهرست <span dir="ltr">{lexiconVersion}</span>
            </p>
          )}
          <Button
            disabled={busy}
            onClick={() =>
              void mutate(
                () =>
                  analysisRequest('/lexicon', {
                    method: 'POST',
                    body: JSON.stringify({
                      stopwords: [
                        ...new Set(
                          stopwords
                            .split(/\r?\n/)
                            .map((word) => word.trim())
                            .filter(Boolean),
                        ),
                      ],
                    }),
                  }),
                'فهرست واژه‌ها ذخیره شد.',
              )
            }
          >
            ذخیرهٔ فهرست واژه‌ها
          </Button>
        </div>
      </Panel>
      <Panel>
        <h2 className="text-sm font-bold">راهنماهای معتبر آزمون</h2>
        <p className="mt-3 text-xs leading-7 text-muted-foreground">
          فقط راهنمای معتبر همان نسخهٔ آزمون را وارد کنید. راهنما باید شناسهٔ
          آزمون، نسخه، مرجع و تعریف واقعی مقیاس‌ها و تفسیر را داشته باشد. راهنمای
          ناسازگار یا متعارض برای تفسیر انتخاب نمی‌شود.
        </p>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <div className="space-y-4">
            <Field label="متن راهنما در قالب JSON">
              <Textarea
                dir="ltr"
                className="min-h-56 font-mono text-xs"
                value={guideText}
                disabled={busy}
                onChange={(event) => setGuideText(event.target.value)}
                placeholder={
                  '{\n  "testKey": "...",\n  "version": "...",\n  "source": "...",\n  "scales": []\n}'
                }
              />
            </Field>
            <label className="flex items-start gap-3 text-xs leading-7">
              <input
                type="checkbox"
                className="mt-2"
                checked={guideConfirmed}
                disabled={busy}
                onChange={(event) => setGuideConfirmed(event.target.checked)}
              />
              <span>
                اعتبار مرجع، روش نمره‌گذاری و تطابق نسخهٔ این راهنما را بررسی
                کرده‌ام.
              </span>
            </label>
            <Button
              disabled={busy || !guideText.trim() || !guideConfirmed}
              onClick={saveGuide}
            >
              ثبت راهنمای معتبر
            </Button>
          </div>
          <div className="space-y-3">
            <h3 className="text-xs font-bold">
              راهنماهای موجود ({faNumber.format(guides.guides.length)})
            </h3>
            {guides.ambiguous && guides.ambiguous.length > 0 && (
              <div
                role="alert"
                className="space-y-3 text-xs leading-7 text-amber-700 dark:text-amber-400"
              >
                <p>
                  تعریف متعارض در راهنماها وجود دارد. مرجع و نسخه‌ها را بررسی
                  کنید. راهنماهای واردشده از این صفحه قابل حذف‌اند و فایل‌های
                  خارجی باید در محل اصلی اصلاح شوند.
                </p>
                {guides.ambiguous.map((guide) => (
                  <div
                    key={`ambiguous:${guide.testKey}:${guide.version}`}
                    className="rounded-xl border border-amber-500/25 p-3"
                  >
                    <p className="break-all" dir="ltr">
                      {guide.testKey} · {guide.version}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () =>
                            analysisRequest(
                              `/guides?${new URLSearchParams({ testKey: guide.testKey, version: guide.version })}`,
                              { method: 'DELETE' },
                            ),
                          'راهنمای واردشده حذف شد. وضعیت تعارض را بررسی کنید.',
                        )
                      }
                    >
                      <Trash2 />
                      حذف راهنمای واردشده
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {guides.guides.length === 0 && (
              <p className="text-xs leading-7 text-muted-foreground">
                راهنمایی ثبت نشده است. آمار خام آزمون‌ها همچنان در دسترس است.
              </p>
            )}
            <div className="max-h-96 space-y-3 overflow-y-auto">
              {guides.guides.map((guide) => (
                <div
                  key={`${guide.testKey}:${guide.version}`}
                  className="rounded-xl border border-border p-4 text-xs leading-7"
                >
                  <p className="break-all font-semibold" dir="ltr">
                    {guide.testKey} · {guide.version}
                  </p>
                  <p className="break-words text-muted-foreground">
                    {typeof guide.source === 'string'
                      ? guide.source
                      : guide.source.title ||
                        guide.source.reference ||
                        guide.source.url ||
                        'مرجع ثبت‌شده'}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    className="mt-2"
                    onClick={() =>
                      void mutate(
                        () =>
                          analysisRequest(
                            `/guides?${new URLSearchParams({ testKey: guide.testKey, version: guide.version })}`,
                            { method: 'DELETE' },
                          ),
                        'راهنمای آزمون حذف شد.',
                      )
                    }
                  >
                    <Trash2 />
                    حذف راهنما
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
