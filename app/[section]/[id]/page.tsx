import {
  ArrowRight,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileQuestion,
  HeartHandshake,
  MapPin,
  MessageSquare,
  MessageSquareText,
  Phone,
  Sparkles,
  User,
  UserRound,
  XCircle,
} from 'lucide-react';
import { notFound } from 'next/navigation';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import { can, getAdminRole } from '@/lib/admin-access';
import { PageAccessDenied } from '@/components/page-access-denied';
import { getRecordDetail } from '@/lib/section-data';
import { CrmShell } from '@/components/crm-shell';

export const dynamic = 'force-dynamic';

const fa = new Intl.NumberFormat('fa-IR');

function toStr(val: unknown, fallback = ''): string {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') return val.toString();
  try {
    return JSON.stringify(val);
  } catch {
    return fallback;
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (entity, code: string) => decodeCodePoint(entity, code, 16))
    .replace(/&#(\d+);/g, (entity, code: string) => decodeCodePoint(entity, code, 10))
    .replace(/&([a-z]+);/gi, (entity, name: string) => named[name.toLowerCase()] ?? entity);
}

function decodeCodePoint(entity: string, code: string, radix: number): string {
  const value = Number.parseInt(code, radix);
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : entity;
}

function analysisParagraphs(value: unknown): string[] {
  const decoded = decodeHtmlEntities(toStr(value));
  const plain = decoded
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h[1-6]|li)\s*>/gi, '\n\n')
    .replace(/<\s*li(?:\s[^>]*)?>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/\*\*/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return plain ? plain.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean) : [];
}

const fieldLabels: Record<string, string> = {
  e: 'برون‌گرایی',
  c: 'وظیفه‌شناسی',
  m: 'مدیریت هیجان',
  a: 'توافق‌پذیری',
  total: 'نمره کل',
  ga: 'اضطراب عمومی',
  ph: 'نشانه‌های جسمانی',
  gad: 'نگرانی فراگیر',
  ocd: 'افکار وسواسی',
  body: 'علائم جسمانی',
  mind: 'علائم شناختی',
  behavior: 'علائم رفتاری',
  overall: 'نتیجه کلی',
  levels: 'سطح ابعاد',
  emotional: 'بلوغ و آمادگی هیجانی',
  respect: 'احترام و نگاه برابر',
  realism: 'واقع‌بینی در انتخاب',
  depth: 'عمق شناخت و گفت‌وگو',
  partnership: 'نگاه مشارکتی به رابطه',
  self_awareness: 'خودآگاهی',
  self_worth: 'ارزشمندی و اعتماد به خود',
  boundaries: 'مرزبندی سالم',
  relational: 'مهارت رابطه و گفت‌وگو',
  agency: 'استقلال و عاملیت فردی',
  archetypeId: 'شناسه الگوی نتیجه',
  archetypeTitle: 'عنوان الگوی نتیجه',
  dimensionDetails: 'توضیحات ابعاد',
  schemaVersion: 'نسخه پرسش‌نامه',
  contactInfo: 'اطلاعات تماس ثبت‌شده',
  userNotes: 'یادداشت شرکت‌کننده',
};

const genderLabels: Record<string, string> = {
  male: 'مرد', female: 'زن', other: 'ترجیح می‌دهم نگویم',
};

const educationLabels: Record<string, string> = {
  under_diploma: 'زیر دیپلم', diploma: 'دیپلم', associate: 'فوق دیپلم',
  bachelor: 'کارشناسی', master: 'کارشناسی ارشد', phd: 'دکتری', hausa: 'علوم حوزوی',
};

const sectionMeta = {
  users: {
    title: 'پرونده یکپارچه کاربر',
    listName: 'کاربران',
    listPath: '/users',
    icon: UserRound,
  },
  conversations: {
    title: 'جزئیات نشست گفتگو',
    listName: 'گفتگوها',
    listPath: '/conversations',
    icon: MessageSquareText,
  },
  tests: {
    title: 'کارنامه و تحلیل آزمون',
    listName: 'آزمون‌ها',
    listPath: '/tests',
    icon: FileCheck2,
  },
  matchmaking: {
    title: 'پرونده همسان‌گزینی',
    listName: 'همسان‌گزینی',
    listPath: '/matchmaking',
    icon: HeartHandshake,
  },
} as const;

