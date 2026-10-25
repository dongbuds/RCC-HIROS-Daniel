#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# RCC-HIROS — database + uploads backup (Daniel's stack)
#
# Run from the compose directory (or set COMPOSE_DIR):
#   ./scripts/backup.sh
#
# Produces, in ./backups/ (or $HOME/rcc-hiros-daniel-backups for a
# checkout on a Windows drive):
#   db-YYYYmmdd-HHMMSS.sql.gz        logical dump of rcc_hiros
#   uploads-YYYYmmdd-HHMMSS.tgz      employee photos, files, leave docs
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$COMPOSE_DIR/.env.production}"

# Docker Desktop resolves bind-mount sources inside its own VM, so a checkout
# reached through /mnt/c or /mnt/e (a Windows drive) cannot be mounted. Fall
# back to the Linux home when the compose directory lives on a Windows drive.
if [ -z "${BACKUP_DIR:-}" ]; then
  case "$COMPOSE_DIR" in
    /mnt/*) BACKUP_DIR="$HOME/rcc-hiros-daniel-backups" ;;
    *) BACKUP_DIR="$COMPOSE_DIR/backups" ;;
  esac
fi

KEEP_DAYS="${KEEP_DAYS:-14}"
PROJECT_NAME="${PROJECT_NAME:-rcc-hiros-daniel}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_NAME="${DB_NAME:-rcc_hiros}"

STAMP="$(date +%Y%m%d-%H%M%S)"

cd "$COMPOSE_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: missing $ENV_FILE" >&2
  exit 1
fi

if ! docker compose --env-file "$ENV_FILE" ps --status running --services | grep -qx "$DB_SERVICE"; then
  echo "ERROR: service '$DB_SERVICE' is not running" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "[$(date -Iseconds)] dumping $DB_NAME"
docker compose --env-file "$ENV_FILE" exec -T "$DB_SERVICE" \
  sh -c 'exec mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" \
    --single-transaction --quick --routines --events "$0"' "$DB_NAME" \
  | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "[$(date -Iseconds)] archiving uploads volume"
docker run --rm \
  -v "${PROJECT_NAME}_uploads-data:/data:ro" \
  -v "$BACKUP_DIR:/backup" \
  alpine tar czf "/backup/uploads-$STAMP.tgz" -C /data .

if [ "$KEEP_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -type f -name 'db-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
  find "$BACKUP_DIR" -type f -name 'uploads-*.tgz' -mtime +"$KEEP_DAYS" -delete
fi

echo "[$(date -Iseconds)] done"
ls -lh "$BACKUP_DIR"/db-"$STAMP".sql.gz "$BACKUP_DIR"/uploads-"$STAMP".tgz
