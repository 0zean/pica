#!/bin/bash
# H-06: writes a Sparkle appcast with one item for a release zip (docs/distribution.md).
#   tools/release/appcast.sh --zip <Pica-x.y.z.zip> --version <x.y.z> --url <enclosure URL> --out <appcast.xml>
#       [--release-notes-url <URL>] [--sign-update <sign_update binary>]
# The private EdDSA key is read from SPARKLE_PRIVATE_ED_KEY (base64, as generate_keys -x exports it) and passed to
# Sparkle's sign_update on standard input, so it never appears in argv or on disk.
set -euo pipefail

zip="" version="" url="" out="" notes="" sign_update=""
while [ $# -gt 0 ]; do
  case "$1" in
    --zip) zip="$2"; shift 2 ;;
    --version) version="$2"; shift 2 ;;
    --url) url="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --release-notes-url) notes="$2"; shift 2 ;;
    --sign-update) sign_update="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -f "$zip" ] && [ -n "$version" ] && [ -n "$url" ] && [ -n "$out" ] ||
  { echo "usage: $0 --zip <zip> --version <x.y.z> --url <enclosure URL> --out <appcast.xml>" >&2; exit 2; }
[ -n "${SPARKLE_PRIVATE_ED_KEY:-}" ] || { echo "SPARKLE_PRIVATE_ED_KEY is not set" >&2; exit 2; }
[ -x "$sign_update" ] || { echo "--sign-update must name Sparkle's sign_update" >&2; exit 2; }

# Prints: sparkle:edSignature="…" length="…"
attributes=$(printf '%s' "$SPARKLE_PRIVATE_ED_KEY" | "$sign_update" --ed-key-file - "$zip")
echo "$attributes" | grep -Eq '^sparkle:edSignature="[^"]+" length="[0-9]+"$' || { echo "sign_update failed: $attributes" >&2; exit 1; }
minimum=$(unzip -p "$zip" 'Pica.app/Contents/Info.plist' | plutil -extract LSMinimumSystemVersion raw -o - -)
link=""
[ -n "$notes" ] && link="      <link>$notes</link>"

cat > "$out" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Pica</title>
    <item>
      <title>Pica $version</title>
$link
      <pubDate>$(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')</pubDate>
      <sparkle:version>$version</sparkle:version>
      <sparkle:shortVersionString>$version</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>$minimum</sparkle:minimumSystemVersion>
      <enclosure url="$url" type="application/octet-stream" $attributes />
    </item>
  </channel>
</rss>
XML
sed -i '' '/^$/d' "$out"
echo "wrote $out for Pica $version"
