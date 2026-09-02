# Lifecycle Hooks

Custom lifecycle hooks exist only on the Spring content type. Cross-entity
status propagation lives in the explicit
[denormalization service](./denormalization.md), not in a Report lifecycle.

## Source locale invariant

`beforeCreate` establishes private, non-localized `source_locale` metadata.

- A new ČHMÚ document must be created in configured locale `cs`.
- A manually authored document uses its creation locale, or the current Strapi
  default when the locale is omitted.
- Publication and localization rows inherit the one consistent source value
  already stored for the document.
- Conflicting, missing, invalid, or unconfigured source values are rejected with
  a Strapi validation error.

`beforeUpdate` prevents changing an established source locale. It tolerates a
legacy null value carried by an unrelated non-localized field synchronization
without allowing that null to erase a valid persisted source.

The field is not schema-level `required` because Strapi validates required
creation fields before the database lifecycle can derive it. Migrations,
lifecycle validation, and the documented database audits enforce the invariant.

## Search-name synchronization

`beforeCreate` and `beforeUpdate` write `name_search` whenever canonical `name`
is supplied. The value is lowercase and accent-free, which supports partial
accent-insensitive search. Bootstrap separately repairs stale values across
existing rows.

## QR generation

`afterCreate` generates one 512×512 PNG with high error correction and a
two-module margin. The QR payload is exactly the immutable Spring `documentId`.
The file is uploaded through Strapi's upload service and linked to the draft
row's `qr_code` field.

Strapi creates physical rows during publish and discard-draft operations. The
hook avoids duplicate assets by:

1. skipping rows whose create payload contains `publishedAt`;
2. querying the draft row directly for an existing QR;
3. generating only for a genuine draft without an existing QR.

The direct Query Engine lookup intentionally bypasses the Admin Panel scope so
a request filter cannot hide an existing QR. QR generation or upload failures
are logged without blocking Spring creation, and the temporary local file is
removed in a `finally` block.

## Orphan cleanup

The maintenance script finds `spring-qr-*` media files without a relation in
`files_related_mph`. It is a dry run unless `--apply` is supplied:

```bash
npm run cleanup:qr-orphans
npm run cleanup:qr-orphans -- --apply
```

Deletion uses Strapi's upload service, so both database rows and provider
objects are removed. Deploy the current lifecycle before applying cleanup.

Legacy datasets can require two cleanup passes: the first removes already
orphaned files; a subsequent publish/sync replaces the old published row and
makes its former QR removable by the second pass.
