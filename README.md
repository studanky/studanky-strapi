# Studánky Strapi

Backend API for the Studánky (Springs) community platform — a hiking app for discovering and reporting the status of natural springs.

Built with [Strapi v5](https://strapi.io) and TypeScript.

## ✨ Features

- **Source-neutral canonical model** — every data source is an adapter mapping into one model
- **ČHMÚ sync** — nightly cron + manual endpoint imports spring discharge data
- **Denormalized map status** — cached current status for a cheap map endpoint
- **Public read API** — `/springs/map` (bbox) and `/springs/:documentId/reports`
- **QR Codes** — Auto-generated for each spring (encode `documentId`)
- **Manager Access Control** — admin users see only springs they manage

> The MVP is read-only ČHMÚ data — there is no public write endpoint. Community
> report submission (HMAC, geo-fence, rate limiting) is **Phase 2**; see
> [API Security](./docs/api-security.md).

## 🚀 Getting Started

### Prerequisites

- Node.js 18–22
- npm 6+

### Environment Setup

```bash
cp .env.example .env
# Edit .env and set all required secrets
```

### Development

```bash
npm install
npm run dev
```

Admin panel: http://localhost:1337/admin

### Testing

```bash
npm test          # run unit tests once (Vitest)
npm run test:watch # watch mode
```

See [Testing](./docs/testing.md) for coverage and how to add tests.

### Production

```bash
npm run build
npm run start
```

## 📖 Documentation

Custom backend logic is documented in [`docs/`](./docs/):

| Document | Description |
|----------|-------------|
| [ČHMÚ Sync](./docs/chmu-sync.md) | Source adapter, sync service, cron, manual endpoint |
| [Public API](./docs/public-api.md) | Custom endpoints: map (bbox) + report history |
| [Denormalization](./docs/denormalization.md) | `refreshLatest`, cached status, flow scale |
| [Database & Migrations](./docs/database-migrations.md) | Indexes + why pairing is non-unique |
| [Admin Filtering](./docs/admin-filtering.md) | Manager-based access control for Springs |
| [Lifecycle Hooks](./docs/lifecycle-hooks.md) | QR code generation (denorm moved to a service) |
| [API Security](./docs/api-security.md) | MVP public surface + Phase 2 submit-security plan |
| [Flutter Integration](./docs/flutter-integration.md) | Client submit contract (Phase 2, planned) |
| [Roadmap](./docs/roadmap.md) | Next steps & Phase 2 / 3 plan |
| [Testing](./docs/testing.md) | Running & writing the automated unit tests |
| [Product spec](./docs/studanky-specifikace.md) · [Backend design](./docs/studanky-strapi-navrh.md) | Source-of-truth design docs |

## 🔐 Environment Variables

| Variable | Description |
|----------|-------------|
| `HOST` | Server host (default: `0.0.0.0`) |
| `PORT` | Server port (default: `1337`) |
| `APP_KEYS` | Application keys for session encryption |
| `API_TOKEN_SALT` | Salt for API token generation |
| `ADMIN_JWT_SECRET` | Secret for admin JWT tokens |
| `TRANSFER_TOKEN_SALT` | Salt for transfer tokens |
| `JWT_SECRET` | Secret for user JWT tokens |
| `ENCRYPTION_KEY` | Key for data encryption |
| `CRON_ENABLED` | Enable scheduled tasks incl. ČHMÚ sync (default `true`) |
| `HMAC_SECRET` | *(Phase 2)* shared secret for report-submit auth — unused in MVP |

## ⚙️ Deployment

See the [Strapi deployment documentation](https://docs.strapi.io/dev-docs/deployment) for deployment options.

## 📚 Learn More

- [Strapi Documentation](https://docs.strapi.io)
- [Strapi v5 Migration Guide](https://docs.strapi.io/dev-docs/migration)
