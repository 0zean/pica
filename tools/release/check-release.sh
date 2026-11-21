#!/bin/bash
# H-06: checks what the release workflow attached to a draft GitHub release (docs/distribution.md).
#   tools/release/check-release.sh [x.y.z]   (default: the newest draft release)
# Needs `gh` signed in with access to the repository: draft assets are not public. Downloads the assets, checks them
# against SHA256SUMS, and runs check-bundle.sh on the zip (codesign --verify --deep --strict, hardened runtime,
# engine version).
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
repo=0zean/pica
fail() { echo "FAIL: $1" >&2; exit 1; }

if [ -n "${1:-}" ]; then
  tag="v$1"
else
  tag=$(gh release list --repo "$repo" --json tagName,isDraft,createdAt \
    --jq '[.[] | select(.isDraft)] | sort_by(.createdAt) | last | .tagName // empty')
  [ -n "$tag" ] || fail "no draft release; run the release workflow first (docs/distribution.md)"
fi
[ "$(gh release view "$tag" --repo "$repo" --json isDraft --jq .isDraft)" = true ] || fail "$tag is not a draft release"
version=${tag#v}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
gh release download "$tag" --repo "$repo" --dir "$work"
for asset in "Pica-$version.zip" SHA256SUMS install.sh; do
  [ -f "$work/$asset" ] || fail "$tag has no $asset"
done
(cd "$work" && shasum -a 256 -c SHA256SUMS) || fail "$tag's assets do not match its SHA256SUMS"
"$repo_root/tools/release/check-bundle.sh" "$work/Pica-$version.zip"
echo "ok: draft release $tag holds Pica-$version.zip, SHA256SUMS and install.sh, and the zip's app verifies"
