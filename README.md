# Studánky Strapi

Strapi v5 and TypeScript backend for storing, importing, administering, and
serving natural-spring status data.

## Current capabilities

- canonical Spring model with localized descriptions and deterministic locale
  fallback;
- public map, search, detail, preview, and report-history reads;
- nightly and on-demand ČHMÚ metadata and discharge synchronization;
- denormalized current Spring status for inexpensive map queries;
- automatic Spring QR generation using immutable `documentId` values;
- manager-based Spring scoping in the Admin Panel;
- isolated idempotent newsletter subscription endpoint;
- SQLite development and PostgreSQL production support;
- Docker Compose and Coolify deployment runbooks.

The backend does not expose a Report create route. Reports are currently written
internally by the ČHMÚ synchronization service.

## Requirements

- Node.js 18–22
- npm 6+

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

The default development database is SQLite at `.tmp/data.db`. The Admin Panel is
available at `http://localhost:1337/admin`.

Useful commands:

```bash
npm run build
npm run start
npm test
npm run test:watch
npm run sync:chmu
npm run cleanup:qr-orphans
```

Set `CRON_ENABLED=false` for local environments that must not contact ČHMÚ.

## Documentation

| Document | Responsibility |
| --- | --- |
| [Architecture](./docs/architecture.md) | Current content types, components, data flows, bootstrap, and access boundaries. |
| [API Reference](./docs/api-reference.md) | Implemented HTTP routes, inputs, outputs, authentication, and privacy boundary. |
| [API Security](./docs/api-security.md) | Current public surface and operational hardening. |
| [Admin Panel Filtering](./docs/admin-filtering.md) | Manager-based Spring scoping and its verification boundary. |
| [ČHMÚ Sync](./docs/chmu-sync.md) | Source adapter, synchronization, cron, and manual execution. |
| [Localization](./docs/localization.md) | Spring locale model, fallback policy, and default-locale runbook. |
| [Status Denormalization](./docs/denormalization.md) | Cached Spring status and flow-scale calculation. |
| [Lifecycle Hooks](./docs/lifecycle-hooks.md) | Source-locale, search-name, QR generation, and orphan cleanup. |
| [Database Indexes & Migrations](./docs/database-migrations.md) | Release migrations, bootstrap indexes, and database audits. |
| [Automated Testing](./docs/testing.md) | Test commands, coverage, and integration gaps. |
| [Docker Compose Deployment](./docs/deployment.md) | Standalone VM deployment, storage, backups, and recovery. |
| [Coolify Deployment](./docs/coolify-deploy.md) | Coolify-native deployment with managed PostgreSQL. |

## Core environment variables

Start from `.env.example`, which contains the complete template.

| Variable | Purpose |
| --- | --- |
| `APP_KEYS` | Session encryption keys. |
| `API_TOKEN_SALT` | API-token salt. |
| `ADMIN_JWT_SECRET` | Admin authentication secret. |
| `TRANSFER_TOKEN_SALT` | Transfer-token salt. |
| `ENCRYPTION_KEY` | Strapi data-encryption key. |
| `JWT_SECRET` | Users & Permissions JWT secret. |
| `HOST`, `PORT` | Bind address and port. |
| `DOMAIN`, `PUBLIC_URL`, `IS_PROXIED` | Public URL and reverse-proxy behavior. |
| `CRON_ENABLED` | Enables scheduled jobs, including the ČHMÚ sync. |
| `CORS_ORIGINS` | Allowed content API origins; restrict in production. |
| `DATABASE_*` | SQLite/PostgreSQL connection and pool configuration. |
| `NEWSLETTER_*` | Newsletter body-size and email-hash limiter configuration. |
| `SMTP_*`, `DEFAULT_FROM_EMAIL`, `DEFAULT_REPLY_TO_EMAIL` | Optional email provider configuration. |
| `AWS_*`, `UPLOAD_CDN_*` | Optional S3-compatible media storage and public media host. |
| `BACKUP_*` | Docker Compose backup schedules and retention. |

## Deployment

The repository supports two production layouts:

- standalone Docker Compose with bundled Traefik, PostgreSQL, backups, and
  persistent uploads;
- a Dockerfile application in Coolify with Coolify-managed proxy, PostgreSQL,
  storage, and backups.

Both layouts must run a single Strapi replica because the ČHMÚ cron is registered
inside the application process. Follow the appropriate runbook from the
documentation table above.
