<?php
// نمونه اتصال api.php مشاور ایتا؛ پس از پایان پاسخ استریم‌شده اجرا می‌شود.
require_once __DIR__ . '/../php/EitaaAdvisorReporter.php';
$crm = EitaaAdvisorReporter::fromEnvironment();

// پس از اعتبارسنجی ورودی و پیش از شروع تولید پاسخ:
$crm->userMessage($requestId, $sessionId, $anonymousId ?? null, $userText, $userIp ?? null);

// فقط پس از کامل‌شدن پاسخ و ارسال موفق آن به کاربر:
$crm->assistantMessage($requestId, $sessionId, $anonymousId ?? null, $completeAiAnswer, $userIp ?? null, $modelName ?? null);
