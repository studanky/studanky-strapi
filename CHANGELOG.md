# Changelog

All notable changes to this project are documented in this file. The project
follows [Semantic Versioning](https://semver.org/).

## [1.5.0] - 2026-08-25

### Changed

- Made `spring.name` and its private normalized search copy
  `spring.name_search` canonical, non-localized fields. `spring.description`
  remains localized and is managed through the standard Strapi Admin UI.
- Added one document-level locale negotiation policy to Spring detail, preview,
  map, and search. Flutter clients may send `Locale.toLanguageTag()` through the
  optional `locale` query parameter. Resolution tries the exact tag, less
  specific and configured same-language variants, the dynamic Strapi default,
  and finally the document's immutable source locale. Map/search deduplicate
  physical locale rows by `documentId`; response ordering, limits, and
  `distance_m` remain unchanged.
- An existing requested localization is returned even when its `description`
  is `null`; no endpoint performs field-level fallback or mixes fields from
  several locale variants.
- Changed ČHMÚ synchronization to create, update, and publish only the Czech
  (`cs`) source variant, independently of the mutable Strapi default locale. It
  no longer creates empty translation rows or changes translated descriptions.
  Sync stats retain all existing keys and add `default_locale` plus
  `sync_locale`; `localized_created` and `localized_updated` now count Czech
  variant operations.
- Added private, non-localized `spring.source_locale` document metadata. ČHMÚ
  documents always use `cs`; manually authored documents retain the locale in
  which they were first created. Preferred ambiguous English siblings are
  configured as `en-US`, then `en-GB`, with all other same-language variants
  following deterministically.
- All four read endpoints log corrupt source-locale metadata and continue with
  the valid requested/parent/sibling/default chain instead of hiding readable
  content or failing the request. Map and search aggregate all affected document
  IDs into at most one error log entry per request. Request-wide i18n
  configuration errors remain visible, and locale parsing/fallback chains are
  cached within each request.
- Source-locale lifecycle validation now reports editor changes as a Strapi
  validation error and tolerates legacy non-localized sync payloads carrying an
  unchanged null value without allowing them to erase an established source.

### Migration

- Added the portable transactional migration
  `2026.08.24T00.00.00.canonical-spring-name.js`. Before schema sync, it reads
  the default locale from Strapi's i18n core-store setting, uses its draft and
  published rows as separate canonical sources, copies `name` to existing
  translations, and rebuilds `name_search`. It does not add/remove rows or
  modify locale, publication state, timestamps, or relations.
- The migration fails if the default locale cannot be determined or a
  document/publication-state group lacks exactly one default-locale row.
  Its core-store lookup matches Strapi's unscoped `environment IS NULL` and
  `tag IS NULL` semantics; preflight diagnostic SQL is documented.
- Added `2026.08.25T00.00.00.spring-source-locale.js`, which creates and
  backfills `source_locale` without changing row counts, content, publication
  state, timestamps, or relations. It assigns ČHMÚ documents to `cs`, preserves
  an existing consistent value, and otherwise uses an unambiguous single or
  first-created locale. Ambiguous data fails and rolls back instead of guessing.
- Strapi does not support down migrations. Rollback requires restoring the
  pre-deployment database backup and deploying the previous application
  version.

See [the client migration guide](./docs/client-migrations/1.5.0-canonical-spring-name.md)
and [localization runbook](./docs/localization.md).
