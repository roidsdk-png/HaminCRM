'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const colors = [
  'var(--chart-blue)',
  'var(--chart-emerald)',
  'var(--chart-amber)',
  'var(--chart-violet)',
  'var(--chart-rose)',
  'var(--chart-teal)',
  'var(--chart-orange)',
  'var(--chart-fuchsia)',
];

function useChartReady() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize((current) => current.width === next.width && current.height === next.height ? current : next);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, ...size, ready: size.width > 0 && size.height > 0 };
}

function ChartPlaceholder({ height }: { height: number }) {
  return (
    <div
      aria-hidden="true"
      className="animate-pulse rounded-2xl bg-muted/70"
      style={{ height }}
    />
  );
}

const customTooltipStyle = {
  backgroundColor: 'var(--card)',
  backdropFilter: 'blur(12px)',
  border: '1px solid var(--border)',
  borderRadius: '16px',
  color: 'var(--foreground)',
  padding: '12px 16px',
  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
  fontSize: '12px',
  direction: 'rtl' as const,
};

export function ActivityMixChart({
  data,
}: {
  data: { label: string; user: number; ai: number; tests: number; matches: number }[];
}) {
  const { ref, ready, width, height } = useChartReady();

  return (
    <div ref={ref} style={{ height: 290 }}>
      {!ready ? <ChartPlaceholder height={290} /> : <ComposedChart width={width} height={height} data={data} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="userBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-blue-highlight)" stopOpacity={1} />
            <stop offset="100%" stopColor="var(--chart-blue-depth)" stopOpacity={0.9} />
          </linearGradient>
          <linearGradient id="aiBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-indigo-highlight)" stopOpacity={1} />
            <stop offset="100%" stopColor="var(--chart-indigo-depth)" stopOpacity={0.9} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1.1} strokeDasharray="4 4" />
        <XAxis
          dataKey="label"
          axisLine={{ stroke: 'var(--chart-grid)', strokeWidth: 1 }}
          tickLine={false}
          tick={{ fill: 'var(--chart-axis)', fontSize: 12, fontWeight: 700 }}
          dy={8}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontWeight: 700 }}
        />
        <Tooltip
          contentStyle={customTooltipStyle}
          formatter={(value, name) => [
            Number(value).toLocaleString('fa-IR'),
            name === 'user' ? 'پیام کاربر' : name === 'ai' ? 'پاسخ هوش مصنوعی' : name === 'tests' ? 'آزمون روانشناسی' : 'فرم کی مناسب ازدواجه',
          ]}
        />
        <Bar
          dataKey="user"
          stackId="messages"
          fill="url(#userBarGrad)"
          barSize={20}
          radius={[0, 0, 6, 6]}
          isAnimationActive={false}
        />
        <Bar
          dataKey="ai"
          stackId="messages"
          fill="url(#aiBarGrad)"
          barSize={20}
          radius={[6, 6, 0, 0]}
          isAnimationActive={false}
        />
        <Line
          className="chart-line-amber"
          dataKey="tests"
          type="monotone"
          stroke="var(--chart-amber)"
          strokeWidth={3}
          dot={{ r: 4, fill: 'var(--card)', stroke: 'var(--chart-amber)', strokeWidth: 2.5 }}
          isAnimationActive={false}
        />
        <Line
          className="chart-line-rose"
          dataKey="matches"
          type="monotone"
          stroke="var(--chart-rose)"
          strokeWidth={3}
          dot={{ r: 4, fill: 'var(--card)', stroke: 'var(--chart-rose)', strokeWidth: 2.5 }}
          isAnimationActive={false}
        />
      </ComposedChart>}
    </div>
  );
}

