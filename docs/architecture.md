# Architecture

This document describes the current Studánky Strapi backend. It is derived from
the committed Strapi schemas, routes, controllers, services, configuration, and
bootstrap code. It does not describe planned application features.

## Runtime shape

The service is a Strapi v5 TypeScript application with four main responsibilities:

1. expose a small public read API for springs and their report history;
2. import spring metadata and discharge measurements from ČHMÚ;
3. provide content management and manager-scoped Spring administration;
4. accept idempotent newsletter subscriptions through an isolated public route.

Production uses PostgreSQL. Local development defaults to SQLite. Media is stored
under `public/uploads` or through the optional S3-compatible upload provider.

## Content types and components

### Spring — `api::spring.spring`

Spring is localized and uses Draft & Publish. `description` is the only localized
business field; canonical identity, position, status, source metadata, and media
are shared across locale rows.

| Attribute | Type | Notes |
|---|---|---|
| `name` | string, required | Canonical, non-localized official name. |
| `description` | text | Localized editorial description. |
| `lat`, `lng` | decimal, required | WGS-84 coordinates. |
| `current_status` | enum, required | `is_flowing`, `is_not_flowing`, or `unknown`. |
| `status_updated_at` | datetime | Timestamp of the report represented by the cached status. |
| `last_flow_scale` | integer | Cached 1–5 scale from the latest report. |
| `last_flow_rate_lps` | decimal | Cached discharge in litres per second. |
| `photo`, `qr_code` | media | Single image relations. |
| `owner` | many-to-one relation | Organizational owner metadata. |
| `managers` | one-to-many relation to `admin::user` | Used by the Admin Panel scope middleware. |
| `reports` | one-to-many relation | Report history, mapped by `report.spring`. |
| `external_source`, `external_id` | string | External-source pairing; currently ČHMÚ. |
| `source_locale` | private string | Immutable source language shared by every physical row. |
| `name_search` | private string | Accent-insensitive normalized search value. |

The current `managers` schema cardinality is `oneToMany`. This document records
that implementation as-is; changing it to a many-to-many model is outside the
documentation scope.

### Report — `api::report.report`

Report has Draft & Publish disabled. Reports are currently created internally by
the ČHMÚ sync. There is no Report router, so the content API exposes no core
Report CRUD endpoint.

| Attribute | Type | Notes |
|---|---|---|
| `spring` | many-to-one relation | Parent Spring. |
| `source_type` | enum, required | `chmu` or `user`; defaults to `user`. |
| `is_flowing` | boolean, required | Observation represented by the report. |
| `flow_scale` | integer | Optional 1–5 normalized strength. |
| `flow_rate_lps` | decimal | Optional measured discharge. |
| `has_odor` | boolean | Optional observation. |
| `water_clarity` | enum | Optional clarity category. |
| `note` | text | Optional note. |
| `reported_at` | datetime, required | Observation time and history sort key. |
| `user_lat`, `user_lng` | private decimal | Capture coordinates. |
| `device_id` | string | Internal identifier; excluded from public history queries. |
| `client_report_id` | unique string | Reserved idempotency key; excluded from public history queries. |

### Owner — `api::owner.owner`

Owner stores organizational metadata. Its current `type` enum contains only
`chmu`. The `springs` one-to-many relation is inverse to `spring.owner`. Owner is
not the Admin Panel authorization mechanism; authorization uses `spring.managers`.

### Platform Config — `api::platform-config.platform-config`

This single type stores `freshness_threshold_days` and the repeatable
`config.flow-range` component. Each range contains a `scale` from 1 to 5 and an
inclusive `min_lps` / `max_lps` interval.

### Newsletter Subscriber — `api::newsletter-subscriber.newsletter-subscriber`

Newsletter Subscriber stores normalized, consent-related subscription data.
Draft & Publish is disabled. Core CRUD routes are explicitly disabled; only the
dedicated subscribe endpoint is exposed.

## Main data flows

### Public Spring reads

Custom routes delegate to the Spring controller and service. Map and search use
an explicit field allowlist and select one published locale row per `documentId`.
Detail retains the Strapi core response contract while adding document-level
locale fallback. History selects an explicit Report field allowlist.

See [API Reference](./api-reference.md) and [Localization](./localization.md).

### ČHMÚ import

`chmu-client.ts` fetches and parses source data into neutral DTOs.
`spring.syncFromChmu()` maps those DTOs into canonical Spring and Report records,
then calls `spring.refreshLatest()` to update cached Spring status fields. A cron
task triggers the same service every day at 03:30 Europe/Prague.

See [ČHMÚ Sync](./chmu-sync.md) and
[Status Denormalization](./denormalization.md).

### Spring lifecycle

Spring lifecycle hooks establish and protect `source_locale`, maintain
`name_search`, and create one QR PNG containing the immutable `documentId`.

See [Lifecycle Hooks](./lifecycle-hooks.md).

### Newsletter subscription

The public controller validates and normalizes the request, handles the honeypot
and body-size guard, applies an in-memory limiter keyed by an HMAC hash of the
normalized email, and delegates the idempotent write to the service.

## Bootstrap and database responsibilities

`src/index.ts` registers the Spring Document Service scope middleware. During
bootstrap it:

1. creates portable application indexes when their tables and columns exist;
2. backfills stale or missing `name_search` values;
3. attempts to create the PostgreSQL `pg_trgm` GIN search index.

Database migrations handle release-specific data transformations. Bootstrap
helpers handle idempotent structures that must also exist on fresh databases.
See [Database Indexes & Migrations](./database-migrations.md).

## Access boundaries

- Custom map, search, history, preview, and newsletter subscription routes set
  `auth: false` explicitly.
- Spring detail and Platform Config use core routes and require the appropriate
  Users & Permissions Public-role actions when unauthenticated access is wanted.
- The manual ČHMÚ sync route requires authentication.
- Spring Admin Panel reads and writes are filtered by `spring.managers` for
  non-super-admin users.
- Internal service and cron calls bypass the Admin Panel scope.

See [API Security](./api-security.md) and
[Admin Panel Filtering](./admin-filtering.md).
