import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decide } from "../../src/index.ts";
import { contextArbitrary, managedRuleArbitrary, toolCallArbitrary } from "./arbitraries.ts";

const runs = { numRuns: 5000, seed: 3003 };

describe("managed deny", () => {
  it("is never overridden when a managed rule matches the call", () => {
    fc.assert(
      fc.property(toolCallArbitrary, contextArbitrary, fc.nat(), (call, context, position) => {
        const catchAll = { id: "lock", reason: "locked" };
        const managed = [...context.managed];
        managed.splice(position % (managed.length + 1), 0, catchAll);
        const decision = decide(call, { ...context, managed });
        expect(decision.outcome).toBe("deny");
        expect(decision.ruleGroup).toBe("managed");
      }),
      runs,
    );
  });

  it("stays deny whatever the rest of the context or the call's result", () => {
    fc.assert(
      fc.property(
        toolCallArbitrary,
        contextArbitrary,
        contextArbitrary,
        fc.option(fc.nat({ max: 1_000_000 }), { nil: undefined }),
        (call, context, other, resultBytes) => {
          const first = decide(call, context);
          fc.pre(first.ruleGroup === "managed");
          const changedCall = resultBytes === undefined ? call : { ...call, result: { bytes: resultBytes } };
          const second = decide(changedCall, { ...other, cwd: context.cwd, managed: context.managed });
          expect(first.outcome).toBe("deny");
          expect(second).toMatchObject({ outcome: "deny", ruleId: first.ruleId });
        },
      ),
      runs,
    );
  });

  it("is produced by generated managed rules often enough to exercise the property", () => {
    const sample = fc.sample(fc.tuple(toolCallArbitrary, contextArbitrary, managedRuleArbitrary), { numRuns: 2000, seed: 3003 });
    const managedDenials = sample.filter(([call, context, rule]) => decide(call, { ...context, managed: [rule] }).ruleGroup === "managed");
    expect(managedDenials.length).toBeGreaterThan(500);
  });
});
