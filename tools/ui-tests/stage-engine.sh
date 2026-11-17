#!/bin/sh
# Keeps what UI tests launch outside ~/Documents, so a rebuilt Pica needs no Documents grant.
#
# Usage: tools/ui-tests/stage-engine.sh --dir   prints this checkout's stage folder (UI-test derived data goes there)
#        tools/ui-tests/stage-engine.sh         copies engine/ (sources and node_modules) and the files the runner
#                                               reads there, and prints the engine copy
#
# Debug builds are signed ad hoc, so macOS treats each rebuild as a new app and asks again for every folder it
# protects. Under ~/Documents two things asked: the Node that Pica starts `picad` with (its file access counts as
# Pica's), and the UI-test runner, which reads the Pica.app it launches from derived data and LaunchBaseline.json. A stage under
# ~/Library/Caches needs no grant wherever the checkout is.
#
# Each checkout has its own stage (keyed by its path), so worktrees testing at the same time do not overwrite each
# other's engine or build. rsync copies only what changed. PICA_UI_TEST_STAGE overrides the root.
set -eu

cd "$(dirname "$0")/../.."
checkout=$(pwd -P)
root="${PICA_UI_TEST_STAGE:-$HOME/Library/Caches/dev.pica.ui-tests}"
key=$(printf '%s' "$checkout" | shasum -a 256 | cut -c1-16)
stage="$root/$key"

if [ "${1:-}" = --dir ]; then
  printf '%s\n' "$stage"
  exit 0
fi

if [ ! -d engine/node_modules ]; then
  echo "stage-engine: engine/node_modules is missing; run \`make engine-install\` first" >&2
  exit 1
fi

mkdir -p "$stage"
printf '%s\n' "$checkout" > "$stage/checkout"
# pnpm's links inside node_modules are relative, so the copy resolves within itself.
rsync -a --delete \
  --exclude node_modules/.vitest-cache --exclude node_modules/.vite --exclude node_modules/.vite-temp \
  --exclude coverage \
  engine/ "$stage/engine/"
# The (sandboxed) runner reads this itself, so it needs a copy outside ~/Documents too.
cp app/PicaUITests/LaunchBaseline.json "$stage/LaunchBaseline.json"
printf '%s\n' "$stage/engine"
