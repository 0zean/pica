import { describe, expect, it } from "vitest";
import { decide, patchCreatedPaths, patchText } from "../../src/index.ts";
import { auto } from "./cases.ts";
import { baseContext, policyConfig, toolCall, writeRoot } from "./fixtures.ts";

const update = "*** Begin Patch\n*** Update File: src/a.mjs\n@@\n-console.log(x)\n+logger.info(x)\n*** End Patch\n";
const add = "*** Begin Patch\n*** Add File: test/a.test.mjs\n+import assert from 'node:assert';\n*** End Patch\n";
const move = "*** Begin Patch\n*** Update File: src/a.mjs\n*** Move to: src/b.mjs\n@@\n-x\n+y\n*** End Patch\n";

// C-11: under `balanced` the main agent keeps `apply_patch` for edits; a patch that creates a file is denied.
describe("patch text", () => {
  it("reads the raw hook string and the event log's { value } form", () => {
    expect(patchText(add)).toBe(add);
    expect(patchText({ value: add })).toBe(add);
    expect(patchText({ path: "x" })).toBeUndefined();
    expect(patchText(["x"])).toBeUndefined();
    expect(patchText(null)).toBeUndefined();
  });

  it("finds the paths a patch adds or moves to, and none in a plain update", () => {
    expect(patchCreatedPaths(update)).toEqual([]);
    expect(patchCreatedPaths(add)).toEqual(["test/a.test.mjs"]);
    expect(patchCreatedPaths(move)).toEqual(["src/b.mjs"]);
    expect(patchCreatedPaths(`${update}${add.replace("test/a", "test/b")}\r\n`)).toEqual(["test/b.test.mjs"]);
  });
});

describe("cost.patch-add-file", () => {
  const creates = toolCall({ kind: "write", path: `${writeRoot}/test/a.test.mjs`, creates: true }, { tool: "apply_patch" });

  it("denies a main-agent file creation under balanced and strict, naming code-writer", () => {
    for (const profile of ["balanced", "strict"] as const) {
      const decision = decide(creates, baseContext({ config: policyConfig({ permissions: { mode: "auto" }, routing: { profile } }) }));
      expect(decision).toMatchObject({ outcome: "deny", ruleId: "cost.patch-add-file", ruleGroup: "cost" });
      expect(decision.reason).toContain("code-writer");
      expect(decision.reason).toContain("test/a.test.mjs");
      expect(decision.reason).toContain("*** Add File");
    }
  });

  it("leaves off, sub-agents and in-place writes alone", () => {
    const off = baseContext({ config: policyConfig({ permissions: { mode: "auto" }, routing: { profile: "off" } }) });
    expect(decide(creates, off).ruleId).not.toBe("cost.patch-add-file");
    expect(decide({ ...creates, agent: "code-writer" }, baseContext(auto)).ruleId).not.toBe("cost.patch-add-file");
    const edit = toolCall({ kind: "write", path: `${writeRoot}/src/a.mjs` }, { tool: "apply_patch" });
    expect(decide(edit, baseContext(auto)).outcome).toBe("allow");
  });
});
