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
  (cd engine && PICA_PERF_GATE=1 PICA_PERF_DIR="$perf_dir" pnpm exec vitest run --no-file-parallelism \
    packages/server/tests/startup-benchmark.test.ts \
    packages/core/tests/policy/benchmark.test.ts \
    packages/core/tests/files/benchmark.test.ts \
    packages/server/tests/files/quick-open-benchmark.test.ts)
}

app_package_benchmarks() {
  PICA_PERF_DIR="$perf_dir" swift test --package-path app/Packages/AppShell \
    --filter 'EventDeliveryLatencyTests|EngineRecoveryTests/killedEngine'
}

ui_benchmarks() {
  make app-ui-test-pica UI_TESTS="LaunchPerformanceTests ComposerLatencyUITests \
    TimelineUITests/testATenThousandEventSessionOpensInUnder300Milliseconds \
    TimelineUITests/testScrollHitchTimeRatioIsUnderOnePercent \
    ReviewUITests/testA5000LineDiffRendersInUnder200Milliseconds ResourceBudgetUITests"
}

export_ui_measurements() {
  rm -rf "$perf_dir/ui" && mkdir -p "$perf_dir/ui"
  xcrun xcresulttool export attachments --path app/.derived/pica-ui-tests.xcresult --output-path "$perf_dir/ui" \
    --filter 'budget-*' >/dev/null
}

machine() {
  echo
  echo "Machine: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m), $(sysctl -n hw.ncpu 2>/dev/null) CPUs," \
    "$(($(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824)) GB, macOS $(sw_vers -productVersion 2>/dev/null)," \
    "Node $(node --version). Load averages $1."
}

load_before=$(sysctl -n vm.loadavg 2>/dev/null)
step engine-benchmarks engine_benchmarks
step app-package-benchmarks app_package_benchmarks
step ui-benchmarks ui_benchmarks
step export-ui-measurements export_ui_measurements
load_after=$(sysctl -n vm.loadavg 2>/dev/null)

report_status=0
node --experimental-strip-types --disable-warning=ExperimentalWarning engine/tools/perf-report/main.ts \
  tools/perf/budgets.json "$perf_dir" "$perf_dir/ui" || report_status=$?
notes=$(machine "before $load_before, after $load_after")
printf '%s\n' "$notes" | tee -a "$perf_dir/report.md"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$notes" >> "$GITHUB_STEP_SUMMARY"; fi

if [ -n "$failed" ]; then
  echo "perf: failed:$failed" >&2
  exit 1
fi
exit "$report_status"
