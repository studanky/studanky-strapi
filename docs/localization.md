# Spring localization and default-locale runbook

Spring is an i18n content type, but only genuinely linguistic content is
localized:

| Field | Localized | Ownership |
|---|---:|---|
| `name` | no | canonical official name, shared by all variants |
| `name_search` | no | private normalized copy maintained by lifecycle hooks |
| `description` | yes | translated editorial content |
| `source_locale` | no | private immutable language of the original document |
| coordinates, status, source metadata and media | no | shared document data |

The standard Strapi Admin UI is sufficient. Editors switch locale in Content
Manager to edit `description`; `name_search` is private and not manually
editable. Locale configuration and the global default remain under **Settings →
Internationalization**. Content-type structure is deployed from the committed
schema and must not be changed only on production.

## Read behavior

- Flutter sends its full `Locale.toLanguageTag()` value (for example `en-AU`).
- Detail, preview, map and search use the same order: exact tag → less-specific
  tag/base language → configured same-language variants → dynamic default →
  document source locale.
- Regional ambiguity is deterministic. `config/locale-fallbacks.ts` defines
  business preferences (`en-US` before `en-GB`); remaining variants of the same
  language follow in canonical lexical order.
- Map and search load only published rows and select one whole row per
  `documentId`. They do not lose Czech-only ČHMÚ documents after a default-locale
  change.
- Fallback is document-level. A present translation with an empty description
  is valid and does not trigger fallback.
- Unsupported client locale codes are never sent to Strapi Document Service.
- Failure to read i18n configuration is a visible server error; the application
  does not silently assume a hardcoded language.

## Source locale versus read default

These concepts are intentionally separate:

- `source_locale` is immutable non-localized document metadata;
- `cs` is the fixed source locale of the Czech ČHMÚ import;
- the Strapi default locale is a cross-language preference before the source
  fallback and may later change to `en`;
- ČHMÚ sync always writes `cs`, even when the read default is `en`.

Do not delete a locale from **Settings → Internationalization** while any Spring
uses it as `source_locale`. Migrate those documents to a valid source first;
the resolver treats an unconfigured source as a visible invariant error rather
than silently choosing an unrelated language.

Existing non-localized fields are synchronized by Strapi to already-existing
translations. Creating a brand-new ČHMÚ Spring, however, creates only its Czech
variant with `source_locale = cs`. Source fallback keeps that Spring visible in
map/search/detail even when the global default is English. ČHMÚ sync must not
fabricate an empty English description.

## Custom-code locale audit

| Code path | Current policy | Assessment |
|---|---|---|
| `syncFromChmu` | always writes configured `cs` and asserts `source_locale = cs` | locale belongs to the source, not the UI default |
| map (`findInBbox`) | per-document full fallback over published bbox rows | one complete row per `documentId`; `locale` is optional |
| search | canonical-name match across published rows, then per-document full fallback | stable deduplication; `locale` is active, not deprecated |
| full detail / preview | exact/parents → same language → default → source | one whole document; null fields never continue fallback |
| `refreshLatest` | raw-updates every locale row of one document | correct: status/timestamps/flow fields are non-localized |
| Spring name lifecycle/bootstrap | rebuilds `name_search` for the affected/all physical rows | correct normalization; the one-time migration, not bootstrap, enforces canonical-name equality |
| QR lifecycle | checks the draft in the event's locale | correct: avoids duplicate assets while preserving document identity |
| 1.5.0 canonical-name migration | uses the default locale at migration time | safe under the locked 1.5.0 rollout precondition (`cs` is default); do not reuse it as a general source-locale rule after changing the default |
| Report, Owner, Platform Config, Newsletter | content types are not localized | no Strapi i18n/default-locale coupling; newsletter `preferred_language` is communication metadata, not a content query locale |

The generic core `GET /api/springs` collection handler still uses native Strapi
i18n selection and does not perform this custom per-document fallback. App
clients should use the documented map/search/detail endpoints.

## Changing the global default locale

The default locale is a data invariant, not just a display preference. Do not
switch it while ČHMÚ sync is running.

1. Disable the ČHMÚ cron and ensure no old application instance can run sync.
2. Back up the database.
3. Audit that every Spring has exactly one non-empty `source_locale` and a
   published variant in that source locale.
4. Create and publish real translations desired for the new product phase;
   never create empty descriptions merely to satisfy fallback.
5. Smoke-test map, search, detail and preview with `en`, `en-AU`, an unsupported
   language and no locale parameter.
6. Change the global default in **Settings → Internationalization**.
7. Run an operational sync/smoke test. Verify the new `default_locale` and
   confirm that `sync_locale` remains `cs`.
8. Re-enable the cron.

After the switch, newly imported Czech-only ČHMÚ documents remain visible via
their source locale. ČHMÚ sync intentionally never creates translations.

## Backend 1.5.0 deployment

1. Release a client that sends `Locale.toLanguageTag()` to map, search and
   localized Spring detail requests (older clients remain compatible).
2. Back up the development SQLite file and production PostgreSQL database.
3. Pause the ČHMÚ cron and prevent old/new instances from overlapping.
4. Deploy 1.5.0 and let its transactional migration finish before schema sync.
5. Verify row/document counts, canonical names, source locales, document-level
   fallback on all four endpoints, and the expected 88 local Springs.
6. Re-enable the cron.

Rollback requires restoring the database backup and previous application
version; Strapi has no down-migration mechanism.
