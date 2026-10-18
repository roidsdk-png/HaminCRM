# بسته اتصال منابع به CRM

این پوشه قراردادها، کلاینت‌ها و کد اتصال منابع CRM را نگهداری می‌کند. وضعیت نصب هر منبع باید در محیط عملیاتی همان منبع بررسی شود.

## نگاشت منابع فعلی

- مشاور بله (`/opt/moshaver-eita/bot.php`): رابط اختصاصی `php/BaleAdvisorReporter.php`، نمونه `examples/bale-advisor.php` و برنامه نصب `BALE_ADVISOR_PLAN.md`
- مشاور ایتا: رابط اختصاصی `php/EitaaAdvisorReporter.php`، نمونه `examples/eitaa-advisor.php` و برنامه `EITAA_ADVISOR_PLAN.md`
- سه آزمون وب: `php/CrmClient.php` از داخل `api.php` سمت سرور
- ربات ازدواج (`/opt/matchhamin-bot/bot.py`): نمونه `examples/matchhamin.py`
- آزمون خط قرمز ازدواج بله و تلگرام (`/opt/redline-bot`): کلاینت پایدار، ربات بله، وب‌سرور و رابط تلگرام، reporter، backfill و تست‌ها در `redline/`

روی هر سرور فقط `CRM_URL` و `CRM_API_KEY` تنظیم می‌شود؛ مشاور وب ایتا برای هش IP به `CRM_IP_SALT` هم نیاز دارد. رمز SSH، توکن پیام‌رسان و کلید هوش مصنوعی به CRM داده نمی‌شوند.

اتصال Redline دو هویت مستقل دارد: `CRM_SOURCE`/`CRM_API_KEY` برای بله و `CRM_TELEGRAM_SOURCE`/`CRM_TELEGRAM_API_KEY` برای تلگرام. مقدار پیش‌فرض شناسه‌ها به‌ترتیب `redline-test` و `redline-telegram` است؛ کلیدها باید جدا و فقط در فایل محیطی سرور نگهداری شوند.

ربات بله IP کاربر را دریافت نمی‌کند و شناسه پیام‌رسان معیار شمارش است. مشاور وب ایتا می‌تواند IP را فقط در سرور خودش هش کند و `ipHash` بفرستد؛ IP خام ارسال نمی‌شود.

در اتصال نهایی، ارسال رویداد بعد از عملیات اصلی برنامه انجام می‌شود. شکست CRM نباید پاسخ‌دهی ربات، نتیجه آزمون یا امکان تلاش مجدد کاربر را متوقف کند.
