import {
  ArrowRight,
  ChevronLeft,
  ClipboardCheck,
  HeartHandshake,
  MessageSquareText,
  Users,
  Activity,
  BarChart3,
} from 'lucide-react';
import { getDashboardData } from '@/lib/dashboard-data';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { CrmShell } from '@/components/crm-shell';
import { ActivityMixChart, SourceChart } from '@/components/dashboard-charts';
import { can, getAdminRole } from '@/lib/admin-access';
import { PageAccessDenied } from '@/components/page-access-denied';
import { BrandLogo } from '@/components/brand-logo';

const fa = new Intl.NumberFormat('fa-IR');

export const dynamic = 'force-dynamic';

function formatRelativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return 'اخیراً';
  const now = Date.now();
  const timeMs = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
  const diffMinutes = Math.max(1, Math.floor((now - timeMs) / (1000 * 60)));

  if (diffMinutes < 60) return `${fa.format(diffMinutes)} دقیقه پیش`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${fa.format(diffHours)} ساعت پیش`;
  const diffDays = Math.floor(diffHours / 24);
  return `${fa.format(diffDays)} روز پیش`;
}

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return <SignIn />;
  }
  if (!can(await getAdminRole(user), 'read')) return <PageAccessDenied />;

  const data = await getDashboardData();
  const sourcePieData = data.sourceActivity.map(s => ({
    name: s.name,
    value: s.messages + s.tests + s.profiles
  }));

  return (
    <CrmShell title="داشبورد حامین چارت">
      <div className="space-y-6 max-w-7xl mx-auto">

        {/* ── Welcome Banner (Airy & Professional) ── */}
        <section className="relative overflow-hidden rounded-3xl bg-card p-6 md:p-8 shadow-sm border border-border transition-colors duration-300">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 dark:bg-blue-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/3"></div>

          <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-center justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary border border-primary/20">
                {data.activeSources > 0 && (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                )}
                {data.activeSources > 0
                  ? `${fa.format(data.activeSources)} منبع آماده دریافت داده است`
                  : 'هنوز منبعی برای دریافت داده فعال نشده است'}
              </div>
              <h1 className="text-2xl font-black md:text-3xl tracking-tight text-foreground">
                گزارش عملکرد مرکز داده حامین
              </h1>
              <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                به میز کار خود خوش آمدید. از این بخش می‌توانید آخرین گفتگوهای چت‌بات‌ها، نتایج جدید آزمون‌های روان‌شناسی و فرم کی مناسب ازدواجه را بررسی و مدیریت کنید.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <a
                href="/conversations"
                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-[13px] font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 hover:-translate-y-0.5"
              >
                <MessageSquareText size={18} />
                بررسی گفتگوهای تازه
              </a>
            </div>
          </div>
        </section>

        {/* ── Key Metrics ── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            href="/conversations"
            label="کل پیام‌های دریافتی"
            value={fa.format(data.messages)}
            detail={`${fa.format(data.aiMessages)} پاسخ توسط هوش مصنوعی`}
            icon={MessageSquareText}
            color="blue"
          />
          <MetricCard
            href="/tests"
            label="نتایج آزمون‌های روان‌شناسی"
            value={fa.format(data.tests)}
            detail="تست‌های تکمیل‌شده کاربران"
            icon={ClipboardCheck}
            color="amber"
          />
          <MetricCard
            href="/matchmaking"
            label="فرم‌های همسرگزینی"
            value={fa.format(data.matchProfiles)}
            detail="پرونده‌های در حال بررسی"
            icon={HeartHandshake}
            color="rose"
          />
          <MetricCard
            href="/users"
            label="تعداد کل مراجعان"
            value={fa.format(data.contacts)}
            detail="ثبت‌شده در دیتابیس"
            icon={Users}
            color="indigo"
          />
        </div>

        {/* ── Charts & Analytics ── */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-3xl border border-border bg-card p-5 shadow-sm transition-colors duration-300">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-muted-foreground border border-border/50">
                  <Activity size={18} />
                </div>
                <div>
                  <h3 className="text-[14px] font-bold text-foreground">روند مراجعه و فعالیت (هفتگی)</h3>
                  <p className="text-[11px] text-muted-foreground">حجم گفتگوها، آزمون‌ها و فرم‌های ازدواج در ۷ روز گذشته</p>
                </div>
              </div>
              <a href="/reports" className="flex items-center gap-1 rounded-lg bg-muted px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:bg-muted/80 transition">
                گزارش کامل
                <ArrowRight size={12} className="rotate-180" />
              </a>
            </div>
            <ActivityMixChart data={data.dailyBreakdown} />
          </div>

          <div className="rounded-3xl border border-border bg-card p-5 shadow-sm transition-colors duration-300">
            <div className="mb-4 flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-muted text-muted-foreground border border-border/50">
                <BarChart3 size={18} />
              </div>
              <div>
                <h3 className="text-[14px] font-bold text-foreground">سهم فعالیت منابع</h3>
                <p className="text-[11px] text-muted-foreground">تعداد و درصد پیام‌ها، آزمون‌ها و فرم‌ها</p>
              </div>
            </div>
            <div className="mt-2">
              <SourceChart data={sourcePieData} />
            </div>
          </div>
        </div>

        {/* ── Recent Activity Feeds ── */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Messages */}
          <div className="rounded-3xl border border-border bg-card shadow-sm overflow-hidden flex flex-col transition-colors duration-300">
            <div className="border-b border-border p-5 pb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <MessageSquareText size={16} />
                </span>
                <h3 className="text-[14px] font-bold text-foreground">
                  پیام‌های تازه مراجعان
                </h3>
              </div>
              <a href="/conversations" className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:opacity-80">
                مشاهده همه
              </a>
            </div>
            <div className="flex-1 p-3">
              {data.recentMessages.length === 0 ? (
                <div className="text-center py-10 text-[12px] text-muted-foreground border border-dashed border-border rounded-2xl mx-2 my-2">
                  در حال حاضر هیچ پیامی دریافت نشده است.
                </div>
              ) : (
                <div className="space-y-1">
                  {data.recentMessages.slice(0, 4).map((msg) => (
                    <a
                      key={msg.id}
                      href={`/conversations/${msg.conversationId}`}
                      className="group flex gap-3 p-3 rounded-2xl hover:bg-muted/50 transition border border-transparent hover:border-border"
                    >
                      <div className="h-11 w-11 shrink-0 rounded-full bg-muted text-muted-foreground grid place-items-center font-black text-sm group-hover:bg-blue-500/10 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {msg.contactName.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-foreground text-[13px] truncate">{msg.contactName}</span>
                          <span className="text-[10px] text-muted-foreground font-medium">{formatRelativeTime(msg.occurredAt)}</span>
                        </div>
                        <p className="text-[12px] text-muted-foreground line-clamp-1 mt-1">{msg.content}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-muted text-[10px] font-bold text-muted-foreground">
                            بستر: {msg.sourceName}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-muted text-[10px] font-bold text-muted-foreground">
                            {msg.role === 'assistant' ? 'پاسخ هوش مصنوعی' : 'پیام از طرف کاربر'}
                          </span>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tests */}
          <div className="rounded-3xl border border-border bg-card shadow-sm overflow-hidden flex flex-col transition-colors duration-300">
            <div className="border-b border-border p-5 pb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-500">
                  <ClipboardCheck size={16} />
                </span>
                <h3 className="text-[14px] font-bold text-foreground">
                  آخرین تست‌های تکمیل‌شده
                </h3>
              </div>
              <a href="/tests" className="text-[11px] font-bold text-amber-600 dark:text-amber-500 hover:opacity-80">
                مشاهده همه
              </a>
            </div>
            <div className="flex-1 p-3">
              {data.recentTests.length === 0 ? (
                <div className="text-center py-10 text-[12px] text-muted-foreground border border-dashed border-border rounded-2xl mx-2 my-2">
                  کارنامه‌ای برای نمایش وجود ندارد.
                </div>
              ) : (
                <div className="space-y-1">
                  {data.recentTests.slice(0, 4).map((test) => (
                    <a
                      key={test.id}
                      href={`/tests/${test.id}`}
                      className="group flex gap-3 p-3 rounded-2xl hover:bg-muted/50 transition border border-transparent hover:border-border"
                    >
                      <div className="h-11 w-11 shrink-0 rounded-full bg-muted text-muted-foreground grid place-items-center font-black text-sm group-hover:bg-amber-500/10 group-hover:text-amber-600 dark:group-hover:text-amber-500 transition-colors">
                        {test.contactName.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-foreground text-[13px] truncate">{test.contactName}</span>
                          <span className="text-[10px] text-muted-foreground font-medium">{formatRelativeTime(test.completedAt)}</span>
                        </div>
                        <p className="text-[12px] text-foreground/80 font-medium mt-1">
                          {test.testKey === 'psytest-1' ? 'تست شخصیت‌شناسی' : test.testKey === 'psytest-2' ? 'تست اضطراب و استرس' : test.testKey === 'psytest-3' ? 'تست افسردگی' : test.testKey === 'honaz-test' ? 'آزمون هوناز' : test.testKey}
                        </p>
                        {test.aiAnalysis && (
                          <p className="text-[11px] text-muted-foreground line-clamp-1 mt-1 leading-relaxed">
                            {test.aiAnalysis}
                          </p>
                        )}
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </CrmShell>
  );
}

function MetricCard({
  href,
  label,
  value,
  detail,
  icon: Icon,
  color,
}: {
  href: string;
  label: string;
  value: string;
  detail: string;
  icon: typeof MessageSquareText;
  color: 'blue' | 'amber' | 'rose' | 'indigo';
}) {
  const styles = {
    blue: 'text-blue-600 bg-blue-500/10 border-blue-500/20 group-hover:bg-blue-600 group-hover:text-white dark:text-blue-400 dark:border-blue-400/20',
    amber: 'text-amber-600 bg-amber-500/10 border-amber-500/20 group-hover:bg-amber-500 group-hover:text-white dark:text-amber-500 dark:border-amber-500/20',
    rose: 'text-rose-600 bg-rose-500/10 border-rose-500/20 group-hover:bg-rose-500 group-hover:text-white dark:text-rose-400 dark:border-rose-400/20',
    indigo: 'text-indigo-600 bg-indigo-500/10 border-indigo-500/20 group-hover:bg-indigo-600 group-hover:text-white dark:text-indigo-400 dark:border-indigo-400/20',
  }[color];

  return (
    <a
      href={href}
      className="group relative overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-1 flex flex-col"
    >
      <div className="flex items-center justify-between mb-5">
        <div className={`grid h-12 w-12 place-items-center rounded-2xl transition-colors border ${styles}`}>
          <Icon size={24} />
        </div>
        <ChevronLeft size={20} className="text-muted-foreground transition group-hover:text-foreground group-hover:-translate-x-1" />
      </div>
      <div>
        <h4 className="text-[13px] font-bold text-muted-foreground mb-1">{label}</h4>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black text-foreground tracking-tight">{value}</span>
        </div>
        <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">{detail}</p>
      </div>
    </a>
  );
}

function SignIn() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground" dir="rtl">
      <section className="w-full max-w-md rounded-3xl bg-card p-8 text-center shadow-xl border border-border">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          <BrandLogo className="h-8 w-8 text-primary-foreground" />
        </div>
        <h1 className="mt-6 text-2xl font-black text-foreground">سامانه مدیریت کلینیک</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          لطفاً برای مدیریت سرویس‌ها و بررسی گفتگوها وارد شوید.
        </p>
        <a
          href={chatGPTSignInPath('/')}
          className="mt-8 block rounded-2xl bg-primary px-5 py-4 text-[14px] font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:opacity-90 hover:-translate-y-0.5"
        >
          ورود امن به پنل سیستم
        </a>
      </section>
    </main>
  );
}
