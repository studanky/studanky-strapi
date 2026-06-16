# API Security

## Current state (MVP)

The MVP backend is **read-only ČHMÚ data** (spec §11): there is **no public write
endpoint**. The public surface is:

- `GET /api/springs/map` — public read ([Public API](./public-api.md))
- `GET /api/springs/search` — public read, map-safe fields only
- `GET /api/springs/:documentId/reports` — public read (private fields never exposed)
- `GET /api/springs/:documentId`, `GET /api/platform-config` — core reads (enable per Public RBAC)
- `POST /api/springs/sync-chmu` — **authenticated** (admin API token), ops-only

Admin Panel access is scoped by the [manager middleware](./admin-filtering.md).
Capture coordinates are private and additionally excluded from the history
allowlist (GDPR, spec §9.2). There is **no report-submit endpoint and no HMAC
policy in the MVP** — they were removed as premature; the design below is the
plan for when submission ships in Phase 2.

### MVP hardening checklist (ops)

- **Verify Public role RBAC**: enable only `spring.find`/`findOne` and
  `platform-config.find`. Do **not** enable any `report.*` action.
- **Report writes stay closed in the MVP**: public clients read reports only via
  `GET /api/springs/:documentId/reports`. Never enable `report.update` or
  `report.delete`; reports are append-only observations.
- **CORS**: restrict `config/middlewares.ts` `strapi::cors` `origin` to the app's
  domains in production (default is permissive).
- **`sync-chmu`**: keep authenticated (admin API token only); consider a
  concurrency guard so two triggers can't overlap.
- A general **rate limit** on the public read API is reasonable at the edge
  (CDN / reverse proxy), matching the planned `spring.map` cache.

## Report submit security — Phase 2 (planned, NOT implemented)

When community submission ships (`POST /api/reports` via `report.submit`), apply
these — layered, with effort spent where it actually buys assurance.

### Trust posture

The `X-App-Signature` / `X-Timestamp` HMAC layer is **best-effort anti-bot only**,
not a source of trust: the shared secret is embedded in the client app
(extractable), and a fixed replay window is incompatible with an offline-first
queue. Real trustworthiness comes from:

1. **Rate limiting** on `POST /reports` (per IP; stricter for anonymous) — the
   single most important control for a public write endpoint. **Required before
   the endpoint goes public.**
2. **GPS geo-fence (≤200 m)** — Haversine distance between the reported GPS and
   the spring (spec §8.1). Soft trust signal (client GPS is spoofable).
3. **`client_report_id` UNIQUE idempotence** — the DB unique index already
   exists; the submit service returns the existing report on a duplicate instead
   of erroring (offline-queue retries).
4. **Server-owned `source_type`** — the create path must force `source_type: "user"`
   and ignore client input. ČHMÚ reports are created only by the sync as
   `source_type: "chmu"`.
5. **Phase 3**: verified vs anonymous weighting, trust score, false-report flagging.

`source_type` is provenance, not authorization or trust. Do not overload it for
verified/anonymous distinctions; model those as auth/trust fields when Phase 3
ships.

### HMAC (if kept) — keep it cheap, don't expand

- Payload `"{timestamp}:{springDocumentId}"`, HMAC-SHA256, compared with
  `crypto.timingSafeEqual`; **fail closed** if `HMAC_SECRET` is unset.
- **Sign at queue flush**, not at capture time, or offline reports expire.
- A server-side **QR signature** (`HMAC(documentId, SERVER_SECRET)`, secret
  **server-only**) is a separate concern from any client-embedded signature and
  must never ship the secret to the app.
- `HMAC_SECRET` env var is only needed once this layer is wired (Phase 2).

### Privacy

- Mark `device_id` **private** (client identifier) alongside `user_lat`/`user_lng`.
- Keep `reporter` (→ users-permissions user) private when added.
- Keep reports immutable from the public API: create-only for Phase 2 submission,
  no public update/delete route.

> The reference implementation (HMAC policy + geofence util) lived on the
> `feature/api-security` branch and is recoverable from git history; re-introduce
> it wired to `report.submit` with rate limiting + idempotence in Phase 2. See
> [roadmap](./roadmap.md) and the client contract in
> [Flutter Integration](./flutter-integration.md).
