import { PicaConfig } from "@pica/protocol";
import type { JsonObject, JsonValue } from "../json.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import { configError } from "./errors.ts";
import type { ConfigError } from "./errors.ts";
import { validateLayer } from "./validate.ts";

export type ConfigLayerName = "default" | "user" | "workspace" | "repo" | "managed";
export type ConfigFileLayer = Exclude<ConfigLayerName, "default">;

// PLAN.md §4.6, lowest to highest. `managed` is not in the order: its keys are locked instead.
export const layerPrecedence: readonly ConfigLayerName[] = ["default", "user", "workspace", "repo"];

export interface ConfigLayerInput {
  readonly layer: ConfigFileLayer;
  readonly source: string;
  readonly value: unknown;
}

export interface ResolvedValue {
  readonly keyPath: string;
  readonly value: JsonValue;
  readonly layer: ConfigLayerName;
  readonly locked: boolean;
}

export interface ResolvedConfig {
  readonly config: PicaConfig;
  readonly values: ReadonlyMap<string, ResolvedValue>;
}

const schemaKey = "$schema";

export function resolveConfig(inputs: readonly ConfigLayerInput[]): Result<ResolvedConfig, ConfigError> {
  const values = new Map<string, ResolvedValue>();
  const defaults = PicaConfig.parse({}) as unknown as JsonObject;
  setLeaves(values, "default", false, defaults);

  const managed = inputs.filter((input) => input.layer === "managed");
  const ordered = [...inputs.filter((input) => input.layer !== "managed")].sort(
    (a, b) => layerPrecedence.indexOf(a.layer) - layerPrecedence.indexOf(b.layer),
  );
  for (const input of [...ordered, ...managed]) {
    const validated = validateLayer(input.source, input.value);
    if (!validated.ok) {
      return validated;
    }
    setLeaves(values, input.layer, input.layer === "managed", validated.value);
  }

  const merged = PicaConfig.safeParse(nest(values));
  if (!merged.success) {
    return err(configError("config.invalid", "(merged)", [{ keyPath: "", message: merged.error.message }]));
  }
  return ok({ config: merged.data, values });
}

function setLeaves(
  values: Map<string, ResolvedValue>,
  layer: ConfigLayerName,
  locked: boolean,
  object: JsonObject,
): void {
  for (const [keyPath, value] of leaves(object, [])) {
    if (values.get(keyPath)?.locked !== true) {
      values.set(keyPath, { keyPath, value, layer, locked });
    }
  }
}

function leaves(object: JsonObject, prefix: readonly string[]): [string, JsonValue][] {
  const found: [string, JsonValue][] = [];
  for (const [key, value] of Object.entries(object)) {
    if (prefix.length === 0 && key === schemaKey) {
      continue;
    }
    const path = [...prefix, key];
    if (isObject(value)) {
      found.push(...leaves(value, path));
    } else {
      found.push([path.join("."), value]);
    }
  }
  return found;
}

function nest(values: ReadonlyMap<string, ResolvedValue>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const { keyPath, value } of values.values()) {
    const keys = keyPath.split(".");
    const last = keys.pop() ?? "";
    let node = root;
    for (const key of keys) {
      const child = node[key];
      const next: Record<string, unknown> = isRecord(child) ? child : {};
      node[key] = next;
      node = next;
    }
    node[last] = value;
  }
  return root;
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
