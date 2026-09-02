# Docker Compose Deployment

This runbook covers the repository's standalone production deployment on a
Linux host. For a Coolify-managed deployment, use
[Coolify Deployment](./coolify-deploy.md) instead.

## Architecture

```text
Internet :80/:443
      |
      v
Traefik (TLS and HTTP-to-HTTPS redirect)
      |
      v
Strapi :1337
      |
      v
PostgreSQL <--- backup sidecar
```

The production compose stack contains Traefik, PostgreSQL 16, one Strapi
container, and a backup container. PostgreSQL data, WAL archives, backups,
uploads, and Traefik certificates use named volumes.

Do not scale Strapi beyond one replica. The ČHMÚ cron runs in-process, so every
replica would schedule the same import.

## Prerequisites

- Docker Engine with the Compose v2 plugin
- a DNS A/AAAA record pointing the configured domain to the host
- inbound TCP ports 80 and 443
- a completed `.env` copied from `.env.example`

Generate independent application secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Use two generated values in the comma-separated `APP_KEYS` value. At minimum,
set `DOMAIN`, `ACME_EMAIL`, `DATABASE_PASSWORD`, `APP_KEYS`, `API_TOKEN_SALT`,
`ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `ENCRYPTION_KEY`, and `JWT_SECRET`.
Restrict `CORS_ORIGINS` for production.

## First deployment

```bash
cp .env.example .env
docker compose -f docker-compose.yml up -d --build
docker compose -f docker-compose.yml logs -f strapi traefik
```

Create the first administrator at `https://<DOMAIN>/admin`. Strapi's health
endpoint is `https://<DOMAIN>/_health` and returns HTTP 204 when ready.

## Updates

```bash
git pull
docker compose -f docker-compose.yml up -d --build
```

Review application logs and verify `/_health`, the Admin Panel, and the public
read endpoints after each deployment. Before database migrations or Strapi
upgrades, create and verify a backup.

## Local Docker mode

Running Compose without `-f` also loads `docker-compose.override.yml`. That
override disables Traefik and the backup service and publishes Strapi directly
on the configured host port:

```bash
docker compose up -d --build
```

For non-Docker development, use `npm run dev`; SQLite is the default database.

## Existing host-level nginx

When another reverse proxy already owns ports 80 and 443, use the committed
override:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.host-nginx.yml \
  up -d --build
```

The override disables bundled Traefik and exposes Strapi only on
`127.0.0.1:1337`. Configure the host nginx to proxy to that address and preserve
the original host and forwarding headers:

```nginx
server {
    server_name studanky.example.com;
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:1337;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    listen 80;
}
```

Keep `IS_PROXIED=true` when TLS terminates at Traefik or nginx. Always use both
compose files for subsequent deployments on this host; omitting the override
would attempt to start bundled Traefik.

## Upload storage

Without `AWS_BUCKET`, files live in the named uploads volume mounted at
`/app/public/uploads`. The backup container archives that volume. Setting
`AWS_BUCKET` enables the S3-compatible provider configured in
`config/plugins.ts`; R2 or MinIO can additionally use `AWS_ENDPOINT` and
`AWS_FORCE_PATH_STYLE`.

When a CDN or object-storage host serves media, configure `UPLOAD_CDN_URL` and
`UPLOAD_CDN_HOST`. The latter is added to the Admin Panel content-security
policy for image and media previews.

## Backups

Default schedules are:

| Operation | Schedule |
|---|---|
| Logical `pg_dump` | 02:30 daily |
| Base backup, uploads archive, and cleanup | 03:00 daily |
| ČHMÚ sync | 03:30 Europe/Prague |
| Retention | 7 days |

Run or inspect backups with:

```bash
docker exec studanky-backup /scripts/pg-backup.sh all
docker exec studanky-backup /scripts/pg-backup.sh list
```

The compose stack stores backups on the same host. Copy the backup volume to
independent off-host storage for host-loss protection.

## Restore

The restore script is destructive and asks for confirmation:

```bash
docker exec -it studanky-backup /scripts/pg-restore.sh dump latest
docker restart studanky-app
docker exec -it studanky-backup /scripts/pg-restore.sh uploads latest
docker exec studanky-backup /scripts/pg-restore.sh pitr-info
```

After restoration, verify database connectivity, Admin Panel access, media,
public reads, and the most recent ČHMÚ report timestamps.
