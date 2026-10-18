'use client';

import { useState, useEffect, type ReactNode } from 'react';
import {
  BarChart3,
  ClipboardCheck,
  DatabaseBackup,
  HeartHandshake,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Search,
  ShieldCheck,
  Users,
  Wifi,
  Settings,
  Sun,
  Moon
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { BrandLogo } from '@/components/brand-logo';

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => {
      if (mounted) {
        setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
      }
    });
    return () => { mounted = false; };
  }, []);

  const toggle = () => {
    if (theme === 'light') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
      setTheme('dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
      setTheme('light');
    }
  };

  return (
    <button
      onClick={toggle}
      className="relative grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-300"
      aria-label="تغییر تم"
      title="تغییر تم"
    >
      <Sun className={`absolute h-5 w-5 transition-all duration-300 ${theme === 'dark' ? 'scale-0 opacity-0 rotate-90' : 'scale-100 opacity-100 rotate-0'}`} />
      <Moon className={`absolute h-5 w-5 transition-all duration-300 ${theme === 'dark' ? 'scale-100 opacity-100 rotate-0' : 'scale-0 opacity-0 -rotate-90'}`} />
    </button>
  );
}

type NavItem = { href: string; label: string; icon: typeof Users };

const mainNav: NavItem[] = [
  { href: '/', label: 'داشبورد', icon: LayoutDashboard },
  { href: '/conversations', label: 'چت‌بات‌ها', icon: MessageSquareText },
  { href: '/tests', label: 'تست‌های روان‌شناسی', icon: ClipboardCheck },
  { href: '/matchmaking', label: 'فرم کی مناسب ازدواجه', icon: HeartHandshake },
  { href: '/users', label: 'مدیریت سرویس‌ها', icon: Users },
];

const toolsNav: NavItem[] = [
  { href: '/reports', label: 'گزارش‌گیری و آمار', icon: BarChart3 },
  { href: '/sources', label: 'منابع و ربات‌ها', icon: Wifi },
  { href: '/access', label: 'مدیران و دسترسی‌ها', icon: ShieldCheck },
  { href: '/system', label: 'تنظیمات و بک‌آپ', icon: DatabaseBackup },
];

export function CrmShell({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuReady, setMobileMenuReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => {
      if (mounted) setMobileMenuReady(true);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const livePages = new Set(['/', '/conversations', '/tests', '/matchmaking', '/users', '/reports', '/sources']);
    if (!livePages.has(pathname)) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [pathname, router]);

  function search(form: HTMLFormElement) {
    const raw = new FormData(form).get('q');
    const q = typeof raw === 'string' ? raw.trim() : '';
    router.push(`/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  }

  async function handleLogout() {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  function NavLink({ item }: { item: NavItem }) {
    const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
    const Icon = item.icon;
    return (
      <a
        href={item.href}
        className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all ${
          active
            ? 'font-bold shadow-sm'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
        }`}
        style={active ? { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' } : undefined}
        aria-current={active ? 'page' : undefined}
      >
        <div className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
          active ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20' : 'text-muted-foreground group-hover:text-foreground'
        }`}>
          <Icon size={18} />
        </div>
        <span style={active ? { color: 'var(--accent-foreground)' } : undefined}>{item.label}</span>
      </a>
    );
  }

  const sidebarContent = (
    <div className="flex h-full flex-col bg-card border-r-0 dark:border-l dark:border-border">
      {/* Brand */}
      <div className="flex items-center gap-3 px-6 py-6 border-b border-border">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-white shadow-md shadow-primary/20">
          <BrandLogo className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-[16px] font-black text-foreground tracking-tight">حامین چارت</h1>
          <p className="text-[11px] text-muted-foreground font-medium">سامانه مدیریت یکپارچه</p>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8">
        <div>
          <p className="mb-3 px-3 text-[11px] font-bold text-muted-foreground tracking-wider">بخش‌های اصلی</p>
          <nav className="space-y-1">
            {mainNav.map((item) => <NavLink key={item.href} item={item} />)}
          </nav>
        </div>

        <div>
          <p className="mb-3 px-3 text-[11px] font-bold text-muted-foreground tracking-wider">ابزارها</p>
          <nav className="space-y-1">
            {toolsNav.map((item) => <NavLink key={item.href} item={item} />)}
          </nav>
        </div>
      </div>

      {/* User / Footer */}
      <div className="p-4 border-t border-border bg-muted/20">
        <div className="flex items-center gap-3 rounded-xl p-2 bg-card border border-border shadow-sm">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary font-bold text-sm">
            م
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold text-foreground truncate">مدیر سیستم</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500"></span>
              </span>
              <p className="text-[10px] text-muted-foreground">پاسخگو و آنلاین</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <main className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[260px_minmax(0,1fr)] transition-colors duration-300" dir="rtl">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:block lg:sticky lg:top-0 lg:h-screen lg:overflow-hidden border-l border-border shadow-sm z-40 bg-card">
        {sidebarContent}
      </aside>

      {/* Main Content */}
      <section className="flex min-w-0 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/80 bg-card/80 backdrop-blur-xl px-4 sm:px-6 md:px-8 shadow-sm transition-colors duration-300">
          <div className="flex items-center gap-4">
            {mobileMenuReady ? (
              <Sheet>
                <SheetTrigger className="lg:hidden rounded-lg p-2 text-muted-foreground hover:bg-muted transition">
                  <Menu size={20} />
                </SheetTrigger>
                <SheetContent side="right" className="w-[280px] border-l-0 p-0">
                  <SheetTitle className="sr-only">منو</SheetTitle>
                  {sidebarContent}
                </SheetContent>
              </Sheet>
            ) : (
              <span aria-hidden="true" className="grid h-9 w-9 place-items-center lg:hidden text-muted-foreground">
                <Menu size={20} />
              </span>
            )}

            <div className="hidden sm:flex flex-col">
              <h2 className="text-[14px] font-bold text-foreground">{title}</h2>
              {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <form
              onSubmit={(e) => { e.preventDefault(); search(e.currentTarget); }}
              className="relative hidden md:block"
            >
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                name="q"
                aria-label="جستجو"
                placeholder="جستجوی مراجع..."
                className="h-9 w-64 rounded-full border border-border bg-muted/50 pr-9 pl-4 text-[13px] text-foreground placeholder:text-muted-foreground outline-none transition-all focus:border-primary focus:bg-card focus:ring-4 focus:ring-primary/10 focus:w-72"
              />
            </form>

            <div className="h-6 w-px bg-border hidden sm:block mx-1" />

            {/* Dark Mode Toggle */}
            <ThemeToggle />

            <a
              href="/system"
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition"
              aria-label="تنظیمات و وضعیت سامانه"
              title="تنظیمات و وضعیت سامانه"
            >
              <Settings size={18} />
            </a>
            <button
              type="button"
              onClick={() => { void handleLogout(); }}
              className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400 transition"
              title="خروج از سیستم"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Mobile Subtitle */}
        {subtitle && (
          <div className="sm:hidden border-b border-border bg-card/50 px-4 py-2">
            <h2 className="text-[13px] font-bold text-foreground">{title}</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
        )}

        {/* Page Content */}
        <div className="flex-1 p-4 sm:p-6 md:p-8">
          {children}
        </div>
      </section>
    </main>
  );
}
