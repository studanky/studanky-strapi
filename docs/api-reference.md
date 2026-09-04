# API Reference

This is the canonical HTTP contract for the currently implemented Studánky
Strapi API. It describes backend behavior and is independent of any consuming
framework.

## Conventions

All content API paths use the `/api` prefix. Entries are addressed by Strapi v5
`documentId` values, not numeric database IDs. JSON errors use the standard
Strapi envelope:

```json
{
  "data": null,
  "error": {
    "status": 400,
    "name": "BadRequestError",
    "message": "...",
    "details": {}
  }
}
```

Custom endpoints return flat objects under `data`. Core Strapi endpoints retain
the standard `{ "data": ..., "meta": ... }` response and require explicit
`populate` parameters for relations, media, and components.

## Authentication

| Method and path                        | Access                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/springs/map`                 | Public (`auth: false`)                                                                     |
| `GET /api/springs/search`              | Public (`auth: false`)                                                                     |
| `GET /api/springs/:documentId/reports` | Public (`auth: false`)                                                                     |
| `GET /api/springs/:documentId/preview` | Public (`auth: false`)                                                                     |
| `POST /api/newsletter/subscribe`       | Public (`auth: false`)                                                                     |
| `GET /api/springs/:documentId`         | Core route; enable `spring.findOne` for the Public role if public access is required       |
| `GET /api/platform-config`             | Core route; enable `platform-config.find` for the Public role if public access is required |
| `POST /api/springs/sync-chmu`          | Authenticated operations route                                                             |

There is no Report router and therefore no `/api/reports` content API surface.

## Localization

Spring map, search, detail, and preview require a BCP 47 `locale` query
parameter. Both a base language such as `en` and a hyphenated regional tag such
as `en-US` are valid. Missing, empty, syntactically invalid, and
underscore-separated values return `400`. Valid tags are canonicalized and
resolution tries configured candidates in this order:

1. the exact requested tag and its less-specific configured forms;
2. configured variants of the requested language;
3. the current Strapi default locale;
4. the Spring document's immutable `source_locale`.

`config/locale-fallbacks.ts` supplies preferred variants for ambiguous language
fallback. A selected localization is returned as a whole document; null fields
do not trigger field-level fallback. Map, search, and preview include the locale
that was actually served. A valid but unconfigured tag is accepted and continues
through the fallback chain; it is not sent directly to the Document Service.

## `GET /api/springs/map`

Returns published Spring markers inside a bounding box.

### Query

| Parameter | Required | Format                                           |
| --------- | -------: | ------------------------------------------------ |
| `bbox`    |      yes | `minLng,minLat,maxLng,maxLat`                    |
| `locale`  |      yes | BCP 47 language tag, for example `en` or `en-US` |

A missing or non-string `bbox` returns `400`. When one of the four parsed values
is `NaN`, the current service returns an empty `data` array. The implementation
does not currently enforce coordinate ranges, ordering, or exactly four values.

### Response

```json
{
  "data": [
    {
      "documentId": "k9f2a7b3c1d0e8",
      "name": "Ostružná",
      "lat": 50.18,
      "lng": 17.05,
      "current_status": "is_flowing",
      "status_updated_at": "2026-05-31T05:00:00.000Z",
      "locale": "cs"
    }
  ]
}
```

The response is limited to `documentId`, `name`, coordinates, cached status,
status timestamp, and served locale.

## `GET /api/springs/search`

Performs partial, case-insensitive and accent-insensitive matching against the
private canonical `name_search` value.

### Query

| Parameter    | Required | Behavior                                                                                              |
| ------------ | -------: | ----------------------------------------------------------------------------------------------------- |
| `q`          |      yes | Trimmed; minimum 2 characters; at most 80 characters are searched.                                    |
| `lat`, `lng` |       no | When both form a valid geographic origin, results include `distance_m` and are ordered nearest-first. |
| `limit`      |       no | Defaults to 10 and is clamped to 1–50.                                                                |
| `locale`     |      yes | BCP 47 language tag, for example `en` or `en-US`.                                                     |

Missing or too-short `q` returns `400`. Invalid or incomplete origin coordinates
are ignored. Without a valid origin, results retain alphabetical query order.
The service examines at most 200 deduplicated candidates before applying the
requested limit.

The response uses the same fields as `/springs/map`; `distance_m` is added when
a valid origin is supplied.

## `GET /api/springs/:documentId`

Returns full Spring detail using the standard Strapi core envelope and query
features. The overridden controller preserves query validation, sanitization,
`fields`, `populate`, and `status`, while the service adds document-level locale
fallback. Published content is used unless `status` is explicitly supplied.

The BCP 47 `locale` query parameter is required. Base-language tags and
language-region tags are accepted.

Example:

```http
GET /api/springs/k9f2a7b3c1d0e8?locale=cs&populate[photo]=true&populate[owner]=true
```

An unknown or unavailable document produces `data: null` through the normal
core response transformation.

## `GET /api/springs/:documentId/reports`

Returns report history newest-first.

### Query

| Parameter  | Default | Behavior                   |
| ---------- | ------: | -------------------------- |
| `page`     |       1 | Clamped to a minimum of 1. |
| `pageSize` |      20 | Clamped to 1–100.          |

### Response

```json
{
  "data": [
    {
      "documentId": "r1a2b3",
      "is_flowing": true,
      "flow_scale": 3,
      "flow_rate_lps": 0.42,
      "has_odor": null,
      "water_clarity": null,
      "note": null,
      "reported_at": "2026-05-31T05:00:00.000Z",
      "source_type": "chmu"
    }
  ],
  "meta": {
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 39,
      "pageCount": 2
    }
  }
}
```

Only the fields shown above are selected. Capture coordinates, `device_id`, and
`client_report_id` are not fetched.

## `GET /api/springs/:documentId/preview`

Returns a published teaser representation. It deliberately excludes flow
strength and report history.

| Parameter | Required | Behavior                                          |
| --------- | -------: | ------------------------------------------------- |
| `locale`  |      yes | BCP 47 language tag, for example `en` or `en-US`. |

Response fields are `documentId`, `name`, `lat`, `lng`, `current_status`,
`status_updated_at`, `description`, `photo`, and served `locale`. The normalized
photo object contains `url`, `alternativeText`, `width`, `height`, and
`thumbnail_url`. Optional values are returned as `null`. A Spring that is not
published in any fallback locale returns `404`.

Missing or invalid `source_locale` metadata is logged as an application
invariant violation. It disables only the final source-locale fallback for that
document; a localization available through the requested/default chain is still
returned.

## `GET /api/platform-config`

Returns the Platform Config single type through the Strapi core controller.
Populate the range component explicitly:

```http
GET /api/platform-config?populate[flow_scale_ranges]=true
```

```json
{
  "data": {
    "freshness_threshold_days": 14,
    "flow_scale_ranges": [{ "scale": 1, "min_lps": 0, "max_lps": 0.1 }]
  },
  "meta": {}
}
```

Configured ranges are operational data; the example is illustrative.

## `POST /api/newsletter/subscribe`

Accepts a top-level JSON object, not the core REST `{ "data": ... }` envelope.

```json
{
  "email": "user@example.com",
  "consent": true,
  "source": "website-footer",
  "preferredLanguage": "cs-CZ",
  "consentVersion": "2026-07-10",
  "sourceRef": "https://example.com/newsletter",
  "website": ""
}
```

| Field               | Required | Validation                                                           |
| ------------------- | -------: | -------------------------------------------------------------------- |
| `email`             |      yes | Trimmed, simple email validation, maximum 254 characters.            |
| `consent`           |      yes | Must be exactly `true`.                                              |
| `source`            |       no | Trimmed, maximum 80 characters.                                      |
| `preferredLanguage` |       no | Normalized locale tag, maximum 32 characters.                        |
| `consentVersion`    |       no | Trimmed, maximum 80 characters.                                      |
| `sourceRef`         |       no | Trimmed, maximum 2048 characters.                                    |
| `website`           |       no | Honeypot; a non-empty value returns neutral success without writing. |

Success and idempotent duplicate submissions return:

```json
{ "data": { "ok": true } }
```

Invalid input returns `400`; an oversized payload returns `413`; the email-hash
rate limiter can return `429` with `Retry-After`. The neutral success response
prevents subscriber enumeration.

## `POST /api/springs/sync-chmu`

Triggers the same import service as the scheduled job and returns its stats under
`data`. The route does not set `auth: false`, so callers must authenticate and
have permission to invoke it. See [ČHMÚ Sync](./chmu-sync.md).

## Privacy boundary

- Spring `source_locale` and `name_search` are private schema attributes.
- Report `user_lat` and `user_lng` are private schema attributes.
- Report history additionally uses an explicit allowlist that excludes
  `device_id` and `client_report_id`, although those two attributes are not
  marked private in the current schema.
- Newsletter `email_normalized` is private and raw email addresses are never
  used as rate-limit keys or logs.
