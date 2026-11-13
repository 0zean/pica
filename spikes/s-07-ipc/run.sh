#!/bin/sh
# S-07 spike runner. Usage: spikes/s-07-ipc/run.sh order|latency|report
#   order    50,000 paced events arrive in order, none dropped, at >= 20,000 events/s.
#   latency  median p99 write-to-decoded across 3 paced runs is under 5 ms. One run's tail
#            is at the mercy of the scheduler on a busy machine (see docs/spikes/S-07.md).
#   report   prints summaries for the paced run and an unpaced burst (no assertions).
# Exits 0 only when the chosen assertions hold.
set -eu

cd "$(dirname "$0")"
check="${1:-}"
count=50000
paced_rate=25000

case "$check" in
  order|latency|report) ;;
  *) echo "usage: $0 order|latency|report" >&2; exit 2 ;;
esac

swift build -c release --package-path client >/dev/null
client="$(swift build -c release --package-path client --show-bin-path)/S07Client"

workdir=$(mktemp -d)
socket="$workdir/s07.sock"
node server.mjs "$socket" &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; rm -rf "$workdir"' EXIT

run() {
  "$client" "$socket" "$count" "$1" "$2"
}

assert() {
  summary="$1"
  expression="$2"
  message="$3"
  if echo "$summary" | jq -e "$expression" >/dev/null; then
    echo "ok: $message"
  else
    echo "FAIL: $message" >&2
    return 1
  fi
}

if [ "$check" = report ]; then
  run "$paced_rate" "paced-$paced_rate" | jq .
  run 0 unpaced | jq .
  exit 0
fi

if [ "$check" = order ]; then
  summary=$(run "$paced_rate" "paced-$paced_rate")
  echo "$summary"
  assert "$summary" ".received == $count and .serverSent == $count" "all $count events received"
  assert "$summary" '.inOrder and .gaps == 0 and .outOfOrder == 0' "events in seq order with no gaps"
  assert "$summary" '.eventsPerSecond >= 20000' "receive rate >= 20,000 events/s"
  exit 0
fi

summaries=""
for trial in 1 2 3; do
  summary=$(run "$paced_rate" "paced-$paced_rate-trial-$trial")
  echo "$summary"
  assert "$summary" '(.clockOffsetNs | fabs) < 1000000' "trial $trial: server and client share a monotonic clock (offset < 1 ms)"
  assert "$summary" ".received == $count" "trial $trial: latency measured over all $count events"
  summaries="$summaries$summary"
done
combined=$(echo "$summaries" | jq -s '{p99s: [.[].latencyMs.p99], medianP99: ([.[].latencyMs.p99] | sort | .[1])}')
echo "$combined" | jq -c .
assert "$combined" '.medianP99 < 5' "median p99 write-to-decoded across 3 runs < 5 ms"
