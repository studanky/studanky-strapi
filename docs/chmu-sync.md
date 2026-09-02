# ČHMÚ Sync

Imports spring discharge data from the ČHMÚ groundwater Open Data and turns it
into canonical Spring + Report records. ČHMÚ is the **first data source adapter**,
not the model definition — its specifics stay isolated in the adapter; the rest
of the backend only ever sees the canonical model.

> Source format reference: [`chmu_groundwater_api_documentation.md`](./chmu_groundwater_api_documentation.md) (branch `now/`).

## Components

| Concern                                                 | Location                                               |
| ------------------------------------------------------- | ------------------------------------------------------ |
| Source adapter (fetch + parse, no Strapi model)         | `src/api/spring/services/chmu-client.ts`               |
| Sync orchestration (canonical mapping, upsert, reports) | `src/api/spring/services/spring.ts` → `syncFromChmu()` |
| Scheduled trigger                                       | `config/cron-tasks.ts` + `config/server.ts` (`cron`)   |
| Manual trigger (ops)                                    | `POST /api/springs/sync-chmu` → `spring.syncChmu`      |

## Adapter — `chmu-client.ts`

Pure functions returning neutral DTOs (no Strapi awareness):

- `listSpringStations()` — GET `now/metadata/meta1.json`, parses the
  `DataCollection` **positionally** (column index resolved from `header`),
  filters `OBJECT_TYPE === 'spring'`, returns `{ externalId, name, lat, lng, altitude }[]`.
- `fetchLatestValue(externalId)` — GET `now/data/{objID}_D.json`, selects the
  series by **`tsConID === 'YD' && unit === 'L_S'`** (discharge in l/s, never by
  array order), returns the newest `tsData` point `{ dt, valueLps }`, or `null`.
- `fetchRecentValue(externalId, yyyymm)` — same, from `recent/data/{objID}_D_{YYYYMM}.json`
  (monthly file, identical structure). Fallback when `now/` has no file.
- `recentMonths()` — `[currentYYYYMM, previousYYYYMM]` (UTC) to probe.

> **`now/` is incomplete.** Empirically only ~46% of spring objects have a
> `now/data` file; the rest return 404 even though `recent/data` carries equally
> fresh last points for them. So the value fetch falls back **now → recent
> (current month → previous month)**, giving complete coverage. `parseLatestValue`
> is reused for both (same JSON shape).

Hardening: per-request timeout (`AbortController`, 15 s) + retry (2×) with
backoff; HTTP `404` → `null` (object file may not exist); empty/missing series → `null`.

## Sync — `syncFromChmu()`

Maps ČHMÚ → canonical (`external_source = 'chmu'`, `external_id = objID`) and
runs in three phases:

1. **Upsert stations** (sequential, SQLite-friendly). Looked up by
   `(external_source, external_id)` across localized Spring rows. Each station is
   created/updated and published only in the **Czech source locale (`cs`)**,
   regardless of the current Strapi default locale. The sync fails before
   downloading ČHMÚ data when `cs` is not configured. New documents store the
   immutable private `source_locale = 'cs'`; existing ČHMÚ documents must have
   that same source value or the station is rejected as inconsistent. After the
   Czech publish, the sync explicitly copies only its source-owned scalar
   allowlist (`name`, `name_search`, coordinates, `external_source`,
   `external_id`) to every physical draft/published row of the document. This is
   required because Strapi's propagation of non-localized fields does not cover
   all publication states. Existing translations are never created or
   published, their publication state stays unchanged, and their localized
   `description` is never written. New springs start `current_status =
'unknown'`. If an existing document lacks a Czech draft, that station is
   skipped and `errors` is incremented.
2. **Fetch latest values** with bounded concurrency (limit 8): `now/` first,
   then `recent/` (current → previous month) when `now/` has no file. One
   failure never aborts the run (`try/catch` per object).
3. **Append report when newer.** A Report (`source_type = 'chmu'`,
   `is_flowing = valueLps > 0`, `flow_rate_lps`, `flow_scale` via
   [`flowScaleFromLps`](./denormalization.md#flow-scale), `reported_at = dt`) is
   created only if `dt` is strictly newer than the spring's
   `status_updated_at`, then [`refreshLatest`](./denormalization.md) denormalizes
   the cached status. → idempotent across daily runs (ČHMÚ updates only some objects).

ČHMÚ reports leave `has_odor` / `water_clarity` / `device_id` / `client_report_id`
as `null` (sensor data has no such fields; sync idempotence is the `dt` check, not
the offline-queue id).

`source_type` is the public data-origin flag. New ČHMÚ records are always written
as `chmu`; community/client-created records are written through the Report create
path as `user`.

### Uniqueness note

`(external_source, external_id)` is a **non-unique** DB index (Spring has Draft &
Publish → draft + published rows share the same `external_id`, so a naive DB
UNIQUE would reject the published row). Pairing uniqueness is enforced by the
phase-1 `findFirst`-before-`create` upsert. See [Database & Migrations](./database-migrations.md).

## Result / observability

`syncFromChmu()` returns and logs a summary:

```json
{
  "stations": 85,
  "locales": ["cs", "en"],
  "default_locale": "en",
  "sync_locale": "cs",
  "created": 85,
  "updated": 0,
  "localized_created": 85,
  "localized_updated": 0,
  "reports": 85,
  "recent": 46,
  "skipped": 0,
  "errors": 0
}
```

All pre-1.5 stats keys remain present. `locales` still lists every configured
locale. `default_locale` reports the current Strapi read default, while
`sync_locale` identifies the variant written by ČHMÚ and is always `cs`.
`localized_created` / `localized_updated` now count create/update operations on
the Czech variant, not operations multiplied by the number of locales.
`recent` = values served by the `recent/` fallback (no `now/` file). `skipped` =
stations with no value anywhere, or whose `dt` is not newer than the cached one.

## Scheduling

`config/cron-tasks.ts` only **triggers** the service (no logic in cron):

```ts
chmuSync: { task: ({ strapi }) => strapi.service('api::spring.spring').syncFromChmu(),
            options: { rule: '30 3 * * *', tz: 'Europe/Prague' } }
```

Enabled in `config/server.ts` via `cron.enabled = env.bool('CRON_ENABLED', true)`.
Set `CRON_ENABLED=false` to disable (e.g. local dev).

## Manual run

Preferred internal run (no HTTP, no API token):

```bash
npm run sync:chmu
```

The script does not choose or mutate the global default. It loads Strapi,
verifies that `cs` is configured, and upserts/publishes only the Czech Spring
variant. Existing variants receive only the canonical non-localized scalar
allowlist described above.

HTTP ops endpoint:

`POST /api/springs/sync-chmu` (authenticated — call with an admin API token).
Returns the same stats object. Keep this for remote automation where a shell on
the Strapi host/container is not available.

Changing the global default locale does not change `sync_locale`. Follow the
[default-locale runbook](./localization.md#changing-the-global-default-locale).
Map/search perform per-document fallback and therefore keep newly imported
Czech-only Springs visible through their `source_locale = cs`, even after the
global default changes.
