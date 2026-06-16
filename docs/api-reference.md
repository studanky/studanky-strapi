# Studánky — Mobile API Reference

API contract for the **Flutter client** (and any other consumer). Describes
every endpoint the app needs to deliver the MVP feature set from the
[product spec](./studanky-specifikace.md): a map of springs with a three‑state
freshness icon, a spring detail with lazy‑loaded history, and the dynamic
configuration the client uses to compute freshness and the flow scale itself.

> **Scope.** This documents the **read‑only MVP** (spec §11). Community report
> submission (`POST /api/reports`, HMAC, geofence, offline queue) is **Phase 2 —
> not implemented in the backend yet**. See [§7](#7-phase-2--report-submission-not-yet-available)
> and [Flutter Integration](./flutter-integration.md) for the planned contract;
> do **not** build against it as if it exists.

---

## 1. Conventions

### Base URL & prefix

| Environment | Base URL |
|---|---|
| Local dev | `http://localhost:1337` |
| Production | `https://<DOMAIN>` |

All content endpoints are under the **`/api`** prefix, e.g.
`https://<DOMAIN>/api/springs/map`. Uploaded media (`photo`, `qr_code`) is served
from `/uploads/...` (local) or the configured S3/R2 CDN host — always use the
**absolute `url`** returned in the payload, never construct it yourself.

### Authentication

The MVP read surface is **public — no token required**:

| Endpoint | Auth |
|---|---|
| `GET /api/springs/map` | none (route is `auth:false`) |
| `GET /api/springs/:documentId/reports` | none (route is `auth:false`) |
| `GET /api/springs/:documentId` | none — but operator must enable `spring.findOne` for the **Public** role |
| `GET /api/platform-config` | none — but operator must enable `platform-config.find` for the **Public** role |
| `POST /api/springs/sync-chmu` | **API token** (ops‑only, not for the app) |

> ⚠️ Two of the endpoints the app relies on (`GET /api/springs/:documentId` and
> `GET /api/platform-config`) are **Strapi core handlers** gated by role
> permissions. They return `403 Forbidden` until an operator enables them for the
> Public role in **Settings → Users & Permissions → Roles → Public**. The two
> custom endpoints (`/map`, `/reports`) are always open. If you get a 403 on
> detail/config in a fresh environment, that's the cause — flag it to the backend
> operator, it is not a client bug.

### Identifiers — `documentId`

Strapi v5 identifies every entry by a stable **`documentId`** (a string like
`"k9f2a7b3c1d0e8"`), **not** the numeric `id`. Always use `documentId` in URLs
and as the spring key in your local store. **The QR codes encode `documentId`**,
so the value you scan in Phase 2 is the same key you use everywhere here.

### Localization (i18n)

`name` and `description` are **localized**; `lat`, `lng`, `current_status` and all
report fields are **not**. Request a language with `?locale=cs` (or `en`, …). If
omitted, the server's **default locale** is used. The map endpoint always serves
the default locale (see [§3.1](#31-get-apispringsmap)).

### Content type & errors

Responses are `application/json`. Errors follow Strapi's standard envelope:

```jsonc
{ "data": null,
  "error": { "status": 400, "name": "BadRequestError", "message": "…", "details": {} } }
```

Relevant status codes: `400` invalid/missing query (e.g. bad `bbox`), `403` role
not permitted, `404` unknown `documentId`.

### Response shapes — heads up

This API mixes **two** response shapes. Don't assume one:

- **Custom endpoints** (`/map`, `/reports`) return a **flat, hand‑built payload** —
  the objects are plain (no Strapi `attributes` nesting), e.g. `data[i].name`.
- **Core endpoints** (`/springs/:documentId`, `/platform-config`) return the
  **standard Strapi v5 shape** — `{ data, meta }`, fields flattened onto `data`,
  and **relations/media/components are not included unless you `populate`** them.

---

## 2. Data model

### 2.1 Spring (`api::spring.spring`)

| Field | Type | Notes |
|---|---|---|
| `documentId` | string | **stable id**, used in URLs & QR codes |
| `name` | string | localized |
| `name_search` | string | private/internal; localized normalized copy of `name` for accent-insensitive search |
| `description` | text \| null | localized |
| `lat`, `lng` | number | WGS‑84 decimal degrees (not localized) |
| `current_status` | enum | `is_flowing` \| `is_not_flowing` \| `unknown` — **denormalized** cache of the latest report (see [§4](#4-client-side-logic)) |
| `status_updated_at` | datetime \| null | ISO‑8601 UTC; timestamp of the latest report. **This is the freshness anchor.** |
| `last_flow_scale` | int \| null | 1–5, from the latest report |
| `last_flow_rate_lps` | number \| null | measured discharge (l/s) from the latest report, if any |
| `photo` | media \| null | single image — populate to get it |
| `qr_code` | media \| null | generated QR PNG (encodes `documentId`) — populate to get it |
| `owner` | relation \| null | the B2B owner (e.g. ČHMÚ) — populate to get it |
| `external_source` | string \| null | e.g. `"chmu"` — provenance of the Spring/station metadata, not the latest Report |
| `external_id` | string \| null | source key (ČHMÚ `objID`) |

> `managers` (admin users) exists on the model but is an **admin‑only** relation —
> **do not populate or rely on it** from the app.

### 2.2 Report (`api::report.report`)

One status record for a spring (from ČHMÚ in the MVP; from users in Phase 2).

| Field | Type | Notes |
|---|---|---|
| `documentId` | string | record id |
| `is_flowing` | boolean | **always present** — the core "teče / neteče" signal |
| `flow_scale` | int \| null | 1–5 shared scale (see [§4.3](#43-flow-strength-1-5-scale)) |
| `flow_rate_lps` | number \| null | measured discharge (l/s); present for measured/ČHMÚ records |
| `has_odor` | boolean \| null | smell yes/no (null = not reported, e.g. ČHMÚ) |
| `water_clarity` | enum \| null | `crystal_clear` \| `clear` \| `slightly_turbid` \| `turbid` \| `heavily_turbid` |
| `note` | text \| null | free text |
| `reported_at` | datetime | ISO‑8601 UTC — sort/age key |
| `source_type` | enum | `chmu` \| `user` — data origin for client badges; server-owned, never trusted from client input |

**Never exposed via the API** (private, GDPR — spec §9.2): `user_lat`, `user_lng`,
`device_id`, `client_report_id`. Don't expect them in any response.

### 2.3 Platform Config (`api::platform-config.platform-config`) — single type

| Field | Type | Notes |
|---|---|---|
| `freshness_threshold_days` | int | default **14** — age after which a status is "stale" |
| `flow_scale_ranges` | component[] | l/s → 1–5 mapping table (populate to get it) |

`flow_scale_ranges[]` items (`config.flow-range`):

| Field | Type |
|---|---|
| `scale` | int 1–5 |
| `min_lps` | number |
| `max_lps` | number |

---

## 3. Endpoints

### 3.1 `GET /api/springs/map`

The hot map path. Returns the **minimal** marker payload for every spring inside
a bounding box — no history, no private data. Serves **published, default‑locale**
rows.

**Query**

| Param | Required | Format | Example |
|---|---|---|---|
| `bbox` | yes | `minLng,minLat,maxLng,maxLat` | `14.2,49.9,14.6,50.2` |

Missing or non‑numeric `bbox` → **`400`**. An empty box returns `{ "data": [] }`.

**Response 200** (flat objects)

```jsonc
{
  "data": [
    {
      "documentId": "k9f2a7b3c1d0e8",
      "name": "Ostružná",
      "lat": 50.18,
      "lng": 17.05,
      "current_status": "is_flowing",
      "status_updated_at": "2026-05-31T05:00:00.000Z"
    }
  ]
}
```

**Client usage**

- Re‑query as the user pans/zooms (debounce on map‑idle), passing the current
  viewport as `bbox`. Do **clustering client‑side** (spec §4.1).
- Render the marker icon from `current_status` **+** `status_updated_at` — see
  [§4.1](#41-three-state-icon-teče--neteče--stale). The "stale" state is **computed
  on the client**, the server never returns it as a fourth value.

### 3.2 `GET /api/springs/:documentId`

Full spring detail (core handler — requires Public `spring.findOne`). Use it for
the detail screen header (name, description, photo, owner, coordinates).

**Populate** what you need (Strapi v5 omits relations/media by default):

```
GET /api/springs/k9f2a7b3c1d0e8?populate[photo]=true&populate[owner]=true&locale=cs
```

**Response 200** (standard Strapi shape)

```jsonc
{
  "data": {
    "documentId": "k9f2a7b3c1d0e8",
    "name": "Ostružná",
    "description": "Pramen u modré značky…",
    "lat": 50.18,
    "lng": 17.05,
    "current_status": "is_flowing",
    "status_updated_at": "2026-05-31T05:00:00.000Z",
    "last_flow_scale": 3,
    "last_flow_rate_lps": 0.42,
    "external_source": "chmu",
    "external_id": "0-203-1-PB0013",
    "locale": "cs",
    "photo": { "url": "https://…/uploads/ostruzna.jpg", "width": 1600, "height": 900, "formats": { "thumbnail": { "url": "…" } } },
    "owner": { "documentId": "…", "name": "ČHMÚ", "type": "chmu" }
  },
  "meta": {}
}
```

> You can read most header data straight from the marker you already have; fetch
> the detail when the user opens a spring (cheaper than over‑populating the map).

### 3.3 `GET /api/springs/:documentId/reports`

Paginated report **history** for the detail screen (spec §4.1 lazy loading). Always
public. Returns an explicit **public field allowlist** only.

**Query**

| Param | Default | Notes |
|---|---|---|
| `page` | `1` | 1‑based |
| `pageSize` | `20` | clamped to **1–100** |

Sorted **newest first** (`reported_at` desc).

**Response 200**

```jsonc
{
  "data": [
    {
      "documentId": "r1a2b3…",
      "is_flowing": true,
      "flow_scale": 3,
      "flow_rate_lps": 0.42,
      "has_odor": false,
      "water_clarity": "clear",
      "note": null,
      "reported_at": "2026-05-31T05:00:00.000Z",
      "source_type": "chmu"
    }
  ],
  "meta": { "pagination": { "page": 1, "pageSize": 20, "total": 39, "pageCount": 2 } }
}
```

**Client usage**

- Infinite scroll: load `page=1`, then `page+1` until `page >= pageCount`.
- Show **concrete age** of `data[0].reported_at` ("ověřeno před 3 dny") — spec
  makes data freshness a first‑class value.
- Use `source_type` for a source badge (`chmu` vs `user`). It is the origin of
  the record, not a trust score.
- `flow_rate_lps` is a **confirming, secondary** number ("measured, not a guess");
  surface it next to the 1–5 scale when present.

### 3.4 `GET /api/platform-config`

Dynamic parameters the client **downloads, caches, and uses to compute state
itself** (spec §7.2). Single type (core handler — requires Public
`platform-config.find`).

**Populate** the ranges component:

```
GET /api/platform-config?populate[flow_scale_ranges]=true
```

**Response 200**

```jsonc
{
  "data": {
    "freshness_threshold_days": 14,
    "flow_scale_ranges": [
      { "scale": 1, "min_lps": 0.0,  "max_lps": 0.1 },
      { "scale": 2, "min_lps": 0.1,  "max_lps": 0.5 },
      { "scale": 3, "min_lps": 0.5,  "max_lps": 1.0 },
      { "scale": 4, "min_lps": 1.0,  "max_lps": 3.0 },
      { "scale": 5, "min_lps": 3.0,  "max_lps": 999 }
    ]
  },
  "meta": {}
}
```

**Client usage**: fetch once on launch (and refresh periodically / on app
foreground), cache it, and feed it into the freshness and flow‑scale logic below.
The values shown are illustrative — read the live ranges, never hardcode them.

### 3.5 `POST /api/springs/sync-chmu` — ops only (not for the app)

Manually triggers the ČHMÚ import (same logic as the nightly **03:30 Europe/Prague**
cron). **Requires an admin API token**; not part of the client flow. Documented
here only so you don't accidentally call it. Returns import stats
(`{ data: { stations, created, updated, reports, … } }`).

---

## 4. Client‑side logic

The server intentionally keeps marker computation on the client so the displayed
state is always accurate against the device's "now", independent of when data was
fetched (spec §7.2).

### 4.1 Three‑state icon (teče / neteče / stale)

The map returns only `is_flowing` / `is_not_flowing` / `unknown` plus
`status_updated_at`. Compute the **third "stale" state yourself**, and let it
**override** flowing/not‑flowing:

```dart
enum SpringIcon { flowing, notFlowing, stale, unknown }

SpringIcon iconFor(String status, DateTime? statusUpdatedAt, int thresholdDays) {
  if (statusUpdatedAt == null || status == 'unknown') return SpringIcon.unknown;

  final ageDays = DateTime.now().toUtc().difference(statusUpdatedAt).inDays;
  if (ageDays > thresholdDays) return SpringIcon.stale; // overrides flow state

  return status == 'is_flowing' ? SpringIcon.flowing : SpringIcon.notFlowing;
}
```

- `thresholdDays` = `platform-config.freshness_threshold_days` (default 14).
- "Stale" must read **neutrally** ("neznámo") — after the threshold we no longer
  reliably know (spec §4.1). This already matters in the MVP: the nightly cron
  only refreshes *some* springs, so others legitimately go stale.

### 4.2 Concrete age (detail screen)

On the detail, always show the **specific age** of the newest record
(`reported_at` of `reports[0]`, or `status_updated_at`): "ověřeno před 3 dny",
"před 5 hodinami". Freshness visibility is the product's core differentiator.

### 4.3 Flow strength (1–5 scale)

The 1–5 scale is the **shared axis** across sources (spec §5.3). The backend
already stores `flow_scale` on each report (ČHMÚ values are converted server‑side
using the config table). You normally just **display** `flow_scale` /
`last_flow_scale` directly.

You only need `flow_scale_ranges` client‑side if you compute a scale **locally**
from a measured l/s (Phase 2 stopwatch feature). The mapping (matches the server's
[`pickFlowScale`](../src/utils/flow-scale.ts)):

```dart
int? flowScaleFromLps(double? lps, List<FlowRange> ranges) {
  if (lps == null) return null;
  for (final r in ranges) {
    if (lps >= r.minLps && lps <= r.maxLps) return r.scale; // inclusive both ends
  }
  return null; // outside every range → leave unset
}
```

### 4.4 "Open in maps" deeplink (out)

The detail offers opening the spring in the user's own routing app (spec §3.1 /
§4.1). Build the deeplink from `lat`/`lng` client‑side, e.g. Mapy.cz:
`https://mapy.cz/zakladni?y=<lat>&x=<lng>&z=17`, or a `geo:<lat>,<lng>` URI for the
OS picker. No backend call involved.

### 4.5 Disclaimer (legal)

The app must **never** claim the water is potable — it only reports flow and
parameters; use is at the user's own risk (spec §3, §9.3). This is a UI/ToS
concern; the API exposes no potability field by design.

---

## 5. Feature → endpoint map

| Spec feature | Endpoint(s) | Client work |
|---|---|---|
| Map of springs in viewport, clustering | `GET /springs/map?bbox=` | client‑side clustering, re‑query on pan/zoom |
| Three‑state icon (teče/neteče/stale) | `…/map` + `GET /platform-config` | compute stale via threshold ([§4.1](#41-three-state-icon-teče--neteče--stale)) |
| Spring detail (name, description, photo) | `GET /springs/:documentId?populate=…` | render header |
| Report history, lazy loading | `GET /springs/:documentId/reports?page=` | infinite scroll on `pageCount` |
| Concrete age of last record | any of the above | format `status_updated_at` / `reported_at` |
| Measured l/s as confirming value | `…/reports` (`flow_rate_lps`) | show beside 1–5 scale |
| Dynamic freshness threshold & flow table | `GET /platform-config?populate=flow_scale_ranges` | cache, feed into [§4](#4-client-side-logic) |
| Multi‑language (CZ first, EU later) | `?locale=cs` on detail/config | pass device locale |
| Open in external maps app | — (client only) | deeplink from `lat`/`lng` |
| Report submission (QR, offline queue) | **Phase 2** | see [§7](#7-phase-2--report-submission-not-yet-available) |

---

## 6. Caching & reliability notes

- **Config**: cache `platform-config` locally; refresh on launch/foreground. The
  app stays correct offline because the icon state is computed from cached config
  + timestamps, not a server "now".
- **Map**: cheap and re‑queried per viewport; debounce. A CDN/edge rate‑limit may
  sit in front in production — handle `429` with backoff.
- **Fallback**: if the network is down, show the last known markers/detail (spec
  §14: always show last known data).
- **Pagination**: `pageSize` is clamped to 100 server‑side; don't request more.

---

## 7. Phase 2 — report submission (not yet available)

Spec §5.2 / §8 / §12 describe QR‑driven, offline‑first community reports. The
backend for this is **not implemented in the MVP** — there is **no public
`POST /api/reports`**. When it ships, the planned client contract is:

- `POST /api/reports` with `data: { spring: <documentId>, is_flowing, flow_scale?,
  flow_rate_lps?, has_odor?, water_clarity?, note?, reported_at, client_report_id }`.
- Clients **must not send `source_type`**. The server assigns `source_type: "user"`
  on report create and ignores any client-supplied value (anti-spoofing).
- **`client_report_id`**: a stable UUID generated per queued report → idempotent
  retries from the offline queue.
- **`X-Timestamp` + `X-App-Signature`** HMAC‑SHA256 over `"{timestamp}:{springDocumentId}"`,
  **signed at queue flush** (not at capture) so offline reports don't expire.
- Server adds **rate limiting**, **geofence (≤200 m)** against the spring
  coordinates, and `client_report_id` idempotence before going public.

Full details (Dart sample, headers, errors) live in
[Flutter Integration](./flutter-integration.md) and [API Security](./api-security.md).
**Treat that as a forward‑looking spec — build the offline queue and data model
for it, but don't wire the network call until the backend confirms the endpoint
is live.**

---

## 8. Quick reference

```text
GET  /api/springs/map?bbox=minLng,minLat,maxLng,maxLat        → { data: [marker] }            public
GET  /api/springs/:documentId?populate[photo]=true&locale=cs  → { data: spring, meta }         public*
GET  /api/springs/:documentId/reports?page=1&pageSize=20      → { data: [report], meta }       public
GET  /api/platform-config?populate[flow_scale_ranges]=true    → { data: config, meta }         public*
POST /api/springs/sync-chmu                                   → { data: stats }                API token (ops)

* core handler — operator must enable it for the Public role
```
