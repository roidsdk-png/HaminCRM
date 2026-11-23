import { LoaderCircle } from 'lucide-react';

export default function AnalysisLoading() {
  return (
    <output className="flex min-h-80 items-center justify-center gap-3 text-sm text-muted-foreground">
      <LoaderCircle className="size-5 animate-spin" />
      در حال آماده‌سازی محیط تحلیل
    </output>
  );
}
