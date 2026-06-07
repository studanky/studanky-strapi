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
| `IS_PROXIED` | Trust `X-Forwarded-*` behind Traefik (default `true`; set `false` for direct access) |
| `DOMAIN` / `PUBLIC_URL` | Public domain / explicit public URL for absolute links (QR, emails) |
| `CORS_ORIGINS` | Comma-separated allowed origins (default `*` — **restrict in production**) |
| `DATABASE_*` | Postgres connection (compose forces `DATABASE_CLIENT=postgres`) |
| `SMTP_*` / `DEFAULT_FROM_EMAIL` | Optional SMTP (nodemailer); auth attached only when enabled |
| `AWS_BUCKET` + `AWS_*` / `UPLOAD_CDN_*` | Optional S3/R2 upload offload (empty = local volume) |
| `COMPOSE_PROJECT_NAME` | Volume/container namespace per host (default `studanky`) |
| `ACME_EMAIL` | Email for Let's Encrypt registration |
| `BACKUP_*` | Backup cron schedules + retention (production only) |

## ⚙️ Deployment

Production runs as a **single-node Docker Compose stack** on an Ubuntu 24.04
server: **Traefik** (auto HTTPS via Let's Encrypt) → **Strapi** → **PostgreSQL**
(WAL archiving) plus a **backup** container (pg_dump + pg_basebackup + WAL +
uploads). Target: low-traffic, read-heavy public API + admin for spring owners.

> ⚠️ **Do not scale `strapi` beyond 1 replica.** The ČHMÚ sync cron runs
> in-process; multiple replicas would fire it N× (duplicate reports, N× load on
> ČHMÚ). Scale vertically instead.

### Architecture

```text
        Internet :80/:443
              │
         ┌────▼─────┐  traefik  — TLS termination + HTTP→HTTPS redirect
         └────┬─────┘
              │  (docker network: studanky-network)
         ┌────▼─────┐  studanky-app  — Strapi :1337 (non-root, healthcheck)
         └────┬─────┘
         ┌────▼─────┐      ┌──────────────────┐
         │ postgres │◄─────│ studanky-backup  │ cron: dump+base+WAL+uploads
         │ + WAL    │      └──────────────────┘
         └──────────┘
```

### Prerequisites (Ubuntu 24.04)

```bash
# Docker Engine + Compose v2 plugin
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

docker compose version   # verify the v2 plugin
```

Point your DNS **A record** for `DOMAIN` at the server's public IP, and open
ports **80** and **443** in the firewall (`sudo ufw allow 80,443/tcp`).

### First deploy

```bash
# On the server, in the project root:
cp .env.example .env

# Generate each secret (run 6× for APP_KEYS×2 + the others):
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Edit .env — required: DOMAIN, ACME_EMAIL, DATABASE_PASSWORD, all secrets,
# HMAC_SECRET; set CORS_ORIGINS to the app/admin domains; COMPOSE_PROJECT_NAME.

# Build and start the full production stack:
docker compose -f docker-compose.yml up -d --build

# Watch startup (first run also provisions the TLS certificate):
docker compose -f docker-compose.yml logs -f strapi traefik
```

Create the first admin at `https://<DOMAIN>/admin`.

### Behind an existing reverse proxy (shared host)

If the server already runs a reverse proxy on `:80`/`:443` (e.g. a host-level
**nginx** shared with another site), do **not** start the bundled Traefik — two
proxies cannot bind the same ports. Use the
[`docker-compose.host-nginx.yml`](./docker-compose.host-nginx.yml) override: it
disables Traefik and publishes Strapi on `127.0.0.1:1337` only, so the host
proxy reverse-proxies to it and terminates TLS (e.g. certbot).

```bash
docker compose -f docker-compose.yml -f docker-compose.host-nginx.yml up -d --build
```

Then add a vhost on the host nginx (`/etc/nginx/sites-available/studanky`):

```nginx
server {
    server_name studanky.example.com;
    client_max_body_size 50M;                 # media uploads via admin
    location / {
        proxy_pass http://127.0.0.1:1337;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # IS_PROXIED=true trusts this
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 120s;
    }
    listen 80;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/studanky /etc/nginx/sites-enabled/studanky
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d studanky.example.com   # adds listen 443 + HTTP→HTTPS redirect
```

Keep `IS_PROXIED=true` (Strapi trusts `X-Forwarded-Proto` for absolute URLs) and
set `CORS_ORIGINS` to the real domain (never `*`). Every redeploy must pass both
`-f` flags, otherwise the base file would start Traefik.

### Updates / redeploy

```bash
git pull
docker compose -f docker-compose.yml up -d --build
docker image prune -f          # optional: reclaim old layers
```

### Local Docker run (optional)

`docker compose up` (without `-f`) merges `docker-compose.override.yml`, which
drops Traefik + backup and exposes Strapi directly on `:1337`. For plain
non-Docker dev use `npm run dev` (SQLite).

### Media uploads

By default uploads live in the `*_uploads` volume and are archived by the backup
container. To offload to **S3 / Cloudflare R2** (recommended once owners upload
photos), set `AWS_BUCKET` + credentials in `.env` (for R2 also `AWS_ENDPOINT` +
`AWS_FORCE_PATH_STYLE=true`) and set `UPLOAD_CDN_HOST` so the admin can preview
media (CSP).

### Backups & restore

Schedules (defaults): logical dump **02:30**, base + uploads + cleanup **03:00**,
retention **7 days** — all before the **03:30** ČHMÚ sync.

```bash
# Run a full backup now / list backups
docker exec studanky-backup /scripts/pg-backup.sh all
docker exec studanky-backup /scripts/pg-backup.sh list

# Restore the latest logical dump (destructive — asks for confirmation)
docker exec -it studanky-backup /scripts/pg-restore.sh dump latest
docker restart studanky-app      # reconnect Strapi after a DB restore

# Restore uploads / Point-in-Time Recovery guide
docker exec -it studanky-backup /scripts/pg-restore.sh uploads latest
docker exec studanky-backup /scripts/pg-restore.sh pitr-info
```

> ⚠️ **Backups are on the same host as the DB.** Add an off-site copy
> (e.g. `restic`/`rclone` of the `*_backups` volume to S3/R2) — the report
> history is the project's core asset.

For deeper background see the [Strapi deployment docs](https://docs.strapi.io/dev-docs/deployment).

## 📚 Learn More

- [Strapi Documentation](https://docs.strapi.io)
- [Strapi v5 Migration Guide](https://docs.strapi.io/dev-docs/migration)
