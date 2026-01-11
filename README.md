# Studánky Strapi

Backend API for the Studánky (Springs) community platform — a hiking app for discovering and reporting the status of natural springs.

Built with [Strapi v5](https://strapi.io) and TypeScript.

## ✨ Features

- **Spring Management** — CRUD for spring locations with i18n support
- **Status Reports** — Public endpoint for hikers to submit spring status
- **QR Codes** — Auto-generated for each spring (encode `documentId`)
- **Manager Access Control** — Admin users see only springs they manage
- **HMAC Authentication** — Bot prevention without user registration
- **Geo-Fence Validation** — Reports validated against spring proximity

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

### Production

```bash
npm run build
npm run start
```

## 📖 Documentation

Custom backend logic is documented in [`docs/`](./docs/):

| Document | Description |
|----------|-------------|
| [API Security](./docs/api-security.md) | HMAC signature, replay protection, geo-fencing |
| [Flutter Integration](./docs/flutter-integration.md) | Mobile client integration guide |
| [Admin Filtering](./docs/admin-filtering.md) | Manager-based access control for Springs |
| [Lifecycle Hooks](./docs/lifecycle-hooks.md) | QR code generation, status propagation |

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
| `HMAC_SECRET` | Shared secret for Report API authentication |

## ⚙️ Deployment

See the [Strapi deployment documentation](https://docs.strapi.io/dev-docs/deployment) for deployment options.

## 📚 Learn More

- [Strapi Documentation](https://docs.strapi.io)
- [Strapi v5 Migration Guide](https://docs.strapi.io/dev-docs/migration)
