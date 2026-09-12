import { ArrowRight, Bot, CheckCircle2, ClipboardCheck, HeartHandshake, MessageSquareText, UserRound } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { getRecordDetail } from '@/lib/section-data';
import { CrmShell } from '@/components/crm-shell';

export const dynamic = 'force-dynamic';
const sectionInfo = {
  users: { title: 'پرونده کاربر', list: 'کاربران', icon: UserRound },
  conversations: { title: 'جزئیات گفتگو', list: 'گفتگوها', icon: MessageSquareText },
  tests: { title: 'نتیجه آزمون', list: 'آزمون‌ها', icon: ClipboardCheck },
  matchmaking: { title: 'پروفایل همسان‌گزینی', list: 'همسان‌گزینی', icon: HeartHandshake },
} as const;

export default async function DetailPage({ params }: { params: Promise<{ section: string; id: string }> }) {
  const { section, id } = await params; const info = sectionInfo[section as keyof typeof sectionInfo]; if (!info) notFound();
  const user = await getChatGPTUser(); if (!user && process.env.NODE_ENV !== 'development') return <SignIn returnTo={`/${section}/${id}`} />;
  const detail = await getRecordDetail(section, id); if (!detail?.header) notFound(); const Icon = info.icon;
  return <CrmShell title={info.title} subtitle={`مشاهده اطلاعات ثبت‌شده در بخش ${info.list}`}><div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
    <a href={`/${section}`} className="inline-flex items-center gap-2 text-sm font-bold text-[#0b6b5b]"><ArrowRight size={17}/>بازگشت به {info.list}</a>
    <section className="surface overflow-hidden rounded-3xl border bg-white"><div className="flex items-center gap-4 border-b bg-gradient-to-l from-slate-50 to-white p-5 md:p-6"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-[#0b6b5b]"><Icon size={23}/></span><div><h2 className="text-lg font-black">{info.title}</h2><p className="mt-1 text-xs text-slate-500">شناسه داخلی: <span dir="ltr">{id}</span></p></div></div><div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(detail.header).map(([key, value]) => <div key={key} className="min-w-0 bg-white p-4"><p className="text-xs font-bold text-slate-400">{fieldLabel(key)}</p><div className="mt-2 break-words text-sm font-medium leading-7 text-slate-700">{renderValue(value)}</div></div>)}</div></section>
    <section><div className="mb-3 flex items-center justify-between"><div><h2 className="font-black">{detail.type === 'test' || detail.type === 'matchmaking' ? 'پرسش‌ها و پاسخ‌ها' : 'تاریخچه پیام‌ها'}</h2><p className="mt-1 text-xs text-slate-500">{detail.items.length.toLocaleString('fa-IR')} مورد ثبت‌شده</p></div><span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700"><CheckCircle2 size={14}/>ثبت کامل</span></div>
      <div className="space-y-3">{detail.items.map((record, index) => <DetailItem key={index} record={record} index={index} />)}{!detail.items.length && <div className="surface rounded-3xl border bg-white p-10 text-center text-sm text-slate-400">برای این رکورد هنوز جزئیات بیشتری ثبت نشده است.</div>}</div>
    </section>
  </div></CrmShell>;
}
function DetailItem({ record, index }: { record: Record<string, unknown>; index: number }) {
  const role = typeof record.role === 'string' ? record.role : null; const assistant = role === 'assistant'; const question = record.content ?? record.question; const answer = record.answer ?? record.value;
  return <article className={`surface rounded-2xl border bg-white p-4 md:p-5 ${assistant ? 'mr-5 border-blue-100' : role === 'user' ? 'ml-5 border-emerald-100' : ''}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${assistant ? 'bg-blue-50 text-blue-700' : role === 'user' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{assistant ? <Bot size={14}/> : role === 'user' ? <UserRound size={14}/> : <ClipboardCheck size={14}/>} {role ? roleLabel(role) : `سؤال ${(Number(record.position) || index + 1).toLocaleString('fa-IR')}`}</span><span className="text-xs text-slate-400">{display(record.occurred, '')}</span></div>{question !== null && question !== undefined && question !== '' && <p className="mt-4 whitespace-pre-wrap text-sm leading-8 text-slate-700">{display(question, '')}</p>}{answer !== null && answer !== undefined && answer !== '' && <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-700"><span className="ml-2 font-bold text-[#0b6b5b]">پاسخ:</span>{display(answer)}</div>}{record.score !== null && record.score !== undefined && <p className="mt-3 text-xs font-bold text-amber-700">امتیاز: {display(record.score)}</p>}</article>;
}
function fieldLabel(key: string) { return ({ source: 'منبع', name: 'نام کاربر', person: 'کاربر', phone: 'شماره تماس', externalId: 'شناسه پیام‌رسان', anonymousId: 'شناسه ناشناس', province: 'استان', city: 'شهر', gender: 'جنسیت', age: 'سن', education: 'تحصیلات', firstSeen: 'اولین فعالیت', lastSeen: 'آخرین فعالیت', conversations: 'تعداد گفتگوها', messages: 'تعداد پیام‌ها', tests: 'تعداد آزمون‌ها', matchmaking: 'تلاش‌های همسان‌گزینی', session: 'شناسه گفتگو', started: 'شروع گفتگو', lastMessage: 'آخرین پیام', tracking: 'کد پیگیری', scores: 'امتیازها', result: 'نتیجه', analysis: 'تحلیل هوش مصنوعی', completed: 'زمان تکمیل', archetype: 'تیپ شخصیتی', traits: 'ویژگی‌ها', consent: 'رضایت اشتراک‌گذاری' } as Record<string, string>)[key] ?? key; }
function roleLabel(role: string) { return role === 'assistant' ? 'پاسخ هوش مصنوعی' : role === 'user' ? 'پیام کاربر' : 'پیام سیستمی'; }
function renderValue(value: unknown) { if (value === null || value === undefined || value === '') return <span className="text-slate-300">ثبت نشده</span>; if (typeof value === 'boolean') return value ? 'بله' : 'خیر'; if (typeof value === 'object') return <pre dir="ltr" className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs leading-6">{JSON.stringify(value, null, 2)}</pre>; if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return String(value); return display(value); }
function display(value: unknown, fallback = '—'): string { if (value === null || value === undefined || value === '') return fallback; if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value); try { return JSON.stringify(value); } catch { return fallback; } }
function SignIn({ returnTo }: { returnTo: string }) { return <main className="grid min-h-screen place-items-center bg-[#102a35]"><a className="rounded-xl bg-white px-6 py-3 font-bold text-[#0b6b5b]" href={chatGPTSignInPath(returnTo)} target="_top">ورود مدیر</a></main>; }
