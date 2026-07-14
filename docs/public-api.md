# Public API — Custom Endpoints

Custom endpoints for the mobile/web clients. Thin controllers, logic in
services. Spring endpoints are defined in `src/api/spring/routes/01-spring-custom.ts`
— the `01-` prefix ensures they load **before** the core router (otherwise
`/springs/map` would be captured by core `/springs/:documentId`). Newsletter
signup lives in `src/api/newsletter-subscriber/routes/01-newsletter-subscribe.ts`.

| Method | Path | Handler | Auth | Purpose |
|---|---|---|---|---|
| GET | `/api/springs/map` | `spring.map` | public | map markers within a bbox |
| GET | `/api/springs/search` | `spring.search` | public | accent-insensitive name search → fly map to a spring |
| GET | `/api/springs/:documentId/reports` | `spring.reports` | public | paginated report history |
| GET | `/api/springs/:documentId/preview` | `spring.preview` | public | minimal share/preview payload (deep-link web fallback) |
| POST | `/api/springs/sync-chmu` | `spring.syncChmu` | API token | manual ČHMÚ sync ([docs](./chmu-sync.md)) |
| POST | `/api/newsletter/subscribe` | `newsletter-subscriber.subscribe` | public | idempotent newsletter signup |

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

## `GET /api/springs/:documentId/preview?locale=cs`

Minimal **share/preview** payload. When a user shares a spring with someone who
does **not** have the app installed, the deep link falls back to the web; this
endpoint feeds that preview page (with a call-to-action to install the app).

**Teaser boundary** (spec §3, §11): returns only fields that live directly on
the Spring object — `name`, `lat`, `lng`, `description`, a `photo`,
`current_status` (whether it currently flows) and `status_updated_at` (when that
was last updated). It **deliberately withholds** the flow **strength**
(`last_flow_scale` / `last_flow_rate_lps`), water clarity/odor and the **report
history** — those stay app-only, so the web page shows the basics and links to
the app for more.

No server-side freshness/staleness verdict: the web just shows the raw
`status_updated_at` and lets the reader judge (the tri-state "stale" rule stays a
client concern, as on `/map` and `/search`).

| Param | Required | Default | Notes |
|---|---|---|---|
| `locale` | no | i18n default | which localized `name` / `description` to return |

**Locale fallback (share links must not die on language).** Reads the
**published** row in the requested locale, but if that misses — an unsupported
locale, or a spring **not yet published in that language** — it falls back to the
**default locale** rather than 404-ing. A `404` means the spring is
missing/unpublished in the default locale too. The response echoes the
**actually served** `locale` so the web knows which language it got (may differ
from the requested one after a fallback).

Field optionality mirrors the Spring schema: `name`, `lat`, `lng`,
`current_status` and `locale` are **required** (always present);
`status_updated_at`, `description` and `photo` are **optional** — `null` when
unset. `photo` is especially expected to be `null` for now (not yet populated);
the web handles missing values.

```jsonc
// 200
{ "data": {
  "documentId": "…", "name": "Ostružná", "lat": 50.18, "lng": 17.05,
  "current_status": "is_flowing", "status_updated_at": "2026-05-31T05:00:00.000Z",
  "description": "Studánka u modré značky…",
  "photo": { "url": "https://…/spring.jpg", "alternativeText": null,
             "width": 1600, "height": 1200, "thumbnail_url": "https://…/thumbnail_spring.jpg" },
  "locale": "cs"
} }
// photo is null when no image is set; description/status_updated_at likewise.
// locale is the served language — may differ from the requested one on fallback.
```

## Privacy

Capture coordinates (`user_lat`, `user_lng`) are marked **private** on the Report
model and are additionally **never selected** by `history` — they cannot leak
through these endpoints regardless of model config. `device_id` is likewise not
exposed. (GDPR / spec §9.2.)

## `POST /api/newsletter/subscribe`

Public, write-only newsletter signup for the separate website / launch page.
This endpoint is intentionally isolated from the spring/report API surface and
does **not** expose core `newsletter-subscriber` CRUD routes.

```jsonc
// request
{
  "email": "user@example.com",
  "consent": true,
  "source": "website-footer",
  "preferredLanguage": "cs",
  "consentVersion": "2026-07-10",
  "sourceRef": "/newsletter"
}
```

Request field names are camelCase. Strapi stores some attributes internally as
snake_case, but clients should not send snake_case field names to this endpoint.
Send the object as the top-level JSON body, not inside the core REST `{ "data": ... }`
envelope.

`source`, `preferredLanguage`, `consentVersion` and `sourceRef` are optional
metadata. The backend does **not** invent defaults for them: if the web does not
send them, a new or reactivated consent is stored without those metadata. Blank
strings are treated as omitted.

| Field | Meaning | Recommended values / format |
|---|---|---|
| `source` | Stable, low-cardinality signup placement/channel identifier. Use it for analytics grouping: "which form or product surface created this signup?" | Optional free-form text, trimmed, max 80 chars. Prefer controlled slug values such as `prelaunch-page`, `website-hero`, `website-footer`, `mobile-app`. Do not put URLs, query strings, campaign IDs, user input, or per-request values here. The backend does not whitelist this field. |
| `preferredLanguage` | Preferred language/locale for future newsletter communication, derived from the web/app i18n locale at the moment of signup. | Optional BCP 47-style language/locale tag, e.g. `cs`, `en`, `cs-CZ`, `en-US`, `sk`. Underscores are normalized to hyphens (`cs_CZ` -> `cs-CZ`) and casing is normalized. If the UI locale is unknown, omit it. |
| `consentVersion` | Version of the privacy/marketing consent text shown to the user. | Optional stable version string, max 80 chars, e.g. `2026-07-10` or `newsletter-consent-2026-07-10`. |
| `sourceRef` | Specific context where the signup happened. Use it for traceability: "which exact page/screen produced this signup?" | Optional text, trimmed, max 2048 chars. For web signups, prefer an absolute canonical URL such as `https://studankyapp.cz/` or `https://studankyapp.cz/prelaunch`; absolute URLs are clearer across production/staging domains. A relative path like `/newsletter` is acceptable when the caller has a single unambiguous public origin. For native/mobile contexts use an app/screen identifier such as `mobile-app:ios:prelaunch`. Do not put secrets, auth/session tokens, raw referrer headers, or unrelated user-provided text into it. |

The frontend should also include a hidden honeypot field named `website`. Real
users leave it empty; if a bot fills it, the server returns a neutral success
without storing anything.

```jsonc
// 200
{ "data": { "ok": true } }
```

Validation errors return `400` (`email` invalid or over 254 chars,
`consent !== true`, malformed/overlong `preferredLanguage` when provided,
or optional metadata over its documented max length). Payloads over
`NEWSLETTER_SUBSCRIBE_MAX_BODY_BYTES` return `413`. Repeated attempts for the
same normalized email may return `429` with `Retry-After` (in-memory server-side
limiter; the web's Next Server Action should still do the primary IP rate
limit).

Duplicate submissions are idempotent: the server normalizes the email into
private `email_normalized`, reuses the existing subscriber when found,
reactivates `unsubscribed` / `bounced` contacts on fresh consent, and always
returns the same neutral success response so callers cannot enumerate stored
emails. For an already `active` subscriber, omitted optional metadata do not
erase previously stored metadata. For reactivation from `unsubscribed` /
`bounced`, omitted optional metadata are cleared so stale metadata are not
attached to the new consent event.
