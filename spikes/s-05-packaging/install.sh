#!/bin/sh
# S-05 prototype of the install script H-06 would publish (docs/spikes/S-05.md, "Install path").
# Usage: install.sh <zip URL> <sha256> [destination folder]
# Uses only tools in the base system (curl, shasum, ditto, codesign, xattr), so it works on a Mac
# without developer tools. curl sets no com.apple.quarantine, so Gatekeeper never blocks the first
# launch; the checksum and the signature check stand in for that.
set -eu

url="${1:-}"
expected="${2:-}"
destination="${3:-/Applications}"
if [ -z "$url" ] || [ -z "$expected" ]; then
  echo "usage: $0 <zip URL> <sha256> [destination folder]" >&2
  exit 2
fi
if [ ! -w "$destination" ]; then
  destination="$HOME/Applications"
  mkdir -p "$destination"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "Downloading $url"
# HTTPS only. S05_ALLOW_INSECURE=1 also allows http:// and file:// URLs, for run.sh's local server
# and for the owner's test copy in /Users/Shared while the repository is private.
protocols='=https'
[ "${S05_ALLOW_INSECURE:-}" = 1 ] && protocols='=https,http,file'
curl -fsSL --proto "$protocols" -o "$work/app.zip" "$url"
actual=$(shasum -a 256 "$work/app.zip" | cut -d' ' -f1)
if [ "$actual" != "$expected" ]; then
  echo "Checksum mismatch: expected $expected, got $actual. Nothing was installed." >&2
  exit 1
fi

ditto -x -k "$work/app.zip" "$work/extracted"
set -- "$work/extracted"/*.app
[ -d "$1" ] || { echo "The zip holds no .app bundle. Nothing was installed." >&2; exit 1; }
name=$(basename "$1")
codesign --verify --deep --strict "$1" || { echo "$name fails signature verification. Nothing was installed." >&2; exit 1; }
# Defensive: a zip fetched some other way may carry quarantine; curl itself adds none.
xattr -dr com.apple.quarantine "$1" 2>/dev/null || true

rm -rf "${destination:?}/$name"
ditto "$1" "$destination/$name"
echo "Installed $destination/$name"
