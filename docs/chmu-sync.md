# ČHMÚ Sync

Imports spring discharge data from the ČHMÚ groundwater Open Data and turns it
into canonical Spring + Report records. ČHMÚ is the **first data source adapter**,
not the model definition — its specifics stay isolated in the adapter; the rest
of the backend only ever sees the canonical model.

> Source format reference: [`chmu_groundwater_api_documentation.md`](./chmu_groundwater_api_documentation.md) (branch `now/`).

## Components

| Concern | Location |
|---|---|
| Source adapter (fetch + parse, no Strapi model) | `src/api/spring/services/chmu-client.ts` |
| Sync orchestration (canonical mapping, upsert, reports) | `src/api/spring/services/spring.ts` → `syncFromChmu()` |
| Scheduled trigger | `config/cron-tasks.ts` + `config/server.ts` (`cron`) |
| Manual trigger (ops) | `POST /api/springs/sync-chmu` → `spring.syncChmu` |

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
   created/updated and published in **every configured i18n locale**. New springs
   start `current_status = 'unknown'`.
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
{ "stations": 85, "locales": ["cs"], "created": 85, "updated": 0, "localized_created": 85, "localized_updated": 0, "reports": 85, "recent": 46, "skipped": 0, "errors": 0 }
```

`localized_created` / `localized_updated` count locale-specific Spring rows.
With two configured locales and a fresh import, `created` is still 85 station
documents while `localized_created` is 170 localized rows. `recent` = values
served by the `recent/` fallback (no `now/` file). `skipped` = stations with no
value anywhere, or whose `dt` is not newer than the cached one.

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

The script does not choose or mutate the locale. It loads Strapi, reads all
configured i18n locales, and the sync service writes Spring rows to all of them.

HTTP ops endpoint:

`POST /api/springs/sync-chmu` (authenticated — call with an admin API token).
Returns the same stats object. Keep this for remote automation where a shell on
the Strapi host/container is not available.
