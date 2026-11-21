#!/bin/sh
# The H-07 performance gate (docs/performance.md): runs every test that measures a PLAN.md §9 budget, then reports
# each budget against its measured value (tools/perf/budgets.json) and exits 1 unless every test passed and every
# budget was measured under its threshold. `make perf` runs it. Locally, run it alone on the machine and under the
# UI-test lock: `lockf /tmp/pica-uitest.lock make perf`. PERF_DIR overrides where measurements and the report go.
set -u

cd "$(dirname "$0")/../.." || exit 2
root=$(pwd -P)
perf_dir="${PERF_DIR:-$root/app/.derived/perf}"
rm -rf "$perf_dir" && mkdir -p "$perf_dir"
unset MAKEFLAGS MFLAGS MAKELEVEL

# Waits, for at most PERF_SETTLE_SECONDS (default 180), until the one-minute load average is under the CPU count, so
# a build that just finished (or a busy CI runner) is not measured along with the app. Prints the load it measured at.
settle() {
  cpus=$(sysctl -n hw.ncpu 2>/dev/null || echo 4)
  waited=0
  while [ "$waited" -lt "${PERF_SETTLE_SECONDS:-180}" ]; do
    load=$(sysctl -n vm.loadavg | awk '{print $2}')
    awk -v load="$load" -v cpus="$cpus" 'BEGIN { exit !(load < cpus) }' && break
    sleep 5
    waited=$((waited + 5))
  done
  echo "perf: measuring at load $(sysctl -n vm.loadavg) after waiting ${waited} s" >&2
  echo "$1: load $(sysctl -n vm.loadavg) after waiting ${waited} s" >> "$perf_dir/loads.txt"
}

# True when PERF_NOT_GATING names the budget id.
not_gating() {
  case " ${PERF_NOT_GATING:-} " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

failed=""
step() {
  name="$1"
  shift
  echo "perf: $name" >&2
  if ! "$@"; then
    failed="$failed $name"
  fi
}

# PICA_PERF_GATE asserts the budgets as PLAN.md §9 states them, also on CI. Test files run one at a time, so no
# benchmark competes with another for the CPU.
engine_benchmarks() {
  settle engine-benchmarks
  (cd engine && PICA_PERF_GATE=1 PICA_PERF_DIR="$perf_dir" pnpm exec vitest run --no-file-parallelism \
    packages/server/tests/startup-benchmark.test.ts \
    packages/core/tests/policy/benchmark.test.ts \
    packages/core/tests/files/benchmark.test.ts \
    packages/server/tests/files/quick-open-benchmark.test.ts)
}

# One suite per run: `swift test` runs a package's suites in parallel. Built first, so the build is not measured. A
# failed run is retried once after settling again: these are tails of a few events or one kill, which a burst of other
# work on the machine decides (docs/performance.md). Both attempts are in the report's notes.
app_package_benchmark() {
  id="$1"
  filter="$2"
  swift build --build-tests --package-path app/Packages/AppShell || return 1
  for attempt in 1 2; do
    settle "$id (attempt $attempt)"
    PICA_PERF_GATE=1 PICA_PERF_DIR="$perf_dir" swift test --skip-build --package-path app/Packages/AppShell \
      --filter "$filter" && return 0
    echo "$id: attempt $attempt failed, measured $(jq -c '{measured, samples}' "$perf_dir/$id.json" 2>/dev/null)" \
      >> "$perf_dir/loads.txt"
  done
  not_gating "$id"
}

# The UI tests that measure budgets, from budgets.json's `uiTest`. PERF_NOT_GATING names budget ids that are measured
# and reported but do not fail the gate (the GitHub runner's list, docs/performance.md): their tests run apart, and
# their failures are left to the report, which marks those rows.
ui_tests() {
  jq -r --arg skip " ${PERF_NOT_GATING:-} " --arg want "$1" \
    '[.[] | select(.uiTest != null) | select(.id as $id | ($skip | contains(" " + $id + " ")) == ($want == "not-gating")) | .uiTest]
     | unique | join(" ")' tools/perf/budgets.json
}

ui_benchmarks() {
  kind="$1"
  tests=$(ui_tests "$kind")
  rm -rf "$perf_dir/ui-$kind" && mkdir -p "$perf_dir/ui-$kind"
  [ -n "$tests" ] || return 0
  status=0
  make app-ui-test-pica-build || return 1
  settle "ui-$kind"
  make app-ui-test-pica UI_TESTS="$tests" || status=$?
  xcrun xcresulttool export attachments --path app/.derived/pica-ui-tests.xcresult --output-path "$perf_dir/ui-$kind" \
    --filter 'budget-*' >/dev/null || status=1
  cp -R app/.derived/pica-ui-tests.xcresult "$perf_dir/ui-$kind.xcresult" 2>/dev/null || true
  [ "$kind" = not-gating ] || return "$status"
}

machine() {
  echo
  echo "Machine: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m), $(sysctl -n hw.ncpu 2>/dev/null) CPUs," \
    "$(($(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824)) GB, macOS $(sw_vers -productVersion 2>/dev/null)," \
    "Node $(node --version). Load averages $1."
}

load_before=$(sysctl -n vm.loadavg 2>/dev/null)
step engine-benchmarks engine_benchmarks
step event-delivery app_package_benchmark event-delivery EventDeliveryLatencyTests
step engine-recovery app_package_benchmark engine-recovery 'EngineRecoveryTests/killedEngine'
step ui-benchmarks ui_benchmarks gating
step ui-benchmarks-not-gating ui_benchmarks not-gating
load_after=$(sysctl -n vm.loadavg 2>/dev/null)

report_status=0
node --experimental-strip-types --disable-warning=ExperimentalWarning engine/tools/perf-report/main.ts \
  tools/perf/budgets.json "$perf_dir" "$perf_dir/ui-gating" "$perf_dir/ui-not-gating" || report_status=$?
notes=$(machine "before $load_before, after $load_after"; echo; sed 's/^/- /' "$perf_dir/loads.txt")
printf '%s\n' "$notes" | tee -a "$perf_dir/report.md"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$notes" >> "$GITHUB_STEP_SUMMARY"; fi

if [ -n "$failed" ]; then
  echo "perf: failed:$failed" >&2
  exit 1
fi
exit "$report_status"
