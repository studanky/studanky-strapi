# Automated Testing

The project uses Vitest in the Node environment. Tests exercise pure helpers,
thin Strapi contracts through mocks, and portable Knex migrations against
in-memory SQLite. They do not require a running Strapi instance or network
access.

## Commands

```bash
npm test
npm run test:watch
npx vitest run tests/unit/chmu-client.test.ts
npx vitest run -t "newest point"
```

`npm test` is the CI-friendly one-shot command and exits non-zero on failure.
Test files live under `tests/` and match `**/*.test.ts`. The application
TypeScript configuration excludes test files from the Strapi build.

## Coverage by capability

| Capability | Coverage |
|---|---|
| ČHMÚ adapter and synchronization | Positional metadata parsing, station filtering, `YD` / `L_S` selection, newest-point selection, month rollover, concurrency, localized upsert/publish behavior, scalar propagation, error isolation, and stats. |
| Spring reads | Bounding-box and search service behavior, normalization, geographic distance, candidate limits, controller forwarding, detail sanitization, preview boundaries, locale fallback, and source-metadata degradation. |
| Localization invariants | Locale canonicalization and ordering, source-locale migration, canonical-name migration, lifecycle assignment, conflict rejection, and immutable updates. |
| Cached status and QR | Flow-range boundaries and QR fire-once decisions. |
| Admin scope | Super Admin bypass, Admin scoping, users-permissions exclusion, unsupported actions, and internal calls. |
| Newsletter | Validation, normalization, consent metadata, idempotent write merging, payload limits, honeypot precedence, email-hash rate limiting, and response headers. |
| General utilities | Fixed-window limiting, bounded concurrency, text search normalization, Haversine distance, and coordinate validation. |

Side-effecting integrations are kept thin and delegate to pure functions where
practical. Examples include ČHMÚ parsing, locale resolution, flow-scale
selection, geographic calculations, search normalization, and Admin scope
decisions.

## Integration gaps

The unit suite does not boot a real Strapi application. It therefore does not
fully prove:

- HTTP routing, installed-plugin RBAC, or complete response serialization;
- `refreshLatest()` behavior against real Draft & Publish rows;
- live ČHMÚ network import;
- Admin Panel filter enforcement for update/delete;
- PostgreSQL migration rehearsal and `pg_trgm` index creation;
- upload-provider behavior for QR generation and orphan cleanup.

Rehearse migrations against a temporary PostgreSQL database before production
and smoke-test critical routes after deployment.
