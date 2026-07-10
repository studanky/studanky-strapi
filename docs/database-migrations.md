# Database Indexes & Migrations

Indexes that the Content-Type Builder cannot express are created idempotently
during Strapi bootstrap, after Strapi has synchronized the content-type schema.
This matters for fresh databases: Strapi runs `database/migrations/` before the
`springs` / `reports` tables exist, so index creation cannot safely live only in
a migration file.

**Runtime hook:** `src/index.ts` → `ensureDbIndexes()`

**Compatibility migration:** `database/migrations/2026.05.31T00.00.00.spring-report-indexes.js`
is kept as a safe no-op for migration-history stability.

| Table | Index | Type | Purpose |
|---|---|---|---|
| `springs` | `(external_source, external_id)` | index | fast ČHMÚ pairing lookup |
| `springs` | `(lat, lng)` | index | map bbox query |
| `springs` | `(status_updated_at)` | index | freshness / sorting |
| `reports` | `(client_report_id)` | **UNIQUE** | offline-queue idempotence |
| `reports` | `(reported_at)` | index | history sorting |
| `newsletter_subscribers` | `(email_normalized)` | **UNIQUE** | newsletter subscribe idempotence / duplicate protection |

## Why springs pairing is NOT a unique index

Spring has **Draft & Publish**, so each published document is stored as **two
rows** (draft + published) that share the same `external_source` / `external_id`
(non-localized fields). A naive DB `UNIQUE` across all rows would reject the
published row and break the ČHMÚ sync. So:

- the DB index on `(external_source, external_id)` is **plain (non-unique)**;
- pairing uniqueness is enforced in the [ČHMÚ sync](./chmu-sync.md) upsert
  (`findFirst` before `create`), and ČHMÚ is the only writer of `external_id`.

This is also why a generic Strapi `unique: true` attribute does not produce a DB
unique index for D&P / i18n content types — Strapi enforces such uniqueness at
the application layer.

## Why reports `client_report_id` IS a unique index

Report has Draft & Publish **disabled** → one row per document, so a DB UNIQUE is
safe and gives a hard idempotence guarantee for the offline submit queue. The
index permits multiple `NULL`s (ČHMÚ reports carry no `client_report_id`).

## `report.spring`

Not added here — already indexed via Strapi's relation link table
(`reports_spring_lnk`).

## Why newsletter `email_normalized` IS a unique index

Newsletter Subscriber has Draft & Publish disabled → one row per subscriber. The
public subscribe endpoint normalizes emails (`trim` + lowercase copy in
`email_normalized`) and performs an idempotent create/update. The DB UNIQUE index
is still required as a hard guarantee when two subscribe requests for the same
email arrive concurrently.
