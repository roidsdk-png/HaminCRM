# استقرار بدون Docker

این مسیر، برنامهٔ ساخته‌شدهٔ فعلی را با Wrangler محلی و سرویس‌های systemd اجرا می‌کند. معماری دیتابیس CRM عوض نمی‌شود. فایل موجود در `/root/socialCRM/data/v3/d1` همان فایل عملیاتی باقی می‌ماند. Nginx به `127.0.0.1:3010` وصل می‌شود؛ سرویس تحلیل فقط روی `127.0.0.1:8091` و بکاپ روی `127.0.0.1:9898` گوش می‌دهند.

قالب‌های `deploy/native` کد را از `/root/socialCRM-current`، اشاره‌گر به یک انتشار در `/root/socialCRM-releases`، اجرا می‌کنند. داده و تنظیمات پایدار در `/root/socialCRM` باقی می‌مانند. پیش از نصب، مسیر واقعی Node و Python، پوشهٔ نصب، مسیر دیتابیس Honaz و وضعیت Nginx را با سرور تطبیق دهید. کلیدها در قالب سرویس قرار نمی‌گیرند. نام‌های ارائه‌دهنده و کلید API مدل بعداً از پنل مالک تنظیم می‌شوند.

## آماده‌سازی و بکاپ

پیش از تغییر، یک بکاپ سازگار SQLite با Online Backup، آرشیو سورس، فایل‌های خصوصی، تنظیمات Nginx و systemd، فهرست نسخهٔ ابزارها و checksum تهیه شود. آرشیو حاوی اطلاعات خصوصی فقط در بکاپ محدود باقی می‌ماند. در GitHub صرفاً سورس و فایل نمونهٔ بدون کلید ثبت می‌شوند. صحت SQLite و checksum نسخهٔ دریافت‌شده روی دسکتاپ باید بررسی شود.

Node نسخهٔ 22.13.0 یا جدیدتر و Python نسخهٔ 3.11 یا جدیدتر لازم‌اند. Node مخصوص CRM در `/root/socialCRM-tools/node/bin` نصب می‌شود و در PATH سرویس CRM قرار می‌گیرد؛ نسخهٔ سراسری Node برای سرویس‌های دیگر عوض نمی‌شود. نصب و ساخت نسخهٔ جدید را در مسیر آماده‌سازی با همین Node انجام دهید. دیتابیس زنده، فایل‌های `.dev.vars`، `analytics.env`، `analytics-data` و پوشهٔ بکاپ از انتشار سورس جدا می‌مانند. انتقال فایل `node_modules` ساخته‌شده روی Windows به Linux مجاز نیست؛ وابستگی‌ها باید در Linux نصب شوند.

```bash
npm ci
npm run lint
npm run build
npm run test:release
python3 -m venv .venv-analytics
.venv-analytics/bin/python -m pip install -r analytics/requirements.txt
```

در `.dev.vars` دو مقدار `ANALYTICS_SERVICE_URL=http://127.0.0.1:8091` و `ANALYTICS_INTERNAL_TOKEN` تنظیم شوند. در `analytics.env` همان توکن داخلی، `ANALYTICS_ENV=production` و مسیرهای خصوصی تحلیل قرار گیرند. برای اجرای محلی SQLite تحلیلی، `ANALYTICS_DATABASE_URL=sqlite:////root/socialCRM/analytics-data/analytics.sqlite` کافی است. انتخاب PostgreSQL بومی به آماده‌سازی پایگاه، مجوزها و پشتیبان‌گیری جدا نیاز دارد. فایل‌ها و پوشه‌های خصوصی با دسترسی محدود نگهداری شوند.

```bash
python3 scripts/analysis-native-preflight.py --root /root/socialCRM --data-root /root/socialCRM/data
```

این فرمان فقط می‌خواند و مقدار کلیدها، نام مخاطبان یا محتوای پیام‌ها را چاپ نمی‌کند. اجرای آن جای بکاپ کامل و آزمون ورود مدیر را نمی‌گیرد.

## تعویض کنترل‌شده

۱. پس از تأیید بکاپ و آماده‌شدن build، ورودی‌های همگام‌ساز CRM را متوقف کنید و برنامهٔ قبلی را ببندید. فقط فرایندها یا سرویس‌های همین CRM تغییر کنند؛ ربات‌ها و سرویس‌های دیگر سرور دست‌نخورده می‌مانند.

