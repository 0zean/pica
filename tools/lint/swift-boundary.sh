#!/bin/sh
# PLAN.md §4.3: Swift never shells out to git or calls GitHub; it asks the engine.
# Fails when a Swift source under the given root (default: app/) names the git executable or a
# GitHub host. A line may opt out with the comment `swift-boundary: allow` and a reason.
set -eu

root="${1:-$(dirname "$0")/../../app}"
pattern='"(/usr/bin/|/opt/homebrew/bin/|/usr/local/bin/)?git"|api\.github\.com|githubusercontent\.com|\.ghe\.com|(https?://)github\.com'

matches=$(find "$root" -name '*.swift' -not -path '*/.derived/*' -not -path '*/.build/*' -print0 \
  | xargs -0 grep -nHE "$pattern" 2>/dev/null \
  | grep -v 'swift-boundary: allow' || true)

if [ -n "$matches" ]; then
  echo "swift-boundary: Swift must not run git or call GitHub; ask the engine instead (PLAN.md §4.3):" >&2
  echo "$matches" >&2
  exit 1
fi
echo "swift-boundary: ok"
