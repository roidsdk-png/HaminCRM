import {
  BarChart3,
  Bot,
  CalendarDays,
  Check,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  Filter,
  HeartHandshake,
  MessageSquareText,
  RotateCcw,
  Sparkles,
  Users,
} from 'lucide-react';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { getReportData } from '@/lib/reports';
import type { ReportFilters } from '@/lib/reports';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CrmShell } from '@/components/crm-shell';
import { ReportCompositionChart, ReportTrendChart } from '@/components/dashboard-charts';
import { can, getAdminRole } from '@/lib/admin-access';
import { PageAccessDenied } from '@/components/page-access-denied';

export const dynamic = 'force-dynamic';

const fa = new Intl.NumberFormat('fa-IR');

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<ReportFilters>;
}) {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return <SignIn />;
  }
  if (!can(await getAdminRole(user), 'read')) return <PageAccessDenied />;

  const filters = await searchParams;
  const data = await getReportData(filters);
  const exportParams = new URLSearchParams({ from: data.range.from, to: data.range.to });
  for (const key of ['source', 'section', 'province', 'gender'] as const) {
    if (data.applied[key]) exportParams.set(key, data.applied[key]);
  }
  if (data.applied.ageFrom !== null) exportParams.set('ageFrom', String(data.applied.ageFrom));
  if (data.applied.ageTo !== null) exportParams.set('ageTo', String(data.applied.ageTo));
  const exportQuery = exportParams.toString();

  const today = new Date().toISOString().slice(0, 10);
  const hasFilters = Boolean(filters.source || filters.section || filters.province || filters.gender || filters.ageFrom || filters.ageTo || filters.from || filters.to);

  return (
    <CrmShell
      title="گزارش‌های تحلیلی و خروجی"
      subtitle="پایش عملکرد چندکاناله، تحلیل روند تعاملات و استخراج هوشمند داده‌ها"
    >
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        {/* Filter Card */}
        <section className="rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
          <div className="flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3.5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
                <BarChart3 size={22} />
              </span>
              <div>
                <h1 className="text-base font-black text-foreground">فیلتر نمودارها و گزارش‌ها</h1>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  بازه، بخش، منبع، استان، جنسیت و سن را جداگانه یا ترکیبی انتخاب کنید
                </p>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-muted-foreground">میانبر:</span>
              {[7, 14, 30].map((days) => {
                const targetFrom = new Date();
                targetFrom.setUTCDate(targetFrom.getUTCDate() - (days - 1));
                const fromStr = targetFrom.toISOString().slice(0, 10);
                const isActive = data.range.from === fromStr && data.range.to === today;

                return (
                  <a
                    key={days}
                    href={presetHref(data.applied, days, today)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'border border-border bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                    }`}
                  >
                    {days === 7 ? 'یک هفته' : days === 14 ? 'دو هفته' : 'یک ماه'}
                  </a>
                );
              })}

              {hasFilters && (
                <a
                  href="/reports"
                  className="inline-flex items-center gap-1 rounded-xl bg-muted px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                >
                  <RotateCcw size={13} />
                  پاک‌کردن
                </a>
              )}
            </div>
          </div>

          {data.notice && (
            <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-700 dark:text-amber-300">
              {data.notice}
            </div>
          )}

          {/* Filter Form */}
          <form method="GET" action="/reports" className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label htmlFor="report-section" className="block text-xs font-bold text-muted-foreground">بخش آماری</label>
              <select id="report-section" name="section" defaultValue={data.applied.section} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
                <option value="">همه بخش‌ها</option>
                <option value="chatbot">چت‌بات‌ها</option>
                <option value="test">آزمون‌ها</option>
                <option value="matchmaking">فرم کی مناسب ازدواجه</option>
              </select>
            </div>
            <div>
              <label htmlFor="report-source" className="block text-xs font-bold text-muted-foreground">
                منبع اتصال
              </label>
              <select
                id="report-source"
                name="source"
                defaultValue={data.applied.source}
                className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 text-xs md:text-sm font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">همه منابع اتصال</option>
                {data.sources.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="report-province" className="block text-xs font-bold text-muted-foreground">استان</label>
              <select id="report-province" name="province" defaultValue={data.applied.province} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
                <option value="">همه استان‌ها</option>
                {data.provinces.map((province) => <option key={province} value={province}>{province}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="report-gender" className="block text-xs font-bold text-muted-foreground">جنسیت</label>
              <select id="report-gender" name="gender" defaultValue={data.applied.gender} className="mt-1.5 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-medium text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20">
                <option value="">همه جنسیت‌ها</option>
                <option value="female">زن / دختر</option>
                <option value="male">مرد / پسر</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div><label htmlFor="report-age-from" className="block text-xs font-bold text-muted-foreground">سن از</label><Input id="report-age-from" type="number" name="ageFrom" min={0} max={120} defaultValue={data.applied.ageFrom ?? ''} className="mt-1.5 h-11 rounded-xl border-border bg-background text-foreground" /></div>
              <div><label htmlFor="report-age-to" className="block text-xs font-bold text-muted-foreground">سن تا</label><Input id="report-age-to" type="number" name="ageTo" min={0} max={120} defaultValue={data.applied.ageTo ?? ''} className="mt-1.5 h-11 rounded-xl border-border bg-background text-foreground" /></div>
            </div>

            <div>
              <label htmlFor="report-from" className="block text-xs font-bold text-muted-foreground">
                از تاریخ
              </label>
              <Input
                id="report-from"
                type="date"
                name="from"
                defaultValue={data.range.from}
                className="mt-1.5 h-11 rounded-xl text-xs md:text-sm border-border bg-background text-foreground"
              />
            </div>

            <div>
              <label htmlFor="report-to" className="block text-xs font-bold text-muted-foreground">
                تا تاریخ
              </label>
              <Input
                id="report-to"
                type="date"
                name="to"
                defaultValue={data.range.to}
                className="mt-1.5 h-11 rounded-xl text-xs md:text-sm border-border bg-background text-foreground"
              />
            </div>

            <div className="flex items-end">
              <Button
                type="submit"
                className="h-11 w-full gap-2 rounded-xl bg-primary px-6 font-bold text-primary-foreground shadow-xs transition hover:bg-primary/90"
              >
                <Filter size={16} />
                اعمال فیلتر
              </Button>
            </div>
          </form>
          {(data.applied.province || data.applied.gender || data.applied.ageFrom !== null || data.applied.ageTo !== null) && (
            <p className="mt-4 rounded-xl border border-border bg-muted/50 px-4 py-3 text-xs leading-6 text-muted-foreground">
              فیلترهای جمعیتی بر اساس مشخصات ثبت‌شدهٔ مراجع اعمال می‌شوند. رکوردهای فاقد مشخصات انتخاب‌شده در نتیجهٔ فیلترشده نمایش داده نمی‌شوند.
            </p>
          )}
        </section>

        {/* Summary Metric Cards */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-3 text-xs text-muted-foreground">
          <span>نتایج دقیق از <b className="text-foreground" dir="ltr">{data.range.from}</b> تا <b className="text-foreground" dir="ltr">{data.range.to}</b></span>
          <span className="rounded-full bg-primary/10 px-3 py-1 font-bold text-primary">{fa.format(data.range.days)} روز</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            icon={Users}
            label="مراجعان ثبت‌شده"
            value={data.totals.users}
            tone="blue"
            hint="هر کاربر در منبع مربوط به خودش"
          />
          <MetricCard
            icon={MessageSquareText}
            label="گفتگوهای آغازشده"
            value={data.totals.conversations}
            tone="indigo"
            hint="نشست‌های گفتگو در بازه انتخابی"
          />
          <MetricCard
            icon={MessageSquareText}
            label="پیام‌های کاربران"
            value={data.totals.userMessages}
            tone="blue"
            hint="پیام‌های ورودی کاربران"
          />
          <MetricCard
            icon={Bot}
            label="پاسخ‌های هوش مصنوعی"
            value={data.totals.ai}
            tone="violet"
            hint="مشاوره‌ها و پیام‌های تحلیلی"
          />
          <MetricCard
            icon={ClipboardCheck}
            label="آزمون‌های تکمیل‌شده"
            value={data.totals.tests}
            tone="amber"
            hint="ارزیابی‌های کامل با نتیجه"
          />
          <MetricCard
            icon={HeartHandshake}
            label="فرم کی مناسب ازدواجه تکمیل‌شده"
            value={data.totals.matches}
            tone="rose"
            hint="پروفایل‌های همسان‌گزینی تکمیل‌شده"
          />
        </div>

        {/* Analytics Charts Grid */}
        <div className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
          {/* Trend Chart */}
          <section className="rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-foreground">روند فعالیت روزانه</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  مراجعان جدید، پیام کاربر، پاسخ هوش مصنوعی، آزمون و فرم ازدواج
                </p>
              </div>
              <span className="flex items-center gap-1.5 rounded-xl bg-muted border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
                <CalendarDays size={14} className="text-primary" />
                {fa.format(data.range.days)} روز فعال
              </span>
            </div>

            <div className="mt-6">
              <ReportTrendChart data={data.daily} section={data.applied.section} />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-border pt-3 text-xs font-bold text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-md bg-emerald-500 shadow-2xs" />
                مراجع جدید
              </span>
              {(data.applied.section === '' || data.applied.section === 'chatbot') && <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-md bg-blue-600 shadow-2xs" />
                پیام کاربر
              </span>}
              {(data.applied.section === '' || data.applied.section === 'chatbot') && <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-md bg-violet-500 shadow-2xs" />
                پاسخ هوش مصنوعی
              </span>}
              {(data.applied.section === '' || data.applied.section === 'test') && <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-md bg-amber-500 shadow-2xs" />
                آزمون
              </span>}
              {(data.applied.section === '' || data.applied.section === 'matchmaking') && <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-md bg-rose-500 shadow-2xs" />
                فرم ازدواج
              </span>}
            </div>

            <div className="mt-6 border-t border-border pt-5">
              <div>
                <h3 className="text-sm font-black text-foreground">مقایسه حجم فعالیت‌ها</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">مقایسه مستقیم پیام‌ها، پاسخ‌ها، آزمون‌ها، فرم‌ها و مراجعان مطابق تمام فیلترهای فعال</p>
              </div>
              <div className="mt-3">
                <ReportCompositionChart data={data.totals} />
              </div>
            </div>
          </section>

          {/* Breakdown by Source */}
          <section className="flex flex-col rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
            <div>
              <h2 className="text-base font-black text-foreground">سهم تعاملات به تفکیک منابع</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">پیام‌ها، آزمون‌ها و فرم کی مناسب ازدواجه در هر منبع</p>
              <div className="mt-5 space-y-3">
                {data.breakdown.filter((item) => item.total > 0).map((item) => {
                  const max = Math.max(1, ...data.breakdown.map((row) => row.total));
                  return <div key={item.name} className="rounded-2xl border border-border bg-muted/30 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0"><p className="truncate text-xs font-black text-foreground">{item.name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{kindLabel(item.kind)} · {platformLabel(item.platform)}</p></div>
                      <span className="rounded-lg bg-card px-2.5 py-1 text-xs font-black text-primary">{fa.format(item.total)}</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, item.total / max * 100)}%` }} /></div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span>کاربر {fa.format(item.users)}</span><span>پیام {fa.format(item.userMessages + item.ai)}</span><span>آزمون {fa.format(item.tests)}</span><span>ازدواج {fa.format(item.matches)}</span>
                    </div>
                  </div>;
                })}
                {!data.breakdown.some((item) => item.total > 0) && (
                  <div className="grid h-48 place-items-center text-center text-xs text-muted-foreground">
                    در این بازه داده‌ای ثبت نشده است.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-2xl bg-muted border border-border p-3.5 text-[11px] text-muted-foreground leading-5">
              <Sparkles size={14} className="inline ml-1 text-primary" />
              این آمار بر اساس پردازش بلادرنگ رویدادهای منابع و وب‌اپ‌ها محاسبه می‌شود.
            </div>
          </section>
        </div>

        {/* Data Export Center */}
        <section className="rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Download size={20} />
              </span>
              <div>
                <h2 className="text-base font-black text-foreground">مرکز خروجی و استخراج داده‌ها</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  دریافت مستقیم فایل‌های اکسل و CSV متناسب با فیلترهای انتخابی این صفحه
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                type: 'users',
                label: 'کاربران و مخاطبان',
                detail: 'مشخصات هویتی، تلفن، سن، شهر و تاریخ ثبت‌نام',
                icon: Users,
              },
              {
                type: 'messages',
                label: 'متن گفتگوها',
                detail: 'پیام کاربران، پاسخ‌های مدل هوش مصنوعی و زمان وقوع',
                icon: MessageSquareText,
              },
              {
                type: 'tests',
                label: 'آزمون‌ها و نمرات',
                detail: 'پاسخ‌ها، کد پیگیری، امتیاز ابعاد و تحلیل بالینی',
                icon: ClipboardCheck,
              },
              {
                type: 'matchmaking',
                label: 'همسان‌گزینی',
                detail: 'پروفایل متقاضیان، تیپ شخصیتی و وضعیت رضایت',
                icon: HeartHandshake,
              },
            ].map((exportItem) => {
              const ExportIcon = exportItem.icon;
              return (
                <div
                  key={exportItem.type}
                  className="group flex flex-col justify-between rounded-2xl border border-border bg-muted/30 p-4 transition-all hover:border-primary/50 hover:bg-card hover:shadow-xs"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-card text-foreground shadow-2xs group-hover:text-primary">
                        <ExportIcon size={16} />
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                        طبق فیلتر فعال
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-bold text-foreground">{exportItem.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-5">{exportItem.detail}</p>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-2 border-t border-border pt-3">
                    <a
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2 text-xs font-bold text-foreground shadow-2xs transition hover:border-primary hover:text-primary"
                      href={`/api/admin/export?type=${exportItem.type}&format=csv&${exportQuery}`}
                    >
                      <Download size={13} />
                      CSV
                    </a>
                    <a
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-bold text-primary-foreground shadow-2xs transition hover:bg-primary/90"
                      href={`/api/admin/export?type=${exportItem.type}&format=xls&${exportQuery}`}
                    >
                      <FileSpreadsheet size={13} />
                      Excel
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </CrmShell>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone: 'blue' | 'indigo' | 'violet' | 'amber' | 'rose';
  hint: string;
}) {
  const styles = {
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
    violet: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  }[tone];

  return (
    <div className="rounded-3xl border border-border bg-card p-5 shadow-xs transition-colors duration-300">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-foreground">
            {fa.format(value)}
          </p>
        </div>
        <span className={`grid h-11 w-11 place-items-center rounded-2xl border ${styles}`}>
          <Icon size={20} />
        </span>
      </div>
      <div className="mt-4 flex items-center gap-1.5 border-t border-border pt-3 text-[11px] text-muted-foreground">
        <Check size={13} className="text-primary" />
        <span>{hint}</span>
      </div>
    </div>
  );
}

function kindLabel(value: string) { return ({ chatbot: 'چت‌بات', test: 'آزمون', matchmaking: 'فرم ازدواج' } as Record<string, string>)[value] ?? value; }
function platformLabel(value: string) { return ({ bale: 'بله', eitaa: 'ایتا', web: 'وب‌اپ' } as Record<string, string>)[value] ?? value; }

function presetHref(filters: { source: string; section: string; province: string; gender: string; ageFrom: number | null; ageTo: number | null }, days: number, today: string) {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - (days - 1));
  const params = new URLSearchParams({
    from: from.toISOString().slice(0, 10),
    to: today,
  });
  for (const key of ['source', 'section', 'province', 'gender'] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (filters.ageFrom !== null) params.set('ageFrom', String(filters.ageFrom));
  if (filters.ageTo !== null) params.set('ageTo', String(filters.ageTo));
  return `/reports?${params.toString()}`;
}

function SignIn() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm rounded-3xl bg-card p-8 text-center shadow-xl border border-border">
        <h1 className="text-xl font-black text-foreground">ورود مدیر سامانه</h1>
        <p className="mt-2 text-xs text-muted-foreground">مشاهده گزارش‌ها نیازمند ورود به حساب مدیر است.</p>
        <a
          href={chatGPTSignInPath('/reports')}
          target="_top"
          className="mt-6 block rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-md transition hover:bg-primary/90"
        >
          ورود امن مدیر
        </a>
      </div>
    </main>
  );
}
