#!/usr/bin/env bash
# Daily v2 database backup (custom-format pg_dump), 14-day retention.
# Installed at /opt/nhg-manabi-v2/backup.sh and run by /etc/cron.d/nhg-manabi-v2-backup.
set -Eeuo pipefail
cd /opt/nhg-manabi-v2
DIR=backups/db
STAMP="$(date +%Y%m%dT%H%M%S)"
OUT="$DIR/nhg_manabi_v2-$STAMP.dump"
mkdir -p "$DIR"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUT.tmp"
# a dump that pg_restore cannot list is not a backup
docker compose exec -T postgres pg_restore -l < "$OUT.tmp" > /dev/null
mv "$OUT.tmp" "$OUT"
chmod 600 "$OUT"
find "$DIR" -name 'nhg_manabi_v2-*.dump' -mtime +14 -delete
echo "$(date -Is) backup ok: $OUT ($(stat -c %s "$OUT") bytes)"
