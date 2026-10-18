import {
  Eye,
  Lock,
  RadioTower,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { sql } from 'drizzle-orm';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { sources } from '@/db/schema';
import { SourceManager } from '@/components/source-manager';
import { CrmShell } from '@/components/crm-shell';
import { can, getAdminRole } from '@/lib/admin-access';

export const dynamic = 'force-dynamic';

const fa = new Intl.NumberFormat('fa-IR');
type SourceStats = { sourceId: string; totalEvents: number; events24h: number; failed24h: number; storedRecords: number; lastSeenAgeHours: number | null };

export default async function SourcesPage() {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return <SignIn />;
  }
  const role = await getAdminRole(user);
  if (!can(role, 'read')) return <AccessDenied />;

  let rows: (typeof sources.$inferSelect)[] = [];
  let stats: SourceStats[] = [];
  try {
    const db = getDb();
    rows = await db.select().from(sources).orderBy(sources.name);
    try {
      stats = await db.all<SourceStats>(sql`SELECT s.id sourceId,
        CASE WHEN s.last_seen_at IS NULL THEN NULL ELSE (unixepoch('now') - s.last_seen_at) / 3600.0 END lastSeenAgeHours,
        COUNT(e.id) totalEvents,
        SUM(CASE WHEN e.received_at >= unixepoch('now','-1 day') THEN 1 ELSE 0 END) events24h,
        SUM(CASE WHEN e.processing_status='failed' AND e.received_at >= unixepoch('now','-1 day') THEN 1 ELSE 0 END) failed24h,
        (SELECT COUNT(*) FROM contacts c WHERE c.source_id=s.id)
        + (SELECT COUNT(*) FROM messages m WHERE m.source_id=s.id)
        + (SELECT COUNT(*) FROM test_attempts a WHERE a.source_id=s.id)
        + (SELECT COUNT(*) FROM match_profiles p WHERE p.source_id=s.id) storedRecords
        FROM sources s LEFT JOIN ingestion_events e ON e.source_id=s.id GROUP BY s.id`);
    } catch {
      // Keep the source list usable even if optional monitoring statistics fail.
    }
  } catch {
    /* database might not be initialized */
  }

  const activeCount = rows.filter((row) => row.status === 'active' && row.credentialHash).length;
  const statsById = new Map(stats.map((item) => [item.sourceId, item]));
  const canManage = can(role, 'manage');

  return (
    <CrmShell
      title="منابع و اتصالات داده"
      subtitle="مدیریت کلیدهای امن دریافت داده، یکپارچه‌سازی ربات‌ها و وب‌اپ‌ها بدون افشای رمز سرورها"
    >
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        {/* Top Header Card */}
        <section className="rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
                <RadioTower size={24} />
              </span>
              <div>
                <h1 className="text-lg font-black text-foreground">یکپارچه‌سازی امن منابع</h1>
                <p className="mt-1 max-w-2xl text-xs md:text-sm leading-6 text-muted-foreground">
                  هر چت‌بات، ربات بله یا وب‌اپ با یک کلید اختصاصی و مستقل احراز هویت می‌شود.
                  سامانه فقط هش امنیتی را ذخیره کرده و به هیچ عنوان به رمزها یا کدهای سرور شما دسترسی ندارد.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {!canManage && (
                <span className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted px-4 py-2 text-xs font-bold text-muted-foreground">
                  <Eye size={16} /> فقط مشاهده
                </span>
              )}
              <div className="flex items-center gap-3 rounded-2xl bg-muted border border-border p-2 text-center">
                <div className="px-3 py-1">
                  <p className="text-base font-black text-green-600 dark:text-green-400">{fa.format(activeCount)}</p>
                  <p className="text-[10px] font-bold text-muted-foreground">فعال و کلیددار</p>
                </div>
                <div className="h-7 w-px bg-border" />
                <div className="px-3 py-1">
                  <p className="text-base font-black text-foreground">{fa.format(rows.length)}</p>
                  <p className="text-[10px] font-bold text-muted-foreground">کل منابع</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Source Cards List */}
        <section className="space-y-4">
          {rows.map((row) => (
            <SourceManager
              key={row.id}
              source={{
                id: row.id,
                slug: row.slug,
                name: row.name,
                kind: row.kind,
                platform: row.platform,
                status: row.status,
                hasKey: Boolean(row.credentialHash),
                hasReceivedEvents: Boolean(row.lastSeenAt),
                lastSeen: row.lastSeenAt ? row.lastSeenAt.toLocaleString('fa-IR') : 'هنوز رویدادی دریافت نشده',
                lastSeenAgeHours: statsById.get(row.id)?.lastSeenAgeHours ?? null,
                totalEvents: Number(statsById.get(row.id)?.totalEvents ?? 0),
                events24h: Number(statsById.get(row.id)?.events24h ?? 0),
                failed24h: Number(statsById.get(row.id)?.failed24h ?? 0),
                storedRecords: Number(statsById.get(row.id)?.storedRecords ?? 0),
              }}
              canManage={canManage}
            />
          ))}

          {!rows.length && (
            <div className="grid min-h-64 place-items-center rounded-3xl border border-border bg-card p-12 text-center shadow-xs">
              <div className="max-w-sm">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-muted text-muted-foreground border border-border">
                  <Server size={28} />
                </div>
                <h2 className="mt-4 text-base font-black text-foreground">منبعی برای نمایش وجود ندارد</h2>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  منابع سامانه در زمان اتصال فنی سرویس‌ها ثبت می‌شوند.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Security & Reliability Callout */}
        <div className="flex items-start gap-3.5 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4 text-xs leading-6 text-foreground">
          <ShieldCheck className="mt-0.5 shrink-0 text-primary" size={18} />
          <div>
            <span className="font-black text-primary">سیاست عدم وابستگی و پایداری: </span>
            <span className="text-muted-foreground">
              توقف یا تعویض کلید در این پنل تنها دریافت رویدادها را کنترل می‌کند و هیچ‌گونه تأثیری بر عملکرد درونی یا
              فایل‌های برنامه اصلی روی سرور مبدأ نخواهد گذاشت. در اتصال‌های دارای صف محلی، رویدادها هنگام قطعی موقت
              نگه داشته می‌شوند و پس از برقراری ارتباط با شناسه ثابت دوباره ارسال می‌شوند؛ نبود رویداد جدید لزوماً نشانه قطعی نیست.
            </span>
          </div>
        </div>
      </div>
    </CrmShell>
  );
}

function AccessDenied() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-8 text-center shadow-xl">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-600">
          <Lock size={22} />
        </div>
        <h1 className="mt-4 text-xl font-black text-foreground">دسترسی مجاز نیست</h1>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">حساب شما اجازه مشاهده تنظیمات منابع و اتصالات را ندارد.</p>
      </div>
    </main>
  );
}

function SignIn() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-sm rounded-3xl bg-card p-8 text-center shadow-xl border border-border">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
          <Lock size={22} />
        </div>
        <h1 className="mt-4 text-xl font-black text-foreground">ورود مدیر سامانه</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          دسترسی به مدیریت منابع و کلیدها نیازمند ورود به حساب مدیر است.
        </p>
        <a
          href={chatGPTSignInPath('/sources')}
          target="_top"
          className="mt-6 block rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-md transition hover:bg-primary/90"
        >
          ورود امن مدیر
        </a>
      </div>
    </main>
  );
}
