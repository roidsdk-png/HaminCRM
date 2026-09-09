import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { getRecordDetail } from '@/lib/section-data';

export const dynamic = 'force-dynamic';

export default async function DetailPage({ params }: { params: Promise<{ section: string; id: string }> }) {
  const { section, id } = await params;
  if (!['conversations', 'tests', 'matchmaking'].includes(section)) notFound();
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return <main className="grid min-h-screen place-items-center"><a className="rounded-xl bg-[#176b52] px-6 py-3 text-white" href={chatGPTSignInPath(`/${section}/${id}`)} target="_top">ورود مدیر</a></main>;
  }
  const detail = await getRecordDetail(section, id);
  if (!detail?.header) notFound();
  return <main className="min-h-screen p-5 md:p-9"><div className="mx-auto max-w-4xl">
    <Link href={`/${section}`} className="inline-flex items-center gap-2 text-sm font-bold text-[#176b52]"><ArrowRight size={17} />بازگشت</Link>
    <h1 className="mt-6 text-2xl font-bold">جزئیات رکورد</h1>
    <div className="mt-5 grid gap-3 rounded-2xl border bg-white p-5 sm:grid-cols-2">{Object.entries(detail.header).map(([key, value]) => <div key={key} className="rounded-xl bg-[#f6f9f7] p-3"><p className="text-xs text-[#78847f]">{key}</p><p className="mt-1 break-words text-sm">{display(value)}</p></div>)}</div>
    <div className="mt-5 space-y-3">{detail.items.map((record, index) => {
      const position = typeof record.position === 'number' ? record.position : index + 1;
      const heading = typeof record.role === 'string' ? record.role : `سؤال ${position}`;
      const answer = record.answer ?? record.value;
      return <article key={index} className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between text-xs text-[#75817c]"><span>{heading}</span><span>{display(record.occurred, '')}</span></div><p className="mt-3 whitespace-pre-wrap leading-7">{display(record.content ?? record.question, '')}</p>{answer !== null && answer !== undefined && answer !== '' ? <p className="mt-3 rounded-xl bg-[#edf6f2] p-3 text-sm text-[#245b49]">پاسخ: {display(answer)}</p> : null}</article>;
    })}</div>
  </div></main>;
}

function display(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value); } catch { return fallback; }
}
