#!/bin/bash
# H-06: turns the Pica.app xcodebuild produced into a release bundle and zip (docs/distribution.md).
#   tools/release/package.sh --app <built Pica.app> --version <x.y.z> --out <dir>
#       [--node <node binary>] [--feed-url <appcast URL>] [--public-key <Sparkle EdDSA public key>]
#       [--bundle-id <id>]   (tests only: keeps their Sparkle state out of the real app's defaults)
# Adds Node, the bundled engine (stamped with the version) and the Copilot runtime, stamps Info.plist, signs inside
# out (PICA_SIGN_IDENTITY, default ad-hoc), verifies, and writes <out>/Pica.app and <out>/Pica-<version>.zip.
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
source "$repo_root/tools/release/sign.sh"

app_in="" version="" out="" node="" public_key="" bundle_id=""
feed_url="https://github.com/0zean/pica/releases/latest/download/appcast.xml"
while [ $# -gt 0 ]; do
  case "$1" in
    --app) app_in="$2"; shift 2 ;;
    --version) version="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --node) node="$2"; shift 2 ;;
    --feed-url) feed_url="$2"; shift 2 ;;
    --public-key) public_key="$2"; shift 2 ;;
    --bundle-id) bundle_id="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -d "$app_in" ] && [ -n "$version" ] && [ -n "$out" ] || { echo "usage: $0 --app <Pica.app> --version <x.y.z> --out <dir>" >&2; exit 2; }
echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "version must be x.y.z, got $version" >&2; exit 2; }
node="${node:-$(command -v node)}"

# The app runs this Node on Macs without developer tools, so it must be the official, self-contained build.
"$node" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' ||
  { echo "Node 22.13 or later is required, found $("$node" -v)" >&2; exit 1; }
if otool -L "$node" | tail -n +2 | grep -Ev '^\s*(/usr/lib/|/System/Library/)' | grep -q .; then
  echo "$node links libraries outside the base system (a Homebrew build?); use the nodejs.org build" >&2; exit 1
fi

copilot_package() {
  # The platform package the SDK would spawn, resolved from @github/copilot-sdk's own location (S-05).
  node -e '
    const { createRequire } = require("node:module");
    const fs = require("node:fs");
    const path = require("node:path");
    const sdk = fs.realpathSync(process.argv[1] + "/engine/packages/adapters/node_modules/@github/copilot-sdk");
    console.log(path.dirname(createRequire(sdk + "/package.json").resolve("@github/copilot-sdk-darwin-arm64/package.json")));
  ' "$repo_root"
}

mkdir -p "$out"
app="$out/Pica.app"
zip="$out/Pica-$version.zip"
rm -rf "$app" "$zip"
ditto "$app_in" "$app"
contents="$app/Contents"

# Pica is not sandboxed (D-12), so Sparkle installs without its XPC services, which only sandboxed apps use.
rm -rf "$contents/Frameworks/Sparkle.framework/Versions/B/XPCServices" "$contents/Frameworks/Sparkle.framework/XPCServices"

plist="$contents/Info.plist"
set_plist() {
  /usr/libexec/PlistBuddy -c "Delete :$1" "$plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :$1 $2 $3" "$plist"
}
set_plist CFBundleShortVersionString string "$version"
set_plist CFBundleVersion string "$version"
[ -n "$bundle_id" ] && set_plist CFBundleIdentifier string "$bundle_id"
set_plist SUFeedURL string "$feed_url"
set_plist SUEnableAutomaticChecks bool true
if [ -n "$public_key" ]; then
  set_plist SUPublicEDKey string "$public_key"
else
  /usr/libexec/PlistBuddy -c "Delete :SUPublicEDKey" "$plist" 2>/dev/null || true
  echo "note: no Sparkle public key; this build will not check for updates" >&2
fi

mkdir -p "$contents/Helpers"
cp "$node" "$contents/Helpers/node"
(cd "$repo_root/engine" && node --experimental-strip-types --disable-warning=ExperimentalWarning tools/bundle/main.ts \
  --out "$contents/Resources/engine" --version "$version")
# The runtime finds runtime.node, rg and tgrep relative to itself, so the package keeps its layout (S-05).
ditto "$(copilot_package)" "$contents/Resources/copilot"

# Files copied from node_modules or a download keep xattrs, and codesign --strict rejects some of them.
xattr -cr "$app"
sign_app "$app"
verify_app "$app"

ditto -c -k --keepParent "$app" "$zip"
echo "packaged Pica $version: $zip"
