import { ArrowLeft, Bot, ClipboardCheck, HeartHandshake, MessageSquareText, Search, Settings, SlidersHorizontal, Users, X } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { getSectionData } from '@/lib/section-data';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CrmShell } from '@/components/crm-shell';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';

export const dynamic = 'force-dynamic';
const sections = {
  users: { title: 'کاربران', description: 'اطلاعات کاربران همه منابع، بدون ادغام اشتباه هویت‌ها', icon: Users, columns: ['کاربر', 'منبع', 'شماره تماس / شناسه', 'آخرین فعالیت'] },
  conversations: { title: 'گفتگوها', description: 'متن کامل پیام کاربر و پاسخ هوش مصنوعی', icon: MessageSquareText, columns: ['شناسه گفتگو', 'منبع', 'تعداد پیام', 'آخرین پیام'] },
  tests: { title: 'آزمون‌ها', description: 'تمام تلاش‌ها، پاسخ‌های خام، امتیازها و تحلیل نهایی', icon: ClipboardCheck, columns: ['آزمون', 'شرکت‌کننده', 'کد پیگیری', 'زمان تکمیل'] },
  matchmaking: { title: 'همسان‌گزینی', description: 'پروفایل‌ها، پاسخ‌ها، ویژگی‌ها و رضایت اشتراک‌گذاری', icon: HeartHandshake, columns: ['پروفایل', 'شهر', 'تیپ شخصیتی', 'وضعیت'] },
  reports: { title: 'گزارش‌ها', description: 'خلاصه عددی هر منبع', icon: Bot, columns: ['منبع', 'کاربران', 'پیام‌ها', 'آزمون‌ها'] },
  sources: { title: 'تنظیمات منابع', description: 'وضعیت اتصال امن ربات‌ها و وب‌اپ‌ها', icon: Settings, columns: ['نام منبع', 'نوع', 'وضعیت اتصال', 'آخرین دریافت'] },
} as const;

