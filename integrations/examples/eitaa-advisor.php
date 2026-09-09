<?php
// نمونه اتصال api.php مشاور ایتا؛ پس از پایان پاسخ استریم‌شده اجرا می‌شود.
require_once __DIR__ . '/../php/CrmClient.php';
$crm = new CrmClient(getenv('CRM_URL') ?: '', 'eitaa-advisor', getenv('CRM_API_KEY') ?: '');

$crm->send('eitaa-user-' . $requestId, 'message.created', [
    'sessionId' => $sessionId,
    'anonymousId' => $anonymousId,
    'ipHash' => hash_hmac('sha256', $userIp, getenv('CRM_IP_SALT') ?: ''),
    'role' => 'user',
    'content' => $userText,
]);
$crm->send('eitaa-ai-' . $requestId, 'message.created', [
    'sessionId' => $sessionId,
    'anonymousId' => $anonymousId,
    'role' => 'assistant',
    'content' => $completeAiAnswer,
    'model' => $modelName,
]);
