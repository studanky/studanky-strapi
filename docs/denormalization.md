# Status Denormalization

Spring stores a cached representation of its newest Report so map and search
queries do not scan report history.

## Cached fields

| Spring field | Source |
|---|---|
| `current_status` | `is_flowing` mapped to `is_flowing` or `is_not_flowing` |
| `status_updated_at` | `reported_at` |
| `last_flow_scale` | `flow_scale` |
| `last_flow_rate_lps` | `flow_rate_lps` |

## `refreshLatest(documentId)`

`src/api/spring/services/spring.ts` is the single writer for these cached
fields. The method:

1. loads the newest Report by `reported_at`;
2. derives the four cached values;
3. performs one Query Engine `updateMany` across all physical Spring rows with
   the same `updatedAt` timestamp.

Spring uses localization and Draft & Publish. Updating every physical row keeps
draft and published status data aligned while preserving unrelated draft-only
edits. The raw query also bypasses the Admin Panel Document Service scope.

The method is idempotent and returns without writing when the Spring has no
reports. Its current caller is the ČHMÚ sync immediately after a Report is
created.

## Flow scale

`platform-config.flowScaleFromLps(lps)` reads `flow_scale_ranges` from the
Platform Config single type and delegates interval selection to the pure
`pickFlowScale` helper.

Ranges are inclusive at both ends. The first matching configured range wins.
The result is `null` when the input is missing or invalid, configuration is
absent, or no range matches. A null scale does not prevent `is_flowing` or
`flow_rate_lps` from being stored.
