#!/usr/bin/env bash
# Proves a backup can be restored: backs up, restores into a scratch database, and compares every
# table (row count and checksum) and every uploaded file (SHA-256) with the original. Then it
# removes the scratch copy. Exit code 0 means the backup is good.
#
#   ./scripts/test-backup-restore.sh
#
# Needs a user allowed to create a database: DB_ADMIN_USER / DB_ADMIN_PASSWORD
# (defaults: root / root-dev-only, the local Docker database). Run it while nobody is changing
# data, or the original can change between the backup and the comparison.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=db-common.sh
. scripts/db-common.sh

export DB_ADMIN_USER="${DB_ADMIN_USER:-root}"
export DB_ADMIN_PASSWORD="${DB_ADMIN_PASSWORD:-root-dev-only}"
STORAGE_DIR="${STORAGE_DIR:-backend/data/uploads}"
SCRATCH="${DB_NAME}_restore_check"
WORK="$(mktemp -d)"
cleanup() {
  echo "DROP DATABASE IF EXISTS \`$SCRATCH\`;" | run_mysql "$DB_ADMIN_USER" "$DB_ADMIN_PASSWORD" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "1/4 Backing up…"
BACKUP_DIR="$WORK/backups" KEEP=1 STORAGE_DIR="$STORAGE_DIR" ./scripts/backup.sh >/dev/null
SQL=$(ls "$WORK"/backups/projectflow-*.sql.gz)
UP=$(ls "$WORK"/backups/projectflow-*-uploads.tar.gz 2>/dev/null || true)

echo "2/4 Restoring into scratch database '$SCRATCH'…"
./scripts/restore.sh "$SQL" --database "$SCRATCH" --yes >/dev/null

echo "3/4 Comparing every table…"
table_report "$DB_NAME" "$DB_ADMIN_USER" "$DB_ADMIN_PASSWORD" > "$WORK/original.tsv"
table_report "$SCRATCH" "$DB_ADMIN_USER" "$DB_ADMIN_PASSWORD" > "$WORK/restored.tsv"
failed=0
printf '%-28s %10s %10s  %s\n' "table" "original" "restored" "result"
join -t $'\t' -a1 -a2 -e MISSING -o 0,1.2,1.3,2.2,2.3 "$WORK/original.tsv" "$WORK/restored.tsv" | while IFS=$'\t' read -r t r1 c1 r2 c2; do
  if [ "$r1" = "$r2" ] && [ "$c1" = "$c2" ]; then res=PASS; else res="FAIL (checksum $c1 vs $c2)"; fi
  printf '%-28s %10s %10s  %s\n' "$t" "$r1" "$r2" "$res"
done | tee "$WORK/tables.txt"
grep -q FAIL "$WORK/tables.txt" && failed=1
tables=$(wc -l < "$WORK/original.tsv" | tr -d ' ')

echo "4/4 Comparing uploaded files…"
files=0
if [ -d "$STORAGE_DIR" ] && [ -n "$UP" ]; then
  mkdir -p "$WORK/files"
  tar -xzf "$UP" -C "$WORK/files"
  (cd "$STORAGE_DIR" && find . -type f | sort | while read -r f; do echo "$f $(sha256_of "$f")"; done) > "$WORK/files-original.txt"
  (cd "$WORK/files" && find . -type f | sort | while read -r f; do echo "$f $(sha256_of "$f")"; done) > "$WORK/files-restored.txt"
  files=$(wc -l < "$WORK/files-original.txt" | tr -d ' ')
  if diff -q "$WORK/files-original.txt" "$WORK/files-restored.txt" >/dev/null; then
    echo "  $files files: all match"
  else
    echo "  FAIL: uploaded files differ"; diff "$WORK/files-original.txt" "$WORK/files-restored.txt" | head -20; failed=1
  fi
else
  echo "  No uploaded files to compare."
fi

if [ "$failed" = 0 ]; then
  echo "PASS: $tables tables and $files files restored exactly."
else
  echo "FAIL: the restored copy differs (see above)."; exit 1
fi
