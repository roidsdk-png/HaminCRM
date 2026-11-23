'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { analysisRequest, errorMessage } from './analysis-api';

export type AnalysisContact = {
  id: string;
  localId: string;
  name: string;
  sourceName: string;
};
type Contact = AnalysisContact;
type SearchResult = {
  query: string;
  status: 'loading' | 'ready' | 'error';
  items: Contact[];
  error?: string;
};

export function AnalysisContactPicker({
  value,
  onChange,
  disabled,
  onSelect,
}: {
  value?: string;
  onChange: (id: string | undefined) => void;
  disabled?: boolean;
  onSelect?: (contact: AnalysisContact) => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const normalizedQuery = query.trim();
  const activeResult = result?.query === normalizedQuery ? result : null;
  const activeContact = selected?.id === value ? selected : null;

  useEffect(() => {
    if (normalizedQuery.length < 2 || disabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setResult({ query: normalizedQuery, status: 'loading', items: [] });
      const parameters = new URLSearchParams({ q: normalizedQuery });
      void analysisRequest<{ items: Contact[] }>(`/contacts?${parameters}`, {
        signal: controller.signal,
      })
        .then(({ items }) => {
          if (!controller.signal.aborted) {
            setResult({ query: normalizedQuery, status: 'ready', items });
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setResult({
              query: normalizedQuery,
              status: 'error',
              items: [],
              error: errorMessage(error),
            });
          }
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery, disabled]);

  function choose(contact: Contact) {
    setSelected(contact);
    setQuery('');
    onChange(contact.id);
    onSelect?.(contact);
  }

  return (
    <div className="space-y-2 sm:col-span-2">
      <label htmlFor={inputId} className="text-xs font-semibold">
        مخاطب مشخص
      </label>
      {value && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
          <span className="min-w-0 text-sm leading-6">
            {activeContact ? (
              <>
                <span className="font-semibold">{activeContact.name}</span>
                <span className="mr-2 text-xs text-muted-foreground">
                  {activeContact.sourceName}
                </span>
              </>
            ) : (
              'مخاطب انتخاب‌شدهٔ این تحقیق'
            )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="حذف فیلتر مخاطب"
            disabled={disabled}
            onClick={() => {
              setSelected(null);
              onChange(undefined);
            }}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-3 size-4 text-muted-foreground" />
        <Input
          id={inputId}
          className="h-10 rounded-xl pr-10"
          value={query}
          maxLength={100}
          placeholder="نام ثبت‌شدهٔ مخاطب را جست‌وجو کنید"
          autoComplete="off"
          aria-describedby={hintId}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault();
          }}
        />
      </div>
      <p id={hintId} className="text-xs leading-6 text-muted-foreground">
        با حداقل دو حرف جست‌وجو کنید و مخاطب را از منبع درست انتخاب کنید. نتیجه‌ها
        از نام‌های ثبت‌شده در CRM خوانده می‌شوند.
      </p>
      <div aria-live="polite" className="text-xs leading-6">
        {activeResult?.status === 'loading' && <p>در حال جست‌وجوی مخاطب…</p>}
        {activeResult?.status === 'error' && (
          <p className="text-rose-600 dark:text-rose-400">
            {activeResult.error}
          </p>
        )}
        {activeResult?.status === 'ready' &&
          activeResult.items.length === 0 && (
            <p className="text-muted-foreground">
              مخاطبی با این نام پیدا نشد. می‌توانید بخشی از نام را جست‌وجو کنید یا
              تحلیل گروه را با فیلترهای دیگر ادامه دهید.
            </p>
          )}
      </div>
      {activeResult?.status === 'ready' && activeResult.items.length > 0 && (
        <fieldset
          aria-label="نتایج جست‌وجوی مخاطب"
          className="max-h-60 min-w-0 overflow-y-auto rounded-xl border border-border bg-background p-1"
        >
          {activeResult.items.map((contact) => (
            <button
              key={contact.id}
              type="button"
              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-3 text-right text-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              disabled={disabled}
              onClick={() => choose(contact)}
            >
              <span className="font-medium">{contact.name}</span>
              <span className="text-xs text-muted-foreground">
                {contact.sourceName}
              </span>
            </button>
          ))}
          {activeResult.items.length === 20 && (
            <p className="px-3 py-2 text-xs leading-6 text-muted-foreground">
              بیست نتیجهٔ اول نمایش داده شد. برای محدودکردن نتیجه، نام کامل‌تری
              وارد کنید.
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}
