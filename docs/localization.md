# Spring Localization

Spring is an i18n content type, but only linguistic editorial content is
localized.

| Field group                                                   | Localized | Ownership                         |
| ------------------------------------------------------------- | --------: | --------------------------------- |
| `description`                                                 |       yes | Editors and translations          |
| `name`                                                        |        no | Canonical official name           |
| `name_search`                                                 |        no | Private normalized search value   |
| `source_locale`                                               |        no | Private immutable source language |
| coordinates, status, source identifiers, relations, and media |        no | Shared document data              |

Editors use the normal Content Manager locale switcher to edit `description`.
Content-type structure is deployed from the committed schema and must not be
changed only in a production Admin Panel.

## Read negotiation

Map, search, detail, and preview require a BCP 47 locale tag and resolve one
complete Spring variant in this order. Base-language tags such as `en` and
regional tags such as `en-US` are both accepted:

1. exact configured tag;
2. configured less-specific tags, including script and base language;
3. configured variants of the same language;
4. current Strapi default locale;
5. the document's `source_locale`.

Tags are canonicalized with `Intl.getCanonicalLocales`. Missing, invalid, or
underscore-separated tags are rejected with `400`. `config/locale-fallbacks.ts` defines preferred
variants where language-only fallback would otherwise be ambiguous. Remaining
same-language variants use stable canonical ordering.

Fallback is document-level. An existing variant with `description: null` is a
valid result and does not borrow a description from another locale. Unsupported
tags are not passed to the Document Service.

Map and search query published physical rows once, group by `documentId`, and
select a single whole row. Invalid, missing, inconsistent, or unconfigured source
metadata is logged in a bounded aggregate. It disables the source fallback for
the affected document but does not hide a row available through the valid
requested/default chain.

The generic core Spring collection route uses native Strapi i18n behavior. The
custom fallback policy applies to map, search, overridden detail, and preview.

## Source locale

`source_locale` belongs to the complete document and is separate from the
mutable global default:

- ČHMÚ documents always use `cs`;
- manually authored documents use their creation locale;
- the value must be configured in Strapi i18n;
- every physical row of a document must contain the same canonical value;
- lifecycle hooks prevent changes after assignment.

Do not delete an i18n locale while any Spring uses it as its source. Audit and
repair those documents first using the queries in
[Database Indexes & Migrations](./database-migrations.md).

The ČHMÚ sync writes and publishes only Czech source content. It propagates a
narrow non-localized scalar allowlist to existing locale rows without creating
translations or changing localized descriptions and publication states.

## Changing the global default locale

Treat the default-locale change as an operational data change:

1. disable the ČHMÚ cron and ensure no old instance can start a sync;
2. create and verify a database backup;
3. audit that every Spring has one valid `source_locale` and a published source
   variant;
4. prepare and publish the required real translations;
5. smoke-test map, search, detail, and preview with exact, regional, unsupported,
   missing, underscore-separated, and syntactically invalid locale values;
6. change the default under Settings → Internationalization;
7. run one manual sync and verify `default_locale`, `sync_locale`, and public
   fallback behavior;
8. re-enable the cron.

Rollback requires restoring the database backup and the previous application
version; Strapi migrations do not provide a down migration.
