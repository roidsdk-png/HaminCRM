<?php
declare(strict_types=1);

require_once __DIR__ . '/CrmClient.php';

/**
 * رابط اختصاصی مشاور بله؛ خطای CRM هرگز منطق اصلی ربات را متوقف نمی‌کند.
 */
final class BaleAdvisorReporter
{
    private CrmClient $client;

    public function __construct(string $baseUrl, string $apiKey)
    {
        $this->client = new CrmClient($baseUrl, 'bale-advisor', $apiKey);
    }

    public static function fromEnvironment(): self
    {
        return new self(getenv('CRM_URL') ?: '', getenv('CRM_API_KEY') ?: '');
    }

    public function userMessage(
        string|int $updateId,
        string|int $chatId,
        string|int $userId,
        string|int $messageId,
        string $text,
        ?string $occurredAt = null
    ): bool {
        return $this->safely(fn (): bool => $this->client->send(
            'bale-user-' . $updateId,
            'message.created',
            [
                'sessionId' => (string) $chatId,
                'userId' => (string) $userId,
                'messageId' => (string) $messageId,
                'role' => 'user',
                'content' => $text,
            ],
            $occurredAt
        ));
    }

    public function assistantMessage(
        string|int $updateId,
        string|int $chatId,
        string|int $userId,
        string $text,
        ?string $model = null,
        ?int $inputTokens = null,
        ?int $outputTokens = null,
        ?int $latencyMs = null,
        ?string $occurredAt = null
    ): bool {
        $payload = [
            'sessionId' => (string) $chatId,
            'userId' => (string) $userId,
            'role' => 'assistant',
            'content' => $text,
        ];
        if ($model !== null) $payload['model'] = $model;
        if ($inputTokens !== null) $payload['inputTokens'] = $inputTokens;
        if ($outputTokens !== null) $payload['outputTokens'] = $outputTokens;
        if ($latencyMs !== null) $payload['latencyMs'] = $latencyMs;

        return $this->safely(fn (): bool => $this->client->send(
            'bale-assistant-' . $updateId,
            'message.created',
            $payload,
            $occurredAt
        ));
    }

    private function safely(callable $operation): bool
    {
        try {
            return (bool) $operation();
        } catch (Throwable $error) {
            error_log('CRM reporter error: ' . $error->getMessage());
            return false;
        }
    }
}
