#!/bin/sh
# Fails if `make codegen` changed or added files, i.e. the committed generated code is out of date (D-05).
set -u
cd "$(dirname "$0")/../.." || exit 2

generated="engine/packages/protocol/protocol.schema.json app/Packages/PicaProtocol/Sources/PicaProtocol/Generated"
# shellcheck disable=SC2086
changes=$(git status --porcelain --untracked-files=all -- $generated)
if [ -n "$changes" ]; then
  echo "codegen: generated files differ from the committed ones; run \`make codegen\` and commit the result:" >&2
  echo "$changes" >&2
  # shellcheck disable=SC2086
  git --no-pager diff --stat -- $generated >&2
  exit 1
fi
echo "codegen: generated files are up to date"
