# Automated Testing

Tests run on [Vitest](https://vitest.dev). They cover pure logic, thin Strapi
contracts through mocks, and the portable migration against an in-memory SQLite
database. No running Strapi or network is required, so they are fast and
deterministic.

## Running

```bash
npm test          # run once (CI-friendly)
npm run test:watch # watch mode (re-runs on change)
```

Run a single file or filter by name:

```bash
npx vitest run tests/unit/chmu-client.test.ts   # one file
npx vitest run -t "newest point"                 # by test name
```

`npm test` exits non-zero on failure, so it can gate CI / pre-push.

## Layout

```
vitest.config.ts          # node environment, includes tests/**/*.test.ts
tests/
  unit/
    flow-scale.test.ts
    fixed-window-rate-limit.test.ts
    concurrency.test.ts
    chmu-client.test.ts
    canonical-spring-name-migration.test.ts
    locale.test.ts
    newsletter-controller.test.ts
    newsletter.test.ts
    spring-chmu-sync.test.ts
    spring-controller.test.ts
    spring-preview.test.ts
    spring-read-localization.test.ts
    spring-scope.test.ts
```

Test files are named `*.test.ts` and live under `tests/`. The app `tsconfig.json`
**excludes** `**/*.test.*`, so tests never affect `tsc` / the Strapi build.

## What is covered

| Test file                                 | Unit under test                                                                                                       | Notes                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flow-scale.test.ts`                      | `pickFlowScale` ([src/utils/flow-scale.ts](../src/utils/flow-scale.ts))                                               | range boundaries, out-of-range, null/NaN, empty ranges                                                                                                                         |
| `fixed-window-rate-limit.test.ts`         | `createFixedWindowRateLimiter` ([src/utils/fixed-window-rate-limit.ts](../src/utils/fixed-window-rate-limit.ts))      | per-key fixed windows, retry-after, max-key cap                                                                                                                                |
| `concurrency.test.ts`                     | `mapWithConcurrency` ([src/utils/concurrency.ts](../src/utils/concurrency.ts))                                        | order preserved, limit never exceeded, empty input                                                                                                                             |
| `chmu-client.test.ts`                     | `parseStations` / `parseLatestValue` / `recentMonths` ([chmu-client.ts](../src/api/spring/services/chmu-client.ts))   | spring filter, positional mapping, bad-coord skip, YD/L_S by name (not order), newest by `dt`, empty → null, month rollover                                                    |
| `canonical-spring-name-migration.test.ts` | 1.5.0 Knex migration                                                                                                  | SQLite draft/published fixtures, unscoped core-store selection, canonical copying, normalization, invariant preservation, missing-default rollback, fresh-DB no-op             |
| `spring-source-locale-migration.test.ts`  | 1.5.0 source metadata migration                                                                                       | SQLite ČHMÚ/single/first-created inference, ambiguity rollback, fresh-DB no-op                                                                                                 |
| `locale.test.ts`                          | `resolveLocaleChain`                                                                                                  | Flutter tag canonicalization, script/base/sibling/default/source ordering, unsupported locales and deduplication                                                               |
| `newsletter-controller.test.ts`           | newsletter subscribe controller ([controller](../src/api/newsletter-subscriber/controllers/newsletter-subscriber.ts)) | 413 payload guard, 429 + `Retry-After`, honeypot precedence, no core REST `{ data }` envelope                                                                                  |
| `newsletter.test.ts`                      | newsletter subscribe helpers ([src/utils/newsletter.ts](../src/utils/newsletter.ts))                                  | email/source/language normalization, optional metadata handling, locale validation, consent validation, honeypot, idempotent write merge                                       |
| `spring-chmu-sync.test.ts`                | `syncFromChmu` localization behavior                                                                                  | Czech-only writes even with English default, no translated description write, missing-Czech/config/documentId errors, compatible stats                                         |
| `spring-controller.test.ts`               | Spring read controllers                                                                                               | map/search language-tag forwarding; detail validation, sanitization and envelope preserved                                                                                     |
| `spring-preview.test.ts`                  | preview service                                                                                                       | exact/base/sibling/default/source fallback, served locale and teaser boundary                                                                                                  |
| `spring-read-localization.test.ts`        | map/search/full-detail services                                                                                       | per-document row selection, corrupt-row isolation, visible global-config failures, source fallback, distance/limit behavior, null-description semantics and query preservation |
| `spring-source-locale-lifecycle.test.ts`  | source metadata lifecycle                                                                                             | ČHMÚ/manual assignment, localization preservation, null-sync tolerance, explicit backfill and 400 immutability validation                                                      |
| `spring-scope.test.ts`                    | `resolveSpringScope` ([spring-scope.ts](../src/middlewares/document/spring-scope.ts))                                 | super-admin bypass, admin scoping, wrong uid/action, internal calls, **users-permissions not scoped (invariant #2)**, missing `roles[]`                                        |

## Design: testable pure logic

Side-effect-heavy code (network, DB, Strapi runtime) is kept thin and delegates
to **pure functions** that are imported directly by tests:

- `chmu-client` splits fetch from parsing — `parseStations` / `parseLatestValue`
  take already-parsed JSON, so no `fetch` mock is needed.
- `flowScaleFromLps` (service) reads config, then delegates to `pickFlowScale`.
- the scoping middleware delegates its gate decision to `resolveSpringScope`.

When adding logic, prefer this shape: a pure function in `src/utils/` (or an
exported pure helper next to the feature) + a thin Strapi-facing wrapper.

## Out of scope (would need integration tests)

These depend on a running Strapi + DB + network and are **not** unit-tested:

- `refreshLatest` draft/published dual-write
- `syncFromChmu` live end-to-end (real source fetch → report → denormalize); its
  locale-specific write contract is unit-tested with mocks
- HTTP endpoints (`/springs/map`, `/springs/:documentId/reports`) and live scoping
- PostgreSQL migration rehearsal (required against a temporary database before
  production; SQLite behavior is automated)

If/when integration coverage is wanted (e.g. alongside Phase 2 `report.submit`),
add a separate suite that boots a test Strapi instance against a throwaway DB.
See the [roadmap](./roadmap.md).
