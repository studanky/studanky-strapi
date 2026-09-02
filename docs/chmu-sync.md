# ČHMÚ Sync

The ČHMÚ integration imports spring station metadata and discharge observations
into the canonical Spring and Report models.

## Source contract used by this project

ČHMÚ groundwater Open Data is a static HTTPS file tree rooted at:

```text
https://opendata.chmi.cz/hydrology/groundwater
```

Only these resources and fields are consumed:

| Resource | Used data |
|---|---|
| `now/metadata/meta1.json` | `DataCollection` rows for which `OBJECT_TYPE` is `spring`; `objID`, `OBJECT_NAME`, `GEOGR1`, `GEOGR2`, and optional `ALTITUDE`. |
| `now/data/{objID}_D.json` | Newest point from the `YD` / `L_S` time series. |
| `recent/data/{objID}_D_{YYYYMM}.json` | Current- and previous-month fallback when the `now` file is missing or empty. |

`YD` is daily spring discharge and `L_S` is litres per second. Parsing resolves
`DataCollection` columns from the `header` and selects time series by identifier
and unit, never by array position. Other ČHMÚ branches are not used.

## Components

| Responsibility | Location |
|---|---|
| HTTP fetch and source parsing | `src/api/spring/services/chmu-client.ts` |
| Canonical mapping and persistence | `src/api/spring/services/spring.ts` → `syncFromChmu()` |
| Scheduled trigger | `config/cron-tasks.ts` |
| Cron enablement | `config/server.ts` |
| Shell trigger | `scripts/ops/sync-chmu.js` |
| HTTP trigger | `POST /api/springs/sync-chmu` |

The adapter returns neutral `ChmuStation` and `ChmuValue` DTOs and contains no
Strapi persistence logic. Fetches use a 15-second timeout, two retries with
backoff, and treat HTTP 404 as missing data.

## Synchronization flow

### 1. Station upsert

The service requires `cs` to be configured in Strapi i18n. It finds draft
Springs by `external_source = "chmu"` and `external_id = objID`, then creates or
updates and publishes the Czech source variant.

New documents receive `source_locale = "cs"` and `current_status = "unknown"`.
Existing ČHMÚ documents must have the same source locale and a Czech draft.

After publishing Czech, the sync copies only this source-owned scalar allowlist
to every existing physical locale row:

- `name`
- `name_search`
- `lat`
- `lng`
- `external_source`
- `external_id`

It does not create translations, modify `description`, change another locale's
publication state, or copy cached status fields.

### 2. Value fetch

Values are fetched with concurrency 8. The service tries the `now` file first,
then the current and previous `recent` monthly files. Each station is isolated
so one failure does not abort the complete run.

### 3. Report append and denormalization

A new Report is created only when its `dt` is strictly newer than the Spring's
cached `status_updated_at`. The report contains:

- `source_type = "chmu"`
- `is_flowing = valueLps > 0`
- `flow_rate_lps = valueLps`
- `flow_scale` resolved from Platform Config
- `reported_at = dt`
- the Spring relation

ČHMÚ reports leave fields unsupported by the source unset. After creation,
`spring.refreshLatest(documentId)` updates the Spring cache. The timestamp check
makes repeated syncs idempotent for unchanged source data.

## Pairing index

`(external_source, external_id)` has a non-unique database index. A localized
Draft & Publish Spring has several physical rows with the same source pair, so a
database unique constraint would reject valid publication and localization
rows. The sync locates an existing draft before creating a document.

See [Database Indexes & Migrations](./database-migrations.md).

## Result and logging

The service logs and returns:

```json
{
  "stations": 85,
  "locales": ["cs", "en"],
  "default_locale": "cs",
  "sync_locale": "cs",
  "created": 0,
  "updated": 85,
  "localized_created": 0,
  "localized_updated": 85,
  "reports": 12,
  "recent": 40,
  "skipped": 73,
  "errors": 0
}
```

Counts are illustrative. `recent` counts values obtained through the monthly
fallback. `skipped` counts missing or non-newer observations. The shell command
exits non-zero when `errors` is greater than zero.

## Scheduling and manual execution

The cron runs daily at `03:30` in `Europe/Prague` and is enabled through
`CRON_ENABLED` (default `true`). Disable it in environments that must not import
source data.

Preferred shell execution:

```bash
npm run sync:chmu
```

The authenticated HTTP alternative is:

```http
POST /api/springs/sync-chmu
```

Both entrypoints call the same service. Neither changes the global default
locale; ČHMÚ always writes the configured Czech source variant.
