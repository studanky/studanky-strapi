# API Security

This document describes the security mechanisms implemented for public API endpoints.

## Report API Authentication

**Location:** `src/api/report/policies/is-authentic-report.ts`

The `POST /api/reports` endpoint uses a multi-layered security approach to prevent bot spam without requiring user registration.

### Security Layers

| Layer | Header | Purpose |
|-------|--------|---------|
| HMAC Signature | `X-App-Signature` | Proves request originates from legitimate app |
| Timestamp | `X-Timestamp` | Prevents replay attacks (5-minute window) |
| Geo-Fence | Request body | Validates user proximity to spring (≤500m) |

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

Distance limit: **500 meters**

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
