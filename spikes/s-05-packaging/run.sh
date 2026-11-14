#!/bin/sh
# S-05 spike runner. Usage: spikes/s-05-packaging/run.sh build|signatures|quarantine|report
#   build       assembles out/Pica S-05.app, ad-hoc signs it inside out, zips it to out/Pica-S05.zip.
#   signatures  build, then: codesign --verify --deep --strict passes on the app, every nested
#               Mach-O is ad-hoc signed with the hardened runtime, and the app answers a ping.
#   quarantine  build, then unzip a copy as a browser download would leave it (com.apple.quarantine
#               on the zip and every extracted file) and check Gatekeeper rejects it; then check both
#               install paths start the engine: xattr -dr before the first launch, and install.sh.
#   report      build, then print bundle sizes and the designated requirement (no assertions).
# Exits 0 only when the chosen assertions hold.
set -eu

cd "$(dirname "$0")"
spike_dir=$(pwd)
repo_root=$(cd ../.. && pwd)
check="${1:-}"
case "$check" in
  build|signatures|quarantine|report) ;;
  *) echo "usage: $0 build|signatures|quarantine|report" >&2; exit 2 ;;
esac

out="$spike_dir/out"
app="$out/Pica S-05.app"
zip="$out/Pica-S05.zip"

ok() { echo "ok: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

copilot_package() {
  # The platform package the SDK spawns (copilot-runtime + runtime.node + assets), resolved the way
  # the SDK resolves it: from @github/copilot-sdk's own location.
  node -e '
    const { createRequire } = require("node:module");
    const path = require("node:path");
    const fs = require("node:fs");
    const sdk = fs.realpathSync(process.argv[1] + "/engine/packages/adapters/node_modules/@github/copilot-sdk");
    const fromSdk = createRequire(sdk + "/package.json");
    console.log(path.dirname(fromSdk.resolve("@github/copilot-sdk-darwin-arm64/package.json")));
  ' "$repo_root"
}

macho_files() {
  find "$app" -type f -print0 | xargs -0 file -N -F '|' | grep 'Mach-O' | cut -d'|' -f1
}

sign_one() {
  codesign --force --sign - --options runtime --timestamp=none "$@" 2>"$out/codesign.log" || { cat "$out/codesign.log" >&2; return 1; }
}

sign() {
  # Inside out: deepest paths first, the app bundle last. Node gets JIT for V8 under the hardened
  # runtime. copilot-runtime dlopens runtime.node; ad-hoc signatures carry no Team ID, so library
  # validation rejects that load unless it is disabled for copilot-runtime (docs/spikes/S-05.md).
  macho_files | awk -F/ '{ print NF "\t" $0 }' | sort -rn | cut -f2- | while IFS= read -r binary; do
    case "$binary" in
      "$app/Contents/Helpers/node") entitlements="$spike_dir/node.entitlements" ;;
      */copilot-runtime) entitlements="$spike_dir/copilot-runtime.entitlements" ;;
      *) entitlements="" ;;
    esac
    sign_one ${entitlements:+--entitlements "$entitlements"} "$binary"
  done
  # Nested bundles (the Copilot package ships "Copilot Computer Use.app") are sealed as bundles too.
  find "$app/Contents" -name '*.app' -type d | awk -F/ '{ print NF "\t" $0 }' | sort -rn | cut -f2- | while IFS= read -r bundle; do
    sign_one "$bundle"
  done
  sign_one "$app"
}

