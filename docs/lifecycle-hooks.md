# Lifecycle Hooks

This document describes custom lifecycle hooks in this Strapi application.

> **Design note:** lifecycle hooks are used only for self-contained work on the
> Spring itself (search-name synchronization and QR generation below).
> Cross-entity business logic — notably status denormalization — lives in
> services, not hooks, so it is deterministic and testable. See
> [Status Denormalization](./denormalization.md).

## Spring Content Type

### Search Name Synchronization

**Location:** `src/api/spring/content-types/spring/lifecycles.ts`

When a Spring's localized `name` is created or updated, the private localized
`name_search` field is updated to a lowercase, accent-free copy. This supports
public search queries without diacritics, e.g. `vyprachtice` → `Výprachtice`.

The hook is guarded so it only writes `name_search` after the field exists in
the content type.

#### Trigger

- **Event:** `beforeCreate`, `beforeUpdate`
- **Content Type:** `api::spring.spring`

### QR Code Auto-Generation

**Location:** `src/api/spring/content-types/spring/lifecycles.ts`

When a new Spring entry is created, a QR code is automatically generated and uploaded to the Media Library.

#### Trigger

- **Event:** `afterCreate`
- **Content Type:** `api::spring.spring`

#### Behavior

1. Generates a QR code image (512×512 PNG) containing the Spring's `documentId`
2. Uploads the image to Strapi's Media Library
3. Links the uploaded file to the Spring's `qr_code` field

#### QR Code Content

The QR code encodes the **`documentId`** — Strapi v5's immutable document identifier. This ensures the QR content remains permanent even if the Spring's name or other metadata changes.

Example content when scanned: `g39qdkl2c0ptrpl081d8kcvd`

#### Configuration

| Setting | Value |
|---------|-------|
| Image Size | 512×512 pixels |
| Format | PNG |
| Error Correction | High (H) — 30% recovery |
| Margin | 2 modules |

#### Dependencies

```bash
npm install qrcode @types/qrcode
```

#### Error Handling

- Errors during QR generation/upload are logged but do not block Spring creation
- If `qr_code` already exists on the entry, generation is skipped (prevents infinite loops)

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
