# Lifecycle Hooks

This document describes custom lifecycle hooks implemented in this Strapi application.

## Spring Content Type

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

### Status Propagation to Spring

**Location:** `src/api/report/content-types/report/lifecycles.ts`

When a Report is created, the parent Spring's `current_status` is automatically updated based on the Report's `is_flowing` field — but only if the report is newer than the Spring's last status update.

#### Trigger

- **Event:** `afterCreate`
- **Content Type:** `api::report.report`

#### Business Context

Field reports may be submitted with delays (e.g., offline sync scenarios). The system must ensure Spring always reflects the state from the **most recent measurement time** (`reported_at`), not the most recently received API request.

#### Behavior

1. Checks if Report is linked to a Spring
2. Fetches the Spring document to compare timestamps
3. Applies the **"Newer-Than" Rule**:
   - If `Report.reported_at > Spring.status_updated_at` → Update Spring
   - If `Report.reported_at <= Spring.status_updated_at` → Skip (report is stale)
   - If `Spring.status_updated_at` is `null` → Always update (first report)
4. Maps `is_flowing` boolean to `current_status` enum
5. Updates Spring draft version
6. If Spring was already published, also updates the published version

#### Status Mapping

| Report.is_flowing | Spring.current_status |
|-------------------|----------------------|
| `true`            | `is_flowing`         |
| `false`           | `is_not_flowing`     |

#### Draft & Publish Handling

Strapi v5 maintains separate draft and published versions:

```
┌─────────────────────────────────────────────────────────┐
│ Report Created                                          │
├─────────────────────────────────────────────────────────┤
│ 1. Update Spring draft version (always)                 │
│ 2. If Spring.publishedAt exists:                        │
│    └── Also update + publish the Spring                 │
└─────────────────────────────────────────────────────────┘
```

This ensures both versions stay synchronized when status changes.

#### Error Handling

- Errors during status propagation are logged but do not block Report creation
- Missing Spring relation is gracefully handled (skipped with debug log)
- Non-existent Spring documentId is handled (logged as warning)

#### Logs

Successful propagation:
```
[info] Report <reportDocId>: Propagating status to Spring <springDocId>
[info] Report <reportDocId>: Updated Spring <springDocId> draft to is_flowing
[info] Report <reportDocId>: Also updated Spring <springDocId> published version
```

Skipped (not newer):
```
[info] Report <reportDocId>: Skipping - report (2024-01-15T10:00:00Z) is not newer than Spring status (2024-01-16T08:00:00Z)
```

No Spring linked:
```
[debug] Report <reportDocId>: No spring linked, skipping status propagation
```

Error case:
```
[error] Report <reportDocId>: Failed to propagate status to Spring <springDocId> <error details>
```

#### Race Conditions

When multiple reports arrive simultaneously:
- Each request fetches fresh Spring data before comparison
- The report with the newer `reported_at` will ultimately determine the final state
- Database-level transactions in Strapi v5 provide basic consistency

> **Note:** For mission-critical atomic updates, consider implementing a database-level trigger or a custom service with explicit row locking.
