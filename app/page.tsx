import { Activity, Bot, ChevronLeft, ClipboardCheck, Database, HeartHandshake, LayoutDashboard, MessageSquareText, Search, Settings, ShieldCheck, Users } from 'lucide-react';
import { getDashboardData } from '@/lib/dashboard-data';
import { chatGPTSignInPath, getChatGPTUser } from '@/app/chatgpt-auth';
import Link from 'next/link';

const sourceCatalog = [
  { slug: 'bale-advisor', name: 'مشاور هوشمند بله', platform: 'بله', kind: 'گفتگو', icon: Bot },
  { slug: 'eitaa-advisor', name: 'مشاور هوشمند ایتا', platform: 'ایتا', kind: 'گفتگو', icon: MessageSquareText },
  { slug: 'psytest-1', name: 'آزمون شخصیت', platform: 'وب‌اپ', kind: 'آزمون', icon: ClipboardCheck },
  { slug: 'psytest-2', name: 'آزمون اضطراب', platform: 'وب‌اپ', kind: 'آزمون', icon: ClipboardCheck },
  { slug: 'psytest-3', name: 'آزمون افسردگی', platform: 'وب‌اپ', kind: 'آزمون', icon: ClipboardCheck },
  { slug: 'matchhamin', name: 'کی مناسب منه؟', platform: 'بله', kind: 'همسان‌گزینی', icon: HeartHandshake },
];
const fa = new Intl.NumberFormat('fa-IR');

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') return <SignIn />;
  const data = await getDashboardData();
  const maxDay = Math.max(1, ...data.daily.map((item) => item.count));
  return (
    <main className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="hidden min-h-screen border-l bg-[#102f27] px-5 py-7 text-white lg:flex lg:flex-col">
        <div className="mb-10 flex items-center gap-3 px-2">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#d7f16b] text-[#17382e]"><Database size={22} /></div>
          <div><p className="text-lg font-bold">مرکز حامین</p><p className="text-xs text-white/55">سامانه مدیریت یکپارچه</p></div>
        </div>
        <nav className="space-y-1 text-sm">
          <NavItem active icon={LayoutDashboard} label="نمای کلی" href="/" /><NavItem icon={Users} label="کاربران" href="/users" />
          <NavItem icon={MessageSquareText} label="گفتگوها" href="/conversations" /><NavItem icon={ClipboardCheck} label="آزمون‌ها" href="/tests" />
          <NavItem icon={HeartHandshake} label="همسان‌گزینی" href="/matchmaking" /><NavItem icon={Activity} label="گزارش‌ها" href="/reports" />
        </nav>
        <div className="mt-auto border-t border-white/10 pt-5"><NavItem icon={Settings} label="تنظیمات منابع" href="/sources" /></div>
      </aside>

      <section className="min-w-0">
        <header className="flex h-20 items-center justify-between border-b bg-white px-5 md:px-9">
          <div><h1 className="text-xl font-bold md:text-2xl">نمای کلی سامانه</h1><p className="mt-1 text-xs text-[#738079]">آخرین وضعیت همه ربات‌ها و وب‌اپ‌ها</p></div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-xl border bg-[#f8faf9] px-3 py-2 text-sm text-[#7a8580] md:flex"><Search size={16} /><span>جستجو در اطلاعات...</span></div>
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#e7f3ee] font-bold text-[#176b52]">ح</div>
          </div>
        </header>

        <div className="mx-auto max-w-[1450px] space-y-7 p-5 md:p-9">
          <div className="rounded-2xl border border-[#cfe0d9] bg-gradient-to-l from-[#eaf6f1] to-white p-4 text-sm text-[#31584c] rise">
            <div className="flex flex-wrap items-center gap-2"><ShieldCheck size={18} className="text-[#176b52]" /><strong>زیرساخت امن و مستقل</strong><span className="text-[#64746e]">— هیچ رمز سروری در CRM ذخیره نمی‌شود و منابع فقط داده ارسال می‌کنند.</span></div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="کاربران یکتا" value={data.contacts} detail="در همه منابع" icon={Users} tone="green" />
            <MetricCard label="پیام‌های ثبت‌شده" value={data.messages} detail={`${fa.format(data.aiMessages)} پاسخ هوش مصنوعی`} icon={MessageSquareText} tone="blue" />
            <MetricCard label="آزمون‌های تکمیل‌شده" value={data.tests} detail="همراه پاسخ‌های خام و نتیجه" icon={ClipboardCheck} tone="amber" />
            <MetricCard label="پروفایل‌های ازدواج" value={data.matchProfiles} detail="هر تلاش به‌صورت مستقل" icon={HeartHandshake} tone="rose" />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
            <section className="rounded-2xl border bg-white p-5 rise [animation-delay:80ms] md:p-6">
              <div className="mb-7 flex items-center justify-between"><div><h2 className="font-bold">فعالیت ۷ روز اخیر</h2><p className="mt-1 text-xs text-[#7a8580]">مجموع پیام‌ها و تکمیل آزمون‌ها</p></div><span className="rounded-lg bg-[#edf6f2] px-3 py-1.5 text-xs text-[#176b52]">به‌روزرسانی خودکار</span></div>
              <div className="flex h-52 items-end justify-between gap-3 border-b border-dashed px-2 pb-2">
                {data.daily.map((day) => <div key={day.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><div className="w-full max-w-12 rounded-t-lg bg-[#2c8067] transition-all" style={{ height: `${Math.max(4, (day.count / maxDay) * 85)}%` }} title={String(day.count)} /><span className="text-[11px] text-[#7a8580]">{day.label}</span></div>)}
              </div>
            </section>
            <section className="rounded-2xl border bg-[#173c32] p-6 text-white rise [animation-delay:130ms]">
              <p className="text-xs text-white/60">وضعیت اتصال</p><div className="mt-2 flex items-end gap-2"><strong className="text-4xl">{fa.format(data.activeSources)}</strong><span className="pb-1 text-sm text-white/60">از {fa.format(sourceCatalog.length)} منبع فعال</span></div>
              <div className="my-6 h-px bg-white/10" /><div className="space-y-3 text-sm"><StatusRow label="دیتابیس مرکزی" ok /><StatusRow label="API دریافت داده" ok /><StatusRow label="اتصال منابع فعلی" ok={data.activeSources > 0} /></div>
              <p className="mt-6 rounded-xl bg-white/7 p-3 text-xs leading-6 text-white/65">اتصال واقعی منابع در مرحله یکپارچه‌سازی انجام می‌شود؛ تا آن زمان هیچ تغییری در برنامه‌های فعال ایجاد نمی‌کنیم.</p>
            </section>
          </div>

          <section className="rise [animation-delay:180ms]">
            <div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold">منابع تحت مدیریت</h2><p className="mt-1 text-xs text-[#7a8580]">ربات‌ها و وب‌اپ‌های فعلی پروژه</p></div><button className="flex items-center gap-1 text-sm font-bold text-[#176b52]">مشاهده جزئیات <ChevronLeft size={16} /></button></div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sourceCatalog.map((source) => { const connected = data.sourceSlugs.includes(source.slug); return <article key={source.slug} className="group rounded-2xl border bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#173c32]/5"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[#edf5f2] text-[#176b52]"><source.icon size={21} /></div><div><h3 className="text-sm font-bold">{source.name}</h3><p className="mt-1 text-xs text-[#7b8782]">{source.platform} · {source.kind}</p></div></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${connected ? 'bg-[#e1f5e9] text-[#187443]' : 'bg-[#f2f3f2] text-[#7b8581]'}`}>{connected ? 'متصل' : 'در انتظار اتصال'}</span></div></article>; })}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function SignIn() {
  return <main className="grid min-h-screen place-items-center bg-[#102f27] p-6"><section className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-2xl shadow-black/20"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#d7f16b] text-[#17382e]"><Database size={26} /></div><h1 className="mt-6 text-2xl font-bold">مرکز مدیریت حامین</h1><p className="mt-3 text-sm leading-7 text-[#68756f]">برای مشاهده اطلاعات کاربران، گفتگوها و آزمون‌ها با حساب مجاز وارد شوید.</p><a href={chatGPTSignInPath('/')} className="mt-7 block rounded-xl bg-[#176b52] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#11533f]">ورود امن به سامانه</a><div className="mt-5 flex items-center justify-center gap-2 text-xs text-[#89938f]"><ShieldCheck size={15} /><span>اطلاعات فقط برای مدیران مجاز نمایش داده می‌شود</span></div></section></main>;
}

function NavItem({ icon: Icon, label, href, active = false }: { icon: typeof LayoutDashboard; label: string; href: string; active?: boolean }) { return <Link href={href} className={`flex items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-white/8 hover:text-white ${active ? 'bg-white/12 text-white' : 'text-white/60'}`}><Icon size={19} /><span>{label}</span></Link>; }
function MetricCard({ label, value, detail, icon: Icon, tone }: { label: string; value: number; detail: string; icon: typeof Users; tone: 'green' | 'blue' | 'amber' | 'rose' }) { const colors = { green: 'bg-[#e5f4ed] text-[#176b52]', blue: 'bg-[#e9f1fb] text-[#316da7]', amber: 'bg-[#fff3d8] text-[#a66b08]', rose: 'bg-[#fbecef] text-[#a84e62]' }; return <article className="rounded-2xl border bg-white p-5 rise"><div className="flex items-start justify-between"><div><p className="text-xs text-[#728079]">{label}</p><p className="mt-3 text-3xl font-bold tracking-tight">{fa.format(value)}</p></div><div className={`grid h-11 w-11 place-items-center rounded-xl ${colors[tone]}`}><Icon size={21} /></div></div><p className="mt-4 text-[11px] text-[#8a948f]">{detail}</p></article>; }
function StatusRow({ label, ok }: { label: string; ok: boolean }) { return <div className="flex items-center justify-between"><span className="text-white/75">{label}</span><span className={`flex items-center gap-1.5 text-xs ${ok ? 'text-[#d8ef74]' : 'text-white/45'}`}><i className={`h-2 w-2 rounded-full ${ok ? 'bg-[#d8ef74]' : 'bg-white/25'}`} />{ok ? 'آماده' : 'در انتظار'}</span></div>; }
