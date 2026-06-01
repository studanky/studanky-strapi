#!/bin/sh
# =============================================================================
# PostgreSQL Startup Initialization Script
# =============================================================================
# Runs EVERY time the PostgreSQL container starts. Ensures WAL archive
# permissions and pg_hba.conf replication access (needed by pg_basebackup),
# then hands off to the original PostgreSQL entrypoint.
# =============================================================================

set -eu

echo "[init-postgres] Initializing PostgreSQL backup prerequisites..."

# 1. WAL archive directory permissions
WAL_DIR="/var/lib/postgresql/wal_archive"
if [ -d "${WAL_DIR}" ]; then
    chown postgres:postgres "${WAL_DIR}"
    chmod 700 "${WAL_DIR}"
    echo "[init-postgres] WAL archive directory permissions set."
fi

# 2. Replication access in pg_hba.conf (host-internal network only)
PG_HBA="/var/lib/postgresql/data/pg_hba.conf"
if [ -f "${PG_HBA}" ] && ! grep -q "^host replication" "${PG_HBA}"; then
    echo "host replication all all md5" >> "${PG_HBA}"
    echo "[init-postgres] Replication access added to pg_hba.conf."
else
    echo "[init-postgres] Replication access already configured."
fi

# 3. Hand off to the original PostgreSQL entrypoint
echo "[init-postgres] Starting PostgreSQL..."
exec docker-entrypoint.sh "$@"
