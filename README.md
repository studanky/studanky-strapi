# Studánky Strapi

Backend API for the Studánky (Springs) community platform — a hiking app for discovering and reporting the status of natural springs.

Built with [Strapi v5](https://strapi.io) and TypeScript.

## 🚀 Getting Started

### Prerequisites

- Node.js 18–22
- npm 6+

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

## 📖 Custom Documentation

This project includes custom backend logic. See the [`docs/`](./docs/) folder for details:

| Document | Description |
|----------|-------------|
| [Admin Filtering](./docs/admin-filtering.md) | Manager-based access control for Springs in Admin Panel |
| [Lifecycle Hooks](./docs/lifecycle-hooks.md) | Auto-generation of QR codes, status propagation |

## ⚙️ Deployment

See the [Strapi deployment documentation](https://docs.strapi.io/dev-docs/deployment) for deployment options.

## 📚 Learn More

- [Strapi Documentation](https://docs.strapi.io)
- [Strapi v5 Migration Guide](https://docs.strapi.io/dev-docs/migration)
