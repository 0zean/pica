#!/bin/bash
# H-06: builds a Pica release into a folder of release assets (docs/distribution.md). The release workflow runs this;
# so can anyone with Xcode, to install a local build with install.sh --from.
#   tools/release/build.sh --version <x.y.z> [--out <dir>]   (default dist/)
# Writes Pica-<version>.zip, install.sh, SHA256SUMS, and appcast.xml when a Sparkle key is configured.
# Environment, all optional:
#   SPARKLE_PUBLIC_ED_KEY, SPARKLE_PRIVATE_ED_KEY  Sparkle EdDSA key pair; without both the build cannot update itself
#   PICA_SIGN_IDENTITY                             a Developer ID Application identity; default "-" (ad-hoc, D-17)
#   APPLE_NOTARY_KEY_ID, APPLE_NOTARY_ISSUER, APPLE_NOTARY_KEY_PATH   notarize with an App Store Connect API key
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
version="" out="$repo_root/dist"
while [ $# -gt 0 ]; do
  case "$1" in
    --version) version="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || { echo "usage: $0 --version <x.y.z> [--out <dir>]" >&2; exit 2; }
if { [ -n "${SPARKLE_PUBLIC_ED_KEY:-}" ] && [ -z "${SPARKLE_PRIVATE_ED_KEY:-}" ]; } ||
   { [ -z "${SPARKLE_PUBLIC_ED_KEY:-}" ] && [ -n "${SPARKLE_PRIVATE_ED_KEY:-}" ]; }; then
  echo "set both SPARKLE_PUBLIC_ED_KEY and SPARKLE_PRIVATE_ED_KEY, or neither" >&2; exit 2
fi

mkdir -p "$out"
out=$(cd "$out" && pwd)
derived="$repo_root/app/.derived/release"
make -C "$repo_root" engine-install
# arm64 only: the bundled Copilot runtime is arm64 (S-05). Signing happens in package.sh, after the helpers are added.
xcodebuild -project "$repo_root/app/Pica.xcodeproj" -scheme Pica -configuration Release \
  -destination 'generic/platform=macOS' -derivedDataPath "$derived" -quiet \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO build

rm -rf "$out"
mkdir -p "$out"
zip="$out/Pica-$version.zip"
"$repo_root/tools/release/package.sh" --app "$derived/Build/Products/Release/Pica.app" --version "$version" \
  --out "$out" ${SPARKLE_PUBLIC_ED_KEY:+--public-key "$SPARKLE_PUBLIC_ED_KEY"}

if [ -n "${APPLE_NOTARY_KEY_ID:-}" ] && [ "${PICA_SIGN_IDENTITY:--}" != "-" ]; then
  "$repo_root/tools/release/notarize.sh" "$out/Pica.app" "$zip"
else
  echo "note: not notarized (no Developer ID identity or notary credentials); install with install.sh (D-17)" >&2
fi

if [ -n "${SPARKLE_PRIVATE_ED_KEY:-}" ]; then
  "$repo_root/tools/release/appcast.sh" --zip "$zip" --version "$version" \
    --url "https://github.com/0zean/pica/releases/download/v$version/Pica-$version.zip" \
    --release-notes-url "https://github.com/0zean/pica/releases/tag/v$version" \
    --sign-update "$derived/SourcePackages/artifacts/sparkle/Sparkle/bin/sign_update" --out "$out/appcast.xml"
else
  echo "note: no Sparkle key; no appcast.xml (installed copies will not be offered this release)" >&2
fi

cp "$repo_root/tools/release/install.sh" "$out/install.sh"
(cd "$out" && shasum -a 256 "Pica-$version.zip" install.sh $([ -f appcast.xml ] && echo appcast.xml) > SHA256SUMS)
cat "$out/SHA256SUMS"
echo "release assets in $out"
