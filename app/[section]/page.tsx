import {
  ArrowLeft,
  Bot,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileSpreadsheet,
  HeartHandshake,
  MessageSquare,
  MessageSquareText,
  Search,
  Settings2,
  SlidersHorizontal,
  User,
  Users,
  X
} from 'lucide-react';
import { notFound } from 'next/navigation';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { getSectionData } from '@/lib/section-data';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/brand-logo';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CrmShell } from '@/components/crm-shell';
import { ProvinceCityFilter } from '@/components/province-city-filter';
import { DateRangeFilter } from '@/components/date-range-filter';
import { can, getAdminRole } from '@/lib/admin-access';
import { PageAccessDenied } from '@/components/page-access-denied';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

export const dynamic = 'force-dynamic';

const fa = new Intl.NumberFormat('fa-IR');

const sections = {
  users: {
    title: 'مدیریت سرویس‌ها',
    description: 'فهرست مرکزی کاربران ثبت‌شده؛ هر ردیف مربوط به یک کاربر در یک منبع مشخص است',
    icon: Users,
    searchPlaceholder: 'جستجو با نام، شماره تماس یا شناسه کاربری...',
    columns: ['کاربر', 'نوع مراجعه', 'منبع اتصال', 'شماره تماس / شناسه یکتا', 'آخرین فعالیت'],
  },
  conversations: {
    title: 'چت‌بات‌ها',
    description: 'تاریخچه پیام‌ها، پاسخ‌های هوش مصنوعی و تبادل‌های ثبت‌شده',
    icon: MessageSquareText,
    searchPlaceholder: 'جستجو بر اساس شناسه کاربر یا نشست گفتگو...',
    columns: ['شناسه کاربر / گفتگو', 'منبع اتصال', 'تعداد پیام', 'آخرین تعامل'],
  },
  tests: {
    title: 'آزمون‌ها و ارزیابی‌ها',
    description: 'تلاش‌های ثبت‌شده، پاسخ‌ها، نمرات ابعاد و تحلیل بالینی هوش مصنوعی',
    icon: ClipboardCheck,
    searchPlaceholder: 'جستجو با نام، شماره یا کد پیگیری آزمون...',
    columns: ['عنوان آزمون', 'شرکت‌کننده', 'کد پیگیری', 'زمان تکمیل'],
  },
  matchmaking: {
    title: 'فرم کی مناسب ازدواجه',
    description: 'پروفایل‌های ثبت‌شده، تیپ‌های شخصیتی و رضایت اشتراک‌گذاری',
    icon: HeartHandshake,
    searchPlaceholder: 'جستجو با نام، شناسه، شماره، استان یا شهر...',
    columns: ['نام متقاضی', 'استان / شهر سکونت', 'تیپ شخصیتی', 'وضعیت ثبت', 'زمان تکمیل'],
  },
  reports: {
    title: 'خلاصه منابع',
    description: 'گزارش‌های آماری و تفکیک عملکرد هر یک از سرویس‌ها',
    icon: Bot,
    searchPlaceholder: 'جستجو بر اساس نام منبع...',
    columns: ['نام منبع', 'کاربران', 'پیام‌ها', 'آزمون‌ها'],
  },
  sources: {
    title: 'تنظیمات منابع داده',
    description: 'پایش وضعیت اتصال ایمن ربات‌ها و وب‌اپ‌ها',
    icon: Settings2,
    searchPlaceholder: 'جستجو بر اساس نام منبع...',
    columns: ['نام منبع', 'نوع سرویس', 'وضعیت اتصال', 'آخرین دریافت'],
  },
} as const;

