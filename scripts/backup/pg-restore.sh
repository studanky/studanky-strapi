#!/bin/sh
# =============================================================================
# Studánky restore script (PostgreSQL + local uploads)
# =============================================================================
#   pg-restore.sh list                 — list available backups
#   pg-restore.sh dump <file|latest>   — restore DB from a logical dump
#   pg-restore.sh uploads <file|latest>— restore uploads archive into /uploads
#   pg-restore.sh pitr-info            — Point-in-Time Recovery instructions
# =============================================================================

set -eu

DB_HOST="${DATABASE_HOST:-postgres}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_NAME="${DATABASE_NAME:-studanky}"
DB_USER="${DATABASE_USERNAME:-studanky}"

BACKUP_DIR="/backups"
BASE_DIR="${BACKUP_DIR}/base"
DUMP_DIR="${BACKUP_DIR}/dump"
UPLOADS_DIR="${BACKUP_DIR}/uploads"
UPLOADS_DST="/uploads"
WAL_ARCHIVE_DIR="/wal_archive"
LOG_PREFIX="[pg-restore]"

log_info()    { echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_PREFIX} INFO: $*"; }
log_error()   { echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_PREFIX} ERROR: $*" >&2; }
log_success() { echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_PREFIX} SUCCESS: $*"; }

confirm_action() {
    echo ""
    echo "  ⚠️  WARNING: This is a DESTRUCTIVE operation!"
    echo "  $1"
    echo ""
    printf "  Type 'yes' to continue: "
    read -r CONFIRM
    if [ "${CONFIRM}" != "yes" ]; then
        echo "  Aborted."
        exit 0
    fi
}

list_backups() {
    echo ""
    echo "============================================="
    echo "  Available Backups for Restore"
    echo "============================================="

    echo ""
    echo "--- Logical Dumps (recommended for restore) ---"
    if [ -d "${DUMP_DIR}" ] && [ "$(ls -A "${DUMP_DIR}" 2>/dev/null)" ]; then
        for f in "${DUMP_DIR}"/dump_*.dump; do
            SIZE=$(du -h "$f" | cut -f1)
            echo "  $(basename "$f")  (${SIZE})"
        done
    else
        echo "  (none)"
    fi

    echo ""
    echo "--- Uploads Archives ---"
    if [ -d "${UPLOADS_DIR}" ] && [ "$(ls -A "${UPLOADS_DIR}" 2>/dev/null)" ]; then
        for f in "${UPLOADS_DIR}"/uploads_*.tar.gz; do
            SIZE=$(du -h "$f" | cut -f1)
            echo "  $(basename "$f")  (${SIZE})"
        done
    else
        echo "  (none)"
    fi

    echo ""
    echo "--- Base Backups (for PITR) ---"
    if [ -d "${BASE_DIR}" ] && [ "$(ls -A "${BASE_DIR}" 2>/dev/null)" ]; then
        for f in "${BASE_DIR}"/base_*.tar.gz; do
            SIZE=$(du -h "$f" | cut -f1)
            echo "  $(basename "$f")  (${SIZE})"
        done
    else
        echo "  (none)"
    fi
    echo ""
}

resolve_file() {
    # $1 = dir, $2 = glob, $3 = arg (file|latest) → echoes resolved path
    DIR="$1"; GLOB="$2"; ARG="$3"
    if [ "${ARG}" = "latest" ]; then
        FOUND=$(find "${DIR}" -name "${GLOB}" -type f | sort | tail -1)
        [ -z "${FOUND}" ] && { log_error "No backup found in ${DIR}"; exit 1; }
        echo "${FOUND}"; return
    fi
    if [ -f "${ARG}" ]; then echo "${ARG}"; return; fi
    if [ -f "${DIR}/${ARG}" ]; then echo "${DIR}/${ARG}"; return; fi
    log_error "File not found: ${ARG}"; exit 1
}

