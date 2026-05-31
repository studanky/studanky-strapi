# Status Denormalization

The map must be cheap to read, so each Spring caches its current status instead
of the map endpoint scanning report history. This cache is computed on write.

## Cached fields (on Spring)

| Field | Meaning |
|---|---|
| `current_status` | `is_flowing` / `is_not_flowing` / `unknown` |
| `status_updated_at` | timestamp of the report that set the status |
| `last_flow_scale` | last flow strength on the shared 1–5 scale (nullable) |
| `last_flow_rate_lps` | last measured discharge in l/s (nullable) |

## `refreshLatest(springDocumentId)` — single source of truth

**Location:** `src/api/spring/services/spring.ts`

This service method is the **only** place that writes the cached fields
(invariant). It:

1. Finds the spring's **newest** report (`order by reported_at desc, limit 1`) —
   *newest-wins*.
2. Derives `current_status` from `is_flowing` and copies `flow_scale` /
   `flow_rate_lps` / `reported_at`.
3. Writes to **both** the draft and published rows (Spring has Draft & Publish):
   - **published** via `strapi.db.query().updateMany(...)` — bypasses the
     Document Service so unrelated uncommitted draft edits are *not* published;
   - **draft** via the Document Service.

It is idempotent (always recomputes from the latest report) and safe to call
repeatedly. Callers: [ČHMÚ sync](./chmu-sync.md) and (Phase 2) report submit.

> **Why a service, not a lifecycle hook.** The previous `report.afterCreate`
> hook that did this was removed. Hooks don't fire on `db.query()` / bulk writes
> and run implicitly, which makes denormalization non-deterministic. Logic lives
> in the service, triggered explicitly by the sync (and, later, submit). If
> admin-created reports ever need to propagate, a thin hook that *only calls*
> `refreshLatest` can be added without moving logic back into the hook.

## Flow scale {#flow-scale}

`flow_scale` (1–5) is derived from a measured `flow_rate_lps` by
`flowScaleFromLps(lps)` on the **platform-config** service
(`src/api/platform-config/services/platform-config.ts`). It reads the
`flow_scale_ranges` configured in the Platform Config single type and returns the
`scale` whose `[min_lps, max_lps]` contains the value, or `null` when there is no
config / no matching range. A `null` scale is fine — `is_flowing` still works.

> Configure `flow_scale_ranges` in the admin once the real l/s distribution is
> known (návrh §10). Until then `flow_scale` stays `null`.
