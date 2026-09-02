# API Security

This document describes the current security boundary of the Studánky Strapi
backend.

## Public surface

The following custom routes are explicitly unauthenticated:

- `GET /api/springs/map`
- `GET /api/springs/search`
- `GET /api/springs/:documentId/reports`
- `GET /api/springs/:documentId/preview`
- `POST /api/newsletter/subscribe`

Spring detail and Platform Config use Strapi core routes. Public access requires
only `spring.findOne` and `platform-config.find` to be enabled for the Public
role. Do not expose Owner CRUD or any write action through the Public role.

There is no Report router. Consequently, no core `/api/reports` read or write
route is exposed. Report history is available only through the Spring history
endpoint and its explicit output allowlist.

`POST /api/springs/sync-chmu` is an authenticated operations endpoint and must
not be granted to public roles. Prefer `npm run sync:chmu` when shell access to
the service is available.

See [API Reference](./api-reference.md) for the complete route contract.

## Data exposure

- `spring.source_locale`, `spring.name_search`, and
  `newsletter-subscriber.email_normalized` are private attributes.
- `report.user_lat` and `report.user_lng` are private attributes.
- Report history selects only status, flow, observation, timestamp, and source
  fields. It does not fetch `device_id` or `client_report_id`.
- `device_id` and `client_report_id` are not marked private in the current
  Report schema. The absence of a Report router and the history allowlist are
  therefore part of the current privacy boundary.

## Newsletter write controls

The newsletter endpoint is deliberately isolated from core CRUD and uses:

- a small configurable body-size guard;
- strict validation and normalized email comparison;
- a honeypot that returns neutral success without a write;
- an in-memory fixed-window limiter keyed by an HMAC hash of normalized email;
- a database unique index on `email_normalized`;
- idempotent create/reactivate behavior;
- one neutral success response to prevent subscriber enumeration.

The in-memory limiter is process-local and is not a replacement for a trusted
reverse-proxy or edge rate limit. Configure body-size and request-rate controls
at the ingress for production traffic.

## Operational checklist

- Restrict `CORS_ORIGINS`; the development default `*` is not appropriate for
  production.
- Keep the application at one replica while the ČHMÚ cron runs in-process.
- Restrict Admin Panel roles and protect editing of the Spring `managers` field.
- Keep the manual sync route authenticated.
- Keep newsletter core CRUD routes disabled.
- Keep secrets out of source control and rotate them through the deployment
  platform.
- Apply ingress request-size and rate limits to public endpoints as appropriate.

CORS controls browser access but does not authenticate requests or prevent
non-browser callers.
