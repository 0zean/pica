import { describe, expect, it } from "vitest";
import { createPathRanker } from "../../src/index.ts";
import { largeIndex, typedQueries } from "./large-index.ts";

// PLAN.md §9: quick open over 100,000 files answers in under 50 ms per keystroke. This measures the
// ranker alone; `packages/server/tests/files/quick-open-benchmark.test.ts` measures it over the socket.
const budgetMs = 50;

describe("quick-open ranking over 100,000 paths", () => {
  it("ranks every keystroke in under 50 ms", () => {
    const paths = largeIndex(100_000);
    createPathRanker(paths).rank("warm", 50);
    // Each query is typed three times, a fresh ranker each time; a keystroke's time is the median of
    // its three, so one garbage collection does not decide the result.
    const runs = [0, 1, 2].map(() => typeEach(createPathRanker(paths)));
    const timings = (runs[0] ?? []).map((timing, index) => ({
      query: timing.query,
      ms: median(runs.map((run) => run[index]?.ms ?? Number.POSITIVE_INFINITY)),
    }));
    const slowest = timings.reduce((worst, timing) => (timing.ms > worst.ms ? timing : worst));
    console.log(`slowest keystroke: ${slowest.ms.toFixed(1)} ms for "${slowest.query}" over ${String(timings.length)} keystrokes`);
    expect(slowest.ms).toBeLessThan(budgetMs);
  });
});

function typeEach(ranker: ReturnType<typeof createPathRanker>): readonly { readonly query: string; readonly ms: number }[] {
  const timings: { readonly query: string; readonly ms: number }[] = [];
  for (const typed of typedQueries) {
    for (let length = 1; length <= typed.length; length += 1) {
      const query = typed.slice(0, length);
      const started = performance.now();
      ranker.rank(query, 50);
      timings.push({ query, ms: performance.now() - started });
    }
  }
  return timings;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}
