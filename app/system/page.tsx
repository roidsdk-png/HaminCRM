import {
  Activity,
  CheckCircle2,
  History,
  ShieldCheck,
  TriangleAlert,
  Wifi,
} from 'lucide-react';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { can, getAdminRole } from '@/lib/admin-access';
import { PageAccessDenied } from '@/components/page-access-denied';
import { getSystemData } from '@/lib/system-data';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CrmShell } from '@/components/crm-shell';
import { BackupManager } from '@/components/backup-manager';
import { CacheManager } from '@/components/cache-manager';
import { IngestionErrorList } from '@/components/ingestion-error-list';

export const dynamic = 'force-dynamic';

const fa = new Intl.NumberFormat('fa-IR');

export default async function SystemPage() {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return <SignIn />;
  }
  const role = await getAdminRole(user);
  if (!can(role, 'manage')) return <PageAccessDenied management />;

  const data = await getSystemData();

  return (
    <CrmShell
      title="سلامت سامانه و پشتیبان‌گیری"
      subtitle="پایش لحظه‌ای خط لوله دریافت داده، ثبت خطاهای ورودی و لاگ امنیتی مدیران"
    >
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        {/* Top Header Card */}
        <section className="flex flex-col justify-between gap-5 rounded-3xl border border-border bg-card p-6 shadow-xs sm:flex-row sm:items-center transition-colors duration-300">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
              <Activity size={24} />
            </span>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-black text-foreground">پایش خط لوله رویدادها</h1>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  سامانه فعال
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                گزارش وضعیت پردازش رویدادها در ۲۴ ساعت گذشته
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-muted px-4 py-2 text-xs text-muted-foreground">بکاپ فقط از دیتابیس مرکزی CRM</div>
        </section>

        {can(role, 'owner') ? <BackupManager /> : <p className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">فهرست، دانلود و حذف بکاپ فقط برای مالک سامانه فعال است.</p>}
        <CacheManager />

        {/* Source Health Table */}
        <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-xs transition-colors duration-300">
          <div className="flex items-center justify-between border-b border-border px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-muted text-muted-foreground">
                <Wifi size={18} />
              </span>
              <div>
                <h2 className="text-sm font-black text-foreground">وضعیت منابع در ۲۴ ساعت اخیر</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  تفکیک رویدادهای پردازش‌شده موفق و ناموفق
                </p>
              </div>
            </div>
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
              {fa.format(data.health.length)} منبع ثبت‌شده
            </span>
          </div>

          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 border-b border-border hover:bg-muted/50">
                  <TableHead className="px-6 text-right text-xs font-bold text-muted-foreground">نام منبع</TableHead>
                  <TableHead className="px-6 text-right text-xs font-bold text-muted-foreground">وضعیت اتصال</TableHead>
                  <TableHead className="px-6 text-right text-xs font-bold text-muted-foreground">پردازش موفق (۲۴h)</TableHead>
                  <TableHead className="px-6 text-right text-xs font-bold text-muted-foreground">رویدادهای خطا (۲۴h)</TableHead>
                  <TableHead className="px-6 text-right text-xs font-bold text-muted-foreground">آخرین دریافت</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.health.map((r) => {
                  const processed = Number(r.processed) || 0;
                  const failed = Number(r.failed) || 0;
                  return (
                    <TableRow key={r.id} className="border-b border-border hover:bg-muted/40">
                      <TableCell className="px-6 py-4 font-bold text-foreground">{r.name}</TableCell>
                      <TableCell className="px-6 py-4">
                        <StatusBadge value={r.status} />
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 size={13} className="text-emerald-500" />
                          {fa.format(processed)} رویداد
                        </span>
                      </TableCell>
                      <TableCell className="px-6 py-4">
                        {failed > 0 ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 border border-red-500/20 px-2.5 py-0.5 text-xs font-bold text-red-600 dark:text-red-400">
                            <TriangleAlert size={13} className="text-red-500" />
                            {fa.format(failed)} خطا
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">۰</span>
                        )}
                      </TableCell>
                      <TableCell className="px-6 py-4 text-xs font-medium text-muted-foreground">
                        {r.lastSeen}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Health Cards */}
          <div className="divide-y divide-border md:hidden">
            {data.health.map((r) => (
              <article key={r.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-foreground text-sm">{r.name}</h3>
                  <StatusBadge value={r.status} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-emerald-500/10 p-2.5 border border-emerald-500/20">
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">موفق</p>
                    <p className="mt-0.5 text-sm font-black text-emerald-600 dark:text-emerald-400">
                      {fa.format(Number(r.processed) || 0)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-muted p-2.5 border border-border">
                    <p className="text-[10px] text-muted-foreground font-bold">خطا</p>
                    <p
                      className={`mt-0.5 text-sm font-black ${
                        Number(r.failed) > 0 ? 'text-red-500' : 'text-muted-foreground'
                      }`}
                    >
                      {fa.format(Number(r.failed) || 0)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-muted p-2.5 border border-border">
                    <p className="text-[10px] text-muted-foreground font-bold">آخرین فعالیت</p>
                    <p className="mt-0.5 text-[11px] font-bold text-foreground truncate">{r.lastSeen}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Diagnostics & Audit Logs Grid */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Ingestion Errors Log */}
          <section className="rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-red-500/10 text-red-500 border border-red-500/20">
                  <TriangleAlert size={18} />
                </span>
                <div>
                  <h2 className="text-sm font-black text-foreground">خطاهای دریافت داده</h2>
                  <p className="text-[11px] text-muted-foreground">آخرین رویدادهایی که پردازش آن‌ها با خطا مواجه شد</p>
                </div>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
                {fa.format(data.errors.length)}
              </span>
            </div>

            <div className="mt-4"><IngestionErrorList initialErrors={data.errors} /></div>
          </section>

          {/* Admin Audit Trail */}
          <section className="rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <h2 className="text-sm font-black text-foreground">لاگ فعالیت‌های مدیریتی</h2>
                  <p className="text-[11px] text-muted-foreground">تغییرات دسترسی، تنظیمات و لاگین مدیران</p>
                </div>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
                {fa.format(data.audits.length)}
              </span>
            </div>

            <div className="mt-4 space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {data.audits.map((audit, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-border bg-muted/40 p-3.5 text-xs transition hover:bg-muted/70 hover:border-border"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-foreground truncate" dir="ltr">
                      {audit.email}
                    </span>
                    <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                      {audit.action}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground truncate" dir="ltr">
                    مورد: {audit.entity}
                  </p>
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                    <History size={12} />
                    <span>{audit.created}</span>
                  </div>
                </div>
              ))}

              {!data.audits.length && (
                <div className="py-16 text-center text-xs text-muted-foreground">
                  هنوز فعالیتی در لاگ‌های امنیتی ثبت نشده است.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </CrmShell>
  );
}

function StatusBadge({ value }: { value: string }) {
  const active = value === 'active';
  const paused = value === 'paused';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
        active
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
          : paused
          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
          : 'bg-muted text-muted-foreground border border-border'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          active ? 'bg-emerald-500' : paused ? 'bg-amber-500' : 'bg-muted-foreground'
        }`}
      />
      {active ? 'فعال' : paused ? 'متوقف' : 'در انتظار'}
    </span>
  );
}

function SignIn() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm rounded-3xl bg-card p-8 text-center shadow-xl border border-border">
        <h1 className="text-xl font-black text-foreground">ورود مدیر سامانه</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          مشاهده وضعیت سلامت سامانه نیازمند ورود به حساب مدیر است.
        </p>
        <a
          href={chatGPTSignInPath('/system')}
          target="_top"
          className="mt-6 block rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-md transition hover:bg-primary/90"
        >
          ورود امن مدیر
        </a>
      </div>
    </main>
  );
}
