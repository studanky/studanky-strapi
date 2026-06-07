# Coolify Deployment

Alternative production deployment on **Coolify 4.1.2**, using the *Coolify-native*
model: a **Dockerfile application** + a **Coolify-managed PostgreSQL** resource,
with TLS terminated by Coolify's built-in proxy and uploads offloaded to S3/R2.

This is independent of the [Docker Compose / VM deployment](../README.md#️-deployment) —
the same repo and the same [`Dockerfile`](../Dockerfile) drive both. **No code or
config changes are required**; everything below is Coolify-side configuration.

> ⚠️ **The ČHMÚ sync cron runs in-process.** Keep **1 replica** and **disable
> rolling updates** (see [Single-replica cron](#single-replica-cron)). Multiple
> concurrent containers would each fire the 03:30 sync.

## Why this model

| Concern | Coolify-native choice | Effect |
|---|---|---|
| App | Dockerfile build pack from Git | reuses the existing multi-stage image as-is |
| Database | Coolify-managed PostgreSQL 16 | lifecycle, internal networking, scheduled backups in the UI |
| TLS / routing | Coolify built-in proxy (Traefik) + Let's Encrypt | automatic cert per FQDN, no manual labels/ports |
| Backups | Coolify scheduled DB backups → S3/R2 | off-site logical `pg_dump`, retention in the UI |
| Uploads | S3 / Cloudflare R2 (`@strapi/provider-upload-aws-s3`) | **stateless app container** — no host volume |

Because uploads go to S3/R2 and data lives in the managed DB, the application
container holds **no persistent state** — clean redeploys and trivial host
migration.

## Architecture

```text
                 Internet (:443)
                       │  Let's Encrypt (Coolify-managed cert)
              ┌────────▼─────────┐
              │  Coolify proxy   │  Traefik — TLS termination + HTTP→HTTPS
              │   (Traefik)      │  routing by FQDN, internal docker network
              └────────┬─────────┘
                       │  http://<app>:1337  (internal, no host port)
              ┌────────▼─────────┐        ┌───────────────────────────┐
              │  Strapi (App)    │───────▶│ PostgreSQL (managed res.)  │
              │  Dockerfile pack │ internal│  Coolify backups → S3/R2   │
              │  1 replica, cron │ hostname└───────────────────────────┘
              └────────┬─────────┘
                       │  uploads
              ┌────────▼─────────┐
              │   S3 / R2 bucket │  (off Coolify host)
              └──────────────────┘
```

The bundled `traefik` and `postgres-backup` services from
[`docker-compose.yml`](../docker-compose.yml) are **not used** here — Coolify
provides the proxy and the DB backups.

## Prerequisites

- A running, self-managed Coolify 4.1.2 instance with a destination/server.
- DNS **A/AAAA record** for the FQDN (e.g. `studanky.smolikja.team`) pointed at the
  Coolify server. Ports **80/443** open (Coolify's proxy handles ACME).
- An S3-compatible bucket for uploads **and** for DB backups (Cloudflare R2, AWS
  S3, MinIO, …) with access keys.

## 1. Project + PostgreSQL

1. Create a **Project** `studanky` → environment `production`.
2. `+ New Resource` → **Databases → PostgreSQL 16**. Set a strong password,
   database `studanky`, user `studanky`.
3. After it starts, open the DB resource and note the **internal connection
   details** (host is the internal service name, port `5432`). These are only
   reachable on Coolify's internal network — never expose the DB publicly.
4. **Backups** tab on the DB resource:
   - Schedule e.g. `0 3 * * *` (before the 03:30 sync), retention `7`.
   - Destination = **S3** → enter the R2/S3 endpoint, bucket and keys.
   - Run one manual backup to verify credentials.

## 2. Application (Strapi)

1. `+ New Resource` → **Application → Git repository** → select the repo + branch
   (`main`).
2. **Build Pack = Dockerfile** (Coolify auto-detects the root `Dockerfile`).
3. **Ports Exposes = `1337`**.
4. **Domains** → `https://studanky.smolikja.team`. Coolify generates the Traefik
   labels and provisions the Let's Encrypt certificate automatically. Do **not**
   add `ports:` or Traefik labels manually.
5. **Health Check** → path `/_health`, expected status `204` (matches the
   Dockerfile `HEALTHCHECK`).

## 3. Environment variables

Set these on the **application** (mark every secret as *Is Secret*). Do **not**
wrap values in quotes — Coolify takes them literally.

```bash
NODE_ENV=production
PUBLIC_URL=https://studanky.smolikja.team
IS_PROXIED=true
HOST=0.0.0.0
PORT=1337
CRON_ENABLED=true
CORS_ORIGINS=https://studanky.smolikja.team   # + the client's app/admin domains, comma-separated

# Database — prefer the individual vars over DATABASE_URL.
# config/database.ts always passes host:'localhost' as a default, so mixing a
# connectionString is ambiguous and forces URL-encoding the password. Use the
# discrete vars Coolify shows on the managed Postgres resource:
DATABASE_CLIENT=postgres
DATABASE_HOST=<coolify-internal-postgres-host>
DATABASE_PORT=5432
DATABASE_NAME=studanky
DATABASE_USERNAME=studanky
DATABASE_PASSWORD=<db-password>
DATABASE_SSL=false                          # internal network, no TLS needed

# Secrets — generate each with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
APP_KEYS=<key1>,<key2>
API_TOKEN_SALT=<generated>
ADMIN_JWT_SECRET=<generated>
TRANSFER_TOKEN_SALT=<generated>
ENCRYPTION_KEY=<generated>
JWT_SECRET=<generated>
HMAC_SECRET=<generated, min 32 chars>       # QR/report signature

# Uploads → S3 / Cloudflare R2
AWS_BUCKET=studanky-media
AWS_REGION=auto                             # R2: auto
AWS_ENDPOINT=https://<account>.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=<key>
AWS_ACCESS_SECRET=<secret>
AWS_FORCE_PATH_STYLE=true                   # R2 / MinIO
UPLOAD_CDN_URL=https://media.studanky.smolikja.team   # public media base URL
UPLOAD_CDN_HOST=media.studanky.smolikja.team          # added to CSP img-src/media-src
```

> `UPLOAD_CDN_URL`/`UPLOAD_CDN_HOST` require the bucket to be **publicly
> readable** (R2 public bucket or a custom domain / Worker in front). Without a
> public media URL the admin panel cannot render image previews.

## 4. Deploy

Trigger **Deploy** and watch the build + runtime logs. On first boot Strapi runs
its migrations automatically. Then create the first admin at
`https://studanky.smolikja.team/admin`.

For auto-deploy on push, enable the Git **webhook** Coolify provides for the app.

## Single-replica cron

The ČHMÚ sync (`config/cron-tasks.ts`, 03:30 Europe/Prague) runs **in-process**.
To guarantee it fires exactly once:

- **Replicas = 1.** Never scale horizontally — scale the container's CPU/RAM
  instead.
- **Disable Rolling Update** (Advanced → use recreate / stop-then-start). A
  rolling deploy briefly runs two containers, both with `CRON_ENABLED=true`. Cost
  is ~10–30 s of downtime per deploy, acceptable for this read-heavy API.

No code refactor is needed: `node-schedule` re-registers on container start, and
`syncFromChmu()` is **idempotent** (upserts springs by `external_source` +
`external_id`), so a missed or overlapping run is self-healing on the next night.

## Operations

- **DB backups** — managed on the PostgreSQL resource (§1). Verify they land in
  the bucket; restore is done from the Coolify DB **Backups** tab.
- **Uploads backups** — handled by the S3/R2 provider's own
  versioning/lifecycle, not by Coolify. Enable bucket versioning if you want
  point-in-time recovery for media.
- **Logs / shell** — use the app resource's **Logs** and **Terminal** tabs
  (e.g. `npm run strapi -- …` for one-off admin tasks).
- **Manual ČHMÚ sync** — `POST /api/springs/sync-chmu` (see
  [`chmu-sync.md`](./chmu-sync.md)).

## Differences vs the Compose/VM deployment

| | Compose / VM | Coolify-native |
|---|---|---|
| Proxy / TLS | bundled Traefik | Coolify proxy |
| Database | `postgres` container (WAL/PITR) | Coolify-managed PostgreSQL |
| DB backups | `postgres-backup` container (dump + base + WAL, PITR) | Coolify scheduled `pg_dump` → S3 (no PITR) |
| Uploads | local `*_uploads` volume | S3 / R2 (stateless app) |
| App state | volume on host | none |

If point-in-time recovery is a hard requirement, prefer the Compose deployment
or run a dedicated managed Postgres with WAL archiving — Coolify's built-in
backups are logical dumps only.
