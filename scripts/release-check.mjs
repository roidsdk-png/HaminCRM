import { access, readdir, stat } from 'node:fs/promises';

const requiredFiles = [
  'dist/server/index.js',
  'dist/server/wrangler.json',
  '.openai/hosting.json',
  'drizzle/0000_wonderful_aqueduct.sql',
];

let failed = 0;
for (const path of requiredFiles) {
  try {
    await access(path);
    console.log(`✓ ${path}`);
  } catch {
    failed++;
    console.error(`✗ فایل لازم پیدا نشد: ${path}`);
  }
}

try {
  const entry = await stat('dist/server/index.js');
  if (entry.size < 1_000) throw new Error('خروجی سرور ناقص است');
  const migrations = (await readdir('drizzle')).filter((name) => name.endsWith('.sql'));
  if (!migrations.length) throw new Error('فایل مهاجرت دیتابیس وجود ندارد');
  console.log(`✓ ${migrations.length.toLocaleString('fa-IR')} مهاجرت دیتابیس آماده است`);
} catch (error) {
  failed++;
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
}

if (failed) process.exit(1);
console.log('\nنسخهٔ ساخت‌شده برای انتقال آماده است.');
