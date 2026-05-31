# API Security

This document describes the security mechanisms implemented for public API endpoints.

## Report API Authentication

**Location:** `src/api/report/policies/is-authentic-report.ts`

The `POST /api/reports` endpoint uses a multi-layered approach to deter bot spam without requiring user registration.

> **Trust posture (important).** The HMAC + timestamp layer is **best-effort
> anti-bot only**, not a source of trust: the shared secret is embedded in the
> client app (extractable), and the 5-minute replay window is incompatible with
> an offline-first queue (sign at queue flush). Real trustworthiness comes from
> the **GPS geofence (200 m)** + (Phase 3) trust score, verified/anonymous origin,
> and false-report flagging — not from the signature. A server-side QR signature
> (`HMAC(documentId, SERVER_SECRET)`, secret **only on the server**) is a separate
> concern and must never ship the secret to the app. See [roadmap](./roadmap.md).

### Security Layers

| Layer | Header | Purpose |
|-------|--------|---------|
| HMAC Signature | `X-App-Signature` | Proves request originates from legitimate app |
| Timestamp | `X-Timestamp` | Prevents replay attacks (5-minute window) |
| Geo-Fence | Request body | Validates user proximity to spring (≤200m) |

### Signature Construction

**Payload format:** `{timestamp}:{springDocumentId}`

```
HMAC-SHA256("{timestamp}:{springDocumentId}", HMAC_SECRET) → hex string
```

**Example:**
```
Timestamp: 1736622000
Spring ID: abc123xyz456
Payload:   "1736622000:abc123xyz456"
```

### Configuration

| Variable | Description |
|----------|-------------|
| `HMAC_SECRET` | Shared secret (min 32 chars), set in `.env` |

### Geo-Fence Validation

Uses the Haversine formula (`src/utils/geo.ts`) to calculate great-circle distance between:
- User's reported GPS coordinates (`user_lat`, `user_lng`)
- Spring's stored coordinates (`lat`, `lng`)

Distance limit: **200 meters** (`MAX_DISTANCE_METERS` in the policy; spec §8.1 / návrh §6)

> **Note:** Geo-fence is bypassed if `user_lat`/`user_lng` are not provided.

### Route Configuration

**Location:** `src/api/report/routes/report.ts`

Policy is applied only to the `POST /reports` route:

```typescript
{
  method: "POST",
  path: "/reports",
  handler: "report.create",
  config: {
    policies: ["api::report.is-authentic-report"],
  },
}
```

### Error Responses

All security failures return `403 Forbidden` with details logged server-side.

| Failure | Log Message |
|---------|-------------|
| Missing signature | `Report rejected: Missing X-App-Signature header` |
| Expired timestamp | `Report rejected: Timestamp expired or invalid` |
| Invalid signature | `Report rejected: Invalid signature for spring ...` |
| Too far from spring | `Report rejected: User location too far from spring` |

### Mobile Integration

See [Flutter Integration Guide](./flutter-integration.md) for client-side implementation details.