export default async function SectionPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ q?: string; source?: string; page?: string }> }) {
  const { section } = await params; const item = sections[section as keyof typeof sections]; if (!item) notFound();
  const user = await getChatGPTUser(); if (!user && process.env.NODE_ENV !== 'development') return <SignIn returnTo={`/${section}`} />;
  const filters = await searchParams; const requestedPage = Math.max(1, Number.parseInt(filters.page ?? '1', 10) || 1); const data = await getSectionData(section, filters.q, filters.source, requestedPage); const Icon = item.icon; const hasFilters = Boolean(filters.q || filters.source); const firstRow = data.total ? (data.page - 1) * data.pageSize + 1 : 0; const lastRow = Math.min(data.total, data.page * data.pageSize);
  return <CrmShell title={item.title} subtitle={item.description}><div className="mx-auto max-w-7xl p-4 md:p-8">
    <header className="surface flex flex-col justify-between gap-4 rounded-3xl border bg-white p-5 sm:flex-row sm:items-center"><div className="flex items-center gap-4"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-[#0b6b5b]"><Icon size={23} /></div><div><h2 className="font-black">{item.title}</h2><p className="mt-1 text-xs text-slate-500">{item.description}</p></div></div><div className="rounded-xl bg-slate-50 px-4 py-2 text-xs text-slate-500"><b className="text-slate-800">{data.total.toLocaleString('fa-IR')}</b> رکورد موجود</div></header>
    <form className="surface mt-5 grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-[auto_1fr_240px_auto]"><span className="hidden h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500 md:grid"><SlidersHorizontal size={18}/></span>
      <div className="relative"><Search className="absolute right-3 top-3 text-[#84908b]" size={17} /><Input name="q" defaultValue={filters.q} placeholder="جستجو..." className="h-10 pr-10" /></div>
      <select name="source" defaultValue={filters.source ?? ''} className="h-10 rounded-lg border bg-white px-3 text-sm"><option value="">همه منابع</option>{data.sources.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select>
      <div className="flex gap-2"><Button type="submit" className="h-10 flex-1 bg-[#0b6b5b] px-5">اعمال فیلتر</Button>{hasFilters && <a href={`/${section}`} aria-label="پاک‌کردن فیلترها" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border bg-white text-slate-500 hover:bg-slate-50"><X size={17}/></a>}</div>
    </form>
    <section className="surface mt-4 overflow-hidden rounded-2xl border bg-white"><div className="flex items-center justify-between border-b px-5 py-4 text-sm text-slate-500"><span>نمایش {firstRow.toLocaleString('fa-IR')} تا {lastRow.toLocaleString('fa-IR')} از {data.total.toLocaleString('fa-IR')}</span><span className="hidden rounded-lg bg-slate-100 px-2 py-1 text-xs sm:block">برای جزئیات روی نام کلیک کنید</span></div>
      <div className="hidden md:block"><Table><TableHeader><TableRow className="bg-slate-50/70">{item.columns.map((c) => <TableHead key={c} className="px-5 text-right font-bold text-slate-600">{c}</TableHead>)}</TableRow></TableHeader><TableBody>
        {data.rows.map((row) => <TableRow key={row.id}>{row.cells.map((cell, i) => <TableCell key={i} className="px-5 py-4">{i === 0 && row.href ? <a className="font-bold text-[#176b52] hover:underline" href={row.href}>{cell}</a> : cell}</TableCell>)}</TableRow>)}
      </TableBody></Table></div>
      <div className="divide-y md:hidden">{data.rows.map((row) => <article key={row.id} className="p-4"><div className="mb-3 flex items-start justify-between gap-3"><div><p className="font-black text-slate-800">{row.cells[0]}</p><p className="mt-1 text-xs text-slate-400">{row.cells[1]}</p></div>{row.href && <a href={row.href} aria-label={`مشاهده ${row.cells[0]}`} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-[#0b6b5b]"><ArrowLeft size={17}/></a>}</div><dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3">{row.cells.slice(2).map((cell, index) => <div key={item.columns[index + 2]} className="min-w-0"><dt className="text-xs text-slate-400">{item.columns[index + 2]}</dt><dd className="mt-1 truncate text-xs font-bold text-slate-600">{cell}</dd></div>)}</dl></article>)}</div>
      {!data.rows.length && <div className="grid min-h-64 place-items-center p-8 text-center"><div><Icon className="mx-auto text-[#8b9b94]" /><h2 className="mt-4 font-bold">داده‌ای پیدا نشد</h2><p className="mt-2 text-sm text-[#7b8782]">پس از اتصال منابع، اطلاعات این بخش خودکار نمایش داده می‌شود.</p></div></div>}
      {data.totalPages > 1 && <div className="border-t px-4 py-4"><Pagination><PaginationContent>{data.page > 1 && <PaginationItem><PaginationPrevious href={pageHref(section, filters, data.page - 1)} text="قبلی" /></PaginationItem>}{pageRange(data.page, data.totalPages).map((page) => <PaginationItem key={page}><PaginationLink href={pageHref(section, filters, page)} isActive={page === data.page}>{page.toLocaleString('fa-IR')}</PaginationLink></PaginationItem>)}{data.page < data.totalPages && <PaginationItem><PaginationNext href={pageHref(section, filters, data.page + 1)} text="بعدی" /></PaginationItem>}</PaginationContent></Pagination></div>}
    </section>
  </div></CrmShell>;
}
function pageHref(section: string, filters: { q?: string; source?: string }, page: number) { const params = new URLSearchParams(); if (filters.q) params.set('q', filters.q); if (filters.source) params.set('source', filters.source); if (page > 1) params.set('page', String(page)); const query = params.toString(); return `/${section}${query ? `?${query}` : ''}`; }
function pageRange(current: number, total: number) { const start = Math.max(1, Math.min(current - 2, total - 4)); return Array.from({ length: Math.min(5, total) }, (_, index) => start + index); }
function SignIn({ returnTo }: { returnTo: string }) { return <main className="grid min-h-screen place-items-center bg-[#102f27] p-6"><div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center"><h1 className="text-xl font-bold">ورود مدیر</h1><p className="mt-3 text-sm text-[#68756f]">این بخش شامل اطلاعات محرمانه است.</p><a className="mt-6 block rounded-xl bg-[#176b52] px-5 py-3 text-sm font-bold text-white" href={chatGPTSignInPath(returnTo)} target="_top">ورود امن</a></div></main>; }