export default async function SectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ q?: string; source?: string; province?: string; city?: string; gender?: string; sort?: string; kind?: string; page?: string; from?: string; to?: string; range?: string }>;
}) {
  const { section } = await params;
  const item = sections[section as keyof typeof sections];
  if (!item) notFound();

  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return <SignIn returnTo={`/${section}`} />;
  }
  if (!can(await getAdminRole(user), 'read')) return <PageAccessDenied />;

  const filters = await searchParams;
  const requestedPage = Math.max(1, Number.parseInt(filters.page ?? '1', 10) || 1);
  const dateRange = resolveDateRange(filters.from, filters.to, filters.range);
  const data = await getSectionData(section, filters.q, filters.source, requestedPage, 20, filters.province, filters.sort, filters.kind, filters.city, dateRange.from, dateRange.to, filters.gender);
  const Icon = item.icon;
  const hasFilters = Boolean(filters.q || filters.source || filters.province || filters.city || filters.gender || filters.kind || filters.from || filters.to || filters.range || (filters.sort && filters.sort !== 'newest'));
  const firstRow = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastRow = Math.min(data.total, data.page * data.pageSize);

  return (
    <CrmShell title={item.title} subtitle={item.description}>
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
        {/* Header Banner */}
        <header className="flex flex-col justify-between gap-4 rounded-3xl border border-border bg-card p-5 sm:flex-row sm:items-center shadow-xs transition-colors duration-300">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
              <Icon size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-black text-foreground">{item.title}</h1>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
                  {fa.format(data.total)} مورد
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            {section === 'reports' ? (
              <a
                href="/reports"
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 font-bold text-primary-foreground shadow-xs transition hover:bg-primary/90"
              >
                <FileSpreadsheet size={15} />
                مشاهده تحلیل و دانلود گزارش‌ها
              </a>
            ) : (
              <div className="flex items-center gap-2 rounded-xl bg-muted border border-border px-3.5 py-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span>همگام‌سازی لحظه‌ای فعال</span>
              </div>
            )}
          </div>
        </header>

        {/* Filter and Search Bar */}
        <form
          method="GET"
          action={`/${section}`}
          className="flex flex-wrap items-center gap-3 overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-xs transition-colors duration-300"
        >
          <span className="hidden h-11 w-11 place-items-center rounded-xl bg-muted border border-border text-muted-foreground md:grid">
            <SlidersHorizontal size={18} />
          </span>

          <div className="relative min-w-[260px] flex-[3]">
            <Search className="pointer-events-none absolute right-3.5 top-3.5 text-muted-foreground" size={18} />
            <input
              name="q"
              defaultValue={filters.q}
              placeholder={item.searchPlaceholder}
              aria-label="جستجو در رکوردها"
              className="h-11 w-full rounded-xl border border-border bg-background pr-10 pl-3 text-xs font-normal text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 md:text-sm"
            />
          </div>

          {section === 'matchmaking' ? (
            <>
              <select
                name="gender"
                defaultValue={filters.gender ?? ''}
                aria-label="فیلتر جنسیت متقاضی"
                className="h-11 min-w-[150px] flex-1 rounded-xl border border-border bg-background px-3 text-xs font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 md:text-sm"
              >
                <option value="">همه جنسیت‌ها</option>
                <option value="female">دختر</option>
                <option value="male">پسر</option>
              </select>
              <ProvinceCityFilter defaultProvince={filters.province} defaultCity={filters.city} />
              <select
                name="sort"
                defaultValue={filters.sort ?? 'newest'}
                aria-label="مرتب‌سازی فرم کی مناسب ازدواجه"
                className="h-11 min-w-[170px] flex-1 rounded-xl border border-border bg-background px-3 text-xs font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 md:text-sm"
              >
                <option value="newest">جدیدترین تکمیل</option>
                <option value="oldest">قدیمی‌ترین تکمیل</option>
                <option value="name_asc">نام: الف تا ی</option>
                <option value="name_desc">نام: ی تا الف</option>
                <option value="location_asc">استان / شهر: الف تا ی</option>
              </select>
            </>
          ) : section === 'users' ? (
            <>
              <select
                name="kind"
                defaultValue={filters.kind ?? ''}
                aria-label="فیلتر نوع مراجعه"
                className="h-11 min-w-[170px] flex-1 rounded-xl border border-border bg-background px-3 text-xs font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 md:text-sm"
              >
                <option value="">همه نوع‌های مراجعه</option>
                <option value="chatbot">گفتگو با چت‌بات</option>
                <option value="test">شرکت در آزمون</option>
                <option value="matchmaking">فرم ازدواج</option>
              </select>
              <ProvinceCityFilter defaultProvince={filters.province} defaultCity={filters.city} />
              <select
                name="source"
                defaultValue={filters.source ?? ''}
                aria-label="انتخاب منبع داده"
                className="h-11 min-w-[170px] flex-1 rounded-xl border border-border bg-background px-3 text-xs font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 md:text-sm"
              >
                <option value="">همه منابع</option>
                {data.sources.map((s) => (
                  <option key={s.slug} value={s.slug}>{s.name}</option>
                ))}
              </select>
              <select
                name="sort"
                defaultValue={filters.sort ?? 'newest'}
                aria-label="مرتب‌سازی مراجعان"
                className="h-11 min-w-[170px] flex-1 rounded-xl border border-border bg-background px-3 text-xs font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 md:text-sm"
              >
                <option value="newest">آخرین فعالیت: جدیدترین</option>
                <option value="oldest">آخرین فعالیت: قدیمی‌ترین</option>
                <option value="name_asc">نام: الف تا ی</option>
                <option value="name_desc">نام: ی تا الف</option>
                <option value="source_asc">مرتب‌سازی بر اساس منبع</option>
              </select>
            </>
          ) : section === 'tests' ? (
            <>
              <select
                name="source"
                defaultValue={filters.source ?? ''}
                aria-label="انتخاب آزمون"
                className="h-11 min-w-[170px] flex-1 rounded-xl border border-border bg-background px-3 text-xs font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 md:text-sm"
              >
                <option value="">همه آزمون‌ها</option>
                {data.sources.map((s) => (
                  <option key={s.slug} value={s.slug}>{s.name}</option>
                ))}
              </select>
              <ProvinceCityFilter defaultProvince={filters.province} defaultCity={filters.city} />
            </>
          ) : (
            <select
              name="source"
              defaultValue={filters.source ?? ''}
              aria-label="انتخاب منبع داده"
              className="h-11 min-w-[200px] flex-1 rounded-xl border border-border bg-background px-3 text-xs md:text-sm font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="">همه منابع اتصال</option>
              {data.sources.map((s) => (
                <option key={s.slug} value={s.slug}>{s.name}</option>
              ))}
            </select>
          )}

          <div className="flex min-w-fit gap-2">
            <Button
              type="submit"
              className="h-11 flex-1 gap-2 rounded-xl bg-primary px-5 font-bold text-primary-foreground shadow-xs transition hover:bg-primary/90"
            >
              <Search size={16} />
              اعمال فیلتر
            </Button>
            {hasFilters && (
              <a
                href={`/${section}`}
                aria-label="پاک‌کردن فیلترها"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-muted text-muted-foreground transition hover:bg-muted/80 hover:text-foreground"
              >
                <X size={18} />
              </a>
            )}
          </div>
          {['users', 'conversations', 'tests', 'matchmaking'].includes(section) && (
            <DateRangeFilter defaultFrom={dateRange.from} defaultTo={dateRange.to} activeRange={filters.range} />
          )}
        </form>

        {/* Data Table Container */}
        <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-xs transition-colors duration-300">
          {/* Table Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground">
                نمایش {fa.format(firstRow)} تا {fa.format(lastRow)}
              </span>
              <span>از مجموع {fa.format(data.total)} رکورد</span>
            </div>
            <span className="hidden rounded-lg bg-muted border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:block">
              برای مشاهده پرونده کامل و تحلیل، روی عنوان رکورد کلیک کنید
            </span>
          </div>

          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 border-b border-border hover:bg-muted/50">
                  {item.columns.map((c, i) => (
                    <TableHead
                      key={c}
                      className={`px-6 py-3.5 text-right text-xs font-bold text-muted-foreground ${
                        i === 0 ? 'w-[32%]' : ''
                      }`}
                    >
                      {c}
                    </TableHead>
                  ))}
                  <TableHead className="w-16 px-4 text-center text-xs font-bold text-muted-foreground">عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="group border-b border-border transition-colors hover:bg-primary/5 dark:hover:bg-primary/10"
                  >
                    {row.cells.map((cell, i) => (
                      <TableCell key={i} className="px-6 py-4 text-xs font-medium text-foreground">
                        {i === 0 ? (
                          row.href ? (
                            <a
                              href={row.href}
                              className="inline-flex items-center gap-3 font-bold text-foreground transition-colors group-hover:text-primary"
                            >
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20 text-xs font-black">
                                {section === 'users' ? (
                                  <User size={15} />
                                ) : section === 'conversations' ? (
                                  <MessageSquare size={15} />
                                ) : section === 'tests' ? (
                                  <ClipboardCheck size={15} />
                                ) : section === 'matchmaking' ? (
                                  <HeartHandshake size={15} />
                                ) : (
                                  <Bot size={15} />
                                )}
                              </span>
                              <span className="truncate max-w-xs">{cell}</span>
                            </a>
                          ) : (
                            <span className="font-bold text-foreground">{cell}</span>
                          )
                        ) : i === 1 ? (
                          <span className="inline-flex items-center rounded-lg bg-muted border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground">
                            {cell}
                          </span>
                        ) : i === 2 && section === 'conversations' ? (
                          <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-bold text-blue-600 dark:text-blue-400">
                            {fa.format(Number(cell) || 0)} پیام
                          </span>
                        ) : i === 3 && section === 'users' ? (
                          <span dir="ltr" className="font-mono text-xs font-bold text-muted-foreground">
                            {cell}
                          </span>
                        ) : i === 2 && section === 'tests' ? (
                          <code dir="ltr" className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] font-bold text-foreground">
                            {cell}
                          </code>
                        ) : i === 3 && section === 'matchmaking' ? (
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              cell === 'تکمیل‌شده'
                                ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                : 'bg-amber-500/10 text-amber-600 dark:text-amber-500'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                cell === 'تکمیل‌شده' ? 'bg-green-500' : 'bg-amber-500'
                              }`}
                            />
                            {cell}
                          </span>
                        ) : (
                          <span>{cell}</span>
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="px-4 py-4 text-center">
                      {row.href ? (
                        <a
                          href={row.href}
                          aria-label={`مشاهده جزئیات رکورد`}
                          className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground transition group-hover:bg-primary group-hover:text-primary-foreground"
                        >
                          <ChevronLeft size={16} />
                        </a>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Card List View */}
          <div className="divide-y divide-border md:hidden">
            {data.rows.map((row) => (
              <article key={row.id} className="p-4 transition hover:bg-muted/40">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary mt-0.5">
                      <Icon size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold text-foreground truncate text-sm">{row.cells[0]}</p>
                      <span className="inline-block mt-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {row.cells[1]}
                      </span>
                    </div>
                  </div>
                  {row.href && (
                    <a
                      href={row.href}
                      aria-label={`مشاهده جزئیات ${row.cells[0]}`}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition"
                    >
                      <ArrowLeft size={16} />
                    </a>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-3 text-xs">
                  {row.cells.slice(2).map((cell, index) => (
                    <div key={item.columns[index + 2]} className="min-w-0">
                      <dt className="text-muted-foreground text-[11px] font-medium">{item.columns[index + 2]}</dt>
                      <dd className="mt-1 truncate font-bold text-foreground">{cell}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>

          {/* Empty State */}
          {!data.rows.length && (
            <div className="grid min-h-64 place-items-center p-12 text-center">
              <div className="max-w-sm">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-muted text-muted-foreground border border-border">
                  <Icon size={30} />
                </div>
                <h2 className="mt-4 text-base font-black text-foreground">هیچ رکوردی یافت نشد</h2>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  با این فیلتر رکوردی پیدا نشد، یا هنوز رویدادی از منابع فعال به سامانه متصل نشده است.
                </p>
                {hasFilters && (
                  <a
                    href={`/${section}`}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2 text-xs font-bold text-foreground shadow-xs hover:bg-muted"
                  >
                    <X size={14} />
                    پاک‌کردن فیلترها
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Pagination Controls */}
          {data.totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-6 py-4">
              <p className="text-xs text-muted-foreground">
                صفحه {fa.format(data.page)} از {fa.format(data.totalPages)}
              </p>
              <Pagination className="w-auto mx-0">
                <PaginationContent>
                  {data.page > 1 && (
                    <PaginationItem>
                      <PaginationPrevious
                         href={pageHref(section, filters, data.page - 1)}
                        text="قبلی"
                        className="gap-1 border border-border hover:bg-muted"
                      >
                        <ChevronRight size={15} />
                      </PaginationPrevious>
                    </PaginationItem>
                  )}
                  {pageRange(data.page, data.totalPages).map((page) => (
                    <PaginationItem key={page}>
                      <PaginationLink
                         href={pageHref(section, filters, page)}
                        isActive={page === data.page}
                        className={`h-9 w-9 rounded-xl text-xs font-bold ${
                          page === data.page
                            ? 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90'
                            : 'border border-border hover:bg-muted text-foreground'
                        }`}
                      >
                        {fa.format(page)}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  {data.page < data.totalPages && (
                    <PaginationItem>
                      <PaginationNext
                         href={pageHref(section, filters, data.page + 1)}
                        text="بعدی"
                        className="gap-1 border border-border hover:bg-muted"
                      >
                        <ChevronLeft size={15} />
                      </PaginationNext>
                    </PaginationItem>
                  )}
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </section>
      </div>
    </CrmShell>
  );
}

function pageHref(section: string, filters: { q?: string; source?: string; province?: string; city?: string; gender?: string; sort?: string; kind?: string; from?: string; to?: string; range?: string }, page: number) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.source) params.set('source', filters.source);
  if (filters.province) params.set('province', filters.province);
  if (filters.city) params.set('city', filters.city);
  if (filters.gender) params.set('gender', filters.gender);
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.sort && filters.sort !== 'newest') params.set('sort', filters.sort);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.range) params.set('range', filters.range);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/${section}${query ? `?${query}` : ''}`;
}

function resolveDateRange(from?: string, to?: string, range?: string) {
  const valid = (value?: string) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
  if (['7', '14', '30'].includes(range ?? '')) {
    const days = Number(range);
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days + 1);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  const safeFrom = valid(from) ? from! : '';
  const safeTo = valid(to) ? to! : '';
  return safeFrom && safeTo && safeFrom > safeTo ? { from: safeTo, to: safeFrom } : { from: safeFrom, to: safeTo };
}

function pageRange(current: number, total: number) {
  const start = Math.max(1, Math.min(current - 2, total - 4));
  return Array.from({ length: Math.min(5, total) }, (_, index) => start + index);
}

function SignIn({ returnTo }: { returnTo: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-sm rounded-3xl bg-card p-8 text-center shadow-xl border border-border">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          <BrandLogo className="h-8 w-8 text-primary-foreground" />
        </div>
        <h1 className="mt-6 text-2xl font-black text-foreground">ورود مدیر سامانه</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          دسترسی به اطلاعات این بخش نیازمند ورود به حساب مدیر است.
        </p>
        <a
          className="mt-8 block rounded-2xl bg-primary px-5 py-4 text-[14px] font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90"
          href={chatGPTSignInPath(returnTo)}
          target="_top"
        >
          ورود امن به پنل سیستم
        </a>
      </div>
    </main>
  );
}
