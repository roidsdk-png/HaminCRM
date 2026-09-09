<?php
// نمونه اتصال /opt/moshaver-eita/bot.php — این فایل مستقیماً روی سرور نصب نشده است.
require_once __DIR__ . '/../php/CrmClient.php';
$crm = new CrmClient(getenv('CRM_URL') ?: '', 'bale-advisor', getenv('CRM_API_KEY') ?: '');

// بلافاصله بعد از دریافت متن کاربر:
$crm->send('bale-in-' . $updateId, 'message.created', [
    'sessionId' => (string) $chatId,
    'userId' => (string) $userId,
    'messageId' => (string) $messageId,
    'role' => 'user',
    'content' => $userText,
]);

// بعد از تولید پاسخ و ترجیحاً پس از ارسال موفق آن به بله:
$crm->send('bale-out-' . $updateId, 'message.created', [
    'sessionId' => (string) $chatId,
    'userId' => (string) $userId,
    'role' => 'assistant',
    'content' => $aiAnswer,
    'model' => 'gpt-4o-mini',
]);

