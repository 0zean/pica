import { buildConfigJsonSchema } from "@pica/protocol";
import { describe, expect, it } from "vitest";
import type { CatalogModel, ConfigFileLayer, JsonValue } from "../../src/index.ts";
import {
  attachMcpServers,
  decide,
  managedBudgetSettings,
  managedPolicyContext,
  resolveTiers,
  withinSessionCeiling,
} from "../../src/index.ts";
import { registry } from "../mcp-attach/helpers.ts";
import { baseContext, toolCall } from "../policy/fixtures.ts";
import { managedPolicy, resolveWithPolicy, userLayer } from "./helpers.ts";

// Every key of config.jsonc can be locked through the policy's `config` section. Each entry is a
// value a user layer sets and the different value the organization locks.
const configKeys: Readonly<Record<string, readonly [JsonValue, JsonValue]>> = {
  "routing.profile": ["off", "strict"],
  "routing.tiers.reasoning": ["user-model", "org-model"],
  "routing.tiers.worker": ["user-model", "org-model"],
  "routing.delegation.read.minBytes": [1, 2],
  "routing.delegation.read.rangeExemptLines": [1, 2],
  "routing.delegation.read.exclude": [["user/**"], ["org/**"]],
  "routing.delegation.output.maxBytes": [1, 2],
  "budget.sessionCredits": [1, 2],
  "budget.workspaceDailyCredits": [1, 2],
  "permissions.mode": ["auto", "ask"],
  "permissions.mcpTools": [[{ tool: "github/*", permission: "allow" }], [{ tool: "github/*", permission: "deny" }]],
  "hooks.sessionStart": [[{ command: "user-setup" }], [{ command: "org-setup" }]],
  "hooks.sessionEnd": [[], [{ command: "org-cleanup", timeoutSeconds: 10 }]],
  "hooks.beforeCommit": [[{ command: "true" }], [{ name: "secret scan", command: "org-scan" }]],
};

const nonManagedLayers: readonly ConfigFileLayer[] = ["user", "workspace", "repo"];

interface SchemaNode {
  readonly properties?: Readonly<Record<string, SchemaNode>>;
}

function schemaLeaves(node: SchemaNode, prefix: readonly string[]): string[] {
  if (node.properties === undefined) {
    return [prefix.join(".")];
  }
  return Object.entries(node.properties)
    .filter(([key]) => prefix.length > 0 || key !== "$schema")
    .flatMap(([key, child]) => schemaLeaves(child, [...prefix, key]));
}

function nested(keyPath: string, value: JsonValue): JsonValue {
  return keyPath
    .split(".")
    .reverse()
    .reduce<JsonValue>((inner, key) => ({ [key]: inner }), value);
}

function model(id: string, input: number, output: number): CatalogModel {
  return { id, name: id, prices: { input, cachedInput: input / 10, output }, priceSource: "table", contextWindow: null };
}

const models: readonly CatalogModel[] = [model("approved-large", 10, 30), model("approved-small", 1, 3), model("unapproved", 20, 60)];

