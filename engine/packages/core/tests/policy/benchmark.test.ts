import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide } from "../../src/index.ts";
import { contextArbitrary, toolCallArbitrary } from "./arbitraries.ts";
import { baseContext } from "./fixtures.ts";

// PLAN.md §9: policy decision p99 < 1 ms. Inputs are seeded so every run measures the same work.
const budgetMs = 1;
const warmup = 2_000;
const samples = 20_000;

describe("decide benchmark", () => {
  it("decides at p99 under 1 ms", () => {
    const managedRules = Array.from({ length: 20 }, (_, index) => ({
      id: `rule-${String(index)}`,
      reason: "managed",
      kinds: ["shell" as const],
      commandPattern: new RegExp(`forbidden-${String(index)}`),
      pathPrefixes: ["/work/repo/secrets"],
    }));
    const realistic = { ...baseContext(), managed: managedRules };
    const inputs = fc
      .sample(fc.tuple(toolCallArbitrary, contextArbitrary), { numRuns: 1_000, seed: 9 })
      .map(([call, context], index) => ({ call, context: index % 2 === 0 ? realistic : context }));

    const timings: number[] = [];
    for (let index = 0; index < warmup + samples; index += 1) {
      const input = inputs[index % inputs.length];
      if (input === undefined) {
        throw new Error("no input");
      }
      const start = performance.now();
      decide(input.call, input.context);
      const elapsed = performance.now() - start;
      if (index >= warmup) {
        timings.push(elapsed);
      }
    }

    timings.sort((a, b) => a - b);
    const p99 = timings[Math.floor(samples * 0.99)] ?? Number.POSITIVE_INFINITY;
    expect(p99).toBeLessThan(budgetMs);
  });
});
