#!/bin/sh
# =============================================================================
# Studánky backup script (PostgreSQL + local uploads)
# =============================================================================
#   pg-backup.sh dump     — logical dump via pg_dump
#   pg-backup.sh base     — full base backup via pg_basebackup
#   pg-backup.sh uploads  — archive local upload volume (tar.gz)
#   pg-backup.sh cleanup  — remove expired backups and WAL files
#   pg-backup.sh all      — dump + base + uploads + cleanup (default)
#   pg-backup.sh list     — list available backups
# =============================================================================

set -eu

DB_HOST="${DATABASE_HOST:-postgres}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_NAME="${DATABASE_NAME:-studanky}"
DB_USER="${DATABASE_USERNAME:-studanky}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

BACKUP_DIR="/backups"
BASE_DIR="${BACKUP_DIR}/base"
DUMP_DIR="${BACKUP_DIR}/dump"
UPLOADS_DIR="${BACKUP_DIR}/uploads"
UPLOADS_SRC="/uploads"
WAL_ARCHIVE_DIR="/wal_archive"
LOG_PREFIX="[pg-backup]"

log_info()    { echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_PREFIX} INFO: $*"; }
log_error()   { echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_PREFIX} ERROR: $*" >&2; }
log_success() { echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_PREFIX} SUCCESS: $*"; }

ensure_dirs() { mkdir -p "${BASE_DIR}" "${DUMP_DIR}" "${UPLOADS_DIR}"; }

wait_for_pg() {
    log_info "Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
    for _ in $(seq 1 30); do
        if pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${DB_NAME}" > /dev/null 2>&1; then
            log_info "PostgreSQL is ready."
            return 0
        fi
        sleep 2
    done
    log_error "PostgreSQL not ready after 60 seconds."
    return 1
}

# ---------------------------------------------------------------------------
backup_base() {
    ensure_dirs
    wait_for_pg

    TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
    BACKUP_FILE="${BASE_DIR}/base_${TIMESTAMP}.tar.gz"
    LOG_FILE="/tmp/pg_basebackup_${TIMESTAMP}.log"

    log_info "Starting base backup → ${BACKUP_FILE}"
    if pg_basebackup -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
        -D - -Ft -z -Xfetch > "${BACKUP_FILE}" 2>"${LOG_FILE}"; then
        SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
        log_success "Base backup completed: ${BACKUP_FILE} (${SIZE})"
        rm -f "${LOG_FILE}"
    else
        log_error "Base backup FAILED!"
        [ -f "${LOG_FILE}" ] && cat "${LOG_FILE}" >&2
        rm -f "${BACKUP_FILE}" "${LOG_FILE}"
        return 1
    fi
}

backup_dump() {
    ensure_dirs
    wait_for_pg

    TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
    BACKUP_FILE="${DUMP_DIR}/dump_${TIMESTAMP}.dump"

    log_info "Starting logical dump → ${BACKUP_FILE}"
    if PGPASSWORD="${DATABASE_PASSWORD}" pg_dump -h "${DB_HOST}" -p "${DB_PORT}" \
        -U "${DB_USER}" -d "${DB_NAME}" -Fc -Z 6 -f "${BACKUP_FILE}" 2>&1; then
        SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
        log_success "Logical dump completed: ${BACKUP_FILE} (${SIZE})"
    else
        log_error "Logical dump FAILED!"
        rm -f "${BACKUP_FILE}"
        return 1
    fi
}

# Archive the local uploads volume. No-op (skipped) when uploads are offloaded
# to S3/R2 and the mounted volume is empty.
backup_uploads() {
    ensure_dirs

    if [ ! -d "${UPLOADS_SRC}" ]; then
        log_info "Uploads source ${UPLOADS_SRC} not mounted — skipping."
        return 0
    fi
    if [ -z "$(ls -A "${UPLOADS_SRC}" 2>/dev/null)" ]; then
        log_info "Uploads volume empty (S3/R2 offload?) — skipping uploads archive."
        return 0
    fi

    TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
    BACKUP_FILE="${UPLOADS_DIR}/uploads_${TIMESTAMP}.tar.gz"

    log_info "Archiving uploads → ${BACKUP_FILE}"
    if tar -czf "${BACKUP_FILE}" -C "${UPLOADS_SRC}" . 2>/dev/null; then
        SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
        log_success "Uploads archive completed: ${BACKUP_FILE} (${SIZE})"
    else
        log_error "Uploads archive FAILED!"
        rm -f "${BACKUP_FILE}"
        return 1
    fi
}