۲. با همان شناسهٔ binding و همان مسیر پایدار، مهاجرت را اجرا کنید. هرگز از `--remote` یا مسیر پیش‌فرض `.wrangler/state` برای دادهٔ عملیاتی استفاده نکنید.

```bash
CI=true node node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --persist-to /root/socialCRM/data --config wrangler.local.jsonc
```

۳. قالب‌های لازم را در `/etc/systemd/system` قرار دهید و `systemctl daemon-reload` اجرا کنید. سرویس‌های `socialcrm.service`، `socialcrm-backup-api.service`، `socialcrm-analytics.service` و سپس `socialcrm-analytics-sync.service` راه‌اندازی شوند. سرویس `socialcrm-honaz-sync.service` فقط اگر پل فعلی Honaz فعال است و مسیرها تأیید شده‌اند جایگزین همان پل شود. مسیرهای حالت و کلید منبع فعلی حفظ شوند.

۴. سلامت داخلی و دامنهٔ HTTPS، ورود مالک، صفحهٔ تحلیل، تعداد منابع و رکوردها، بکاپ و دریافت رویداد را بررسی کنید. در ابتدا API مدل خالی می‌ماند و آمار و ابر واژه باید از دادهٔ واقعی کار کنند. پس از ورود کلید توسط مالک، کیفیت مدل جداگانه ارزیابی می‌شود.

```bash
curl -fsS http://127.0.0.1:3010/api/health
curl -fsS http://127.0.0.1:8091/health
curl -fsS https://crm.haminyar.ir/api/health
nginx -t
systemctl status socialcrm socialcrm-analytics socialcrm-analytics-sync socialcrm-backup-api --no-pager
```

اسکریپت `backup-production.py` مستقیماً از SQLite موجود بکاپ آنلاین می‌سازد و وابستگی اجرایی به Docker ندارد. واحد oneshot جدید، بعد از `socialcrm-backup-api.service` مرتب می‌شود و تایمر موجود همان برنامهٔ روزانهٔ 03:15 را نگه می‌دارد. هر دو قالب در `deploy/native` قرار دارند. تنظیمات و نسخهٔ قبلی تا پایان بررسی نگهداری شوند.

## مرز احراز هویت در دامنهٔ مستقیم

در VPS مستقل، Nginx پیش از proxy کردن درخواست‌های عمومی، سرآیندهای `oai-authenticated-user-id`، `oai-authenticated-user-email`، `oai-authenticated-user-full-name` و `oai-authenticated-user-full-name-encoding` را پاک می‌کند. برنامه این سرآیندها را برای محیط میزبانی مدیریت‌شده می‌شناسد؛ مقدار ارسال‌شده از اینترنت عمومی در دامنهٔ مستقل نباید هویت معتبر ایجاد کند. نسخهٔ مستقیم از نشست امن مدیر استفاده می‌کند. آزمون عدم ورود با سرآیند جعلی پیش و پس از تعویض اجرا شود.

برای بررسی مبدأ درخواست‌های تغییردهنده، `ANALYTICS_PUBLIC_ORIGIN=https://crm.haminyar.ir` در تنظیمات CRM ثبت می‌شود. Nginx همچنان Host اصلی و `X-Forwarded-Proto` را کنترل می‌کند. بررسی صرفاً با HTTP لوکال کافی نیست؛ یک درخواست POST مجاز با Origin دامنهٔ HTTPS و یک درخواست با Origin نامعتبر باید از خود دامنه آزمایش شوند.

## بازگشت

اگر smoke یا ورود مدیر شکست خورد، تحلیل و همگام‌سازهای جدید را متوقف کنید و انتشار سورس و سرویس بومی را به نسخهٔ ثبت‌شدهٔ قبل برگردانید. مهاجرت‌های فعلی افزایشی‌اند و نسخهٔ قدیمی را ابتدا روی کپی دیتابیس آزمایش کنید. فایل دیتابیس پیش از انتشار فقط در صورت نیاز واقعی و با برنامهٔ نگهداری بازیابی می‌شود؛ بازیابی خودکار بکاپ قدیمی می‌تواند رویدادهای جدید را از بین ببرد. Nginx و کلیدهای احراز هویت باید با بکاپ محفوظ قابل بازگرداندن باشند. بازگشت به Docker جزو این دستور کار نیست؛ در صورت ایراد باید نسخهٔ قبلی نیز به‌صورت بومی اجرا شود یا سرویس با وضعیت نگهداری بماند تا ایراد رفع شود.
