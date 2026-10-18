import {
  Archive,
  DatabaseBackup,
  Lock,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';
import { getDb } from '@/db';
import { administrators } from '@/db/schema';
import { RestoreBackup } from '@/components/restore-backup';
import { AccessSettings } from '@/components/access-settings';
import { chatGPTSignInPath, getChatGPTUser } from '@/app/chatgpt-auth';
import { can, getAdminRole } from '@/lib/admin-access';
import { CrmShell } from '@/components/crm-shell';
import { MagicAccessSettings } from '@/components/magic-access-settings';
import { getMagicAccessConfig, MAGIC_ACCESS_USER_ID } from '@/lib/magic-access';

export const dynamic = 'force-dynamic';

export default async function AccessPage() {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return <SignIn />;
  }

  const role = await getAdminRole(user);
  if (!can(role, 'owner')) {
    return <Denied />;
  }

  let admins: (typeof administrators.$inferSelect)[] = [];
  try {
    admins = (await getDb().select().from(administrators)).filter((admin) => admin.userId !== MAGIC_ACCESS_USER_ID);
  } catch {
    /* database table might not be initialized yet */
  }
  const bootstrapOwnerEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase() || 'owner@hamin.local';
  const magicAccess = await getMagicAccessConfig().catch(() => null);

  return (
    <CrmShell
      title="سطوح دسترسی و نگهداری داده‌ها"
      subtitle="مدیریت حساب‌های مدیران، کنترل دسترسی نقش‌محور (RBAC) و بازیابی ایمن نسخه‌های پشتیبان"
    >
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        {/* Policy Highlights */}
        <div className="grid gap-4 md:grid-cols-2">
          <PolicyCard
            icon={Archive}
            title="نگهداری داده و نسخه پشتیبان"
            text="داده‌ها تا زمان اقدام صریح مدیر حذف نمی‌شوند. برای حفاظت در برابر خرابی سرور، نسخه پشتیبان JSON را به‌صورت دوره‌ای دریافت و خارج از سرور نگهداری کنید."
          />
          <PolicyCard
            icon={ShieldCheck}
            title="کنترل دسترسی چند سطحی (RBAC)"
            text="مشاهده‌گر فقط داده‌ها و گزارش‌ها را می‌خواند؛ مدیر عملیاتی منابع و گزارش‌ها را مدیریت می‌کند؛ مالک ارشد علاوه بر این موارد، مدیران و بازیابی نسخه پشتیبان را کنترل می‌کند."
          />
        </div>

        {/* Administrator Access Settings */}
        <AccessSettings
          bootstrapOwnerEmail={bootstrapOwnerEmail}
          initialAdmins={admins.map((admin) => ({
            id: admin.id,
            email: admin.email,
            role: admin.role,
            active: admin.active,
            hasPassword: Boolean(admin.passwordHash),
            updatedAt: admin.updatedAt.toLocaleString('fa-IR'),
          }))}
        />

        <MagicAccessSettings initialActive={Boolean(magicAccess?.active)} initialCreatedAt={magicAccess?.createdAt ?? null} />

        {/* Restore Backup Card */}
        <section className="surface rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs">
          <div className="mb-5 flex items-center gap-3 border-b border-border pb-4">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/10 text-amber-700 border border-amber-500/20 dark:text-amber-400">
              <DatabaseBackup size={20} />
            </span>
            <div>
              <h2 className="text-base font-black text-foreground">بازیابی و ادغام نسخه پشتیبان مرکزی</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                بارگذاری فایل JSON جهت بازگردانی اطلاعات یا انتقال داده‌ها از سرور دیگر
              </p>
            </div>
          </div>
          <RestoreBackup bare />
        </section>
      </div>
    </CrmShell>
  );
}

function PolicyCard({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Archive;
  title: string;
  text: string;
}) {
  return (
    <div className="surface flex items-start gap-4 rounded-3xl border border-border bg-card p-5 md:p-6 shadow-xs">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
        <Icon size={21} />
      </span>
      <div>
        <h2 className="text-sm font-black text-foreground">{title}</h2>
        <p className="mt-1.5 text-xs leading-6 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function SignIn() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm rounded-3xl bg-card p-8 text-center shadow-xl border border-border">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
          <Lock size={22} />
        </div>
        <h1 className="mt-4 text-xl font-black text-foreground">ورود مدیر سامانه</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          دسترسی به بخش مدیریت مدیران نیازمند ورود به حساب مالک است.
        </p>
        <a
          href={chatGPTSignInPath('/access')}
          target="_top"
          className="mt-6 block rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-md transition hover:bg-primary/90"
        >
          ورود امن مالک
        </a>
      </div>
    </main>
  );
}

function Denied() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-center text-foreground">
      <div className="w-full max-w-sm rounded-3xl bg-card p-8 shadow-md border border-border">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-500/10 text-red-600 border border-red-500/20 dark:text-red-400">
          <ShieldX size={30} />
        </div>
        <h1 className="mt-4 text-lg font-black text-foreground">عدم دسترسی به این بخش</h1>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          تنها مالک ارشد سامانه (Owner) مجاز به مشاهده و تغییر سطوح دسترسی مدیران دیگر است.
        </p>
        <a
          href="/"
          className="mt-6 inline-block rounded-xl bg-primary px-6 py-2.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90"
        >
          بازگشت به پیشخوان
        </a>
      </div>
    </main>
  );
}
