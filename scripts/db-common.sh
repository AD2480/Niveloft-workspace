# Shared by backup.sh, restore.sh and test-backup-restore.sh (sourced, not run).
# Connection settings come from the same variables as the backend, with local defaults:
#   DB_URL (jdbc:mysql://host:port/name?...) or DB_HOST / DB_PORT / DB_NAME
#   DB_USERNAME, DB_PASSWORD
# Uses mysql/mysqldump if they're installed, otherwise the ones inside the projectflow-mysql
# Docker container (backend/docker-compose.yml).

if [ -n "${DB_URL:-}" ] && [ -z "${DB_HOST:-}" ]; then
  _rest="${DB_URL#jdbc:mysql://}"
  _hostport="${_rest%%/*}"
  _dbq="${_rest#*/}"
  DB_HOST="${_hostport%%:*}"
  if [ "$_hostport" != "$DB_HOST" ]; then DB_PORT="${_hostport##*:}"; fi
  DB_NAME="${DB_NAME:-${_dbq%%\?*}}"
fi
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-projectflow}"
DB_USERNAME="${DB_USERNAME:-projectflow}"
DB_PASSWORD="${DB_PASSWORD:-projectflow}"
DOCKER_CONTAINER="${DOCKER_CONTAINER:-projectflow-mysql}"

if command -v mysql >/dev/null 2>&1 && command -v mysqldump >/dev/null 2>&1 && [ -z "${USE_DOCKER:-}" ]; then
  _via=local
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DOCKER_CONTAINER"; then
  _via=docker
else
  echo "Neither mysql/mysqldump nor a running '$DOCKER_CONTAINER' container was found." >&2
  echo "Install the MySQL client (brew install mysql-client) or start the database: cd backend && docker compose up -d" >&2
  exit 1
fi

# run_mysql [user] [password] [args…]: the mysql client, reading SQL from stdin.
run_mysql() {
  local user="$1" pass="$2"; shift 2
  if [ "$_via" = local ]; then
    MYSQL_PWD="$pass" mysql --host="$DB_HOST" --port="$DB_PORT" --user="$user" --default-character-set=utf8mb4 "$@"
  else
    docker exec -i -e MYSQL_PWD="$pass" "$DOCKER_CONTAINER" mysql --user="$user" --default-character-set=utf8mb4 "$@"
  fi
}

# run_mysqldump [args…]: a consistent snapshot of a database (no locks on InnoDB tables).
run_mysqldump() {
  local extra=()
  # MySQL's mysqldump (not MariaDB's) needs this so the dump restores on any server.
  if [ "$_via" = local ]; then
    mysqldump --help 2>/dev/null | grep -q -- '--set-gtid-purged' && extra+=(--set-gtid-purged=OFF)
    MYSQL_PWD="$DB_PASSWORD" mysqldump --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USERNAME" \
      --single-transaction --quick --routines --triggers --no-tablespaces --default-character-set=utf8mb4 "${extra[@]}" "$@"
  else
    docker exec -i -e MYSQL_PWD="$DB_PASSWORD" "$DOCKER_CONTAINER" mysqldump --user="$DB_USERNAME" \
      --single-transaction --quick --routines --triggers --no-tablespaces --default-character-set=utf8mb4 --set-gtid-purged=OFF "$@"
  fi
}

# table_report <database> [user] [password]: "table<TAB>rows<TAB>checksum" for every table, sorted.
table_report() {
  local db="$1" user="${2:-$DB_USERNAME}" pass="${3:-$DB_PASSWORD}"
  local tables
  tables=$(echo "SHOW TABLES;" | run_mysql "$user" "$pass" --batch --skip-column-names "$db")
  for t in $tables; do
    local rows sum
    rows=$(echo "SELECT COUNT(*) FROM \`$t\`;" | run_mysql "$user" "$pass" --batch --skip-column-names "$db")
    sum=$(echo "CHECKSUM TABLE \`$t\`;" | run_mysql "$user" "$pass" --batch --skip-column-names "$db" | awk '{print $2}')
    printf '%s\t%s\t%s\n' "$t" "$rows" "$sum"
  done | sort
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}
