#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
backup_dir="$script_dir/backups"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backup_dir/boldapp-$timestamp.dump"

umask 077
mkdir -p "$backup_dir"

docker compose \
    --env-file "$script_dir/.env.oracle" \
    --file "$script_dir/compose.oracle.yaml" \
    exec -T postgres \
    sh -c 'exec pg_dump --format=custom --no-owner --no-acl --username="$POSTGRES_USER" "$POSTGRES_DB"' \
    > "$target"

test -s "$target"
find "$backup_dir" -type f -name 'boldapp-*.dump' -mtime "+$retention_days" -delete
printf 'Backup creado: %s\n' "$target"
