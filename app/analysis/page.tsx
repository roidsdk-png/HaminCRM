import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { AnalysisWorkspace } from '@/components/analysis/analysis-workspace';
import { CrmShell } from '@/components/crm-shell';
import { PageAccessDenied } from '@/components/page-access-denied';
import { can, getAdminRole } from '@/lib/admin-access';

export const dynamic = 'force-dynamic';

export default async function AnalysisPage() {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-8 text-center shadow-xl">
          <h1 className="text-xl font-black">تحلیل و هوش مصنوعی</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            برای بررسی داده‌ها و تجربه‌های مخاطبان وارد حساب مدیر شوید.
          </p>
          <a
            href={chatGPTSignInPath('/analysis')}
            target="_top"
            className="mt-6 block rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground"
          >
            ورود مدیر
          </a>
        </div>
      </main>
    );
  }

  const role = await getAdminRole(user);
  if (!can(role, 'read')) return <PageAccessDenied />;

  return (
    <CrmShell
      title="تحلیل و هوش مصنوعی"
      subtitle="تحقیق در داده‌ها، شناخت مخاطب و تولید محتوا از تجربه‌های مستند"
    >
      <AnalysisWorkspace
        canManage={can(role, 'manage')}
        canConfigure={can(role, 'owner')}
      />
    </CrmShell>
  );
}
