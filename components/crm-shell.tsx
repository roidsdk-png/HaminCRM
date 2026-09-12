'use client';

import type { ReactNode } from 'react';
import { Activity, ClipboardCheck, Database, DatabaseBackup, HeartHandshake, KeyRound, LayoutDashboard, Menu, MessageSquareText, Search, Settings, Users } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

const navigation = [
  ['/', 'نمای کلی', LayoutDashboard], ['/users', 'کاربران', Users], ['/conversations', 'گفتگوها', MessageSquareText],
  ['/tests', 'آزمون‌ها', ClipboardCheck], ['/matchmaking', 'همسان‌گزینی', HeartHandshake], ['/reports', 'گزارش‌ها', Activity],
];
const operations = [['/system', 'سلامت و پشتیبان', DatabaseBackup], ['/sources', 'منابع و اتصال‌ها', Settings], ['/access', 'دسترسی‌ها', KeyRound]];

export function CrmShell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  const pathname = usePathname(); const router = useRouter();
  function search(form: HTMLFormElement) { const raw = new FormData(form).get('q'); const q = typeof raw === 'string' ? raw.trim() : ''; router.push(`/users${q ? `?q=${encodeURIComponent(q)}` : ''}`); }
  const nav = (mobile = false) => <nav className={mobile ? 'space-y-1' : 'space-y-1 text-sm'}>{navigation.map(([href, label, Icon]) => <Nav key={href as string} href={href as string} label={label as string} icon={Icon as typeof Database} current={pathname} mobile={mobile} />)}<div className="my-5 border-t border-white/10" />{operations.map(([href, label, Icon]) => <Nav key={href as string} href={href as string} label={label as string} icon={Icon as typeof Database} current={pathname} mobile={mobile} />)}</nav>;
  return <main className="app-grid min-h-screen lg:grid lg:grid-cols-[270px_minmax(0,1fr)]">
    <aside className="hidden min-h-screen bg-[#102a35] px-4 py-6 text-white lg:flex lg:flex-col">
      <Brand />{nav()}<div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs text-white/50">وضعیت سامانه</p><div className="mt-2 flex items-center gap-2 text-sm"><i className="h-2 w-2 rounded-full bg-[#b9ef72] shadow-[0_0_0_4px_rgba(185,239,114,.12)]" />دیتابیس مرکزی آماده</div></div>
    </aside>
    <section className="min-w-0">
      <header className="sticky top-0 z-20 flex min-h-20 items-center justify-between border-b border-slate-200/80 bg-[#f4f6f8]/90 px-4 backdrop-blur md:px-8">
        <div className="flex items-center gap-3"><Sheet><SheetTrigger render={<Button variant="outline" size="icon" className="lg:hidden" />}><Menu /></SheetTrigger><SheetContent side="right" className="w-[290px] border-0 bg-[#102a35] p-4 text-white"><SheetTitle className="sr-only">منوی مدیریت</SheetTitle><Brand />{nav(true)}</SheetContent></Sheet><div><h1 className="text-lg font-black tracking-tight text-slate-900 md:text-xl">{title}</h1>{subtitle && <p className="mt-1 hidden text-xs text-slate-500 sm:block">{subtitle}</p>}</div></div>
        <div className="flex items-center gap-2"><form onSubmit={(event) => { event.preventDefault(); search(event.currentTarget); }} className="relative hidden md:block"><input name="q" aria-label="جستجو در کاربران" placeholder="جستجو در کاربران..." className="h-10 w-56 rounded-xl border border-slate-200 bg-white pr-3 pl-10 text-sm outline-none transition focus:w-72 focus:border-[#0b6b5b] focus:ring-4 focus:ring-emerald-100" /><button type="submit" aria-label="اجرای جستجو" className="absolute left-1 top-1 grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-[#0b6b5b]"><Search size={17} /></button></form><a href="/sources" className="hidden rounded-xl bg-[#0b6b5b] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#075647] sm:block">مدیریت منابع</a><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#d9efe8] text-sm font-black text-[#0b6b5b]">ح</div></div>
      </header>
      {children}
    </section>
  </main>;
}

function Brand() { return <a href="/" className="mb-8 flex items-center gap-3 px-2"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#b9ef72] text-[#102a35]"><Database size={22} /></div><div><p className="font-black">مرکز حامین</p><p className="mt-0.5 text-[11px] text-white/50">کنترل‌پنل یکپارچه</p></div></a>; }
function Nav({ href, label, icon: Icon, current, mobile }: { href: string; label: string; icon: typeof Database; current: string; mobile: boolean }) { const active = href === '/' ? current === '/' : current.startsWith(href); return <a href={href} className={`flex items-center gap-3 rounded-xl px-3 py-3 transition ${active ? 'bg-white text-[#102a35] shadow-lg shadow-black/10' : 'text-white/62 hover:bg-white/8 hover:text-white'} ${mobile ? 'text-sm' : ''}`}><Icon size={19} /><span>{label}</span>{active && <i className="mr-auto h-1.5 w-1.5 rounded-full bg-[#0b6b5b]" />}</a>; }
