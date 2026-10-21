#!/usr/bin/env bash
# Restores a ProjectFlow backup made by backup.sh.
#
#   ./scripts/restore.sh backups/projectflow-20260928-101500.sql.gz            # the database
#   ./scripts/restore.sh backups/projectflow-….sql.gz --uploads backups/projectflow-…-uploads.tar.gz
#   ./scripts/restore.sh backups/projectflow-….sql.gz --database projectflow_copy --yes
#
# It replaces everything in the target database, so it asks first (unless --yes). Stop the
# backend while restoring. Restoring into another database (--database) needs a user allowed to
# create it: set DB_ADMIN_USER / DB_ADMIN_PASSWORD (the Docker database's root password is
# root-dev-only).
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=db-common.sh
. scripts/db-common.sh

SQL="${1:-}"
[ -n "$SQL" ] && [ -f "$SQL" ] || { echo "Usage: $0 <backup.sql.gz> [--uploads <uploads.tar.gz>] [--database <name>] [--yes]" >&2; exit 2; }
shift
UPLOADS=""; TARGET="$DB_NAME"; YES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --uploads) UPLOADS="$2"; shift 2 ;;
    --database) TARGET="$2"; shift 2 ;;
    --yes) YES=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$TARGET" in *[!A-Za-z0-9_]*) echo "Database names may use letters, digits and _ only." >&2; exit 2 ;; esac
ADMIN_USER="${DB_ADMIN_USER:-$DB_USERNAME}"
ADMIN_PASSWORD="${DB_ADMIN_PASSWORD:-$DB_PASSWORD}"

gunzip -t "$SQL" || { echo "$SQL is damaged (not a complete gzip file)." >&2; exit 1; }
if [ -z "$YES" ]; then
  echo "This replaces everything in database '$TARGET' with $SQL."
  read -r -p "Type the database name to continue: " answer
  [ "$answer" = "$TARGET" ] || { echo "Cancelled."; exit 1; }
fi

echo "CREATE DATABASE IF NOT EXISTS \`$TARGET\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;" | run_mysql "$ADMIN_USER" "$ADMIN_PASSWORD"
if [ "$TARGET" != "$DB_NAME" ] && [ "$ADMIN_USER" != "$DB_USERNAME" ]; then
  echo "GRANT ALL ON \`$TARGET\`.* TO '$DB_USERNAME'@'%';" | run_mysql "$ADMIN_USER" "$ADMIN_PASSWORD" || true
fi
echo "Restoring the database into '$TARGET'…"
gunzip -c "$SQL" | run_mysql "$ADMIN_USER" "$ADMIN_PASSWORD" "$TARGET"

if [ -n "$UPLOADS" ]; then
  STORAGE_DIR="${STORAGE_DIR:-backend/data/uploads}"
  if [ -d "$STORAGE_DIR" ] && [ -n "$(ls -A "$STORAGE_DIR" 2>/dev/null)" ]; then
    aside="$STORAGE_DIR.before-restore-$(date +%Y%m%d-%H%M%S)"
    mv "$STORAGE_DIR" "$aside"
    echo "The files that were there are kept in $aside"
  fi
  mkdir -p "$STORAGE_DIR"
  tar -xzf "$UPLOADS" -C "$STORAGE_DIR"
  echo "Restored uploaded files into $STORAGE_DIR"
fi
echo "Done."
