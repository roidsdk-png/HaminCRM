import type { AnalysisGuideReference } from '@/lib/analysis/types';

export function AnalysisGuideReferences({
  items,
}: {
  items?: AnalysisGuideReference[];
}) {
  if (!items?.length) return null;
  return (
    <details className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs leading-7">
      <summary className="cursor-pointer font-semibold">
        راهنماهای معتبر این دامنه
      </summary>
      <ul className="mt-2 space-y-2">
        {items.map((item) => {
          const source =
            typeof item.source === 'string'
              ? item.source
              : [item.source?.title, item.source?.reference]
                  .filter((value) => typeof value === 'string')
                  .join(' · ');
          return (
            <li key={`${item.testKey}:${item.version}`}>
              <span dir="auto">{item.testKey}</span> · نسخهٔ{' '}
              <span dir="auto">{item.version}</span>
              <p className="text-muted-foreground">
                {source || 'مرجع ثبت‌شدهٔ راهنما'}
              </p>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