build() {
  node_bin=$(command -v node) || fail "node is not on PATH"
  node_major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$node_major" -ge 22 ] || fail "node 22 or later is required, found $(node -v)"
  if ! copilot=$(copilot_package 2>/dev/null); then
    make -C "$repo_root" engine-install >/dev/null
    copilot=$(copilot_package)
  fi

  rm -rf "$app" "$zip"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Helpers" "$app/Contents/Resources/engine"
  cp Info.plist "$app/Contents/Info.plist"
  xcrun swiftc -O -swift-version 6 -target arm64-apple-macos26.0 launcher/main.swift -o "$app/Contents/MacOS/PicaS05"
  cp "$node_bin" "$app/Contents/Helpers/node"
  cp engine/hello-engine.mjs "$app/Contents/Resources/engine/"
  # Keep the package layout intact: the runtime finds runtime.node, rg and tgrep relative to itself.
  ditto "$copilot" "$app/Contents/Resources/copilot"
  # Files copied out of node_modules or a download keep xattrs; codesign --strict rejects some of them.
  xattr -cr "$app"
  sign
  ditto -c -k --keepParent "$app" "$zip"
}

ping_app() {
  # $1: app path. Runs the main executable headless, so the check needs no UI. A copy Gatekeeper
  # has not cleared is held at launch however it is started (docs/spikes/S-05.md).
  result=$("$1/Contents/MacOS/PicaS05" --headless) || { echo "$result"; return 1; }
  echo "$result" | jq -e '.ok and .hello.engineVersion and .health.status == "ok" and .probe.copilot.message == "pong: s05" and .probe.sqlite.ok' >/dev/null || { echo "$result"; return 1; }
  echo "$result" | jq -c '{engine: .hello.engineVersion, health: .health.status, node: .probe.node.version, copilot: .probe.copilot.message, copilotProtocol: .probe.copilot.protocolVersion, sqlite: .probe.sqlite.version}'
}

build

if [ "$check" = build ]; then
  echo "built: $app"
  echo "zipped: $zip"
  exit 0
fi

if [ "$check" = signatures ]; then
  codesign --verify --deep --strict --verbose=2 "$app" 2>&1 | grep -v '^--' | sed 's/^/  /'
  codesign --verify --deep --strict "$app" || fail "codesign --verify --deep --strict on the app"
  ok "codesign --verify --deep --strict passes on the app"

  count=0
  for binary in $(macho_files | tr ' ' '\037'); do
    binary=$(echo "$binary" | tr '\037' ' ')
    details=$(codesign -dv --verbose=2 "$binary" 2>&1)
    echo "$details" | grep -q '^Signature=adhoc$' || fail "not ad-hoc signed: $binary"
    echo "$details" | grep -q '^CodeDirectory .*flags=0x[0-9a-f]*(.*runtime' || fail "no hardened runtime: $binary"
    codesign --verify --strict "$binary" || fail "codesign --verify --strict: $binary"
    count=$((count + 1))
  done
  [ "$count" -ge 6 ] || fail "expected at least 6 nested Mach-O files, found $count"
  ok "all $count Mach-O files in the bundle are ad-hoc signed with the hardened runtime"

  codesign -dv --verbose=2 "$app" 2>&1 | grep -q 'flags=0x[0-9a-f]*(.*runtime' || fail "app bundle lacks the hardened runtime flag"
  ok "app bundle signature carries the hardened runtime flag"

  ping_app "$app" || fail "the signed app's engine did not answer the ping"
  ok "the signed app starts its bundled engine, which answers engine.hello, engine.health and pings the Copilot runtime"
  exit 0
fi

