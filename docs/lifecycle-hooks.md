# Lifecycle Hooks

This document describes custom lifecycle hooks in this Strapi application.

> **Design note:** lifecycle hooks are used only for self-contained work on the
> Spring itself (source-locale/search-name invariants and QR generation below).
> Cross-entity business logic — notably status denormalization — lives in
> services, not hooks, so it is deterministic and testable. See
> [Status Denormalization](./denormalization.md).

## Spring Content Type

### Source Locale Invariant

`beforeCreate` assigns private, non-localized `source_locale` once. ČHMÚ uses
`cs`; a manually authored document uses its first creation locale (or the
then-current i18n default when omitted). Creating publication/localization rows
preserves the existing document value. `beforeUpdate` rejects changing an
already assigned source locale with a Strapi validation error (HTTP 400 in the
Content Manager API). A stale non-localized sync carrying `source_locale: null`
cannot erase an established value. If an imported legacy row is already null,
an unrelated editor update is allowed without writing that null back; operations
must repair it using the documented database audit. Read endpoints log invalid
source metadata and continue through their requested/default chain without the
source step. This metadata is never exposed by the public API.

The field cannot be schema-level `required` while it is derived here: Strapi
Document Service validates required creation fields before the database
`beforeCreate` lifecycle. Migration, create assignment, update protection and
deployment audits jointly enforce the invariant without breaking normal Admin
UI creation.

### Search Name Synchronization

**Location:** `src/api/spring/content-types/spring/lifecycles.ts`

When a Spring's canonical, non-localized `name` is created or updated, the
private non-localized `name_search` field is updated to a lowercase, accent-free
copy. This supports public search queries without diacritics, e.g.
`vyprachtice` → `Výprachtice`.

The hook is guarded so it only writes `name_search` after the field exists in
the content type.

#### Trigger

- **Event:** `beforeCreate`, `beforeUpdate`
- **Content Type:** `api::spring.spring`

### QR Code Auto-Generation

**Location:** `src/api/spring/content-types/spring/lifecycles.ts`

When a new Spring **document** is created, a QR code is generated once and
uploaded to the Media Library. A Spring needs exactly **one** QR for its
lifetime — the encoded value is the immutable `documentId`, so it never needs
regenerating.

#### Trigger

- **Event:** `afterCreate`
- **Content Type:** `api::spring.spring`

#### Behavior

1. Generates a QR code image (512×512 PNG) containing the Spring's `documentId`
2. Uploads the image to Strapi's Media Library
3. Links the uploaded file to the **draft** Spring row's `qr_code` field

`publish()` deep-populates and clones the draft's `qr_code` relation onto the
published row automatically (same `file_id`, no duplicate asset), so linking only
the draft is enough.

#### Fire-once guard (important)

Strapi v5 fires `afterCreate` for **every row creation**, not just a genuine new
document. In particular `documents().publish()` clones the draft into a fresh
published row (`publish` → `entries.publish` → `createEntry` → `db.query().create`),
and the ČHMÚ sync re-publishes every Spring on every nightly run. Without a guard
this regenerated the QR on **every publish**, orphaning the previous file in the
Media Library (historically ~2500 orphans for ~85 springs).

The hook therefore generates only on a genuine **draft** creation, decided by the
pure `shouldGenerateQr({ publishedAt, hasExistingQr })` helper
(unit-tested in `tests/unit/spring-qr.test.ts`):

- **Publish / re-publish** → the create data carries `publishedAt` → **skip**
  (fast path, no DB read; this is the hot path, ~one publish per spring per sync).
- **Document already has a QR** (`discardDraft`, re-create) → **skip**. Idempotency
  is checked against the draft row's `qr_code`, queried with
  `strapi.db.query(SPRING_UID).findOne({ where: { documentId, publishedAt: null, locale }, populate: { qr_code: true } })`
  — **not** `event.result` (media relations are never populated onto the lifecycle
  result, which is why the earlier `if (result.qr_code)` guard never fired). It
  deliberately uses `db.query`, not the Document Service, so this internal check
  bypasses the Spring admin-scoping middleware (`spring-scope.ts`): a request-scoped
  `managers` filter must never hide an existing QR and cause a spurious regeneration.
- **Genuine draft creation without a QR** → generate.

#### QR Code Content

The QR code encodes the **`documentId`** — Strapi v5's immutable document identifier. This ensures the QR content remains permanent even if the Spring's name or other metadata changes.

Example content when scanned: `g39qdkl2c0ptrpl081d8kcvd`

> Phase 2: the printed (stainless) QR is planned to carry a signed deeplink URL
> (`HMAC(documentId, SERVER_SECRET)`, see [API Security](./api-security.md)),
> decided before physical codes are printed. The current bare-`documentId`
> content is unchanged by the fire-once fix.

#### Configuration

| Setting          | Value                   |
| ---------------- | ----------------------- |
| Image Size       | 512×512 pixels          |
| Format           | PNG                     |
| Error Correction | High (H) — 30% recovery |
| Margin           | 2 modules               |

#### Dependencies

```bash
npm install qrcode @types/qrcode
```

#### Error Handling

- Errors during QR generation/upload are logged but do not block Spring creation

#### Cleaning up historical orphans

Orphaned QR assets created before the fire-once guard are removed by
`scripts/ops/cleanup-qr-orphans.js` (an orphan = a `spring-qr-%` file with no
`files_related_mph` link). Dry-run by default; `--apply` deletes via the upload
service so S3/R2 objects go too:

```bash
npm run cleanup:qr-orphans            # dry-run: report only
npm run cleanup:qr-orphans -- --apply # delete
```

Deploy the lifecycle fix **before** running it, otherwise the next nightly sync
recreates fresh orphans.

**Reaching one QR per spring takes two passes.** Legacy springs affected by the
old bug have _two_ still-linked QR files — the draft's and the current
published's (different files, same encoded `documentId`). The orphan cleanup only
removes _unlinked_ files, so a single run right after deploy leaves those two in
place. On the next fixed sync, `publish()` clones the draft's QR onto the new
published row and deletes the old published row, orphaning its file; a **second
cleanup run** then removes it, leaving one file per spring:

1. Deploy the fix.
2. `npm run cleanup:qr-orphans -- --apply` (removes the historical orphans).
3. Let one nightly ČHMÚ sync run (or `npm run sync:chmu`).
4. `npm run cleanup:qr-orphans -- --apply` again (removes the now-orphaned
   legacy published files) → one QR per spring.

The two-linked-files state is harmless in the meantime (both encode the same
`documentId`); this only matters if you want a perfectly deduplicated Media
Library. Springs created after the fix have exactly one file from the start.

#### Logs

Successful generation:

```
[info] Spring <documentId>: Generating QR code...
[info] Spring <documentId>: QR code uploaded successfully (file id: <id>)
```

Error case:

```
[error] Spring <documentId>: Failed to generate/upload QR code <error details>
```

---

## Report Content Type

### Status Propagation — moved to a service

The earlier `report.afterCreate` hook that propagated `is_flowing` to the parent
Spring **has been removed**. Status denormalization (`current_status`,
`status_updated_at`, `last_flow_scale`, `last_flow_rate_lps`) is now the sole
responsibility of `spring.refreshLatest(...)`, called explicitly by the ČHMÚ sync
(and, in Phase 2, by report submit).

Rationale and the draft/published dual-write details are documented in
[Status Denormalization](./denormalization.md).