describe("managed policy: user config is ignored for every lockable key", () => {
  it("covers every key of config.jsonc", () => {
    expect(Object.keys(configKeys).sort()).toEqual(schemaLeaves(buildConfigJsonSchema() as SchemaNode, []).sort());
  });

  const cases = Object.entries(configKeys).flatMap(([keyPath, [userValue, lockedValue]]) =>
    nonManagedLayers.map((layer) => ({ keyPath, layer, userValue, lockedValue })),
  );

  it.each(cases)("config.$keyPath ignores the $layer layer", ({ keyPath, layer, userValue, lockedValue }) => {
    const policy = managedPolicy({ config: nested(keyPath, lockedValue) });
    const resolved = resolveWithPolicy([{ layer, source: `${layer}.jsonc`, value: nested(keyPath, userValue) }], policy);
    expect(resolved.values.get(keyPath)).toEqual({ keyPath, value: lockedValue, layer: "managed", locked: true });
  });

  describe("models", () => {
    it("a tier the user points at a model off the allowlist does not get that model", () => {
      const policy = managedPolicy({ models: { allow: ["approved-large", "approved-small"] } });
      const resolved = resolveWithPolicy([userLayer({ routing: { tiers: { reasoning: "unapproved", worker: "unapproved" } } })], policy);
      expect(resolveTiers(resolved.config.routing.tiers, models, policy.models)).toEqual([
        { tier: "reasoning", setting: "unapproved", resolvedModelId: "approved-large", reason: "fallback_blocked" },
        { tier: "worker", setting: "unapproved", resolvedModelId: "approved-small", reason: "fallback_blocked" },
      ]);
    });

    it("a tier the user points at a denied model does not get that model", () => {
      const policy = managedPolicy({ models: { deny: ["approved-large"] } });
      const resolved = resolveWithPolicy([userLayer({ routing: { tiers: { reasoning: "approved-large" } } })], policy);
      expect(resolveTiers(resolved.config.routing.tiers, models, policy.models)[0]).toMatchObject({
        resolvedModelId: "unapproved",
        reason: "fallback_blocked",
      });
    });
  });

  describe("mcpServers", () => {
    const policy = managedPolicy({ id: "acme", mcpServers: { allow: [{ id: "github" }] } });

    it("a server from the user's MCP config cannot be attached", () => {
      const attached = attachMcpServers(registry, [], [{ serverId: "scripts", target: { kind: "session" }, tools: null }], policy.mcpAllowlist);
      expect(attached.ok ? [] : attached.error.issues.map((issue) => issue.policy)).toEqual(["managed:acme.mcp-servers"]);
    });

    it("a call to it is denied even when the user allows every tool in auto mode", () => {
      const resolved = resolveWithPolicy(
        [userLayer({ permissions: { mode: "auto", mcpTools: [{ tool: "scripts/*", permission: "allow" }] } })],
        policy,
      );
      const decision = decide(
        toolCall({ kind: "mcp", server: "scripts", tool: "run" }),
        baseContext({ config: resolved.config, ...managedPolicyContext(policy) }),
      );
      expect({ outcome: decision.outcome, ruleId: decision.ruleId }).toEqual({ outcome: "deny", ruleId: "managed:acme.mcp-servers" });
    });
  });

  describe("budget.maxSessionCredits", () => {
    const policy = managedPolicy({ budget: { maxSessionCredits: 50 } });

    it("caps the user's budget.sessionCredits", () => {
      const resolved = resolveWithPolicy([userLayer({ budget: { sessionCredits: 900 } })], policy);
      expect(resolved.config.budget.sessionCredits).toBe(50);
      expect(resolved.values.get("budget.sessionCredits")).toEqual({ keyPath: "budget.sessionCredits", value: 50, layer: "managed", locked: true });
    });

    it("keeps a user budget under the ceiling", () => {
      const resolved = resolveWithPolicy([userLayer({ budget: { sessionCredits: 20 } })], policy);
      expect(resolved.values.get("budget.sessionCredits")).toMatchObject({ value: 20, layer: "user", locked: false });
    });

    it("caps a per-session budget and a session with no budget", () => {
      const settings = managedBudgetSettings({ sessionCredits: 900 }, policy);
      expect(withinSessionCeiling(900, settings)).toBe(50);
      expect(withinSessionCeiling(undefined, settings)).toBe(50);
      expect(withinSessionCeiling(20, settings)).toBe(20);
    });
  });

  describe("budget.maxWorkspaceDailyCredits", () => {
    it("caps the user's budget.workspaceDailyCredits", () => {
      const policy = managedPolicy({ budget: { maxWorkspaceDailyCredits: 500 } });
      const resolved = resolveWithPolicy([userLayer({ budget: { workspaceDailyCredits: 10000 } })], policy);
      expect(resolved.config.budget.workspaceDailyCredits).toBe(500);
      expect(resolved.values.get("budget.workspaceDailyCredits")).toMatchObject({ value: 500, layer: "managed", locked: true });
    });
  });

  describe("permissions.minimumMode", () => {
    const policy = managedPolicy({ permissions: { minimumMode: "ask" } });

    it("raises the user's auto mode to ask", () => {
      const resolved = resolveWithPolicy([userLayer({ permissions: { mode: "auto" } })], policy);
      expect(resolved.config.permissions.mode).toBe("ask");
      expect(resolved.values.get("permissions.mode")).toEqual({ keyPath: "permissions.mode", value: "ask", layer: "managed", locked: true });
      const decision = decide(toolCall({ kind: "write", path: "/work/repo/a.ts" }), baseContext({ config: resolved.config }));
      expect(decision.outcome).toBe("ask");
    });

    it("leaves a mode that is already at least as strict", () => {
      const resolved = resolveWithPolicy([userLayer({ permissions: { mode: "ask" } })], managedPolicy({ permissions: { minimumMode: "auto" } }));
      expect(resolved.values.get("permissions.mode")).toMatchObject({ value: "ask", layer: "user", locked: false });
    });
  });

  describe("rules", () => {
    it("deny a call the user's config would allow", () => {
      const policy = managedPolicy({ id: "acme", rules: [{ id: "no-push", reason: "pushes go through CI", kinds: ["shell"], commandPattern: "^git push" }] });
      const resolved = resolveWithPolicy([userLayer({ permissions: { mode: "auto" } })], policy);
      const decision = decide(
        toolCall({ kind: "shell", command: "git push origin main", cwd: "/work/repo" }),
        baseContext({ config: resolved.config, ...managedPolicyContext(policy) }),
      );
      expect({ outcome: decision.outcome, ruleId: decision.ruleId, reason: decision.reason }).toEqual({
        outcome: "deny",
        ruleId: "managed:acme.no-push",
        reason: "pushes go through CI",
      });
    });
  });
});
