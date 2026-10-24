#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo 'Usage: bash scripts/deploy-static.sh ubuntu@LIGHTSAIL_STATIC_IP' >&2
  echo 'Build dist locally first; use ~/.ssh/config for your Lightsail key.' >&2
  exit 2
fi
target=$1
if [[ ! "$target" =~ ^[A-Za-z0-9_.@:-]+$ ]] || [[ "$target" == -* ]]; then
  echo 'Use an SSH hostname or user@hostname, without shell syntax.' >&2; exit 2
fi
test -f dist/index.html
test -f dist/wasm/crtvd.js
test -f dist/wasm/crtvd.wasm
release="$(date -u +%Y%m%dT%H%M%S%NZ)-$(git rev-parse --short HEAD)"
remote="/srv/projects/crtvd/releases/$release"
ssh "$target" "mkdir -p '$remote' /srv/projects/crtvd/shared/assets"
tar -C dist -czf - . | ssh "$target" "tar --no-same-owner -xzf - -C '$remote'"
ssh "$target" bash -s -- "$release" <<'REMOTE'
set -euo pipefail
release=$1
base=/srv/projects/crtvd
test -f "$base/releases/$release/index.html"
test -f "$base/releases/$release/wasm/crtvd.wasm"
test -f "$base/releases/$release/wasm/crtvd.js"
# Keep old hashed chunks available for tabs opened before the release switch.
cp -a "$base/releases/$release/assets/." "$base/shared/assets/"
find "$base/releases/$release" -type d -exec chmod 755 {} +
find "$base/releases/$release" -type f -exec chmod 644 {} +
find "$base/shared/assets" -type d -exec chmod 755 {} +
find "$base/shared/assets" -type f -exec chmod 644 {} +
if [[ -L "$base/current" ]]; then
  previous=$(readlink "$base/current")
  ln -s "$previous" "$base/.previous-$release"
  mv -Tf "$base/.previous-$release" "$base/previous"
elif [[ -e "$base/current" ]]; then
  echo 'current exists but is not a release symlink; inspect it before deploying.' >&2; exit 1
fi
ln -s "$base/releases/$release" "$base/.current-$release"
mv -Tf "$base/.current-$release" "$base/current"
echo "Activated $release"
REMOTE
echo 'Verify https://crtvd.vaell.dev/ and its Wasm MIME/cache headers.'
