const baseUrl = process.env.CRM_TEST_URL ?? 'http://localhost:3000';

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
  { name: 'سلامت API دریافت داده', path: '/api/v1/events', expected: 200 },
  { name: 'رد درخواست بدون کلید', path: '/api/v1/events', expected: 401, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } },
  { name: 'اعتبارسنجی بازیابی', path: '/api/admin/restore', expected: 400, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } },
];

let failed = 0;
for (const { name, path, expected, init } of checks) {
  try {
    const response = await fetch(`${baseUrl}${path}`, init);
    const ok = response.status === expected;
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
