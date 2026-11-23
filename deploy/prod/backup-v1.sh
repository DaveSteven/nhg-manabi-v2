#!/usr/bin/env bash
# Daily V1 database backup (custom-format pg_dump), 14-day retention.
# Installed at /opt/nhg-manabi/backup.sh; run by /etc/cron.d/nhg-manabi-backup.
set -Eeuo pipefail
cd /opt/nhg-manabi
DIR=backups/db
STAMP="$(date +%Y%m%dT%H%M%S)"
OUT="$DIR/nhg_manabi-$STAMP.dump"
mkdir -p "$DIR"
docker compose exec -T db pg_dump -U nhg_manabi -d nhg_manabi -Fc > "$OUT.tmp"
# a dump that pg_restore cannot list is not a backup
docker compose exec -T db pg_restore -l < "$OUT.tmp" > /dev/null
mv "$OUT.tmp" "$OUT"
chmod 600 "$OUT"
find "$DIR" -name 'nhg_manabi-*.dump' -mtime +14 -delete
echo "$(date -Is) backup ok: $OUT ($(stat -c %s "$OUT") bytes)"
