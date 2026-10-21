#!/usr/bin/env bash
# Backs up ProjectFlow: the database (a consistent snapshot, taken without stopping the app) and
# the uploaded evidence files, plus a manifest with checksums and row counts.
#
#   ./scripts/backup.sh
#     → backups/projectflow-<date>.sql.gz, projectflow-<date>-uploads.tar.gz, projectflow-<date>-manifest.txt
#
# Settings (environment variables): see scripts/db-common.sh for the database, and
#   STORAGE_DIR  uploaded files (default: backend/data/uploads)
#   BACKUP_DIR   where backups go (default: backups)
#   KEEP         how many backups to keep (default: 14; older ones are deleted)
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=db-common.sh
. scripts/db-common.sh

STORAGE_DIR="${STORAGE_DIR:-backend/data/uploads}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
KEEP="${KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BASE="$BACKUP_DIR/projectflow-$STAMP"
mkdir -p "$BACKUP_DIR"

echo "Backing up database '$DB_NAME' ($_via)…"
run_mysqldump "$DB_NAME" | gzip -9 > "$BASE.sql.gz.part"
# A dump that stopped half-way has no completion line: refuse it rather than keep a broken backup.
if ! gunzip -c "$BASE.sql.gz.part" | tail -n 5 | grep -q "Dump completed"; then
  rm -f "$BASE.sql.gz.part"
  echo "The database dump didn't complete. Nothing was kept." >&2
  exit 1
fi
mv "$BASE.sql.gz.part" "$BASE.sql.gz"

if [ -d "$STORAGE_DIR" ]; then
  echo "Backing up uploaded files from $STORAGE_DIR…"
  tar -czf "$BASE-uploads.tar.gz" -C "$STORAGE_DIR" .
fi

{
  echo "ProjectFlow backup $STAMP"
  echo "database: $DB_NAME"
  echo "sql: $(basename "$BASE.sql.gz") sha256 $(sha256_of "$BASE.sql.gz")"
  [ -f "$BASE-uploads.tar.gz" ] && echo "uploads: $(basename "$BASE-uploads.tar.gz") sha256 $(sha256_of "$BASE-uploads.tar.gz") files $(tar -tzf "$BASE-uploads.tar.gz" | grep -vc '/$')"
  echo "tables (name, rows, checksum) when the backup finished:"
  table_report "$DB_NAME"
} > "$BASE-manifest.txt"

# Keep the newest $KEEP backups.
ls -1t "$BACKUP_DIR"/projectflow-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  stem="${old%.sql.gz}"
  rm -f "$old" "$stem-uploads.tar.gz" "$stem-manifest.txt"
done

echo "Done: $BASE.sql.gz"
[ -f "$BASE-uploads.tar.gz" ] && echo "      $BASE-uploads.tar.gz"
echo "      $BASE-manifest.txt"
