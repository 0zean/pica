import { describe, expect, it } from "vitest";
import { createPathRanker } from "../../src/index.ts";
import { keystrokeLimitMs, largeIndex, slowest, timeKeystrokes } from "./large-index.ts";

// PLAN.md §9: quick open over 100,000 files answers in under 50 ms per keystroke. This measures the
// ranker alone, in CPU time so a busy machine does not count against it;
// `packages/server/tests/files/quick-open-benchmark.test.ts` measures wall time over the socket.
describe("quick-open ranking over 100,000 paths", () => {
  it("ranks every keystroke in under 50 ms", async () => {
    const paths = largeIndex(100_000);
    // A fresh ranker per typing, as each repo listing gets one.
    const timings = await timeKeystrokes(() => {
      const ranker = createPathRanker(paths);
      return (query) => ranker.rank(query, 50);
    }, "cpu");
    const worst = slowest(timings);
    console.log(`slowest keystroke: ${worst.ms.toFixed(1)} ms for "${worst.query}" over ${String(timings.length)} keystrokes`);
    expect(worst.ms).toBeLessThan(keystrokeLimitMs());
  });
});
