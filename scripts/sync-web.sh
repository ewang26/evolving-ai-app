#!/bin/bash
# Copy the web app into the iOS bundle. docs/ stays the single source of truth:
# never edit ios/EvolvingAI/web by hand, it is overwritten every run.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/ios/EvolvingAI/web"
rm -rf "$dest"
mkdir -p "$dest"
cp -R "$root/docs/." "$dest/"
# Keep every frontend asset referenced by index.html. WebKit may not register
# a service worker on the private app scheme, but the bundled files should
# still match the website release exactly.
rm -rf "$dest/preview"
# sheet-backend.gs is server source, not app content.
rm -f "$dest/sheet-backend.gs"
echo "Synced docs/ -> ios/EvolvingAI/web ($(find "$dest" -type f | wc -l | tr -d ' ') files)"
