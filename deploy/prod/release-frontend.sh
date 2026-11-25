#!/usr/bin/env bash
# Publish a built frontend as a new release and switch `current` (run from the repo root).
#   deploy/prod/release-frontend.sh web|admin
# Hashed /assets/ are carried over from earlier releases so a tab still running the
# previous build can lazy-load its old chunks instead of hitting 404 (HTML itself is
# served `no-cache`, see web-locations.inc / admin-locations.inc).
set -Eeuo pipefail
site="${1:?usage: release-frontend.sh web|admin}"
case "$site" in
  web) src=apps/web/build/client ;;
  admin) src=apps/admin/dist ;;
  *) echo "unknown site: $site" >&2; exit 2 ;;
esac
host="${DEPLOY_HOST:-manabi}"
base="/opt/nhg-manabi-v2/$site"
ts="$(date -u +%Y%m%dT%H%M%S)"
rsync -az --delete "$src"/ "$host:$base/releases/$ts/"
ssh "$host" "set -e; for old in $base/releases/*/; do old=\${old%/}; [ \"\$old\" = $base/releases/$ts ] || cp -a --update=none \"\$old/assets/.\" $base/releases/$ts/assets/; done; ln -sfn $base/releases/$ts $base/current; echo switched $site to $ts"
