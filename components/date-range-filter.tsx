import { CalendarDays } from 'lucide-react';

type Props = {
  defaultFrom?: string;
  defaultTo?: string;
  activeRange?: string;
};

const presets = [
  { value: '7', label: 'یک هفته' },
  { value: '14', label: 'دو هفته' },
  { value: '30', label: 'یک ماه' },
];

export function DateRangeFilter({ defaultFrom = '', defaultTo = '', activeRange = '' }: Props) {
  return (
    <div className="flex w-full flex-wrap items-end gap-2 border-t border-border pt-3">
      <div className="flex min-w-[255px] flex-1 items-center gap-2">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-muted text-muted-foreground">
          <CalendarDays size={17} />
        </span>
        <label className="min-w-[112px] flex-1 text-[11px] font-bold text-muted-foreground">
          از تاریخ
          <input type="date" name="from" defaultValue={defaultFrom} className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </label>
        <label className="min-w-[112px] flex-1 text-[11px] font-bold text-muted-foreground">
          تا تاریخ
          <input type="date" name="to" defaultValue={defaultTo} className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="میانبر بازه زمانی">
        {presets.map((preset) => (
          <button
            key={preset.value}
            type="submit"
            name="range"
            value={preset.value}
            className={`h-10 rounded-xl border px-3 text-xs font-bold transition ${activeRange === preset.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted text-muted-foreground hover:text-foreground'}`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
