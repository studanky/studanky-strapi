# Public API — Custom Endpoints

Custom read endpoints for the mobile/web client. Thin controllers, logic in
services. Defined in `src/api/spring/routes/01-spring-custom.ts` — the `01-`
prefix ensures they load **before** the core router (otherwise `/springs/map`
would be captured by core `/springs/:documentId`).

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/springs/map` | `spring.map` | public | map markers within a bbox |
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

## `GET /api/springs/:documentId/reports?page=1&pageSize=20`

Paginated history (lazy load). The service (`history`) returns an **explicit
public field allowlist** — `is_flowing`, `flow_scale`, `flow_rate_lps`,
`has_odor`, `water_clarity`, `note`, `reported_at`. `pageSize` is clamped to 100.

```jsonc
// 200
{ "data": [ … ], "meta": { "pagination": { "page": 1, "pageSize": 20, "total": 39, "pageCount": 2 } } }
```

## Privacy

Capture coordinates (`user_lat`, `user_lng`) are marked **private** on the Report
model and are additionally **never selected** by `history` — they cannot leak
through these endpoints regardless of model config. `device_id` is likewise not
exposed. (GDPR / spec §9.2.)
