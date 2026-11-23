'use client';

import { KeyRound, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { analysisRequest, errorMessage } from './analysis-api';
import {
  ErrorState,
  Field,
  LoadingState,
  Panel,
  selectClass,
} from './analysis-primitives';

type ProviderId = 'openai' | 'google' | 'openrouter' | 'custom';
type ProviderOption = { id: ProviderId; label: string; defaultBaseUrl: string };
type ProviderConfiguration = {
  provider: ProviderId;
  model: string;
  apiBaseUrl: string;
  apiKeyConfigured: boolean;
  embeddingProvider: ProviderId | '';
  embeddingModel: string;
  embeddingApiBaseUrl: string;
  embeddingApiKeyConfigured: boolean;
  chatProviders: ProviderOption[];
};
type Draft = Pick<
  ProviderConfiguration,
  | 'provider'
  | 'model'
  | 'apiBaseUrl'
  | 'embeddingProvider'
  | 'embeddingModel'
  | 'embeddingApiBaseUrl'
>;

const defaultOptions: ProviderOption[] = [
  {
    id: 'openai',
    label: 'OpenAI / مدل‌های GPT',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'google',
    label: 'Google AI Studio / Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  { id: 'custom', label: 'نشانی سفارشی سازگار با OpenAI', defaultBaseUrl: '' },
];

function asDraft(value: ProviderConfiguration): Draft {
  return {
    provider: value.provider,
    model: value.model,
    apiBaseUrl: value.apiBaseUrl,
    embeddingProvider: value.embeddingProvider || '',
    embeddingModel: value.embeddingModel,
    embeddingApiBaseUrl: value.embeddingApiBaseUrl || '',
  };
}

export function AnalysisProviderSettings({
  onSaved,
}: {
  onSaved?: () => void;
}) {
  const [saved, setSaved] = useState<ProviderConfiguration | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [embeddingApiKey, setEmbeddingApiKey] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [clearEmbeddingApiKey, setClearEmbeddingApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const value = await analysisRequest<ProviderConfiguration>(
        '/provider-settings',
        { signal },
      );
      if (signal?.aborted) return;
      setSaved(value);
      setDraft(asDraft(value));
      setApiKey('');
      setEmbeddingApiKey('');
      setClearApiKey(false);
      setClearEmbeddingApiKey(false);
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

  async function save(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !saved || busy) return;
    setError('');
    setNotice('');
    if (draft.provider === 'custom' && !draft.apiBaseUrl.trim()) {
      setError('برای ارائه‌دهندهٔ سفارشی، نشانی پایهٔ API را وارد کنید.');
      return;
    }
    if (
      draft.embeddingProvider === 'custom' &&
      !draft.embeddingApiBaseUrl.trim()
    ) {
      setError('نشانی API ارائه‌دهندهٔ سفارشی جست‌وجوی معنایی را وارد کنید.');
      return;
    }
    if (
      draft.provider !== saved.provider &&
      saved.apiKeyConfigured &&
      !apiKey.trim() &&
      !clearApiKey
    ) {
      setError(
        'با تغییر ارائه‌دهنده، کلید تازه وارد کنید یا حذف کلید قبلی را انتخاب کنید.',
      );
      return;
    }
    const currentEmbeddingProvider = saved.embeddingProvider || saved.provider;
    const nextEmbeddingProvider = draft.embeddingProvider || draft.provider;
    if (
      currentEmbeddingProvider !== nextEmbeddingProvider &&
      saved.embeddingApiKeyConfigured &&
      !embeddingApiKey.trim() &&
      !clearEmbeddingApiKey
    ) {
      setError(
        'ارائه‌دهندهٔ جست‌وجوی معنایی تغییر کرده است. کلید تازه وارد کنید یا حذف کلید جداگانهٔ قبلی را انتخاب کنید.',
      );
      return;
    }
    setBusy(true);
    try {
      await analysisRequest('/provider-settings', {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          model: draft.model.trim(),
          apiBaseUrl: draft.apiBaseUrl.trim(),
          embeddingModel: draft.embeddingModel.trim(),
          embeddingApiBaseUrl: draft.embeddingApiBaseUrl.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(embeddingApiKey.trim()
            ? { embeddingApiKey: embeddingApiKey.trim() }
            : {}),
          clearApiKey,
          clearEmbeddingApiKey,
        }),
      });
      setApiKey('');
      setEmbeddingApiKey('');
      await load();
      setNotice(
        'تنظیمات ارائه‌دهنده ذخیره شد. ذخیرهٔ تنظیمات، فراخوانی مدل انجام نمی‌دهد.',
      );
      onSaved?.();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const options = saved?.chatProviders?.length
    ? saved.chatProviders
    : defaultOptions;
  const defaultBaseUrl =
    options.find((item) => item.id === draft?.provider)?.defaultBaseUrl || '';
  const embeddingProvider = draft?.embeddingProvider || draft?.provider;
  const defaultEmbeddingBaseUrl =
    options.find((item) => item.id === embeddingProvider)?.defaultBaseUrl || '';

  return (
    <Panel>
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <KeyRound className="size-4 text-primary" />
        اتصال ارائه‌دهندهٔ هوش مصنوعی
      </h2>
      <p className="mt-3 text-xs leading-7 text-muted-foreground">
        ارائه‌دهنده، نام مدل و کلید API را انتخاب کنید. می‌توانید تنظیمات را بدون
        کلید ذخیره کنید و اتصال را بعداً تکمیل کنید. کلید ثبت‌شده دوباره نمایش
        داده نمی‌شود.
      </p>
      {loading && !saved && (
        <LoadingState label="در حال دریافت تنظیمات ارائه‌دهنده" />
      )}
      {error && (
        <div className="mt-4">
          <ErrorState message={error} retry={() => void load()} />
        </div>
      )}
      {notice && (
        <output className="mt-4 block rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs leading-7">
          {notice}
        </output>
      )}
      {draft && saved && (
        <form
          onSubmit={(event) => void save(event)}
          className="mt-5 space-y-5"
          autoComplete="off"
        >
          <fieldset
            disabled={busy || loading}
            className="grid gap-4 sm:grid-cols-2"
          >
            <legend className="mb-3 text-xs font-bold">
              مدل تحلیل و تولید محتوا
            </legend>
            <Field label="ارائه‌دهنده">
              <select
                className={selectClass}
                value={draft.provider}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    provider: event.target.value as ProviderId,
                    apiBaseUrl: '',
                  })
                }
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="نام دقیق مدل"
              hint="نام مدلِ پشتیبان ابزارهای تابعی و خروجی JSON را از پنل ارائه‌دهنده کپی کنید."
            >
              <Input
                value={draft.model}
                maxLength={300}
                onChange={(event) =>
                  setDraft({ ...draft, model: event.target.value })
                }
                dir="ltr"
                className="h-10"
                placeholder="شناسهٔ مدل در ارائه‌دهنده"
              />
            </Field>
            <Field
              label="کلید API"
              hint={
                saved.apiKeyConfigured
                  ? 'کلید ثبت شده است. خالی بگذارید تا حفظ شود؛ برای تعویض، کلید تازه وارد کنید.'
                  : 'کلیدی ثبت نشده است. می‌توانید بعداً آن را وارد کنید.'
              }
            >
              <Input
                type="password"
                value={apiKey}
                disabled={clearApiKey}
                autoComplete="new-password"
                spellCheck={false}
                maxLength={2000}
                onChange={(event) => setApiKey(event.target.value)}
                dir="ltr"
                className="h-10"
                placeholder="کلید جدید"
              />
            </Field>
            <Field
              label="نشانی پایهٔ API"
              hint={
                defaultBaseUrl
                  ? 'خالی بگذارید تا نشانی پیش‌فرض استفاده شود. برای درگاه دیگر، ارائه‌دهندهٔ سفارشی را انتخاب کنید.'
                  : 'نشانی پایهٔ سرویس سازگار با OpenAI را وارد کنید.'
              }
            >
              <Input
                type="url"
                value={draft.apiBaseUrl}
                maxLength={2000}
                onChange={(event) =>
                  setDraft({ ...draft, apiBaseUrl: event.target.value })
                }
                dir="ltr"
                className="h-10"
                placeholder={defaultBaseUrl || 'https://example.com/v1'}
              />
            </Field>
            {saved.apiKeyConfigured && (
              <label className="flex items-start gap-2 text-xs leading-7 sm:col-span-2">
                <input
                  type="checkbox"
                  className="mt-2 accent-primary"
                  checked={clearApiKey}
                  onChange={(event) => {
                    setClearApiKey(event.target.checked);
                    if (event.target.checked) setApiKey('');
                  }}
                />
                <span>کلید ثبت‌شدهٔ مدل تحلیل حذف شود.</span>
              </label>
            )}
          </fieldset>
          <details className="rounded-xl border border-border p-4">
            <summary className="cursor-pointer text-xs font-bold">
              تنظیم جست‌وجوی معنایی و مدل بردارسازی
            </summary>
            <p className="mt-3 text-xs leading-7 text-muted-foreground">
              برای فعال‌کردن جست‌وجوی معنایی، نام مدل بردارسازی را وارد کنید.
              ارائه‌دهنده و کلید آن می‌توانند جدا از مدل تحلیل باشند. مدل خالی،
              بردارسازی را غیرفعال می‌کند.
            </p>
            <fieldset
              disabled={busy || loading}
              className="mt-4 grid gap-4 sm:grid-cols-2"
            >
              <Field label="ارائه‌دهندهٔ بردارسازی">
                <select
                  className={selectClass}
                  value={draft.embeddingProvider}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      embeddingProvider: event.target.value as ProviderId | '',
                      embeddingApiBaseUrl: '',
                    })
                  }
                >
                  <option value="">همان ارائه‌دهندهٔ مدل تحلیل</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="نام مدل بردارسازی">
                <Input
                  value={draft.embeddingModel}
                  maxLength={300}
                  onChange={(event) =>
                    setDraft({ ...draft, embeddingModel: event.target.value })
                  }
                  dir="ltr"
                  className="h-10"
                  placeholder="شناسهٔ embedding model"
                />
              </Field>
              <Field
                label="کلید جداگانهٔ بردارسازی"
                hint={
                  saved.embeddingApiKeyConfigured
                    ? 'کلید جداگانه ثبت شده است. خالی‌گذاشتن آن را حفظ می‌کند.'
                    : 'برای همان ارائه‌دهنده می‌توان از کلید تحلیل استفاده کرد. برای ارائه‌دهندهٔ دیگر، کلید خودش را وارد کنید.'
                }
              >
                <Input
                  type="password"
                  value={embeddingApiKey}
                  disabled={clearEmbeddingApiKey}
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={2000}
                  onChange={(event) => setEmbeddingApiKey(event.target.value)}
                  dir="ltr"
                  className="h-10"
                  placeholder="کلید جدید بردارسازی"
                />
              </Field>
              <Field
                label="نشانی پایهٔ API بردارسازی"
                hint="با خالی‌گذاشتن، نشانی پیش‌فرض ارائه‌دهندهٔ انتخاب‌شده استفاده می‌شود."
              >
                <Input
                  type="url"
                  value={draft.embeddingApiBaseUrl}
                  maxLength={2000}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      embeddingApiBaseUrl: event.target.value,
                    })
                  }
                  dir="ltr"
                  className="h-10"
                  placeholder={
                    defaultEmbeddingBaseUrl || 'https://example.com/v1'
                  }
                />
              </Field>
              {saved.embeddingApiKeyConfigured && (
                <label className="flex items-start gap-2 text-xs leading-7 sm:col-span-2">
                  <input
                    type="checkbox"
                    className="mt-2 accent-primary"
                    checked={clearEmbeddingApiKey}
                    onChange={(event) => {
                      setClearEmbeddingApiKey(event.target.checked);
                      if (event.target.checked) setEmbeddingApiKey('');
                    }}
                  />
                  <span>کلید جداگانهٔ ثبت‌شدهٔ بردارسازی حذف شود.</span>
                </label>
              )}
            </fieldset>
          </details>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs leading-7 text-muted-foreground">
              تا پیش از ثبت کلید و مدل معتبر، تحلیل هوش مصنوعی فعال نمی‌شود. صحت
              اتصال و کیفیت پاسخ‌ها پس از اتصال واقعی بررسی می‌شود.
            </p>
            <Button type="submit" disabled={busy || loading}>
              <Save className="size-4" />
              {busy ? 'در حال ذخیره…' : 'ذخیرهٔ تنظیمات ارائه‌دهنده'}
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
