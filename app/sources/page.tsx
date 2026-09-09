import { ArrowRight, ShieldCheck } from 'lucide-react';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { getDb } from '@/db';
import { sources } from '@/db/schema';
import { SourceManager } from '@/components/source-manager';

export const dynamic = 'force-dynamic';
export default async function SourcesPage() {
  const user = await getChatGPTUser(); if (!user && process.env.NODE_ENV !== 'development') return <main className="grid min-h-screen place-items-center"><a href={chatGPTSignInPath('/sources')} target="_top" className="rounded-xl bg-[#176b52] px-6 py-3 text-white">ورود مدیر</a></main>;
  let rows: typeof sources.$inferSelect[] = []; try { rows = await getDb().select().from(sources).orderBy(sources.name); } catch { /* local database is not migrated yet */ }
  return <main className="min-h-screen p-5 md:p-9"><div className="mx-auto max-w-5xl"><a href="/" className="inline-flex items-center gap-2 text-sm font-bold text-[#176b52]"><ArrowRight size={17} />بازگشت به داشبورد</a><div className="mt-6 flex items-center gap-3"><ShieldCheck className="text-[#176b52]" /><div><h1 className="text-2xl font-bold">اتصال امن منابع</h1><p className="mt-1 text-sm text-[#6f7c76]">هر ربات یا وب‌اپ یک کلید جدا دارد؛ خود کلید در دیتابیس ذخیره نمی‌شود.</p></div></div><div className="mt-7 space-y-4">{rows.map((row) => <SourceManager key={row.id} source={{ id: row.id, slug: row.slug, name: row.name, kind: row.kind, platform: row.platform, status: row.status, hasKey: Boolean(row.credentialHash), lastSeen: row.lastSeenAt?.toLocaleString('fa-IR') ?? 'هنوز داده‌ای دریافت نشده' }} />)}{!rows.length && <div className="rounded-2xl border bg-white p-8 text-center text-sm text-[#75817c]">ابتدا دیتابیس لوکال راه‌اندازی می‌شود؛ سپس شش منبع اینجا نمایش داده خواهند شد.</div>}</div></div></main>;
}
