#!/bin/sh
# =============================================================================
# Entrypoint for the backup container
# =============================================================================
# Builds an env file (cron runs with an empty environment), installs the cron
# jobs and starts crond in the foreground.
# =============================================================================

set -eu

LOG_PREFIX="[backup-entrypoint]"

log_info() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') ${LOG_PREFIX} INFO: $*"
}

SCHEDULE_BASE="${BACKUP_SCHEDULE_BASE:-0 3 * * *}"
SCHEDULE_DUMP="${BACKUP_SCHEDULE_DUMP:-30 2 * * *}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

log_info "============================================="
log_info "  Studánky Backup Service Starting"
log_info "============================================="
log_info "Base+uploads schedule: ${SCHEDULE_BASE}"
log_info "Dump schedule:         ${SCHEDULE_DUMP}"
log_info "Retention:             ${RETENTION_DAYS} days"
log_info "============================================="

mkdir -p /backups/base /backups/dump /backups/uploads

# Cron has no environment — persist what the scripts need into an env file.
ENV_FILE="/etc/backup.env"
cat > "${ENV_FILE}" << EOF
DATABASE_HOST=${DATABASE_HOST:-postgres}
DATABASE_PORT=${DATABASE_PORT:-5432}
DATABASE_NAME=${DATABASE_NAME:-studanky}
DATABASE_USERNAME=${DATABASE_USERNAME:-studanky}
DATABASE_PASSWORD=${DATABASE_PASSWORD:-}
BACKUP_RETENTION_DAYS=${RETENTION_DAYS}
PGPASSWORD=${DATABASE_PASSWORD:-}
EOF
chmod 600 "${ENV_FILE}"

CRON_FILE="/etc/crontabs/root"
cat > "${CRON_FILE}" << EOF
# Studánky backup cron — managed by entrypoint-backup.sh, do not edit manually

# Logical dump
${SCHEDULE_DUMP}  . ${ENV_FILE} && /scripts/pg-backup.sh dump >> /proc/1/fd/1 2>> /proc/1/fd/2

# Base backup + uploads + cleanup
${SCHEDULE_BASE}  . ${ENV_FILE} && /scripts/pg-backup.sh all >> /proc/1/fd/1 2>> /proc/1/fd/2

EOF

log_info "Cron jobs configured:"
grep -v '^#' "${CRON_FILE}" | grep -v '^$' | while read -r line; do
    log_info "  ${line}"
done

if [ "${BACKUP_ON_STARTUP:-false}" = "true" ]; then
    log_info "Running initial backup on startup..."
    . "${ENV_FILE}"
    /scripts/pg-backup.sh all || log_info "Initial backup failed (database may not be ready yet)"
fi

log_info "Starting cron daemon..."
exec crond -f -l 2
