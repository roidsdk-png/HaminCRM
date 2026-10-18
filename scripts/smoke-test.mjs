const baseUrl = process.env.CRM_TEST_URL ?? 'http://localhost:3000';
const adminPassword = process.env.CRM_TEST_PASSWORD ?? '';

let sessionCookie = '';
if (adminPassword) {
  const login = await fetch(`${baseUrl}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(baseUrl).origin },
    body: JSON.stringify({ password: adminPassword }),
    redirect: 'manual',
  });
  if (!login.ok) {
    console.error(`✗ ورود مدیر برای آزمون صفحات داخلی: ${login.status}`);
    process.exit(1);
  }
  sessionCookie = login.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  if (!sessionCookie) {
    console.error('✗ کوکی نشست مدیر دریافت نشد.');
    process.exit(1);
  }
  console.log('✓ ورود امن مدیر برای آزمون صفحات داخلی');
}

const checks = [
  { name: 'داشبورد', path: '/', expected: 200 },
  { name: 'کاربران', path: '/users', expected: 200 },
  { name: 'گفتگوها', path: '/conversations', expected: 200 },
  { name: 'آزمون‌ها', path: '/tests', expected: 200 },
  { name: 'همسان‌گزینی', path: '/matchmaking', expected: 200 },
  { name: 'گزارش‌ها', path: '/reports', expected: 200 },
  { name: 'منابع', path: '/sources', expected: 200 },
  { name: 'سلامت سامانه', path: '/system', expected: 200 },
  { name: 'دسترسی مدیران', path: '/access', expected: 200 },
  { name: 'سلامت برنامه و دیتابیس', path: '/api/health', expected: 200 },
  { name: 'سلامت API دریافت داده', path: '/api/v1/events', expected: 200 },
  { name: 'رد درخواست بدون کلید', path: '/api/v1/events', expected: 401, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } },
  // در توسعه کاربر محلی واردشده است و بدنه نامعتبر 400 می‌گیرد؛ در محیط
  // عملیاتی درخواست بدون نشست باید پیش از پردازش بدنه با 403 رد شود.
  { name: 'محافظت و اعتبارسنجی بازیابی', path: '/api/admin/restore', expected: [400, 403], init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } },
];

let failed = 0;
for (const { name, path, expected, init } of checks) {
  try {
    const headers = new Headers(init?.headers);
    if (sessionCookie) headers.set('cookie', sessionCookie);
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    const expectedStatuses = Array.isArray(expected) ? expected : [expected];
    const ok = expectedStatuses.includes(response.status);
    console.log(`${ok ? '✓' : '✗'} ${name}: ${response.status}`);
    if (!ok) failed++;
  } catch (error) {
    failed++;
    console.error(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) {
  console.error(`\n${failed} بررسی ناموفق بود.`);
  process.exit(1);
}

console.log('\nهمه بررسی‌های اصلی با موفقیت انجام شدند.');