# ---------------------------------------------------------------------------
cleanup_old() {
    log_info "Cleaning up backups older than ${RETENTION_DAYS} days..."

    REMOVED_BASE=$(find "${BASE_DIR}" -name "base_*.tar.gz" -type f -mtime "+${RETENTION_DAYS}" -print -delete 2>/dev/null | wc -l)
    log_info "Removed ${REMOVED_BASE} old base backup(s)."

    REMOVED_DUMP=$(find "${DUMP_DIR}" -name "dump_*.dump" -type f -mtime "+${RETENTION_DAYS}" -print -delete 2>/dev/null | wc -l)
    log_info "Removed ${REMOVED_DUMP} old dump backup(s)."

    REMOVED_UPLOADS=$(find "${UPLOADS_DIR}" -name "uploads_*.tar.gz" -type f -mtime "+${RETENTION_DAYS}" -print -delete 2>/dev/null | wc -l)
    log_info "Removed ${REMOVED_UPLOADS} old uploads archive(s)."

    OLDEST_BASE=$(find "${BASE_DIR}" -name "base_*.tar.gz" -type f | sort | head -1)
    if [ -n "${OLDEST_BASE}" ] && [ -d "${WAL_ARCHIVE_DIR}" ]; then
        WAL_COUNT_BEFORE=$(find "${WAL_ARCHIVE_DIR}" -type f 2>/dev/null | wc -l)
        find "${WAL_ARCHIVE_DIR}" -type f -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
        WAL_COUNT_AFTER=$(find "${WAL_ARCHIVE_DIR}" -type f 2>/dev/null | wc -l)
        REMOVED_WAL=$((WAL_COUNT_BEFORE - WAL_COUNT_AFTER))
        log_info "Removed ${REMOVED_WAL} expired WAL file(s). Remaining: ${WAL_COUNT_AFTER}"
    else
        log_info "No WAL cleanup needed (no base backups or WAL archive found)."
    fi

    log_success "Cleanup completed."
}

# ---------------------------------------------------------------------------
list_backups() {
    echo ""
    echo "============================================="
    echo "  Available Backups"
    echo "============================================="

    echo ""
    echo "--- Logical Dumps (pg_dump) ---"
    if [ -d "${DUMP_DIR}" ] && [ "$(ls -A "${DUMP_DIR}" 2>/dev/null)" ]; then
        ls -lh "${DUMP_DIR}"/dump_*.dump 2>/dev/null | awk '{print $NF, "(" $5 ")", $6, $7, $8}'
    else
        echo "  (none)"
    fi

    echo ""
    echo "--- Base Backups (pg_basebackup) ---"
    if [ -d "${BASE_DIR}" ] && [ "$(ls -A "${BASE_DIR}" 2>/dev/null)" ]; then
        ls -lh "${BASE_DIR}"/base_*.tar.gz 2>/dev/null | awk '{print $NF, "(" $5 ")", $6, $7, $8}'
    else
        echo "  (none)"
    fi

    echo ""
    echo "--- Uploads Archives ---"
    if [ -d "${UPLOADS_DIR}" ] && [ "$(ls -A "${UPLOADS_DIR}" 2>/dev/null)" ]; then
        ls -lh "${UPLOADS_DIR}"/uploads_*.tar.gz 2>/dev/null | awk '{print $NF, "(" $5 ")", $6, $7, $8}'
    else
        echo "  (none — empty or S3/R2 offload)"
    fi

    echo ""
    echo "--- WAL Archive ---"
    if [ -d "${WAL_ARCHIVE_DIR}" ]; then
        WAL_COUNT=$(find "${WAL_ARCHIVE_DIR}" -type f 2>/dev/null | wc -l)
        WAL_SIZE=$(du -sh "${WAL_ARCHIVE_DIR}" 2>/dev/null | cut -f1)
        echo "  Files: ${WAL_COUNT}, Total size: ${WAL_SIZE:-0}"
    else
        echo "  (not available)"
    fi

    echo ""
    echo "--- Disk Usage ---"
    du -sh "${BACKUP_DIR}" 2>/dev/null || echo "  Backup dir not found"
    du -sh "${WAL_ARCHIVE_DIR}" 2>/dev/null || echo "  WAL archive dir not found"
    echo ""
}

# ---------------------------------------------------------------------------
run_all() {
    log_info "========== Starting scheduled backup run =========="
    backup_dump
    backup_base
    backup_uploads
    cleanup_old
    log_success "========== Scheduled backup run completed =========="
}

case "${1:-all}" in
    base)    backup_base ;;
    dump)    backup_dump ;;
    uploads) backup_uploads ;;
    cleanup) cleanup_old ;;
    list)    list_backups ;;
    all)     run_all ;;
    *)
        echo "Usage: $0 {base|dump|uploads|cleanup|list|all}"
        exit 1
        ;;
esac
