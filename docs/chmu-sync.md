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

Hardening: per-request timeout (`AbortController`, 15 s) + retry (2×) with
backoff; HTTP `404` → `null` (object file may not exist); empty/missing series → `null`.

## Sync — `syncFromChmu()`

Maps ČHMÚ → canonical (`external_source = 'chmu'`, `external_id = objID`) and
runs in three phases:

1. **Upsert stations** (sequential, SQLite-friendly). Looked up by
   `(external_source, external_id)` in the **default locale**; created springs
   are published so they appear on the map. New springs start `current_status = 'unknown'`.
2. **Fetch latest values** with bounded concurrency (limit 8) — hundreds of small
   file downloads; one failure never aborts the run (`try/catch` per object).
3. **Append report when newer.** A Report (`is_flowing = valueLps > 0`,
   `flow_rate_lps`, `flow_scale` via [`flowScaleFromLps`](./denormalization.md#flow-scale),
   `reported_at = dt`) is created only if `dt` is strictly newer than the spring's
   `status_updated_at`, then [`refreshLatest`](./denormalization.md) denormalizes
   the cached status. → idempotent across daily runs (ČHMÚ updates only some objects).

ČHMÚ reports leave `has_odor` / `water_clarity` / `device_id` / `client_report_id`
as `null` (sensor data has no such fields; sync idempotence is the `dt` check, not
the offline-queue id).

### Uniqueness note

`(external_source, external_id)` is a **non-unique** DB index (Spring has Draft &
Publish → draft + published rows share the same `external_id`, so a naive DB
UNIQUE would reject the published row). Pairing uniqueness is enforced by the
phase-1 `findFirst`-before-`create` upsert. See [Database & Migrations](./database-migrations.md).

## Result / observability

`syncFromChmu()` returns and logs a summary:

```json
{ "stations": 85, "created": 85, "updated": 0, "reports": 39, "skipped": 46, "errors": 0 }
```

`skipped` = stations with no current YD/L_S value, or whose `dt` is not newer.

## Scheduling

`config/cron-tasks.ts` only **triggers** the service (no logic in cron):

```ts
chmuSync: { task: ({ strapi }) => strapi.service('api::spring.spring').syncFromChmu(),
            options: { rule: '30 0 * * *', tz: 'Europe/Prague' } }
```

Enabled in `config/server.ts` via `cron.enabled = env.bool('CRON_ENABLED', true)`.
Set `CRON_ENABLED=false` to disable (e.g. local dev).

## Manual run

`POST /api/springs/sync-chmu` (authenticated — call with an admin API token).
Returns the same stats object. Useful for ops / first import.