export function SourceChart({ data }: { data: { name: string; value: number }[] }) {
  const { ref, ready, width, height } = useChartReady();
  const items = data
    .filter((item) => item.value > 0)
    .map((item, index) => ({ ...item, fill: colors[index % colors.length] }));

  if (!items.length) {
    return (
      <div className="grid h-[210px] place-items-center text-center text-xs text-muted-foreground">
        پس از ثبت اولین تعامل، نمودار توزیع منابع اینجا نمایش می‌یابد.
      </div>
    );
  }

  const total = items.reduce((a, b) => a + b.value, 0);

  return (
    <div className="space-y-3">
      <div ref={ref} className="relative h-[210px]">
      {!ready ? <ChartPlaceholder height={210} /> : <PieChart width={width} height={height}>
          <Pie
            data={items}
            dataKey="value"
            nameKey="name"
            innerRadius={68}
            outerRadius={88}
            paddingAngle={3}
            stroke="var(--card)"
            strokeWidth={3}
            isAnimationActive={false}
          />
          <Tooltip
            contentStyle={customTooltipStyle}
            formatter={(value) => [Number(value).toLocaleString('fa-IR'), 'رکورد']}
            position={{ x: 8, y: 8 }}
            wrapperStyle={{ zIndex: 20, pointerEvents: 'none' }}
            allowEscapeViewBox={{ x: false, y: false }}
          />
        </PieChart>}
      {ready && <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-2xl font-black tracking-tight text-foreground">
            {total.toLocaleString('fa-IR')}
          </p>
          <p className="text-[11px] font-bold text-muted-foreground">مجموع رکوردها</p>
        </div>
      </div>}
      </div>
      <div className="grid gap-2 border-t border-border pt-3">
        {items.map((item) => (
          <div key={item.name} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="flex min-w-0 items-center gap-2 font-bold text-foreground">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.fill }} />
              <span className="truncate">{item.name}</span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              {item.value.toLocaleString('fa-IR')} رکورد · {Math.round(item.value / total * 100).toLocaleString('fa-IR')}٪
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SourceBars({ data }: { data: { name: string; value: number }[] }) {
  const items = data.filter((item) => item.value > 0).slice(0, 6);
  if (!items.length) return null;
  const maximum = Math.max(...items.map((item) => item.value));

  return (
    <div className="space-y-4 py-2">
      {items.map((item) => (
        <div key={item.name}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-bold text-foreground">{item.name}</span>
            <span className="shrink-0 font-black text-primary">{item.value.toLocaleString('fa-IR')}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-l from-blue-600 to-cyan-400" style={{ width: `${Math.max(2, item.value / maximum * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ReportCompositionChart({
  data,
}: {
  data: { users: number; conversations: number; userMessages: number; ai: number; tests: number; matches: number };
}) {
  const { ref, ready, width, height } = useChartReady();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const rows = [
    { name: 'پیام کاربران', value: data.userMessages, fill: '#2563eb', light: '#60a5fa', depth: '#173f9f' },
    { name: 'پاسخ هوش مصنوعی', value: data.ai, fill: '#8b5cf6', light: '#c4b5fd', depth: '#5637ad' },
    { name: 'آزمون تکمیل‌شده', value: data.tests, fill: '#f59e0b', light: '#fcd34d', depth: '#a75f06' },
    { name: 'فرم ازدواج', value: data.matches, fill: '#f43f5e', light: '#fb7185', depth: '#a51f3a' },
    { name: 'گفتگوهای آغازشده', value: data.conversations, fill: '#06b6d4', light: '#67e8f9', depth: '#08788c' },
    { name: 'مراجع جدید', value: data.users, fill: '#10b981', light: '#6ee7b7', depth: '#087653' },
  ].filter((row) => row.value > 0);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const gap = rows.length > 1 ? 3 : 0;
  const usableAngle = rows.length === 1 ? 359.5 : 360 - gap * rows.length;
  let cursor = -90;
  const sectors = rows.map((row) => {
    const span = row.value / total * usableAngle;
    const sector = { ...row, startAngle: cursor + gap / 2, endAngle: cursor + gap / 2 + span, midAngle: cursor + gap / 2 + span / 2 };
    cursor += span + gap;
    return sector;
  });

  if (!rows.length) {
    return <div className="grid h-[300px] place-items-center rounded-2xl bg-muted/30 text-center text-xs text-muted-foreground">در این بازه و با فیلترهای انتخابی، فعالیتی ثبت نشده است.</div>;
  }

  return (
    <div className="space-y-4">
      <div ref={ref} className="relative" style={{ height: 320 }}>
        {!ready ? <ChartPlaceholder height={320} /> : <svg viewBox="0 0 480 320" width={width} height={height} aria-label="نمودار سه‌بعدی ترکیب فعالیت‌ها" className="overflow-visible">
          <title>نمودار سه‌بعدی ترکیب فعالیت‌ها</title>
          <defs>
            <filter id="reportDonutGroundShadow" x="-50%" y="-100%" width="200%" height="300%">
              <feGaussianBlur stdDeviation="11" />
            </filter>
            <clipPath id="reportDonutFrontHalf"><rect x="0" y="150" width="480" height="170" /></clipPath>
            {sectors.map((sector, index) => <linearGradient key={sector.name} id={`reportDonutSurface-${index}`} x1="0" y1="0" x2="0.8" y2="1">
              <stop offset="0%" stopColor={sector.light} />
              <stop offset="55%" stopColor={sector.fill} />
              <stop offset="100%" stopColor={sector.depth} />
            </linearGradient>)}
          </defs>
          <ellipse cx="240" cy="259" rx="126" ry="22" fill="var(--chart-shadow)" opacity="0.3" filter="url(#reportDonutGroundShadow)" />
          <g transform="translate(0 42) scale(1 .72)">
            {sectors.map((sector, index) => {
              const radians = sector.midAngle * Math.PI / 180;
              const active = activeIndex === index;
              const dx = active ? Math.cos(radians) * 10 : 0;
              const dy = active ? Math.sin(radians) * 10 : 0;
              const path = donutSectorPath(240, 150, 72, 118, sector.startAngle, sector.endAngle);
              return <g key={sector.name}>
                <g
                  pointerEvents="none"
                  style={{
                    transform: `translate(${dx}px, ${dy}px)`,
                    transformOrigin: '240px 150px',
                    transition: 'transform 220ms cubic-bezier(.2,.8,.2,1), filter 220ms ease',
                    filter: active ? 'brightness(1.13) drop-shadow(0 12px 8px rgba(2,6,23,.38))' : 'none',
                  }}
                >
                  <path d={path} transform="translate(0 18)" fill={sector.depth} clipPath="url(#reportDonutFrontHalf)" />
                  <path d={path} fill={`url(#reportDonutSurface-${index})`} stroke="var(--card)" strokeWidth="3" />
                  <path d={path} fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.2" transform="translate(0 -1)" />
                </g>
                <path
                  d={path}
                  fill="rgba(0,0,0,0.001)"
                  stroke="rgba(0,0,0,0.001)"
                  strokeWidth="28"
                  pointerEvents="all"
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  style={{ cursor: 'pointer' }}
                />
              </g>;
            })}
          </g>
        </svg>}
        {ready && <div className="pointer-events-none absolute inset-0 grid place-items-center pb-5 text-center">
          <div className="rounded-full bg-card/80 px-4 py-3 backdrop-blur-sm">
            <p className="text-3xl font-black tracking-tight text-foreground">{total.toLocaleString('fa-IR')}</p>
            <p className="mt-1 text-[10px] font-bold text-muted-foreground">مجموع فعالیت فیلترشده</p>
          </div>
        </div>}
        {activeIndex !== null && sectors[activeIndex] && <div className="pointer-events-none absolute left-3 top-3 z-20 rounded-xl border border-border bg-card/95 px-3 py-2 text-xs shadow-xl backdrop-blur-md">
          <p className="font-black text-foreground">{sectors[activeIndex].name}</p>
          <p className="mt-1 font-bold text-muted-foreground">{sectors[activeIndex].value.toLocaleString('fa-IR')} · {Math.round(sectors[activeIndex].value / total * 100).toLocaleString('fa-IR')}٪</p>
        </div>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {sectors.map((row, index) => (
          <button type="button" key={row.name} onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-right transition ${activeIndex === index ? 'border-primary/40 bg-primary/10 shadow-sm' : 'border-border bg-muted/30'}`}>
            <span className="flex min-w-0 items-center gap-2 text-[11px] font-bold text-foreground">
              <span className="h-3 w-3 shrink-0 rounded-full shadow-sm" style={{ backgroundColor: row.fill }} />
              <span className="truncate">{row.name}</span>
            </span>
            <span className="shrink-0 text-[11px] font-black text-foreground">
              {row.value.toLocaleString('fa-IR')} <small className="font-bold text-muted-foreground">· {Math.round(row.value / total * 100).toLocaleString('fa-IR')}٪</small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function donutSectorPath(cx: number, cy: number, innerRadius: number, outerRadius: number, startAngle: number, endAngle: number) {
  const point = (radius: number, angle: number) => {
    const radians = angle * Math.PI / 180;
    return { x: cx + Math.cos(radians) * radius, y: cy + Math.sin(radians) * radius };
  };
  const outerStart = point(outerRadius, startAngle);
  const outerEnd = point(outerRadius, endAngle);
  const innerEnd = point(innerRadius, endAngle);
  const innerStart = point(innerRadius, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ');
}

export function ReportTrendChart({
  data,
  section = '',
}: {
  data: { day: string; users: number; userMessages: number; ai: number; tests: number; matches: number }[];
  section?: string;
}) {
  const { ref, ready, width, height } = useChartReady();
  const showChat = section === '' || section === 'chatbot';
  const showTests = section === '' || section === 'test';
  const showMatches = section === '' || section === 'matchmaking';

  if (!data.some((row) => row.users + row.userMessages + row.ai + row.tests + row.matches > 0)) {
    return <div className="grid h-[300px] place-items-center rounded-2xl bg-muted/30 text-center text-xs text-muted-foreground">در این بازه و با این فیلترها داده‌ای برای نمودار ثبت نشده است.</div>;
  }

  return (
    <div ref={ref} style={{ height: 300 }}>
      {!ready ? <ChartPlaceholder height={300} /> : <ComposedChart width={width} height={height} data={data} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1.1} strokeDasharray="4 4" />
        <XAxis
          dataKey="day"
          tickFormatter={(value) => String(value).slice(5)}
          interval="preserveStartEnd"
          minTickGap={24}
          axisLine={{ stroke: 'var(--chart-grid)', strokeWidth: 1 }}
          tickLine={false}
          tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontWeight: 700 }}
          dy={8}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          tick={{ fill: 'var(--chart-axis)', fontSize: 11, fontWeight: 700 }}
        />
        <Tooltip
          contentStyle={customTooltipStyle}
          formatter={(value, name) => [
            Number(value).toLocaleString('fa-IR'),
            name === 'userMessages' ? 'پیام کاربر' : name === 'ai' ? 'پاسخ هوش مصنوعی' : name === 'tests' ? 'آزمون تکمیل‌شده' : name === 'matches' ? 'فرم ازدواج' : 'مراجع جدید',
          ]}
          labelFormatter={(label) => `تاریخ ${label}`}
        />
        {showTests && <Bar dataKey="tests" fill="var(--chart-amber)" radius={[5, 5, 0, 0]} barSize={10} isAnimationActive={false} />}
        {showMatches && <Bar dataKey="matches" fill="var(--chart-rose)" radius={[5, 5, 0, 0]} barSize={10} isAnimationActive={false} />}
        <Line
          className="chart-line-emerald"
          dataKey="users"
          type="monotone"
          stroke="var(--chart-emerald)"
          strokeWidth={2.5}
          strokeDasharray="5 4"
          dot={false}
          isAnimationActive={false}
        />
        {showChat && <Line
          className="chart-line-blue"
          dataKey="userMessages"
          type="monotone"
          stroke="var(--chart-blue)"
          strokeWidth={3}
          dot={data.length <= 31 ? { r: 3.5, fill: 'var(--chart-blue)', stroke: 'var(--card)', strokeWidth: 1.5 } : false}
          isAnimationActive={false}
        />}
        {showChat && <Line
          className="chart-line-violet"
          dataKey="ai"
          type="monotone"
          stroke="var(--chart-violet)"
          strokeWidth={3}
          dot={data.length <= 31 ? { r: 3.5, fill: 'var(--chart-violet)', stroke: 'var(--card)', strokeWidth: 1.5 } : false}
          isAnimationActive={false}
        />}
      </ComposedChart>}
    </div>
  );
}
