import { KeyRound, ShieldCheck, Wifi } from 'lucide-react';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { sources } from '@/db/schema';
import { SourceManager } from '@/components/source-manager';
import { CrmShell } from '@/components/crm-shell';

export const dynamic = 'force-dynamic';
export default async function SourcesPage() {
  const user = await getChatGPTUser(); if (!user && process.env.NODE_ENV !== 'development') return <SignIn />;
  let rows: typeof sources.$inferSelect[] = []; try { rows = await getDb().select().from(sources).orderBy(sources.name); } catch { /* local database is not migrated yet */ }
  return <CrmShell title="منابع و اتصال‌ها" subtitle="مدیریت امن کلیدهای دریافت داده، بدون نگهداری رمز سرورها"><div className="mx-auto max-w-6xl p-4 md:p-8">
    <section className="surface rounded-3xl border bg-white p-5 md:p-6"><div className="flex flex-col justify-between gap-5 md:flex-row md:items-center"><div className="flex gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-[#0b6b5b]"><Wifi size={23}/></span><div><h2 className="font-black">اتصال امن هر منبع</h2><p className="mt-1 max-w-2xl text-sm leading-7 text-slate-500">برای هر ربات یا وب‌اپ یک کلید مجزا ساخته می‌شود. این CRM فقط هش کلید را نگه می‌دارد و رمز یا ورود به سرورها در آن ذخیره نمی‌شود.</p></div></div><div className="flex gap-2"><div className="rounded-xl bg-slate-50 px-4 py-3 text-center"><p className="text-lg font-black">{rows.filter((row) => row.status === 'active').length.toLocaleString('fa-IR')}</p><p className="text-xs text-slate-500">منبع فعال</p></div><div className="rounded-xl bg-slate-50 px-4 py-3 text-center"><p className="text-lg font-black">{rows.length.toLocaleString('fa-IR')}</p><p className="text-xs text-slate-500">کل منابع</p></div></div></div></section>
    <section className="mt-5 space-y-4">{rows.map((row) => <SourceManager key={row.id} source={{ id: row.id, slug: row.slug, name: row.name, kind: row.kind, platform: row.platform, status: row.status, hasKey: Boolean(row.credentialHash), lastSeen: row.lastSeenAt?.toLocaleString('fa-IR') ?? 'هنوز داده‌ای دریافت نشده' }} />)}{!rows.length && <div className="surface grid min-h-64 place-items-center rounded-3xl border bg-white p-8 text-center"><div><KeyRound className="mx-auto text-slate-300" size={28}/><h2 className="mt-4 font-bold">هنوز منبعی آماده نیست</h2><p className="mt-2 text-sm text-slate-500">پس از راه‌اندازی دیتابیس، منابع اینجا قابل مدیریت می‌شوند.</p></div></div>}</section>
    <div className="mt-5 flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-xs leading-6 text-slate-600"><ShieldCheck className="shrink-0 text-[#0b6b5b]" size={19}/><span>برای قطع اتصال یک منبع، کافی است آن را متوقف کنید. برنامه اصلی آن منبع حذف یا دستکاری نمی‌شود و هر زمان می‌توان آن را دوباره فعال کرد.</span></div>
  </div></CrmShell>;
}
function SignIn() { return <main className="grid min-h-screen place-items-center bg-[#102a35]"><a href={chatGPTSignInPath('/sources')} target="_top" className="rounded-xl bg-white px-6 py-3 font-bold text-[#0b6b5b]">ورود مدیر</a></main>; }
