import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/index.ts";
import type { ConfigFileLayer, ConfigLayerInput, ConfigLayerName, ResolvedConfig } from "../../src/index.ts";

const layers: readonly ConfigLayerName[] = ["default", "user", "workspace", "repo", "managed"];
const fileLayers: readonly ConfigFileLayer[] = ["user", "workspace", "repo", "managed"];
const keyPath = "routing.delegation.read.minBytes";
const defaultMinBytes = 32768;

const valueFor: Record<ConfigLayerName, number> = {
  default: defaultMinBytes,
  user: 1000,
  workspace: 2000,
  repo: 3000,
  managed: 4000,
};

function minBytesLayer(layer: ConfigFileLayer): ConfigLayerInput {
  return {
    layer,
    source: `${layer}.jsonc`,
    value: { routing: { delegation: { read: { minBytes: valueFor[layer] } } } },
  };
}

function resolve(inputs: readonly ConfigLayerInput[]): ResolvedConfig {
  const result = resolveConfig(inputs);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function inputsFor(layer: ConfigLayerName): ConfigLayerInput[] {
  return layer === "default" ? [] : [minBytesLayer(layer)];
}

const pairs = layers.flatMap((lower, index) => layers.slice(index + 1).map((higher) => ({ lower, higher })));

describe("config precedence", () => {
  it("covers all ten layer pairs", () => {
    expect(pairs).toHaveLength(10);
  });

  it.each(pairs)("$higher beats $lower", ({ lower, higher }) => {
    const inputs = [...inputsFor(lower), ...inputsFor(higher)];
    for (const order of [inputs, [...inputs].reverse()]) {
      const resolved = resolve(order);
      expect(resolved.config.routing.delegation.read.minBytes).toBe(valueFor[higher]);
      expect(resolved.values.get(keyPath)).toEqual({
        keyPath,
        value: valueFor[higher],
        layer: higher,
        locked: higher === "managed",
      });
    }
  });

  it.each(fileLayers)("a %s layer that does not set the key keeps the lower value", (layer) => {
    const resolved = resolve([{ layer, source: `${layer}.jsonc`, value: { budget: { sessionCredits: 5 } } }]);
    expect(resolved.values.get(keyPath)?.layer).toBe("default");
    expect(resolved.config.routing.delegation.read.minBytes).toBe(defaultMinBytes);
    expect(resolved.config.budget.sessionCredits).toBe(5);
  });

  it("a key locked by the managed layer ignores every other layer", () => {
    const inputs = fileLayers.map(minBytesLayer);
    for (const order of [inputs, [...inputs].reverse()]) {
      const resolved = resolve(order);
      expect(resolved.config.routing.delegation.read.minBytes).toBe(valueFor.managed);
      expect(resolved.values.get(keyPath)).toMatchObject({ layer: "managed", locked: true });
    }
  });

  it("locking one key leaves its siblings to the normal precedence", () => {
    const resolved = resolve([
      minBytesLayer("managed"),
      { layer: "repo", source: "repo.jsonc", value: { routing: { delegation: { read: { minBytes: 1, rangeExemptLines: 50 } } } } },
    ]);
    expect(resolved.config.routing.delegation.read).toEqual({ minBytes: valueFor.managed, rangeExemptLines: 50, exclude: [] });
    expect(resolved.values.get("routing.delegation.read.rangeExemptLines")).toEqual({
      keyPath: "routing.delegation.read.rangeExemptLines",
      value: 50,
      layer: "repo",
      locked: false,
    });
  });

  it("merges objects key by key across layers", () => {
    const resolved = resolve([
      { layer: "user", source: "user.jsonc", value: { routing: { tiers: { worker: "small-model" } } } },
      { layer: "repo", source: "repo.jsonc", value: { routing: { tiers: { reasoning: "big-model" } } } },
    ]);
    expect(resolved.config.routing.tiers).toEqual({ reasoning: "big-model", worker: "small-model" });
  });

  it("resolves the documented defaults with no layers", () => {
    const resolved = resolve([]);
    expect(resolved.config).toEqual({
      routing: {
        profile: "balanced",
        tiers: { reasoning: "auto", worker: "auto" },
        delegation: { read: { minBytes: 32768, rangeExemptLines: 400, exclude: [] }, output: { maxBytes: 16384 } },
      },
      budget: { sessionCredits: 300, workspaceDailyCredits: 3000 },
      permissions: { mode: "ask" },
    });
    expect([...resolved.values.values()].every((value) => value.layer === "default" && !value.locked)).toBe(true);
  });

  it("ignores $schema", () => {
    const resolved = resolve([{ layer: "user", source: "user.jsonc", value: { $schema: "./config.schema.json" } }]);
    expect(resolved.values.has("$schema")).toBe(false);
  });

  it("rejects an invalid layer naming its source and key path", () => {
    const result = resolveConfig([
      { layer: "workspace", source: "workspace:team", value: { permissions: { mode: "sometimes" }, budjet: {} } },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("config.invalid");
      expect(result.error.file).toBe("workspace:team");
      expect(result.error.issues.map((issue) => issue.keyPath).sort()).toEqual(["budjet", "permissions.mode"]);
    }
  });
});