restore_dump() {
    DUMP_FILE=$(resolve_file "${DUMP_DIR}" "dump_*.dump" "$1")
    log_info "Will restore database from: ${DUMP_FILE}"
    confirm_action "Database '${DB_NAME}' will be dropped and recreated."

    PGPASSWORD="${DATABASE_PASSWORD}" psql \
        -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" \
        > /dev/null 2>&1 || true

    log_info "Dropping database '${DB_NAME}'..."
    PGPASSWORD="${DATABASE_PASSWORD}" dropdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" --if-exists "${DB_NAME}"

    log_info "Creating database '${DB_NAME}'..."
    PGPASSWORD="${DATABASE_PASSWORD}" createdb -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -O "${DB_USER}" "${DB_NAME}"

    log_info "Restoring data..."
    if PGPASSWORD="${DATABASE_PASSWORD}" pg_restore -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
        -d "${DB_NAME}" --no-owner --no-privileges --verbose "${DUMP_FILE}" 2>&1; then
        log_success "Database restored from ${DUMP_FILE}"
    else
        TABLE_COUNT=$(PGPASSWORD="${DATABASE_PASSWORD}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
            -d "${DB_NAME}" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ')
        if [ "${TABLE_COUNT:-0}" -gt 0 ]; then
            log_success "Database restored (with warnings) — ${TABLE_COUNT} tables found."
        else
            log_error "Restore may have failed — 0 tables found."
            exit 1
        fi
    fi

    echo ""
    log_info "⚡ Restart Strapi to reconnect: docker restart studanky-app"
    echo ""
}

restore_uploads() {
    if [ ! -d "${UPLOADS_DST}" ]; then
        log_error "Uploads volume ${UPLOADS_DST} not mounted (read-only or S3 offload)."
        log_error "Mount the uploads volume read-write into this container to restore."
        exit 1
    fi
    ARCHIVE=$(resolve_file "${UPLOADS_DIR}" "uploads_*.tar.gz" "$1")
    log_info "Will restore uploads from: ${ARCHIVE}"
    confirm_action "Existing files in ${UPLOADS_DST} will be overwritten."

    log_info "Extracting uploads into ${UPLOADS_DST}..."
    if tar -xzf "${ARCHIVE}" -C "${UPLOADS_DST}"; then
        log_success "Uploads restored from ${ARCHIVE}"
    else
        log_error "Uploads restore FAILED!"
        exit 1
    fi
}

pitr_info() {
    cat << 'EOF'

=============================================================================
  Point-in-Time Recovery (PITR) Guide
=============================================================================
Restore the DB to ANY point in time using a base backup + WAL archive.

Prerequisites: a base backup in /backups/base/ and WAL files in /wal_archive/.

1. Stop services:
   docker compose -f docker-compose.yml down

2. Remove current PostgreSQL data volume:
   docker volume rm studanky_postgres_data

3. Extract the base backup into a fresh data volume:
   docker run --rm \
     -v studanky_postgres_data:/var/lib/postgresql/data \
     -v studanky_backups:/backups \
     postgres:16-alpine \
     sh -c "tar xzf /backups/base/base_YYYYMMDD_HHMMSS.tar.gz -C /var/lib/postgresql/data"

4. Stage WAL files for replay:
   docker run --rm \
     -v studanky_postgres_data:/var/lib/postgresql/data \
     -v studanky_wal_archive:/wal_archive \
     postgres:16-alpine \
     sh -c "cp /wal_archive/* /var/lib/postgresql/data/pg_wal/"

5. Configure recovery target:
   docker run --rm \
     -v studanky_postgres_data:/var/lib/postgresql/data \
     postgres:16-alpine \
     sh -c "
       touch /var/lib/postgresql/data/recovery.signal
       cat >> /var/lib/postgresql/data/postgresql.auto.conf << CONF
restore_command = 'cp /wal_archive/%f %p'
recovery_target_time = '2026-01-15 14:30:00+01'
recovery_target_action = 'promote'
CONF
     "

6. Start PostgreSQL (recovery mode) and watch logs:
   docker compose -f docker-compose.yml up -d postgres
   docker logs -f studanky-postgres

7. After recovery, start Strapi:
   docker compose -f docker-compose.yml up -d strapi

=============================================================================
  Replace YYYYMMDD_HHMMSS and recovery_target_time with your values.
=============================================================================

EOF
}

case "${1:-}" in
    list)      list_backups ;;
    dump)      [ -z "${2:-}" ] && { echo "Usage: $0 dump <file|latest>"; exit 1; }; restore_dump "$2" ;;
    uploads)   [ -z "${2:-}" ] && { echo "Usage: $0 uploads <file|latest>"; exit 1; }; restore_uploads "$2" ;;
    pitr-info) pitr_info ;;
    *)
        echo "Usage: $0 {list|dump <file|latest>|uploads <file|latest>|pitr-info}"
        exit 1
        ;;
esac
