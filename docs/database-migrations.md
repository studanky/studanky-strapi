# Database Indexes & Migrations

Database migrations perform release-specific data transformations before schema
synchronization. Idempotent bootstrap helpers create application indexes and
repair derived search data after Strapi has synchronized the content-type
schema. This split is necessary because a fresh database does not yet contain
the application tables when `database/migrations/` runs.

`src/index.ts` invokes three helpers during bootstrap:

- `ensureDbIndexes()` creates portable indexes when their tables and columns
  exist;
- `ensureSpringSearchNames()` repairs missing or stale `name_search` values;
- `ensureSpringSearchIndexes()` attempts to enable PostgreSQL `pg_trgm` and
  create a partial GIN trigram index for `name_search`.

The trigram optimization is PostgreSQL-only. Failure to create its extension or
index is logged as a warning so the application can still start with functional,
but potentially slower, search.

**Compatibility migration:** `database/migrations/2026.05.31T00.00.00.spring-report-indexes.js`
is kept as a safe no-op for migration-history stability.

## 1.5.0 Spring source-locale migration

`database/migrations/2026.08.24T00.00.00.spring-source-locale.js` adds private,
non-localized `source_locale` document metadata. Because migrations run before
schema sync, it creates the column itself on an existing `springs` table; a
fresh database remains a safe no-op and schema sync creates the field.

For every `document_id`, the portable Knex migration:

1. preserves an existing single consistent source value;
2. assigns `cs` to ČHMÚ documents and requires their Czech row;
3. uses the only locale when a document has one;
4. otherwise uses a uniquely earliest-created locale;
5. fails and rolls back on conflicts, timestamp ambiguity, or invalid rows.

The selected value is copied to all draft/published physical rows of the
document. Row counts, content, locale, publication state, timestamps and
relations do not change. Automated SQLite coverage lives in
`tests/unit/spring-source-locale-migration.test.ts`; rehearse both 1.5.0
migrations in filename order on PostgreSQL before production.

`database/migrations/2026.09.04T00.00.00.repair-spring-source-locale.js`
re-applies the same idempotent inference once for deployments where a later
data import or row rewrite restored `NULL` values after the original migration
was recorded. Existing valid source metadata is preserved.

## 1.5.0 canonical Spring name migration

`database/migrations/2026.08.25T00.00.00.canonical-spring-name.js` runs after
the source-locale backfill and prepares existing data before `name` and
`name_search` become non-localized. Strapi runs each migration once,
transactionally, before content-type schema sync.

The migration is intentionally DML-only and uses portable Knex APIs for both
development SQLite and production PostgreSQL. On a fresh database where the
`springs` table does not yet exist, it exits safely. On an existing database it:

1. validates all required Spring columns, including `source_locale`;
2. groups rows by `document_id` and separately by draft/published state;
3. requires one consistent source locale on every physical row in a group;
4. requires exactly one source-locale row in every group;
5. copies that row's official `name` to every existing localization and
   rebuilds `name_search` with the application's normalization algorithm.

It does not change row counts, `document_id`, locale, publication state,
timestamps, or relations. Missing/ambiguous source variants fail the migration
and roll back its transaction instead of guessing a canonical name.

The automated SQLite fixture test is
`tests/unit/canonical-spring-name-migration.test.ts`. Before production, rehearse
both migrations in filename order against a temporary PostgreSQL database and
an anonymized snapshot/count audit.

### ČHMÚ production preflight

The current production dataset contains only ČHMÚ Springs, whose authoritative
source locale is `cs`. This portable SQLite/PostgreSQL query must return no rows;
it lists every draft/published group that lacks exactly one Czech source row:

```sql
SELECT
  document_id,
  CASE
    WHEN published_at IS NULL THEN 'draft'
    ELSE 'published'
  END AS publication_state,
  COUNT(*) AS locale_rows,
  SUM(CASE WHEN locale = 'cs' THEN 1 ELSE 0 END) AS source_rows
FROM springs
WHERE external_source = 'chmu'
GROUP BY
  document_id,
  CASE WHEN published_at IS NULL THEN 'draft' ELSE 'published' END
HAVING SUM(CASE WHEN locale = 'cs' THEN 1 ELSE 0 END) <> 1
ORDER BY document_id, publication_state;
```

If startup reports a failing `document_id`, repair its source draft/published
variant, verify the official source name, and restart the same application
version. A failed migration is not recorded as complete, so Strapi retries it.

After migration or data transfer, the following audit must also return no rows:

```sql
SELECT
  document_id,
  COUNT(*) AS physical_rows,
  COUNT(source_locale) AS rows_with_source,
  COUNT(DISTINCT source_locale) AS distinct_sources
FROM springs
GROUP BY document_id
HAVING COUNT(source_locale) <> COUNT(*)
   OR COUNT(DISTINCT source_locale) <> 1
ORDER BY document_id;
```

Strapi does not support `down()` migrations. Back up SQLite/PostgreSQL before
deployment; rollback is a database restore plus the previous application
version. See the [localization runbook](./localization.md).

| Table                    | Index                                                    | Type           | Managed by                  | Purpose                                        |
| ------------------------ | -------------------------------------------------------- | -------------- | --------------------------- | ---------------------------------------------- |
| `springs`                | `(external_source, external_id)`                         | index          | `ensureDbIndexes`           | ČHMÚ pairing lookup                            |
| `springs`                | `(lat, lng)`                                             | index          | `ensureDbIndexes`           | map bounding-box query                         |
| `springs`                | `(status_updated_at)`                                    | index          | `ensureDbIndexes`           | status sorting and freshness queries           |
| `springs`                | `name_search gin_trgm_ops WHERE name_search IS NOT NULL` | PostgreSQL GIN | `ensureSpringSearchIndexes` | partial accent-normalized name search          |
| `reports`                | `(client_report_id)`                                     | **UNIQUE**     | `ensureDbIndexes`           | reserved idempotency key                       |
| `reports`                | `(reported_at)`                                          | index          | `ensureDbIndexes`           | history sorting                                |
| `newsletter_subscribers` | `(email_normalized)`                                     | **UNIQUE**     | `ensureDbIndexes`           | subscribe idempotence and duplicate protection |

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
safe and provides a hard uniqueness guarantee for the reserved idempotency key.
The index permits multiple `NULL`s; current ČHMÚ reports do not set
`client_report_id`.

## `report.spring`

Not added here — already indexed via Strapi's relation link table
(`reports_spring_lnk`).

## Why newsletter `email_normalized` IS a unique index

Newsletter Subscriber has Draft & Publish disabled → one row per subscriber. The
public subscribe endpoint normalizes emails (`trim` + lowercase copy in
`email_normalized`) and performs an idempotent create/update. The DB UNIQUE index
is still required as a hard guarantee when two subscribe requests for the same
email arrive concurrently.
