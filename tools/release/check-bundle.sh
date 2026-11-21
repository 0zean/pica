#!/bin/bash
# H-06: checks a release zip (docs/distribution.md). Usage: tools/release/check-bundle.sh <Pica-x.y.z.zip>
# Unzips it as a user would, then: codesign --verify --deep --strict passes, every Mach-O carries the hardened runtime,
# the bundle's version matches the zip's name, and its bundled engine starts and reports that same version.
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
source "$repo_root/tools/release/sign.sh"

zip="${1:?usage: check-bundle.sh <Pica-x.y.z.zip>}"
expected=$(basename "$zip" | sed -nE 's/^Pica-([0-9]+\.[0-9]+\.[0-9]+)\.zip$/\1/p')
[ -n "$expected" ] || { echo "FAIL: $zip is not named Pica-x.y.z.zip" >&2; exit 1; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
ditto -x -k "$zip" "$work"
app="$work/Pica.app"
[ -d "$app" ] || { echo "FAIL: $zip holds no Pica.app" >&2; exit 1; }

verify_app "$app"
version=$(plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist")
[ "$version" = "$expected" ] || { echo "FAIL: Info.plist says $version, the zip says $expected" >&2; exit 1; }
hello=$(node "$repo_root/tools/release/engine-hello.mjs" "$app")
engine=$(echo "$hello" | node -e 'process.stdin.on("data", d => console.log(JSON.parse(d).engineVersion))')
[ "$engine" = "$version" ] || { echo "FAIL: the bundled engine reports $engine, the app is $version" >&2; exit 1; }
echo "ok: Pica $version; its bundled engine answers engine.hello with $engine"
