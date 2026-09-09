<?php
declare(strict_types=1);

require_once __DIR__ . '/CrmClient.php';

/**
 * رابط اختصاصی مشاور ایتا؛ IP خام هرگز از این کلاس خارج نمی‌شود.
 */
final class EitaaAdvisorReporter
{
    private CrmClient $client;
    private string $ipSalt;

    public function __construct(string $baseUrl, string $apiKey, string $ipSalt)
    {
        $this->client = new CrmClient($baseUrl, 'eitaa-advisor', $apiKey);
        $this->ipSalt = trim($ipSalt);
    }

    public static function fromEnvironment(): self
    {
        return new self(
            getenv('CRM_URL') ?: '',
            getenv('CRM_API_KEY') ?: '',
            getenv('CRM_IP_SALT') ?: ''
        );
    }

    public function userMessage(
        string $requestId,
        string $sessionId,
        ?string $anonymousId,
        string $text,
        ?string $userIp = null,
        ?string $messageId = null,
        ?string $occurredAt = null
    ): bool {
        $payload = $this->identity($sessionId, $anonymousId, $userIp) + [
            'sessionId' => $sessionId,
            'role' => 'user',
            'content' => $text,
        ];
        if ($messageId !== null && trim($messageId) !== '') $payload['messageId'] = $messageId;

        return $this->safely(fn (): bool => $this->client->send(
            'eitaa-user-' . $requestId,
            'message.created',
            $payload,
            $occurredAt
        ));
    }

    public function assistantMessage(
        string $requestId,
        string $sessionId,
        ?string $anonymousId,
        string $text,
        ?string $userIp = null,
        ?string $model = null,
        ?int $inputTokens = null,
        ?int $outputTokens = null,
        ?int $latencyMs = null,
        ?string $occurredAt = null
    ): bool {
        $payload = $this->identity($sessionId, $anonymousId, $userIp) + [
            'sessionId' => $sessionId,
            'role' => 'assistant',
            'content' => $text,
        ];
        if ($model !== null) $payload['model'] = $model;
        if ($inputTokens !== null) $payload['inputTokens'] = $inputTokens;
        if ($outputTokens !== null) $payload['outputTokens'] = $outputTokens;
        if ($latencyMs !== null) $payload['latencyMs'] = $latencyMs;

        return $this->safely(fn (): bool => $this->client->send(
            'eitaa-assistant-' . $requestId,
            'message.created',
            $payload,
            $occurredAt
        ));
    }

    private function identity(string $sessionId, ?string $anonymousId, ?string $userIp): array
    {
        $identity = ['anonymousId' => trim((string) $anonymousId) ?: $sessionId];
        if ($userIp !== null && trim($userIp) !== '' && $this->ipSalt !== '') {
            $identity['ipHash'] = hash_hmac('sha256', trim($userIp), $this->ipSalt);
        }
        return $identity;
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
