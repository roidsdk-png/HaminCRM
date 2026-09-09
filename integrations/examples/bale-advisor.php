<?php
// نمونه اتصال /opt/moshaver-eita/bot.php — این فایل مستقیماً روی سرور نصب نشده است.
require_once __DIR__ . '/../php/BaleAdvisorReporter.php';
$crm = BaleAdvisorReporter::fromEnvironment();

// بلافاصله بعد از دریافت متن کاربر:
$crm->userMessage($updateId, $chatId, $userId, $messageId, $userText);

// بعد از تولید پاسخ و ترجیحاً پس از ارسال موفق آن به بله:
$crm->assistantMessage($updateId, $chatId, $userId, $aiAnswer, $modelName ?? null);
