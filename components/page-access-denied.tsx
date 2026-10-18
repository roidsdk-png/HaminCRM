import { ShieldX } from 'lucide-react';

export function PageAccessDenied({ management = false }: { management?: boolean }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-center text-foreground" dir="rtl">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-8 shadow-xl">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400">
          <ShieldX size={28} />
        </div>
        <h1 className="mt-4 text-lg font-black">دسترسی شما غیرفعال یا ناکافی است</h1>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          {management ? 'این بخش به نقش مدیر عملیاتی یا مالک ارشد نیاز دارد.' : 'برای مشاهده اطلاعات سامانه باید یک دسترسی فعال داشته باشید.'}
        </p>
        <a href="/login" className="mt-6 inline-block rounded-xl bg-primary px-6 py-2.5 text-xs font-bold text-primary-foreground">ورود با حساب دیگر</a>
      </div>
    </main>
  );
}