export default async function DetailPage({
  params,
}: {
  params: Promise<{ section: string; id: string }>;
}) {
  const { section, id } = await params;
  const meta = sectionMeta[section as keyof typeof sectionMeta];
  if (!meta) notFound();

  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== 'development') {
    return <SignIn returnTo={`/${section}/${id}`} />;
  }
  if (!can(await getAdminRole(user), 'read')) return <PageAccessDenied />;

  const detail = await getRecordDetail(section, id);
  if (!detail || !detail.header) notFound();

  const header = detail.header;
  const items = detail.items;
  const Icon = meta.icon;
  const matchmakingProfile = detail.type === 'matchmaking' ? toRecord(header.profile) : {};
  const matchValue = (key: string) => matchmakingProfile[key] ?? header[key];
  const matchUserId = header.externalId ?? matchmakingProfile.userId ?? matchmakingProfile.baleId ?? header.profileId;
  const matchGender = genderLabels[toStr(matchValue('gender')).toLowerCase()] ?? matchValue('gender');
  const userGender = genderLabels[toStr(header.gender).toLowerCase()] ?? header.gender;
  const userEducation = educationLabels[toStr(header.education).toLowerCase()] ?? header.education;
  const userKind = toStr(header.sourceKind);
  const relatedConversations = relatedRecords(detail, 'conversations');
  const relatedTests = relatedRecords(detail, 'tests');
  const relatedMatches = relatedRecords(detail, 'matches');
  const userAge = Number(header.age);
  const questionableAge = Boolean(header.age) && (!Number.isFinite(userAge) || userAge < 10 || userAge > 120);
  const questionablePhone = Boolean(header.phone) && !isLikelyPhone(toStr(header.phone));

  return (
    <CrmShell title={meta.title} subtitle="مشاهده پرونده تفصیلی ثبت‌شده در سامانه">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        {/* Navigation Breadcrumb */}
        <div>
          <a
            href={meta.listPath}
            className="inline-flex items-center gap-2 rounded-xl bg-card border border-border px-3.5 py-2 text-xs font-bold text-foreground shadow-2xs transition hover:bg-muted hover:text-primary"
          >
            <ArrowRight size={15} />
            <span>بازگشت به {meta.listName}</span>
          </a>
        </div>

        {/* ============================================================ */}
        {/* CONVERSATION VIEW                                            */}
        {/* ============================================================ */}
        {detail.type === 'conversation' && (
          <div className="space-y-6">
            {/* Conversation Header Card */}
            <section className="overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
              <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    <MessageSquare size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-lg font-black text-foreground">نشست گفتگو</h1>
                      <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
                        منبع: {toStr(header.source, 'نامشخص')}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">
                      Session ID: {toStr(header.session, id)}
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">
                      User ID: {toStr(header.userIdentity, 'نامشخص')}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="rounded-2xl bg-muted border border-border px-4 py-2.5 text-center">
                    <p className="text-xs text-muted-foreground">تعداد پیام‌ها</p>
                    <p className="mt-0.5 text-base font-black text-foreground">
                      {fa.format(Number(header.messages) || items.length)}
                    </p>
                  </div>
                  {Boolean(header.started) && (
                    <div className="rounded-2xl bg-muted border border-border px-4 py-2.5 text-center">
                      <p className="text-xs text-muted-foreground">شروع گفتگو</p>
                      <p className="mt-0.5 text-xs font-bold text-foreground">
                        {toStr(header.started)}
                      </p>
                    </div>
                  )}
                  {Boolean(header.lastMessage) && (
                    <div className="rounded-2xl bg-muted border border-border px-4 py-2.5 text-center">
                      <p className="text-xs text-muted-foreground">آخرین پیام</p>
                      <p className="mt-0.5 text-xs font-bold text-foreground">
                        {toStr(header.lastMessage)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Chat Messages Timeline View */}
            <section className="overflow-hidden rounded-3xl border border-border bg-card p-5 md:p-8 shadow-xs transition-colors duration-300">
              <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Clock size={16} />
                  </span>
                  <div>
                    <h2 className="text-sm font-black text-foreground">متن پیام‌های گفتگو</h2>
                    <p className="text-[11px] text-muted-foreground">
                      به ترتیب زمانی از آغاز تا آخرین پیام
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
                  {fa.format(items.length)} پیام ثبت‌شده
                </span>
              </div>

              <div className="space-y-4">
                {items.map((msg, index) => {
                  const isAssistant = msg.role === 'assistant';
                  const isUser = msg.role === 'user';
                  const content = toStr(msg.content);
                  const occurred = toStr(msg.occurred);
                  const model = msg.model ? toStr(msg.model) : null;

                  return (
                    <div
                      key={index}
                      className={`flex flex-col ${
                        isUser ? 'items-end' : 'items-start'
                      }`}
                    >
                      {/* Sender Header Tag */}
                      <div className="mb-1.5 flex items-center gap-2 px-2 text-[11px] text-muted-foreground">
                        {isUser ? (
                          <>
                            <span>{occurred}</span>
                            <span className="font-bold text-primary">کاربر</span>
                            <User size={13} className="text-primary" />
                          </>
                        ) : (
                          <>
                            <Bot size={13} className="text-blue-500" />
                            <span className="font-bold text-blue-500">هوش مصنوعی</span>
                            {model && (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground border border-border">
                                {model}
                              </span>
                            )}
                            <span>{occurred}</span>
                          </>
                        )}
                      </div>

                      {/* Message Bubble */}
                      <div
                        className={`max-w-2xl rounded-2xl p-4 text-xs md:text-sm leading-7 shadow-2xs ${
                          isUser
                            ? 'rounded-tr-xs bg-primary text-primary-foreground font-medium'
                            : isAssistant
                            ? 'rounded-tl-xs bg-muted border border-border text-foreground'
                            : 'rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{content}</p>
                      </div>
                    </div>
                  );
                })}

                {!items.length && (
                  <div className="py-12 text-center text-xs text-muted-foreground">
                    هنوز پیامی برای این گفتگو در سامانه ذخیره نشده است.
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* ============================================================ */}
        {/* PSYCHOLOGICAL TEST VIEW                                      */}
        {/* ============================================================ */}
        {detail.type === 'test' && (
          <div className="space-y-6">
            {/* Test Header & Tracking Card */}
            <section className="overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
              <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    <FileCheck2 size={24} />
                  </div>
                  <div>
                    <h1 className="text-lg font-black text-foreground">
                      کارنامه آزمون: {toStr(header.source, 'آزمون روانشناسی')}
                    </h1>
                    <p className="mt-1 text-xs text-muted-foreground">
                      شرکت‌کننده: <span className="font-bold text-foreground">{toStr(header.person, 'بدون نام')}</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {Boolean(header.tracking) && header.tracking !== '—' && (
                    <div className="flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/10 px-4 py-2.5">
                      <div>
                        <p className="text-[10px] font-bold text-primary">کد پیگیری آزمون</p>
                        <p className="font-mono text-xs font-black text-foreground" dir="ltr">
                          {toStr(header.tracking)}
                        </p>
                      </div>
                    </div>
                  )}
                  {Boolean(header.completed) && (
                    <div className="rounded-2xl bg-muted border border-border px-4 py-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground">زمان تکمیل</p>
                      <p className="mt-0.5 text-xs font-bold text-foreground">
                        {toStr(header.completed)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Participant registration data */}
            {renderTestProfile(header)}

            {/* AI Clinical Analysis Card */}
            {Boolean(header.analysis) && (
              <section className="relative overflow-hidden rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-card to-purple-500/10 p-6 md:p-8 shadow-xs transition-colors duration-300">
                <div className="mb-4 flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-600 text-white shadow-xs">
                    <Sparkles size={18} />
                  </span>
                  <div>
                    <h2 className="text-base font-black text-foreground">
                      تحلیل بالینی و تفسیر هوش مصنوعی
                    </h2>
                    <p className="text-xs text-indigo-500 dark:text-indigo-400">
                      بررسی تخصصی الگوهای پاسخ شرکت‌کننده
                    </p>
                  </div>
                </div>
                <div className="space-y-4 rounded-2xl bg-card border border-border p-5 md:p-6 text-sm leading-8 text-foreground shadow-2xs" dir="rtl">
                  {analysisParagraphs(header.analysis).map((paragraph, index) => (
                    <p key={index} className="text-justify leading-8">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            )}

            {/* Result & Scores Summary (if present) */}
            {Boolean(header.scores || header.result) && (
              <section className="rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
                <h2 className="text-sm font-black text-foreground">نمرات و ابعاد آزمون</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {renderScores(header.scores, header.result)}
                </div>
              </section>
            )}

            {/* Answers Breakdown */}
            <section className="rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
              <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
                <div className="flex items-center gap-2">
                  <FileQuestion size={18} className="text-primary" />
                  <h2 className="text-sm font-black text-foreground">پرسش‌ها و پاسخ‌های انتخاب‌شده</h2>
                </div>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
                  {fa.format(items.length)} پاسخ ثبت‌شده
                </span>
              </div>

              <div className="space-y-3">
                {items.map((item, index) => {
                  const position = Number(item.position) || index + 1;
                  const question = toStr(item.question);
                  const answer = toStr(item.answer ?? item.value);
                  const score = item.score !== null && item.score !== undefined ? toStr(item.score) : null;

                  return (
                    <article
                      key={index}
                      className="rounded-2xl border border-border bg-muted/30 p-4 transition hover:bg-card hover:border-primary/40 hover:shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary text-xs font-bold mt-0.5">
                            {fa.format(position)}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs md:text-sm font-bold text-foreground leading-6">
                              {question}
                            </p>
                            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                              <span className="text-[11px] font-medium text-muted-foreground">پاسخ:</span>
                              <span className="rounded-lg bg-card border border-border px-3 py-1 text-xs font-bold text-primary shadow-2xs">
                                {answer}
                              </span>
                            </div>
                          </div>
                        </div>
                        {score && (
                          <span className="shrink-0 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                            امتیاز: {score}
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* ============================================================ */}
        {/* MATCHMAKING VIEW                                             */}
        {/* ============================================================ */}
        {detail.type === 'matchmaking' && (
          <div className="space-y-6">
            {/* Archetype Emblem Card */}
            <section className="overflow-hidden rounded-3xl border border-rose-500/20 bg-gradient-to-br from-rose-500/10 via-card to-pink-500/10 p-6 md:p-8 shadow-xs transition-colors duration-300">
              <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-rose-500 text-white shadow-md">
                    <HeartHandshake size={28} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h1 className="text-xl font-black text-foreground">
                        {toStr(header.person, 'متقاضی ناشناس')}
                      </h1>
                      {Boolean(header.archetype) && header.archetype !== '—' && (
                        <span className="rounded-full bg-rose-500/10 border border-rose-500/20 px-3 py-1 text-xs font-black text-rose-600 dark:text-rose-400">
                          {toStr(header.archetype)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      محل سکونت: <span className="font-bold text-foreground">{toStr(matchValue('province') ?? matchValue('city'), 'ثبت نشده')}</span> ·
                      جنسیت: <span className="font-bold text-foreground">{toStr(matchGender, 'ثبت نشده')}</span> ·
                      سن: <span className="font-bold text-foreground">{toStr(matchValue('age'), 'ثبت نشده')}</span>
                    </p>
                  </div>
                </div>

                {/* Consent Badge */}
                <div className="flex flex-wrap items-center gap-2">
                  {Boolean(matchUserId) && (
                    <span className="rounded-2xl border border-border bg-card/80 px-4 py-2 text-xs shadow-2xs">
                      <span className="text-muted-foreground">شناسه کاربر: </span>
                      <b dir="ltr" className="font-mono text-foreground">{toStr(matchUserId)}</b>
                    </span>
                  )}
                  {header.consent ? (
                    <span className="inline-flex items-center gap-1.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 shadow-2xs">
                      <CheckCircle2 size={16} className="text-emerald-500" />
                      رضایت برای معرفی ثبت شده است
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 px-4 py-2.5 text-xs font-bold text-amber-600 dark:text-amber-400 shadow-2xs">
                      <XCircle size={16} className="text-amber-500" />
                      عدم اعلام رضایت برای معرفی
                    </span>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-border bg-card p-5 md:p-6 shadow-xs transition-colors duration-300">
              <div className="flex flex-col gap-2 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-black text-foreground">مشخصات ثبت‌شده متقاضی</h2>
                  <p className="mt-1 text-xs text-muted-foreground">اطلاعات هویتی و زمان ثبت فرم ازدواج</p>
                </div>
                <span className="w-fit rounded-full bg-rose-500/10 px-3 py-1 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                  نوبت ثبت: {fa.format(Number(header.attemptNumber) || 1)}
                </span>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <MetaItem label="شناسه کاربر" value={matchUserId} ltr />
                <MetaItem label="شناسه بله" value={matchmakingProfile.baleId} ltr />
                <MetaItem label="کد شرکت‌کننده" value={matchmakingProfile.participantCode} ltr />
                <MetaItem label="شماره تماس" value={matchValue('phone')} ltr />
                <MetaItem label="استان" value={matchValue('province')} />
                <MetaItem label="شهر محل سکونت" value={matchValue('city')} />
                <MetaItem label="جنسیت" value={matchGender} />
                <MetaItem label="سن" value={matchValue('age')} />
                <MetaItem label="تحصیلات" value={educationLabels[toStr(matchValue('education')).toLowerCase()] ?? matchValue('education')} />
                <MetaItem label="تیپ شخصیتی" value={header.archetype} />
                <MetaItem label="زمان تکمیل فرم" value={header.completed} />
                <MetaItem label="شناسه پرونده منبع" value={header.profileId} ltr />
              </div>
            </section>

            {/* Traits Breakdown */}
            {Object.keys(toRecord(header.traits)).length > 0 && (
              <section className="rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
                <h2 className="text-sm font-black text-foreground">ویژگی‌ها و ابعاد ارزیابی همسان‌گزینی</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {renderTraits(header.traits)}
                </div>
              </section>
            )}

            {/* Answers Breakdown */}
            <section className="rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
              <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
                <h2 className="text-sm font-black text-foreground">پاسخ‌های پرسشنامه همسان‌گزینی</h2>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
                  {fa.format(items.length)} پاسخ ثبت‌شده
                </span>
              </div>

              <div className="space-y-3">
                {items.map((item, index) => {
                  const position = Number(item.position) || index + 1;
                  const question = toStr(item.question);
                  const answer = toStr(item.answer ?? item.value);

                  return (
                    <article
                      key={index}
                      className="rounded-2xl border border-border bg-muted/30 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-bold mt-0.5">
                          {fa.format(position)}
                        </span>
                        <div>
                          <p className="text-xs md:text-sm font-bold text-foreground leading-6">
                            {question}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground font-medium">پاسخ ثبت‌شده:</span>
                            <span className="rounded-lg bg-card border border-border px-3 py-1 text-xs font-bold text-rose-600 dark:text-rose-400 shadow-2xs">
                              {answer}
                            </span>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* ============================================================ */}
        {/* USER DOSSIER VIEW                                            */}
        {/* ============================================================ */}
        {detail.type === 'user' && (
          <div className="space-y-6">
            {/* User Profile Dossier Card */}
            <section className="overflow-hidden rounded-3xl border border-border bg-card p-6 md:p-8 shadow-xs transition-colors duration-300">
              <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
                <div className="flex items-center gap-4">
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground font-black text-2xl shadow-md">
                    {toStr(header.name, 'ک').charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h1 className="text-xl font-black text-foreground">
                        {toStr(header.name, 'کاربر ناشناس')}
                      </h1>
                      <span className="rounded-full bg-primary/10 border border-primary/20 px-3 py-0.5 text-xs font-bold text-primary">
                        منبع: {toStr(header.source, 'نامشخص')}
                      </span>
                      <span className="rounded-full bg-muted border border-border px-3 py-0.5 text-xs font-bold text-muted-foreground">
                        {sourceKindLabels[userKind] ?? userKind} · {platformLabels[toStr(header.platform)] ?? toStr(header.platform)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      {Boolean(header.phone) && !questionablePhone && (
                        <span className="flex items-center gap-1.5">
                          <Phone size={14} className="text-primary" />
                          <span dir="ltr" className="font-mono font-bold text-foreground">
                            {toStr(header.phone)}
                          </span>
                        </span>
                      )}
                      {Boolean(header.city) && (
                        <span className="flex items-center gap-1.5">
                          <MapPin size={14} className="text-primary" />
                          <span>{toStr(header.city)}</span>
                        </span>
                      )}
                      {Boolean(header.lastSeen) && (
                        <span className="flex items-center gap-1.5">
                          <Clock size={14} className="text-primary" />
                          <span>آخرین فعالیت: {toStr(header.lastSeen)}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Identity Badges */}
                <div className="flex flex-wrap gap-2 text-xs">
                  {Boolean(header.externalId) && (
                    <div className="rounded-xl bg-muted border border-border px-3 py-2">
                      <p className="text-[10px] text-muted-foreground font-medium">شناسه پیام‌رسان</p>
                      <p className="font-mono font-bold text-foreground mt-0.5" dir="ltr">
                        {toStr(header.externalId)}
                      </p>
                    </div>
                  )}
                  {Boolean(header.anonymousId) && (
                    <div className="rounded-xl bg-muted border border-border px-3 py-2">
                      <p className="text-[10px] text-muted-foreground font-medium">شناسه ناشناس</p>
                      <p className="font-mono font-bold text-foreground mt-0.5" dir="ltr">
                        {toStr(header.anonymousId)}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* KPI Activity Counters */}
              <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-6 sm:grid-cols-4">
                <div className="rounded-2xl bg-muted p-3 text-center">
                  <p className="text-xs text-muted-foreground">گفتگوها</p>
                  <p className="mt-1 text-lg font-black text-foreground">
                    {fa.format(Number(header.conversations) || 0)}
                  </p>
                </div>
                <div className="rounded-2xl bg-muted p-3 text-center">
                  <p className="text-xs text-muted-foreground">پیام‌ها</p>
                  <p className="mt-1 text-lg font-black text-foreground">
                    {fa.format(Number(header.messages) || 0)}
                  </p>
                </div>
                <div className="rounded-2xl bg-muted p-3 text-center">
                  <p className="text-xs text-muted-foreground">آزمون‌ها</p>
                  <p className="mt-1 text-lg font-black text-foreground">
                    {fa.format(Number(header.tests) || 0)}
                  </p>
                </div>
                <div className="rounded-2xl bg-muted p-3 text-center">
                  <p className="text-xs text-muted-foreground">همسان‌گزینی</p>
                  <p className="mt-1 text-lg font-black text-foreground">
                    {fa.format(Number(header.matchmaking) || 0)}
                  </p>
                </div>
              </div>
            </section>

            {(questionableAge || questionablePhone) && (
              <section className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-amber-700 dark:text-amber-300">
                <AlertTriangle size={19} className="mt-0.5 shrink-0" />
                <div>
                  <h2 className="text-sm font-black">برخی اطلاعات نیازمند بررسی هستند</h2>
                  <p className="mt-1 text-xs leading-6">
                    {questionableAge && 'سن واردشده خارج از بازه معمول است. '}
                    {questionablePhone && 'مقدار شماره تماس ساختار معتبر شماره تلفن ندارد. '}
                    مقادیر بدون تغییر و دقیقاً مطابق ورودی کاربر نمایش داده شده‌اند.
                  </p>
                </div>
              </section>
            )}

            {/* Demographics & Metadata Grid */}
            <section className="rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
              <h2 className="text-sm font-black text-foreground">مشخصات هویتی و ثبت‌شده</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <MetaItem label="شناسه پیام‌رسان" value={header.externalId} ltr />
                <MetaItem label="شناسه ناشناس" value={header.anonymousId} ltr />
                <MetaItem label="شماره تماس" value={header.phone} ltr />
                <MetaItem label="استان" value={header.province} />
                <MetaItem label="شهر" value={header.city} />
                <MetaItem label="جنسیت" value={userGender} />
                <MetaItem label="سن" value={header.age} />
                <MetaItem label="تحصیلات" value={userEducation} />
                <MetaItem label="اولین ثبت فعالیت" value={header.firstSeen} />
                <MetaItem label="آخرین فعالیت" value={header.lastSeen} />
              </div>
            </section>

            {relatedConversations.length > 0 && (
              <RelatedRecords
                title="گفتگوهای این کاربر"
                icon="chat"
                records={relatedConversations.map((record) => ({
                  href: `/conversations/${toStr(record.id)}`,
                  title: `گفتگو ${toStr(record.session, 'بدون شناسه')}`,
                  description: `${fa.format(Number(record.messageCount) || 0)} پیام · آخرین تعامل: ${toStr(record.activity, 'ثبت نشده')}`,
                }))}
              />
            )}

            {relatedTests.length > 0 && (
              <RelatedRecords
                title="آزمون‌های انجام‌شده این کاربر"
                icon="test"
                records={relatedTests.map((record) => ({
                  href: `/tests/${toStr(record.id)}`,
                  title: toStr(record.test, 'آزمون'),
                  description: `کد پیگیری: ${toStr(record.tracking, 'ثبت نشده')} · تکمیل: ${toStr(record.completed, 'ثبت نشده')}`,
                }))}
              />
            )}

            {relatedMatches.length > 0 && (
              <RelatedRecords
                title="فرم کی مناسب ازدواجه این کاربر"
                icon="match"
                records={relatedMatches.map((record) => ({
                  href: `/matchmaking/${toStr(record.id)}`,
                  title: `تیپ شخصیتی: ${toStr(record.archetype, 'ثبت نشده')}`,
                  description: `${toStr(record.status, 'نامشخص')} · تکمیل: ${toStr(record.completed, 'ثبت نشده')}`,
                }))}
              />
            )}

            {/* User Messages History */}
            {items.length > 0 && <section className="rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
              <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
                <h2 className="text-sm font-black text-foreground">آخرین تعاملات و پیام‌های کاربر</h2>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">
                  {fa.format(items.length)} تعامل ثبت‌شده
                </span>
              </div>

              <div className="space-y-3">
                {items.map((item, index) => {
                  const role = typeof item.role === 'string' ? item.role : 'user';
                  const content = toStr(item.content);
                  const occurred = toStr(item.occurred);

                  return (
                    <article
                      key={index}
                      className="rounded-2xl border border-border bg-muted/30 p-4 transition hover:bg-card hover:border-border"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          role === 'user'
                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            : 'bg-primary/10 text-primary'
                        }`}>
                          {role === 'user' ? <User size={12} /> : <Bot size={12} />}
                          {role === 'user' ? 'پیام کاربر' : 'پاسخ هوش مصنوعی'}
                        </span>
                        <span>{occurred}</span>
                      </div>
                      <p className="text-xs md:text-sm font-normal leading-7 text-foreground whitespace-pre-wrap">
                        {content}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>}

            {!items.length && !relatedConversations.length && !relatedTests.length && !relatedMatches.length && (
              <section className="rounded-3xl border border-border bg-card p-10 text-center shadow-xs">
                <UserRound className="mx-auto text-muted-foreground" size={30} />
                <h2 className="mt-3 text-sm font-black text-foreground">هنوز فعالیت مرتبطی ثبت نشده است</h2>
                <p className="mt-1 text-xs text-muted-foreground">اطلاعات هویتی دریافت شده، اما گفتگو، آزمون یا فرم تکمیل‌شده‌ای به این پرونده متصل نیست.</p>
              </section>
            )}
          </div>
        )}

        {/* Fallback for any other section */}
        {detail.type !== 'conversation' &&
          detail.type !== 'test' &&
          detail.type !== 'matchmaking' &&
          detail.type !== 'user' && (
            <section className="rounded-3xl border border-border bg-card p-6 shadow-xs transition-colors duration-300">
              <div className="flex items-center gap-3 border-b border-border pb-4">
                <Icon size={20} className="text-primary" />
                <h2 className="font-black text-foreground">{meta.title}</h2>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(header).map(([k, v]) => (
                  <MetaItem key={k} label={k} value={v} />
                ))}
              </div>
            </section>
          )}
      </div>
    </CrmShell>
  );
}

const sourceKindLabels: Record<string, string> = {
  chatbot: 'کاربر چت‌بات', test: 'شرکت‌کننده آزمون', matchmaking: 'متقاضی ازدواج',
};

const platformLabels: Record<string, string> = {
  bale: 'بله', eitaa: 'ایتا', web: 'وب‌اپ',
};

function relatedRecords(detail: unknown, key: string): Record<string, unknown>[] {
  if (!detail || typeof detail !== 'object') return [];
  const value = (detail as Record<string, unknown>)[key];
  return Array.isArray(value) ? value as Record<string, unknown>[] : [];
}

function isLikelyPhone(value: string): boolean {
  const normalized = value.replace(/[\s()-]/g, '');
  return /^\+?\d{7,15}$/.test(normalized);
}

function RelatedRecords({
  title,
  icon,
  records,
}: {
  title: string;
  icon: 'chat' | 'test' | 'match';
  records: { href: string; title: string; description: string }[];
}) {
  const RelatedIcon = icon === 'chat' ? MessageSquareText : icon === 'test' ? FileCheck2 : HeartHandshake;
  return (
    <section className="rounded-3xl border border-border bg-card p-5 md:p-6 shadow-xs transition-colors duration-300">
      <div className="mb-4 flex items-center justify-between border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><RelatedIcon size={18} /></span>
          <h2 className="text-sm font-black text-foreground">{title}</h2>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-bold text-muted-foreground">{fa.format(records.length)} مورد</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {records.map((record) => (
          <a key={record.href} href={record.href} className="group rounded-2xl border border-border bg-muted/30 p-4 transition hover:border-primary/30 hover:bg-primary/5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-foreground group-hover:text-primary">{record.title}</p>
                <p className="mt-1.5 text-xs leading-6 text-muted-foreground">{record.description}</p>
              </div>
              <ArrowRight className="shrink-0 rotate-180 text-muted-foreground group-hover:text-primary" size={17} />
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function MetaItem({ label, value, ltr = false }: { label: string; value: unknown; ltr?: boolean }) {
  const displayVal = toStr(value, 'ثبت نشده');
  const isRegistered = displayVal !== 'ثبت نشده';

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-3.5">
      <p className="text-[11px] font-bold text-muted-foreground">{label}</p>
      <p dir={ltr ? 'ltr' : undefined} className={`mt-1 text-xs md:text-sm font-bold truncate ${
        isRegistered ? 'text-foreground' : 'text-muted-foreground/50 font-normal'
      }`}>
        {displayVal}
      </p>
    </div>
  );
}

function renderTestProfile(header: Record<string, unknown>) {
  const profile = toRecord(header.profile);
  const metadata = toRecord(profile.metadata);
  const value = (key: string) => profile[key] ?? header[key];
  const isHonaz = toStr(header.testKey) === 'honaz-test';
  const defaultFields = [
    { key: 'name', label: 'نام و نام خانوادگی', value: value('name') ?? header.person, optional: true },
    { key: 'phone', label: 'شماره تماس', value: value('phone'), optional: true, ltr: true },
    { key: 'province', label: 'استان محل سکونت', value: value('province') ?? value('city'), optional: false },
    { key: 'gender', label: 'جنسیت', value: genderLabels[toStr(value('gender'))] ?? value('gender'), optional: false },
    { key: 'age', label: 'سن', value: value('age') ? `${toStr(value('age'))} سال` : '', optional: false },
    { key: 'education', label: 'میزان تحصیلات', value: educationLabels[toStr(value('education'))] ?? value('education'), optional: false },
  ];
  const fields = isHonaz ? [
    { key: 'gender', label: 'نسخه انتخاب‌شده آزمون', value: genderLabels[toStr(value('gender'))] ?? value('gender'), optional: false },
    { key: 'phone', label: 'شماره تماس', value: value('phone'), optional: true, ltr: true },
    { key: 'contactInfo', label: 'اطلاعات تماس ثبت‌شده', value: metadata.contactInfo, optional: true },
    { key: 'userNotes', label: 'یادداشت شرکت‌کننده', value: metadata.userNotes, optional: true },
    { key: 'sourceSubmissionId', label: 'شناسه ثبت در آزمون', value: metadata.sourceSubmissionId, optional: false, ltr: true },
    { key: 'ipHash', label: 'شناسه ناشناس مراجعه‌کننده', value: toStr(value('ipHash')).slice(0, 16), optional: false, ltr: true },
  ] : defaultFields;

  return (
    <section className="rounded-3xl border border-border bg-card p-5 md:p-6 shadow-xs transition-colors duration-300">
      <div className="flex flex-col gap-2 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-black text-foreground">اطلاعات اولیه شرکت‌کننده</h2>
          <p className="mt-1 text-xs text-muted-foreground">تمام اطلاعات واردشده پیش از شروع آزمون</p>
        </div>
        <span className="w-fit rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
          {isHonaz ? 'اطلاعات ثبت‌شده آزمون هوناز' : 'اطلاعات ثبت‌نام آزمون'}
        </span>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => {
          const display = toStr(field.value, 'ثبت نشده');
          const missing = display === 'ثبت نشده';
          return (
            <div key={field.key} className="rounded-2xl border border-border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-bold text-muted-foreground">{field.label}</p>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${field.optional ? 'bg-slate-500/10 text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                  {field.optional ? 'اختیاری' : 'اجباری'}
                </span>
              </div>
              <p
                className={`mt-2 min-h-6 text-sm font-bold ${missing ? 'text-muted-foreground italic' : 'text-foreground'}`}
                dir={field.ltr ? 'ltr' : undefined}
              >
                {display}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function renderScores(scores: unknown, result: unknown) {
  const scoreRecord = toRecord(scores);
  const resultRecord = toRecord(result);
  const levels = toRecord(resultRecord.levels);
  const overall = resultRecord.overall;
  const scoreEntries = Object.entries(scoreRecord);

  if (scoreEntries.length || Object.keys(resultRecord).length) {
    return (
      <>
        {overall !== undefined && overall !== null && overall !== '' && (
          <div className="col-span-full rounded-2xl border border-primary/20 bg-primary/10 p-4">
            <p className="text-[11px] font-bold text-primary">نتیجه کلی آزمون</p>
            <p className="mt-1.5 text-sm font-black leading-7 text-foreground">
              {formatStructuredValue(overall)}
            </p>
          </div>
        )}

        {scoreEntries.map(([dimension, score]) => (
          <div key={dimension} className="rounded-2xl border border-border bg-muted/30 p-4">
            <p className="text-[11px] font-bold text-muted-foreground">
              {fieldLabels[dimension] ?? dimension}
            </p>
            <div className="mt-2 flex items-end justify-between gap-3">
              <span className="text-xl font-black text-primary">{formatStructuredValue(score)}</span>
              {levels[dimension] !== undefined && (
                <span className="rounded-full bg-card px-2.5 py-1 text-[10px] font-bold text-foreground border border-border">
                  {formatStructuredValue(levels[dimension])}
                </span>
              )}
            </div>
          </div>
        ))}

        {Object.entries(resultRecord)
          .filter(([key]) => key !== 'overall' && key !== 'levels')
          .map(([key, value]) => (
            <div key={key} className="rounded-2xl border border-border bg-muted/30 p-4">
              <p className="text-[11px] font-bold text-muted-foreground">{fieldLabels[key] ?? key}</p>
              <p className="mt-2 text-sm font-black leading-7 text-foreground">{formatStructuredValue(value)}</p>
            </div>
          ))}
      </>
    );
  }

  return (
    <p className="text-xs text-muted-foreground col-span-full">
      امتیاز تفکیکی برای این آزمون ثبت نشده است.
    </p>
  );
}

function formatStructuredValue(value: unknown): string {
  if (typeof value === 'number') return fa.format(value);
  if (typeof value === 'boolean') return value ? 'بله' : 'خیر';
  if (Array.isArray(value)) return value.map(formatStructuredValue).join('، ');
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${fieldLabels[key] ?? key}: ${formatStructuredValue(nested)}`)
      .join('، ');
  }
  return toStr(value, 'ثبت نشده');
}

function renderTraits(traits: unknown) {
  const parsedTraits = toRecord(traits);
  if (Object.keys(parsedTraits).length) {
    return Object.entries(parsedTraits).map(([trait, val]) => (
      <div key={trait} className="rounded-2xl border border-border bg-muted/50 p-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-foreground">{trait}</span>
          <span className="font-black text-rose-600 dark:text-rose-400">{toStr(val)}</span>
        </div>
      </div>
    ));
  }

  return (
    <p className="text-xs text-muted-foreground col-span-full">
      ویژگی خاصی ذخیره نشده است.
    </p>
  );
}

function SignIn({ returnTo }: { returnTo: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm rounded-3xl bg-card p-8 text-center shadow-xl border border-border">
        <h1 className="text-xl font-black text-foreground">ورود مدیر سامانه</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          برای مشاهده این پرونده لطفا وارد حساب مدیر شوید.
        </p>
        <a
          href={chatGPTSignInPath(returnTo)}
          target="_top"
          className="mt-6 block rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-md transition hover:bg-primary/90"
        >
          ورود به سامانه
        </a>
      </div>
    </main>
  );
}
