# Coolify Deployment

Alternative production deployment for **Coolify 4.1.2** using the Coolify-native
model:

- **Application** built from the existing root [`Dockerfile`](../Dockerfile)
- **Coolify-managed PostgreSQL**
- **Coolify proxy** for TLS and routing
- **Coolify local database backups**
- **Coolify persistent storage** for local Strapi uploads

The existing [Docker Compose / VM deployment](../README.md#deployment) remains
unchanged. Do not deploy the root `docker-compose.yml` in Coolify; it contains a
bundled Traefik service, explicit host ports and a custom network that are meant
for a standalone Linux VM, not for Coolify's managed proxy/network model.

Relevant upstream docs:

- [Coolify Dockerfile build pack](https://coolify.io/docs/applications/build-packs/dockerfile)
- [Coolify PostgreSQL backups](https://coolify.io/docs/databases/backups)
- [Coolify persistent storage](https://coolify.io/docs/knowledge-base/persistent-storage)
- [Strapi Docker production notes](https://docs.strapi.io/cms/installation/docker)
- [Strapi database pooling note](https://docs.strapi.io/cms/configurations/database#database-pooling-options)

## Architecture

```text
Internet :443
    |
    v
Coolify proxy (Traefik, managed by Coolify)
    |
    v
Strapi application (Dockerfile build, :1337, 1 replica)
    |                         |
    v                         v
Coolify PostgreSQL       Coolify volume /app/public/uploads
local pg_dump backups    backed up by Kopia with the Coolify host
```

Backups are local in Coolify in this setup. That is intentional for the current
phase. The operational requirement is that **Kopia backs up the Coolify host data,
including Coolify resources, database volumes, local backup files and application
volumes**.

## Before You Start

Prepare these values:

- Public API/admin domain, for example `studanky.example.com`
- Coolify project and environment, for example `studanky` / `production`
- PostgreSQL database name/user, for example `studanky` / `studanky`
- Strong PostgreSQL password
- Six Strapi secrets plus the app HMAC secret
- Local backup retention, for example `7` days

Generate each Strapi secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Use two generated values for `APP_KEYS`:

```text
APP_KEYS=<key1>,<key2>
```

## 1. Create The PostgreSQL Resource

1. In Coolify, open your project and production environment.
2. Create a new resource: **Databases -> PostgreSQL**.
3. Use PostgreSQL 16 if available.
4. Set:
   - Database: `studanky`
   - User: `studanky`
   - Password: a strong generated password
5. Do not expose PostgreSQL publicly. Leave public port / internet access off.
6. Start the database.
7. Copy the internal connection details shown by Coolify:
   - Internal host
   - Port, normally `5432`
   - Database
   - Username
   - Password

The Strapi application must use the internal host, not a public database URL.

## 2. Configure Local Database Backups

In the PostgreSQL resource:

1. Open **Backups**.
2. Create a scheduled backup.
3. Database list: `studanky`.
4. Schedule: `30 0 * * *`.
5. Retention: `7` days, or your chosen value.
6. Storage: local Coolify/server storage. Do not configure S3/R2 for this phase.
7. Run **Backup now** once and verify that the backup succeeds.

Coolify schedules are commonly evaluated in UTC. `30 0 * * *` means `02:30`
in Czech summer time and `01:30` in Czech winter time, so a clean backup exists
before the ČHMÚ sync at `03:30 Europe/Prague`.

Coolify PostgreSQL backups are logical `pg_dump` backups in custom format. For
restore, use the PostgreSQL resource's **Import Backups** section; Coolify's
default import expects a dump created with `pg_dump -Fc`.

## 3. Create The Strapi Application

1. Create a new resource: **Application -> Git repository**.
2. Select this repository and the production branch, usually `main`.
3. Set **Build Pack** to `Dockerfile`.
4. Base directory: `/`.
5. Dockerfile: `Dockerfile`.
6. Set **Port Exposes** to `1337`.
7. Do not configure port mappings to the host.
8. Add the domain:

```text
https://studanky.example.com
```

Replace the domain with the real production domain. DNS must already point to the
Coolify server, and ports `80`/`443` must be reachable by Coolify's proxy.

The image already contains a Docker `HEALTHCHECK` for `/_health`, expecting
Strapi's `204` response. If you configure a Coolify UI health check as well, use:

```text
Path: /_health
Expected status: 204
```

If Coolify shows `No available server`, first check whether the container is
marked unhealthy and whether `Port Exposes` is still `1337`.

## 4. Add Persistent Storage For Uploads

Even if user uploads are not important yet, configure the volume now so future
admin-uploaded files survive redeploys.

In the Strapi application resource, add persistent storage:

```text
Type: Volume
Name: studanky_uploads
Destination Path: /app/public/uploads
```

Leave `AWS_BUCKET` unset/empty. With no S3 bucket configured, Strapi uses local
uploads under `/app/public/uploads`, and this Coolify volume is what Kopia must
back up.

## 5. Add Environment Variables

Open the application's **Environment Variables** tab. Developer View is the
fastest way to paste the values.

Set secret values as **Secret**. For secrets and database credentials, keep
**Runtime Variable** enabled and disable **Build Variable**. The Docker image does
not need database credentials or Strapi secrets during build.

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=1337

DOMAIN=studanky.example.com
PUBLIC_URL=https://studanky.example.com
IS_PROXIED=true
CRON_ENABLED=true
STRAPI_PLUGIN_I18N_INIT_LOCALE_CODE=cs
CORS_ORIGINS=https://studanky.example.com
NEWSLETTER_SUBSCRIBE_MAX_BODY_BYTES=8192
NEWSLETTER_EMAIL_RATE_LIMIT_HOUR_MAX=5
NEWSLETTER_EMAIL_RATE_LIMIT_DAY_MAX=20
NEWSLETTER_RATE_LIMIT_MAX_KEYS=10000
NEWSLETTER_RATE_LIMIT_SALT=<generated-or-leave-empty-to-use-app-secret>

DATABASE_CLIENT=postgres
DATABASE_HOST=<coolify-internal-postgres-host>
DATABASE_PORT=5432
DATABASE_NAME=studanky
DATABASE_USERNAME=studanky
DATABASE_PASSWORD=<postgres-password>
DATABASE_SSL=false
DATABASE_POOL_MIN=0
DATABASE_POOL_MAX=10

APP_KEYS=<key1>,<key2>
API_TOKEN_SALT=<generated>
ADMIN_JWT_SECRET=<generated>
TRANSFER_TOKEN_SALT=<generated>
ENCRYPTION_KEY=<generated>
JWT_SECRET=<generated>
HMAC_SECRET=<generated-minimum-32-chars>
```

Use individual database variables instead of `DATABASE_URL`. It avoids password
URL-encoding problems and matches this repository's `config/database.ts`.

The website calls Strapi from a Next Server Action, so the primary visitor-IP
rate limit belongs in the web application or edge layer; Strapi's built-in
newsletter limiter is a secondary in-memory limit keyed by an HMAC hash of the
normalized email.

Optional SMTP variables can be added later if email sending is needed:

```env
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=false
SMTP_TLS_REJECT_UNAUTHORIZED=true
SMTP_AUTH_ENABLED=
SMTP_USER=
SMTP_PASS=
DEFAULT_FROM_EMAIL=noreply@example.com
DEFAULT_REPLY_TO_EMAIL=info@example.com
```

Do not set these unless you are using S3/R2 uploads:

```env
AWS_BUCKET=
AWS_REGION=
AWS_ENDPOINT=
AWS_ACCESS_KEY_ID=
AWS_ACCESS_SECRET=
AWS_ROOT_PATH=
AWS_FORCE_PATH_STYLE=false
UPLOAD_CDN_URL=
UPLOAD_CDN_HOST=
```

## 6. Deployment Settings

Set the application to a single replica.

The ČHMÚ sync cron runs in-process in Strapi at `03:30 Europe/Prague`. Multiple
running application containers would each register the same cron task. Keep:

```text
Replicas: 1
```

If your Coolify UI exposes rolling-update settings, disable rolling updates or
use a stop-then-start/recreate deployment strategy for this app. If that setting
is not available, avoid manual deployments around the `03:30` cron window.

For a small production Strapi instance, start with at least:

```text
Runtime memory: 1 GB minimum, 2 GB preferred
Build memory: 2 GB preferred
```

If Docker builds fail during `npm ci` or `npm run build`, increase available
memory or use a separate Coolify build server.

## 7. Deploy

1. Click **Deploy**.
2. Watch build logs until the Docker image is built.
3. Watch runtime logs until Strapi starts successfully.
4. Open:

```text
https://studanky.example.com/_health
```

Expected response: HTTP `204`.

5. Open:

```text
https://studanky.example.com/admin
```

6. Create the first Strapi admin user.
7. In the PostgreSQL resource, run a manual backup once after the first successful
   boot.
8. Run or verify a Kopia backup of the Coolify host.

## 8. Updates

For normal releases:

1. Push changes to the configured branch.
2. Trigger deployment manually or enable Coolify auto-deploy/webhook.
3. Watch application logs after deployment.
4. Verify `/_health` and `/admin`.

Before a Strapi upgrade or database-affecting migration:

1. Run a manual PostgreSQL backup in Coolify.
2. Confirm Kopia has a recent backup of the Coolify host.
3. Deploy.
4. Verify logs and admin access.

## 9. Restore

For an application-level database restore:

1. Open the PostgreSQL resource.
2. Stop the Strapi application to avoid writes during restore.
3. Use **Import Backups** or restore one of the local Coolify backups.
4. Start Strapi again.
5. Verify `/admin`, public API endpoints and recent content.

For full-host recovery:

1. Restore Coolify with Kopia according to your Kopia runbook.
2. Verify Coolify resources, PostgreSQL volume, local DB backups and
   `studanky_uploads` volume are present.
3. Start PostgreSQL first.
4. Start Strapi.
5. Verify `/_health` and `/admin`.

## Differences Vs VM Compose Deployment

| Concern | VM Docker Compose | Coolify-native |
|---|---|---|
| Proxy / TLS | Bundled Traefik in `docker-compose.yml` | Coolify proxy |
| App build | Local `docker compose build` | Coolify Dockerfile build pack |
| Database | Compose `postgres` service | Coolify PostgreSQL resource |
| DB backups | Backup sidecar + WAL/PITR | Coolify local `pg_dump` backups |
| Uploads | Compose `strapi_uploads` volume | Coolify volume `/app/public/uploads` |
| Off-host backup | Not built in | Kopia backs up the Coolify host |

The Coolify setup intentionally does not implement S3/R2 backup storage in this
phase. If off-host backups become required later, add S3-compatible backup
storage in Coolify and consider moving uploads to S3/R2 as well.
