import Link from 'next/link';
import { ArrowRight, Bot, ClipboardCheck, HeartHandshake, MessageSquareText, Search, Settings, Users } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { getSectionData } from '@/lib/section-data';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const dynamic = 'force-dynamic';
const sections = {
  users: { title: 'کاربران', description: 'اطلاعات کاربران همه منابع، بدون ادغام اشتباه هویت‌ها', icon: Users, columns: ['کاربر', 'منبع', 'شماره تماس / شناسه', 'آخرین فعالیت'] },
  conversations: { title: 'گفتگوها', description: 'متن کامل پیام کاربر و پاسخ هوش مصنوعی', icon: MessageSquareText, columns: ['شناسه گفتگو', 'منبع', 'تعداد پیام', 'آخرین پیام'] },
  tests: { title: 'آزمون‌ها', description: 'تمام تلاش‌ها، پاسخ‌های خام، امتیازها و تحلیل نهایی', icon: ClipboardCheck, columns: ['آزمون', 'شرکت‌کننده', 'کد پیگیری', 'زمان تکمیل'] },
  matchmaking: { title: 'همسان‌گزینی', description: 'پروفایل‌ها، پاسخ‌ها، ویژگی‌ها و رضایت اشتراک‌گذاری', icon: HeartHandshake, columns: ['پروفایل', 'شهر', 'تیپ شخصیتی', 'وضعیت'] },
  reports: { title: 'گزارش‌ها', description: 'خلاصه عددی هر منبع', icon: Bot, columns: ['منبع', 'کاربران', 'پیام‌ها', 'آزمون‌ها'] },
  sources: { title: 'تنظیمات منابع', description: 'وضعیت اتصال امن ربات‌ها و وب‌اپ‌ها', icon: Settings, columns: ['نام منبع', 'نوع', 'وضعیت اتصال', 'آخرین دریافت'] },
} as const;

export default async function SectionPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ q?: string; source?: string }> }) {
  const { section } = await params; const item = sections[section as keyof typeof sections]; if (!item) notFound();
  const user = await getChatGPTUser(); if (!user && process.env.NODE_ENV !== 'development') return <SignIn returnTo={`/${section}`} />;
  const filters = await searchParams; const data = await getSectionData(section, filters.q, filters.source); const Icon = item.icon;
  return <main className="min-h-screen p-5 md:p-9"><div className="mx-auto max-w-6xl">
    <Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#176b52]"><ArrowRight size={17} />بازگشت به داشبورد</Link>
    <header className="flex items-center gap-4"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#e4f3ed] text-[#176b52]"><Icon size={23} /></div><div><h1 className="text-2xl font-bold">{item.title}</h1><p className="mt-1 text-sm text-[#6e7b75]">{item.description}</p></div></header>
    <form className="mt-7 grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-[1fr_240px_auto]">
      <div className="relative"><Search className="absolute right-3 top-3 text-[#84908b]" size={17} /><Input name="q" defaultValue={filters.q} placeholder="جستجو..." className="h-10 pr-10" /></div>
      <select name="source" defaultValue={filters.source ?? ''} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="">همه منابع</option>{data.sources.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select>
      <Button type="submit" className="h-10 px-5">اعمال فیلتر</Button>
    </form>
    <section className="mt-4 overflow-hidden rounded-2xl border bg-white"><div className="border-b px-5 py-4 text-sm text-[#6c7973]">{data.total.toLocaleString('fa-IR')} رکورد نمایش داده می‌شود</div>
      <Table><TableHeader><TableRow className="bg-[#f7faf8]">{item.columns.map((c) => <TableHead key={c} className="px-5 text-right font-bold">{c}</TableHead>)}</TableRow></TableHeader><TableBody>
        {data.rows.map((row) => <TableRow key={row.id}>{row.cells.map((cell, i) => <TableCell key={i} className="px-5 py-4">{i === 0 && row.href ? <Link className="font-bold text-[#176b52] hover:underline" href={row.href}>{cell}</Link> : cell}</TableCell>)}</TableRow>)}
      </TableBody></Table>
      {!data.rows.length && <div className="grid min-h-64 place-items-center p-8 text-center"><div><Icon className="mx-auto text-[#8b9b94]" /><h2 className="mt-4 font-bold">داده‌ای پیدا نشد</h2><p className="mt-2 text-sm text-[#7b8782]">پس از اتصال منابع، اطلاعات این بخش خودکار نمایش داده می‌شود.</p></div></div>}
    </section>
  </div></main>;
}
function SignIn({ returnTo }: { returnTo: string }) { return <main className="grid min-h-screen place-items-center bg-[#102f27] p-6"><div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center"><h1 className="text-xl font-bold">ورود مدیر</h1><p className="mt-3 text-sm text-[#68756f]">این بخش شامل اطلاعات محرمانه است.</p><a className="mt-6 block rounded-xl bg-[#176b52] px-5 py-3 text-sm font-bold text-white" href={chatGPTSignInPath(returnTo)} target="_top">ورود امن</a></div></main>; }
