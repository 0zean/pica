import { describe, expect, it } from "vitest";
import type { ToolPermissionRule } from "@pica/protocol";
import { matchingRule, requestSubject, ruleFor } from "../../src/index.ts";

const allowTest: ToolPermissionRule = { tool: "bash", match: "npm test", permission: "allow" };
const denyTest: ToolPermissionRule = { tool: "bash", match: "npm test", permission: "deny" };
const allowBash: ToolPermissionRule = { tool: "bash", permission: "allow" };
const denyBash: ToolPermissionRule = { tool: "bash", permission: "deny" };

describe("A-07 permission rules", () => {
  it.each([
    ["a command", { command: "npm test", description: "Run" }, "npm test"],
    ["a path", { path: "src/a.ts", old_str: "x", new_str: "y" }, "src/a.ts"],
    ["a url", { url: "https://example.com" }, "https://example.com"],
    ["command before path", { command: "ls", path: "src" }, "ls"],
    ["no subject", { query: "x" }, undefined],
    ["an empty command", { command: "" }, undefined],
    ["not an object", ["npm test"], undefined],
    ["null", null, undefined],
  ])("the subject of a call with %s", (_name, args, subject) => {
    expect(requestSubject(args)).toBe(subject);
  });

  it("derives the rule always allow writes", () => {
    expect(ruleFor("bash", { command: "npm test" }, "allow")).toEqual(allowTest);
    expect(ruleFor("fetch", { query: "x" }, "allow")).toEqual({ tool: "fetch", permission: "allow" });
  });

  it.each<[string, ToolPermissionRule[], string, unknown, ToolPermissionRule | undefined]>([
    ["no rules", [], "bash", { command: "npm test" }, undefined],
    ["an identical request", [allowTest], "bash", { command: "npm test" }, allowTest],
    ["another command", [allowTest], "bash", { command: "npm run lint" }, undefined],
    ["another tool", [allowTest], "edit", { path: "npm test" }, undefined],
    ["a call without a subject", [allowTest], "bash", {}, undefined],
    ["a tool-wide rule", [allowBash], "bash", { command: "anything" }, allowBash],
    ["exact beats tool-wide", [denyBash, allowTest], "bash", { command: "npm test" }, allowTest],
    ["deny beats allow at one level", [allowTest, denyTest], "bash", { command: "npm test" }, denyTest],
    ["tool-wide deny beats tool-wide allow", [allowBash, denyBash], "bash", { command: "x" }, denyBash],
  ])("%s", (_name, rules, tool, args, expected) => {
    expect(matchingRule(rules, tool, args as never)).toEqual(expected);
  });
});
