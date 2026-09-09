<?php
// این کد باید در api.php سمت سرور اجرا شود؛ کلید CRM هرگز داخل JavaScript مرورگر قرار نمی‌گیرد.
require_once __DIR__ . '/../php/CrmClient.php';
$crm = new CrmClient(getenv('CRM_URL') ?: '', 'psytest-1', getenv('CRM_API_KEY') ?: '');

$crm->send('test-' . $attemptId, 'test.completed', [
    'attemptId' => $attemptId,
    'testKey' => 'personality',
    'trackingCode' => $trackingCode,
    'profile' => $profile,
    'answers' => $answers, // questionText, value, label, score
    'scores' => $scores,
    'result' => $result,
    'aiAnalysis' => $analysis,
]);

