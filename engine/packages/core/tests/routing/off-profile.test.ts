import { describe, expect, it } from "vitest";
import { decide, type PolicyContext } from "../../src/index.ts";
import { groups } from "../policy/cases.ts";
import { baseContext } from "../policy/fixtures.ts";

const cases = Object.values(groups).flat();

function withProfile(context: PolicyContext, profile: PolicyContext["config"]["routing"]["profile"]): PolicyContext {
  const { config } = context;
  return { ...context, config: { ...config, routing: { ...config.routing, profile } } };
}

describe("profile off", () => {
  it("leaves cost gates firing in some C-03 cases under their own profile, so the check below is not vacuous", () => {
    const gated = cases.filter(({ call, context }) => decide(call, baseContext(context)).ruleGroup === "cost");
    expect(gated.length).toBeGreaterThan(0);
  });

  it.each(cases)("fires no cost gate: $name", ({ call, context }) => {
    const decision = decide(call, withProfile(baseContext(context), "off"));
    expect(decision.ruleGroup).not.toBe("cost");
  });
});
