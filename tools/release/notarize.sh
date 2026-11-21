#!/bin/bash
# H-06, optional: notarizes and staples a Developer ID signed Pica.app, then re-zips it (docs/distribution.md).
#   tools/release/notarize.sh <Pica.app> <zip>
# Needs APPLE_NOTARY_KEY_ID, APPLE_NOTARY_ISSUER and APPLE_NOTARY_KEY_PATH (an App Store Connect API key, .p8).
set -euo pipefail

app="$1" zip="$2"
: "${APPLE_NOTARY_KEY_ID:?}" "${APPLE_NOTARY_ISSUER:?}" "${APPLE_NOTARY_KEY_PATH:?}"
xcrun notarytool submit "$zip" --key "$APPLE_NOTARY_KEY_PATH" --key-id "$APPLE_NOTARY_KEY_ID" \
  --issuer "$APPLE_NOTARY_ISSUER" --wait
xcrun stapler staple "$app"
xcrun stapler validate "$app"
rm -f "$zip"
ditto -c -k --keepParent "$app" "$zip"
echo "notarized and stapled: $zip"
