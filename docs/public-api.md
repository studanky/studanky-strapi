# Public API — Custom Endpoints

Custom read endpoints for the mobile/web client. Thin controllers, logic in
services. Defined in `src/api/spring/routes/01-spring-custom.ts` — the `01-`
prefix ensures they load **before** the core router (otherwise `/springs/map`
would be captured by core `/springs/:documentId`).

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/springs/map` | `spring.map` | public | map markers within a bbox |
| GET | `/api/springs/search` | `spring.search` | public | accent-insensitive name search → fly map to a spring |
| GET | `/api/springs/:documentId/reports` | `spring.reports` | public | paginated report history |
| POST | `/api/springs/sync-chmu` | `spring.syncChmu` | API token | manual ČHMÚ sync ([docs](./chmu-sync.md)) |

> Core `GET /api/springs/:documentId` (single spring) and `GET /api/platform-config`
> remain the default core handlers — enable them for the Public role via admin RBAC.

## `GET /api/springs/map?bbox=minLng,minLat,maxLng,maxLat`

Minimal payload for rendering markers. The service (`findInBbox`) queries the
**published**, **default-locale** rows and returns only map-safe fields —
`name`, `lat`, `lng`, `current_status`, `status_updated_at` (+ `documentId`).
**No report history, no private data.** Missing/invalid `bbox` → `400`.

```jsonc
// 200
{ "data": [ { "documentId": "…", "name": "Ostružná", "lat": 50.18, "lng": 17.05,
              "current_status": "is_flowing", "status_updated_at": "2026-05-31T05:00:00.000Z" } ] }
```

The client computes the third "stale" state itself from `status_updated_at` +
`platform-config.freshness_threshold_days` — the server only returns
`is_flowing` / `is_not_flowing` / `unknown` + the timestamp.

## `GET /api/springs/search?q=ostr&lat=50.1&lng=17.0&limit=10&locale=cs`

Name autocomplete for the map **search box**: the user types, picks a result,
and the client flies the map to its `lat`/`lng`. The service (`search`) does a
case-insensitive, accent-insensitive partial match on `name` (for example
`ostruzna` matches `Ostružná`) and returns the **same map-safe fields as `/map`**
(`name`, `lat`, `lng`, `current_status`, `status_updated_at`, `documentId`) —
so a result is renderable as a marker immediately.

| Param | Required | Default | Notes |
|---|---|---|---|
| `q` | yes | — | search text; **min 2 chars** (else `400`) |
| `lat`,`lng` | no | — | origin (user GPS or map centre); when both valid → nearest-first + `distance_m` |
| `limit` | no | `10` | clamped to `50` |
| `locale` | no | i18n default | which localized name to search/return |

With a valid `lat`/`lng` origin results are ordered **nearest-first** and each
carries a rounded `distance_m` (metres, haversine); without it they are
alphabetical by `name`. Broad queries are capped at 200 candidates before the
distance sort.

```jsonc
// 200 — with origin (nearest-first, includes distance_m)
{ "data": [ { "documentId": "…", "name": "Ostružná", "lat": 50.18, "lng": 17.05,
              "current_status": "is_flowing", "status_updated_at": "2026-05-31T05:00:00.000Z",
              "distance_m": 2310 } ] }
```

As with `/map`, the client computes the "stale" state itself from
`status_updated_at` + `platform-config.freshness_threshold_days`.

`source_type` is intentionally not returned by `/map` or `/search`; those
endpoints expose only Spring-level marker data. Load report history when the UI
needs the source of the latest observation.

## `GET /api/springs/:documentId/reports?page=1&pageSize=20`

Paginated history (lazy load). The service (`history`) returns an **explicit
public field allowlist** — `is_flowing`, `flow_scale`, `flow_rate_lps`,
`has_odor`, `water_clarity`, `note`, `reported_at`, `source_type`. `pageSize`
is clamped to 100.

`source_type` is an enum: `chmu` for imported ČHMÚ sensor reports and `user` for
client-created/community reports. Clients can use it to render a source badge.

```jsonc
// 200
{ "data": [ { "is_flowing": true, "source_type": "chmu", "reported_at": "2026-05-31T05:00:00.000Z" } ],
  "meta": { "pagination": { "page": 1, "pageSize": 20, "total": 39, "pageCount": 2 } } }
```

## Privacy

Capture coordinates (`user_lat`, `user_lng`) are marked **private** on the Report
model and are additionally **never selected** by `history` — they cannot leak
through these endpoints regardless of model config. `device_id` is likewise not
exposed. (GDPR / spec §9.2.)
