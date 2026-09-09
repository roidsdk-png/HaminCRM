# Hamin CRM ingestion API

Each source sends events to `POST /api/v1/events` over HTTPS. The CRM never connects to a source server and never stores SSH credentials.

Required headers are `Content-Type: application/json`, `X-CRM-Source`, and a per-source `X-CRM-Key`.

The endpoint accepts one event or `{ "events": [...] }` with at most 100 events. `eventId` must be stable so retries do not create duplicates.

Supported event types:

- `message.created`: session, anonymous/user identity, role, full content, model and optional usage data.
- `test.completed`: profile, every raw answer, scores, result and AI analysis.
- `matchmaking.profile.completed`: profile, every answer, traits, archetype and consent.

All attempts and messages are append-only. The CRM does not impose eligibility, retry, or access rules on source applications.
