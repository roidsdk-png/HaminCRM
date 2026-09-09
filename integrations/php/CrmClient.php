<?php
declare(strict_types=1);

final class CrmClient
{
    private string $baseUrl;
    private string $source;
    private string $apiKey;
    private int $timeoutSeconds;

    public function __construct(
        string $baseUrl,
        string $source,
        string $apiKey,
        int $timeoutSeconds = 2
    ) {
        $this->baseUrl = rtrim(trim($baseUrl), '/');
        $this->source = trim($source);
        $this->apiKey = trim($apiKey);
        $this->timeoutSeconds = $timeoutSeconds;
    }

    public function enabled(): bool
    {
        return $this->baseUrl !== '' && $this->source !== '' && $this->apiKey !== '';
    }

    /** Failure is logged and never interrupts the bot or web-app flow. */
    public function send(string $eventId, string $type, array $payload, ?string $occurredAt = null): bool
    {
        if (!$this->enabled()) return false;
        $body = json_encode([
            'eventId' => $eventId,
            'type' => $type,
            'occurredAt' => $occurredAt ?? gmdate('c'),
            'payload' => $payload,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($body === false) return false;

        $curl = curl_init($this->baseUrl . '/api/v1/events');
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => $this->timeoutSeconds,
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-CRM-Source: ' . $this->source, 'X-CRM-Key: ' . $this->apiKey],
        ]);
        curl_exec($curl);
        $ok = curl_errno($curl) === 0 && curl_getinfo($curl, CURLINFO_RESPONSE_CODE) >= 200 && curl_getinfo($curl, CURLINFO_RESPONSE_CODE) < 300;
        if (!$ok) error_log('CRM delivery failed for event ' . $eventId);
        curl_close($curl);
        return $ok;
    }
}
