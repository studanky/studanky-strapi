# Roadmap & Next Steps

Current state: **MVP backend alignment is complete** — canonical source-neutral
model, ČHMÚ sync (cron + manual), denormalized map status, public map + history
endpoints, admin manager scoping. The items below are recommended follow-ups.

## Immediate (config / ops — no code)

- **Configure `flow_scale_ranges`** in Platform Config. It is empty, so
  `flow_scale` stays `null`. Tune the l/s → 1–5 buckets to the real discharge
  distribution revealed by the first sync (návrh §10). See [denormalization](./denormalization.md#flow-scale).
- **Grant Public-role permissions** for the read endpoints that should be open:
  `spring.findOne`, `platform-config.find` (the custom `map` / `reports` routes are
  already `auth:false`). **Do NOT enable any `report.*` action** — reports are
  read via spring history only. See [Public API](./public-api.md).
- **Restrict CORS** `origin` (`config/middlewares.ts` → `strapi::cors`) to the
  app's domains in production (default is permissive). See [API Security](./api-security.md).
- **Create an admin API token** for `POST /api/springs/sync-chmu` if you want
  manual/ops runs in addition to the cron.
- **Set `CRON_ENABLED`** appropriately per environment (default `true`).
- Update [`api-security.md`](./api-security.md) / [`flutter-integration.md`](./flutter-integration.md)
  examples if the client contract changes further.

## Phase 2 — Report submit (offline-first)

> The MVP has **no submit endpoint**. The earlier HMAC policy, `POST /reports`
> routes and the geofence util were **removed from the codebase** as premature
> (recoverable from git / the `feature/api-security` branch). Re-introduce them
> wired to `report.submit` — **with rate limiting in place first**.

- **Rate limiting on `POST /reports`** (per IP; stricter for anonymous) — the
  prerequisite control before the endpoint is public. See [API Security](./api-security.md).
- **`report.submit` service** (override `POST /api/reports`): idempotency via
  **`client_report_id`** (return the existing report instead of a 409 on the
  unique index — deferred item "C9"), QR HMAC resolve, l/s → scale conversion,
  then `refreshLatest`. The unique index already guarantees no duplicates at the
  DB level.
- Mark **`device_id` private** when the submit path returns/stores it.
- **Report fields** still to add (deferred): `source`, `measurement_method`,
  `received_at`, `trust_score`, `reporter` (relation → users-permissions user,
  **private**), `flagged_count`.
- **QR signature**: a server-side `sig = HMAC(documentId, SERVER_SECRET)` with the
  secret **only on the server** — keep this separate from any client-embedded
  signature. See the security note below.

## Phase 3 — Trust & community

- Authenticated submissions (users-permissions), `trust_score` (source + geofence
  + method), `POST /reports/:documentId/flag` (`flagged_count`), rewards.
- Consider cursor-based pagination for history (stable infinite scroll).
- Map endpoint caching (CDN / Redis) — it changes rarely and is read often.

## Security direction (HMAC verdict)

The current `X-App-Signature` / `X-Timestamp` layer is **best-effort anti-bot
only**, not a source of trust: the secret is embedded in the client (extractable)
and the 5-minute replay window is incompatible with offline queues. Keep it, but:
sign **at queue flush**, and put real trust in **GPS geofence (200 m) + trust
score + verified/anonymous + flagging**. See [API Security](./api-security.md).

## Other sources (future)

The model is source-neutral. A new source = a new adapter (like `chmu-client.ts`)
mapping into the canonical model, plus a sync entry. No core changes needed; do
not leak source specifics into the model.
