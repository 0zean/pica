# Sourced by package.sh and check-bundle.sh. Signing and verification of a Pica.app, inside out (docs/distribution.md).
# PICA_SIGN_IDENTITY is "-" (ad-hoc, D-17) unless a Developer ID identity is configured.

release_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

macho_files() {
  # Universal binaries add one "(for architecture …)" line per slice; only the file's own line is kept.
  find "$1" -type f -print0 | xargs -0 file -N -F '|' | grep -v '(for architecture ' | grep 'Mach-O' | cut -d'|' -f1
}

deepest_first() {
  awk -F/ '{ print NF "\t" $0 }' | sort -rn | cut -f2-
}

sign_one() {
  local identity="${PICA_SIGN_IDENTITY:--}" timestamp="--timestamp=none"
  # Notarization requires a secure timestamp; ad-hoc signatures cannot have one.
  [ "$identity" != "-" ] && timestamp="--timestamp"
  local log
  log=$(codesign --force --sign "$identity" --options runtime "$timestamp" "$@" 2>&1) || { echo "$log" >&2; return 1; }
}

# Library validation only admits libraries with the process's Team ID, and an ad-hoc signature has none. So, ad-hoc
# only, Pica (which loads Sparkle.framework) and copilot-runtime (which dlopens runtime.node) disable it (S-05).
entitlements_for() {
  local ad_hoc=""
  [ "${PICA_SIGN_IDENTITY:--}" = "-" ] && ad_hoc=1
  case "$1" in
    */Contents/Helpers/node) echo "$release_dir/entitlements/node.plist" ;;
    */copilot-runtime) [ -n "$ad_hoc" ] && echo "$release_dir/entitlements/library-validation.plist" ;;
    */Contents/MacOS/Pica) [ -n "$ad_hoc" ] && echo "$release_dir/entitlements/library-validation.plist" ;;
  esac
  return 0
}

sign_app() {
  local app="$1" binary bundle entitlements
  macho_files "$app" | deepest_first | while IFS= read -r binary; do
    entitlements=$(entitlements_for "$binary")
    sign_one ${entitlements:+--entitlements "$entitlements"} "$binary"
  done
  # Nested bundles are sealed as bundles, deepest first: Sparkle's Updater.app and framework, Copilot's plugin app.
  find "$app/Contents" \( -name '*.app' -o -name '*.framework' -o -name '*.xpc' \) -type d | deepest_first |
    while IFS= read -r bundle; do
      sign_one "$bundle"
    done
  entitlements=$(entitlements_for "$app/Contents/MacOS/Pica")
  sign_one ${entitlements:+--entitlements "$entitlements"} "$app"
}

# Exits non-zero with a message naming the first file that fails.
verify_app() {
  local app="$1" binary details count=0
  codesign --verify --deep --strict "$app" || { echo "FAIL: codesign --verify --deep --strict $app" >&2; return 1; }
  # Code under Resources (the Copilot package) is sealed as a resource, so --deep does not descend into it (S-05).
  while IFS= read -r binary; do
    details=$(codesign -dv --verbose=2 "$binary" 2>&1)
    echo "$details" | grep -q 'flags=0x[0-9a-f]*(.*runtime' || { echo "FAIL: no hardened runtime: $binary" >&2; return 1; }
    codesign --verify --strict "$binary" || { echo "FAIL: codesign --verify --strict $binary" >&2; return 1; }
    count=$((count + 1))
  done < <(macho_files "$app")
  echo "ok: codesign --verify --deep --strict passes; $count Mach-O files signed with the hardened runtime"
}