if [ "$check" = report ]; then
  du -sh "$app" "$zip" "$app/Contents/Helpers/node" "$app/Contents/Resources/copilot" "$app/Contents/Resources/copilot/prebuilds"
  du -sk "$app/Contents/Resources/copilot"/* | sort -rn | head -6
  echo "zip bytes: $(stat -f %z "$zip")"
  echo "Mach-O files:"
  macho_files | sed "s|$app/||; s/^/  /"
  echo "designated requirement:"
  codesign -d -r- "$app" 2>&1 | sed 's/^/  /'
  exit 0
fi

# quarantine. Gatekeeper caches its verdict per file, so every variant gets a fresh extraction.
sim="$out/quarantine"
rm -rf "$sim"
mkdir -p "$sim"
cp "$zip" "$sim/Pica-S05.zip"
qtn="0083;$(printf '%x' "$(date +%s)");Safari;$(uuidgen)"
xattr -w com.apple.quarantine "$qtn" "$sim/Pica-S05.zip"

extract() {
  # $1: variant name. Prints the extracted app path. ditto, like Archive Utility, copies the zip's
  # quarantine onto every extracted item (it drops the agent name).
  rm -rf "${sim:?}/$1"
  ditto -x -k "$sim/Pica-S05.zip" "$sim/$1"
  echo "$sim/$1/Pica S-05.app"
}

downloaded=$(extract downloaded)
missing=$(find "$downloaded" -print0 | xargs -0 xattr -p com.apple.quarantine 2>&1 | grep -c 'No such xattr' || true)
[ "$missing" -eq 0 ] || fail "$missing extracted items lack com.apple.quarantine"
ok "every extracted item carries com.apple.quarantine (zip: $qtn)"

codesign --verify --deep --strict "$downloaded" || fail "the downloaded copy's signature does not verify"
ok "the downloaded copy's signature still verifies after zip and unzip"

verdict=$(spctl --assess --type execute -vv "$downloaded" 2>&1 || true)
echo "$verdict" | sed 's/^/  gatekeeper: /'
echo "$verdict" | grep -q 'rejected' || fail "expected Gatekeeper to reject a quarantined, unnotarized ad-hoc app"
ok "Gatekeeper rejects the downloaded copy as is"

if [ "${S05_PROBE_BLOCK:-}" = 1 ]; then
  # Shows Gatekeeper's "Not Opened" dialog on this account; dismiss it with Done.
  "$downloaded/Contents/MacOS/PicaS05" --headless >/dev/null 2>&1 &
  blocked_pid=$!
  sleep 15
  if kill -0 "$blocked_pid" 2>/dev/null; then
    kill "$blocked_pid"
    ok "launching the quarantined main executable directly is held by Gatekeeper too (no output after 15 s)"
  else
    fail "the quarantined copy launched without approval"
  fi
fi

# Install path (a): clear the quarantine before the first launch, as the install guide says.
cleared=$(extract cleared-before-first-launch)
xattr -dr com.apple.quarantine "$cleared"
ping_app "$cleared" || fail "with the quarantine cleared before the first launch, the engine did not answer"
ok "path (a): xattr -dr com.apple.quarantine before the first launch, then the engine answers the ping"

# Install path (b): install.sh over HTTP (curl sets no quarantine) into a scratch Applications folder.
port=$((20000 + $$ % 20000))
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$out" >/dev/null 2>&1 &
http_pid=$!
trap 'kill "$http_pid" 2>/dev/null || true' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null && break
  sleep 0.3
done
mkdir -p "$sim/curl-installed"
sha=$(shasum -a 256 "$zip" | cut -d' ' -f1)
export S05_ALLOW_INSECURE=1
if "$spike_dir/install.sh" "http://127.0.0.1:$port/Pica-S05.zip" 0000 "$sim/curl-installed" >/dev/null 2>&1; then
  fail "install.sh accepted a wrong checksum"
fi
ok "install.sh refuses a zip whose checksum does not match"
"$spike_dir/install.sh" "http://127.0.0.1:$port/Pica-S05.zip" "$sha" "$sim/curl-installed" | sed 's/^/  /'
installed="$sim/curl-installed/Pica S-05.app"
left=$(find "$installed" -print0 | xargs -0 xattr -p com.apple.quarantine 2>/dev/null | wc -l | tr -d ' ')
[ "$left" -eq 0 ] || fail "$left installed items carry com.apple.quarantine"
ping_app "$installed" || fail "the curl-installed copy's engine did not answer"
ok "path (b): install.sh downloads with curl, checks the sha256 and signature, installs with no quarantine; the engine answers the ping"
