#!/bin/bash
# H-06's update checks (docs/distribution.md). Usage: tools/release/check-update.sh update|bad-signature
#   update         Pica N, installed by install.sh, updates to N+1 through a local appcast. Afterwards the bundle is
#                  N+1, passes codesign --verify --deep --strict, has no quarantine, and its engine reports N+1.
#   bad-signature  The appcast's EdDSA signature for N+1 is made with another key. Sparkle refuses the update and
#                  N stays installed, unchanged.
# Both use Sparkle's own updater (tools/release/update-check) and a throwaway EdDSA key pair. The builds get a test
# bundle identifier so Sparkle's state never lands in the real app's defaults.
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
release="$repo_root/tools/release"
check="${1:-}"
case "$check" in update|bad-signature) ;; *) echo "usage: $0 update|bad-signature" >&2; exit 2 ;; esac

fail() { echo "FAIL: $1" >&2; exit 1; }
work=$(mktemp -d "${TMPDIR:-/tmp}/pica-update-check.XXXXXX")
server=""
test_id=dev.pica.Pica.update-test
cleanup() {
  if [ -n "$server" ]; then kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true; fi
  rm -rf "$work" "$HOME/Library/Caches/$test_id" "$HOME/Library/Caches/pica-update-check"
  defaults delete "$test_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT

derived="$repo_root/app/.derived/release"
built="$derived/Build/Products/Release/Pica.app"
if [ ! -d "$built" ] || [ -n "${PICA_REBUILD:-}" ]; then
  make -C "$repo_root" engine-install >/dev/null
  xcodebuild -project "$repo_root/app/Pica.xcodeproj" -scheme Pica -configuration Release \
    -destination 'generic/platform=macOS' -derivedDataPath "$derived" -quiet \
    ARCHS=arm64 ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO build
fi
sign_update="$derived/SourcePackages/artifacts/sparkle/Sparkle/bin/sign_update"
swift build -c release --package-path "$release/update-check" >/dev/null
# Run the updater from outside the checkout: authd cannot read a client under ~/Documents (TCC), and Sparkle's
# installer launch needs an authorization reference even for an update the user can write.
mkdir -p "$work/bin"
ditto "$release/update-check/.build/release/pica-update-check" "$work/bin/pica-update-check"
ditto "$release/update-check/.build/release/Sparkle.framework" "$work/bin/Sparkle.framework"
updater="$work/bin/pica-update-check"

keys=$(node "$release/sparkle-test-keys.mjs")
key() { echo "$keys" | node -e 'process.stdin.on("data", d => process.stdout.write(JSON.parse(d)[process.argv[1]]))' "$1"; }
public_key=$(key publicKey)

old=0.1.0 new=0.1.1
for version in $old $new; do
  "$release/package.sh" --app "$built" --version "$version" --out "$work/build-$version" \
    --public-key "$public_key" --bundle-id "$test_id" --feed-url "http://127.0.0.1:1/unused.xml" >/dev/null
done

mkdir -p "$work/feed"
cp "$work/build-$new/Pica-$new.zip" "$work/feed/"
node "$release/serve.mjs" "$work/feed" > "$work/port" &
server=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$work/port" ] && break; sleep 0.2; done
port=$(head -n 1 "$work/port")
[ -n "$port" ] || fail "the local appcast server did not start"
feed="http://127.0.0.1:$port"

signing_key=$(key privateKey)
[ "$check" = bad-signature ] && signing_key=$(node "$release/sparkle-test-keys.mjs" | node -e 'process.stdin.on("data", d => process.stdout.write(JSON.parse(d).privateKey))')
SPARKLE_PRIVATE_ED_KEY="$signing_key" "$release/appcast.sh" --zip "$work/feed/Pica-$new.zip" --version "$new" \
  --url "$feed/Pica-$new.zip" --sign-update "$sign_update" --out "$work/feed/appcast.xml" >/dev/null

# Install N the way users do: install.sh with the release's SHA256SUMS.
(cd "$work/build-$old" && shasum -a 256 "Pica-$old.zip" > SHA256SUMS)
sh "$release/install.sh" --from "$work/build-$old" --dest "$work/Applications" >/dev/null
app="$work/Applications/Pica.app"
before=$(codesign -dv --verbose=4 "$app" 2>&1 | grep '^CDHash=')

set +e
result=$("$updater" "$app" "$feed/appcast.xml")
status=$?
set -e
echo "updater: $result"
installed=$(plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist")

if [ "$check" = bad-signature ]; then
  [ "$status" -eq 1 ] && echo "$result" | grep -q '"outcome":"refused"' || fail "the update with a bad signature was not refused (status $status)"
  echo "$result" | grep -q 'EdDSA signature does not match' || fail "the update was refused, but not for its EdDSA signature"
  [ "$installed" = "$old" ] || fail "Pica $installed is installed; the refused update replaced $old"
  [ "$(codesign -dv --verbose=4 "$app" 2>&1 | grep '^CDHash=')" = "$before" ] || fail "the installed bundle changed"
  codesign --verify --deep --strict "$app" || fail "the installed Pica $old no longer verifies"
  echo "ok: Sparkle refused the update signed with another EdDSA key; Pica $old is installed, unchanged"
  exit 0
fi

[ "$status" -eq 0 ] || fail "the update did not install (status $status)"
[ "$installed" = "$new" ] || fail "Pica $installed is installed after the update to $new"
codesign --verify --deep --strict "$app" || fail "the updated bundle fails codesign --verify --deep --strict"
if xattr -r "$app" 2>/dev/null | grep -q com.apple.quarantine; then fail "the updated bundle carries com.apple.quarantine"; fi
engine=$(node "$release/engine-hello.mjs" "$app" | node -e 'process.stdin.on("data", d => process.stdout.write(JSON.parse(d).engineVersion))')
[ "$engine" = "$new" ] || fail "the updated app is $new but its engine reports $engine"
echo "ok: Pica $old updated to $new through the local appcast; no quarantine; the engine reports $engine"
