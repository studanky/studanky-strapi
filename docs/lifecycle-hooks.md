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
