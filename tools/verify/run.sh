#!/bin/sh
# Runs the checks mapped to one unit in units.json (PLAN.md §8.1).
# Usage: tools/verify/run.sh <unit ID>. VERIFY_UNITS_FILE overrides the mapping for tests.
set -u

cd "$(dirname "$0")/../.." || exit 2
units_file="${VERIFY_UNITS_FILE:-tools/verify/units.json}"
unit="${1:-}"

if [ -z "$unit" ]; then
  echo "verify: no unit ID given; usage: make verify UNIT=<unit ID>" >&2
  exit 2
fi
if ! jq -e --arg unit "$unit" 'has($unit)' "$units_file" >/dev/null; then
  echo "verify: unknown unit ID \"$unit\"; it has no entry in $units_file" >&2
  exit 2
fi

# Checks may call make themselves; the outer `make verify UNIT=...` must not leak into them.
unset MAKEFLAGS MFLAGS MAKELEVEL UNIT

count=$(jq --arg unit "$unit" '.[$unit] | length' "$units_file")
if [ "$count" -eq 0 ]; then
  echo "verify: unit $unit has no checks mapped" >&2
  exit 1
fi

field() {
  jq -r --arg unit "$unit" --argjson i "$1" ".[\$unit][\$i].$2 // empty" "$units_file"
}

failed=0
pending=0
i=0
while [ "$i" -lt "$count" ]; do
  check=$(field "$i" check)
  run=$(field "$i" run)
  if [ "$(field "$i" manual)" = true ]; then
    echo "MANUAL   $check"
  elif [ -z "$run" ]; then
    echo "PENDING  $check"
    pending=$((pending + 1))
  elif [ "$(field "$i" live)" = true ] && [ "${PICA_LIVE:-}" != 1 ]; then
    echo "SKIPPED  $check (live; set PICA_LIVE=1 to run)"
  else
    echo "RUNNING  $check"
    if sh -c "$run"; then
      echo "PASSED   $check"
    else
      echo "FAILED   $check"
      failed=$((failed + 1))
    fi
  fi
  i=$((i + 1))
done

if [ "$failed" -gt 0 ] || [ "$pending" -gt 0 ]; then
  echo "verify: unit $unit: $failed failed, $pending without an automated check" >&2
  exit 1
fi
echo "verify: unit $unit passed"
