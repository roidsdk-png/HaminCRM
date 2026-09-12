import { Archive, DatabaseBackup, ShieldCheck } from 'lucide-react';
import { getDb } from '@/db';
import { administrators } from '@/db/schema';
import { RestoreBackup } from '@/components/restore-backup';
import { AccessSettings } from '@/components/access-settings';
import { chatGPTSignInPath, getChatGPTUser } from '@/app/chatgpt-auth';
import { can, getAdminRole } from '@/lib/admin-access';
import { CrmShell } from '@/components/crm-shell';

export const dynamic = 'force-dynamic';
export default async function AccessPage() {
  const user = await getChatGPTUser(); if (!user && process.env.NODE_ENV !== 'development') return <SignIn />;
  const role = await getAdminRole(user); if (!can(role, 'owner')) return <Denied />;
  let admins: typeof administrators.$inferSelect[] = []; try { admins = await getDb().select().from(administrators); } catch { /* local database may not be migrated */ }
  return <CrmShell title="دسترسی و نگهداری" subtitle="مدیریت مدیران، سیاست نگهداری و بازیابی امن اطلاعات"><div className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
    <div className="grid gap-4 md:grid-cols-2"><Policy icon={Archive} title="نگهداری کامل اطلاعات" text="تمام پیام‌ها، پاسخ‌های هوش مصنوعی، آزمون‌ها و تلاش‌های مجدد بدون محدودیت زمانی نگهداری می‌شوند."/><Policy icon={ShieldCheck} title="دسترسی نقش‌محور" text="مالک، مدیر عملیاتی و مشاهده‌گر سطح دسترسی متفاوت دارند و فعالیت‌های مدیریتی ثبت می‌شود."/></div>
    <AccessSettings initialAdmins={admins.map((admin) => ({ id: admin.id, email: admin.email, role: admin.role, active: admin.active, updatedAt: admin.updatedAt.toLocaleString('fa-IR') }))}/>
    <section className="surface rounded-3xl border bg-white p-5 md:p-6"><div className="mb-5 flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700"><DatabaseBackup size={19}/></span><div><h2 className="font-black">بازیابی نسخه پشتیبان</h2><p className="mt-1 text-xs text-slate-500">داده‌های فایل با اطلاعات فعلی ادغام می‌شوند.</p></div></div><RestoreBackup bare/></section>
  </div></CrmShell>;
}
function Policy({ icon: Icon, title, text }: { icon: typeof Archive; title: string; text: string }) { return <section className="surface flex gap-4 rounded-3xl border bg-white p-5"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 text-[#0b6b5b]"><Icon size={20}/></span><div><h2 className="font-black">{title}</h2><p className="mt-2 text-sm leading-7 text-slate-500">{text}</p></div></section>; }
function SignIn() { return <main className="grid min-h-screen place-items-center bg-[#102a35]"><a href={chatGPTSignInPath('/access')} target="_top" className="rounded-xl bg-white px-6 py-3 font-bold text-[#0b6b5b]">ورود مدیر</a></main>; }
function Denied() { return <main className="grid min-h-screen place-items-center bg-slate-50 text-center"><div><ShieldCheck className="mx-auto text-slate-300" size={36}/><h1 className="mt-4 text-xl font-black">دسترسی مجاز نیست</h1><p className="mt-2 text-sm text-slate-500">فقط مالک سامانه می‌تواند مدیران را تغییر دهد.</p><a href="/" className="mt-5 inline-block font-bold text-[#0b6b5b]">بازگشت به داشبورد</a></div></main>; }
