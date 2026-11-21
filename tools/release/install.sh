#!/bin/sh
# Installs Pica from a GitHub release (H-06, docs/distribution.md):
#   curl -fsSL https://github.com/0zean/pica/releases/latest/download/install.sh | sh
#   sh install.sh [--version x.y.z] [--from <folder>] [--dest <folder>]
#
# The zip is fetched with curl, which sets no com.apple.quarantine, so Gatekeeper does not block the first launch of
# this ad-hoc signed build (D-17, S-05). The SHA-256 from the release's SHA256SUMS and codesign --verify stand in for
# that check. --from installs from a folder holding SHA256SUMS and the zip instead (a local build's dist/, or the
# assets of a draft release fetched with `gh release download`). Uses only base-system tools, so it runs on a Mac
# without developer tools.
set -eu

repo_url="https://github.com/0zean/pica"
version="" from="" destination=""
while [ $# -gt 0 ]; do
  case "$1" in
    --version) version="${2:?--version needs x.y.z}"; shift 2 ;;
    --from) from="${2:?--from needs a folder}"; shift 2 ;;
    --dest) destination="${2:?--dest needs a folder}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0" 2>/dev/null; exit 0 ;;
    *) echo "install.sh: unknown argument $1" >&2; exit 2 ;;
  esac
done

fail() {
  echo "install.sh: $1 Nothing was installed." >&2
  exit 1
}

if [ -z "$destination" ]; then
  destination=/Applications
  [ -w "$destination" ] || destination="$HOME/Applications"
fi
mkdir -p "$destination"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# HTTPS only. PICA_ALLOW_INSECURE=1 also allows http:// and file://, for the tests' local server.
protocols='=https'
[ "${PICA_ALLOW_INSECURE:-}" = 1 ] && protocols='=https,http,file'
fetch() {
  curl -fsSL --proto "$protocols" --retry 2 -o "$2" "$1" || fail "Could not download $1."
}

if [ -n "$from" ]; then
  [ -f "$from/SHA256SUMS" ] || fail "$from has no SHA256SUMS."
  cp "$from/SHA256SUMS" "$work/SHA256SUMS"
else
  if [ -n "${PICA_RELEASE_BASE:-}" ]; then
    base="$PICA_RELEASE_BASE"
  elif [ -n "$version" ]; then
    base="$repo_url/releases/download/v$version"
  else
    base="$repo_url/releases/latest/download"
  fi
  fetch "$base/SHA256SUMS" "$work/SHA256SUMS"
fi

# SHA256SUMS lines are "<sha256>  <file>", as shasum -a 256 writes them.
line=$(grep -E '^[0-9a-f]{64}  Pica-[0-9]+\.[0-9]+\.[0-9]+\.zip$' "$work/SHA256SUMS" | tail -n 1)
[ -n "$line" ] || fail "SHA256SUMS lists no Pica zip."
expected=${line%% *}
zip_name=${line##* }
if [ -n "$from" ]; then
  [ -f "$from/$zip_name" ] || fail "$from has no $zip_name."
  cp "$from/$zip_name" "$work/$zip_name"
else
  echo "Downloading $zip_name"
  fetch "$base/$zip_name" "$work/$zip_name"
fi

actual=$(shasum -a 256 "$work/$zip_name" | cut -d' ' -f1)
[ "$actual" = "$expected" ] || fail "Checksum mismatch for $zip_name: expected $expected, got $actual."
echo "Checksum ok: $actual"

ditto -x -k "$work/$zip_name" "$work/extracted"
app="$work/extracted/Pica.app"
[ -d "$app" ] || fail "$zip_name holds no Pica.app."
codesign --verify --deep --strict "$app" 2>/dev/null || fail "Pica.app fails codesign --verify --deep --strict."
# Code under Resources is sealed as a resource, not as code, so the helpers the engine runs are checked one by one.
for helper in Contents/Helpers/node Contents/Resources/copilot/prebuilds/darwin-arm64/copilot-runtime; do
  codesign --verify --strict "$app/$helper" 2>/dev/null || fail "$helper fails codesign --verify --strict."
done
echo "Signature ok"
# Defensive: a zip that came some other way may carry quarantine; curl itself adds none.
xattr -dr com.apple.quarantine "$app" 2>/dev/null || true

target="$destination/Pica.app"
if pgrep -f "$target/Contents/MacOS/Pica" >/dev/null 2>&1; then
  fail "Pica is running from $target. Quit it and run this again."
fi
staging="$destination/.Pica.app.installing"
rm -rf "$staging"
ditto "$app" "$staging"
rm -rf "$target"
mv "$staging" "$target"
installed=$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$target/Contents/Info.plist" 2>/dev/null || echo "?")
echo "Installed Pica $installed at $target"
