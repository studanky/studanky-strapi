# Automated Testing

Unit tests run on [Vitest](https://vitest.dev). They cover the **pure logic** of
the custom features — no running Strapi, DB, or network required, so they are
fast and deterministic.

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
    concurrency.test.ts
    chmu-client.test.ts
    spring-scope.test.ts
```

Test files are named `*.test.ts` and live under `tests/`. The app `tsconfig.json`
**excludes** `**/*.test.*`, so tests never affect `tsc` / the Strapi build.

## What is covered

| Test file | Unit under test | Notes |
|---|---|---|
| `flow-scale.test.ts` | `pickFlowScale` ([src/utils/flow-scale.ts](../src/utils/flow-scale.ts)) | range boundaries, out-of-range, null/NaN, empty ranges |
| `concurrency.test.ts` | `mapWithConcurrency` ([src/utils/concurrency.ts](../src/utils/concurrency.ts)) | order preserved, limit never exceeded, empty input |
| `chmu-client.test.ts` | `parseStations` / `parseLatestValue` / `recentMonths` ([chmu-client.ts](../src/api/spring/services/chmu-client.ts)) | spring filter, positional mapping, bad-coord skip, YD/L_S by name (not order), newest by `dt`, empty → null, month rollover |
| `spring-scope.test.ts` | `resolveSpringScope` ([spring-scope.ts](../src/middlewares/document/spring-scope.ts)) | super-admin bypass, admin scoping, wrong uid/action, internal calls, **users-permissions not scoped (invariant #2)**, missing `roles[]` |

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
- `syncFromChmu` end-to-end (upsert → report → denormalize)
- HTTP endpoints (`/springs/map`, `/springs/:documentId/reports`) and live scoping

If/when integration coverage is wanted (e.g. alongside Phase 2 `report.submit`),
add a separate suite that boots a test Strapi instance against a throwaway DB.
See the [roadmap](./roadmap.md).
