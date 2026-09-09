import Link from 'next/link';
import { ArrowRight, Bot, ClipboardCheck, HeartHandshake, MessageSquareText, Search, Settings, Users } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';

const sections = {
  users: { title: 'کاربران', description: 'اطلاعات کاربران همه منابع، بدون ادغام اشتباه هویت‌ها', icon: Users, columns: ['کاربر', 'منبع', 'شماره تماس / شناسه', 'آخرین فعالیت'] },
  conversations: { title: 'گفتگوها', description: 'متن کامل پیام کاربر و پاسخ هوش مصنوعی به تفکیک هر گفتگو', icon: MessageSquareText, columns: ['گفتگو', 'منبع', 'تعداد پیام', 'آخرین پیام'] },
  tests: { title: 'آزمون‌ها', description: 'تمام تلاش‌ها، پاسخ‌های خام، امتیازها و تحلیل نهایی', icon: ClipboardCheck, columns: ['آزمون', 'شرکت‌کننده', 'کد پیگیری', 'زمان تکمیل'] },
  matchmaking: { title: 'همسان‌گزینی', description: 'پروفایل‌ها، پاسخ‌ها، ویژگی‌ها و رضایت اشتراک‌گذاری', icon: HeartHandshake, columns: ['پروفایل', 'شهر', 'تیپ شخصیتی', 'وضعیت'] },
  reports: { title: 'گزارش‌ها', description: 'گزارش‌های عددی و نموداری قابل فیلتر بر اساس منبع و زمان', icon: Bot, columns: ['گزارش', 'بازه زمانی', 'منبع', 'خروجی'] },
  sources: { title: 'تنظیمات منابع', description: 'مدیریت اتصال امن ربات‌ها و وب‌اپ‌ها به دیتابیس مرکزی', icon: Settings, columns: ['نام منبع', 'نوع', 'وضعیت اتصال', 'آخرین دریافت'] },
} as const;

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params; const item = sections[section as keyof typeof sections]; if (!item) notFound();
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') return <main className="grid min-h-screen place-items-center bg-[#102f27] p-6"><div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center"><h1 className="text-xl font-bold">ورود مدیر</h1><p className="mt-3 text-sm leading-7 text-[#68756f]">این بخش شامل اطلاعات محرمانه کاربران است.</p><a className="mt-6 block rounded-xl bg-[#176b52] px-5 py-3 text-sm font-bold text-white" href={chatGPTSignInPath(`/${section}`)}>ورود امن</a></div></main>;
  const Icon = item.icon;
  return <main className="min-h-screen p-5 md:p-9"><div className="mx-auto max-w-6xl"><Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#176b52]"><ArrowRight size={17} />بازگشت به داشبورد</Link><header className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#e4f3ed] text-[#176b52]"><Icon size={23} /></div><div><h1 className="text-2xl font-bold">{item.title}</h1><p className="mt-1 text-sm text-[#6e7b75]">{item.description}</p></div></div><div className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm text-[#7a8580]"><Search size={17} />جستجو و فیلتر</div></header><section className="mt-7 overflow-hidden rounded-2xl border bg-white"><div className="grid grid-cols-4 gap-3 border-b bg-[#f7faf8] px-5 py-4 text-xs font-bold text-[#65726c]">{item.columns.map((column) => <span key={column}>{column}</span>)}</div><div className="grid min-h-72 place-items-center p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#edf4f1] text-[#7a8c84]"><Icon size={22} /></div><h2 className="mt-4 font-bold">هنوز داده‌ای دریافت نشده است</h2><p className="mt-2 text-sm text-[#7b8782]">بعد از اتصال منابع، اطلاعات این بخش به‌صورت خودکار نمایش داده می‌شود.</p></div></div></section></div></main>;
}
