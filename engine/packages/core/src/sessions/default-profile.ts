import type { JsonObject, JsonValue } from "../json.ts";
import { isRoutingProfile } from "./info.ts";
import type { SessionRoutingProfile } from "./info.ts";

export interface DefaultProfileInputs {
  // `routing.profile` from the user config with the managed policy applied; `off` unless set (D-22).
  readonly configured: SessionRoutingProfile;
  // The managed policy locks `routing.profile`, so no workspace may override it.
  readonly locked: boolean;
  // The workspace layer's `routing` object, when the workspace has one.
  readonly workspaceRouting: JsonValue | undefined;
}

// The profile for a session created without one: the workspace's override, unless managed policy
// locks the key or the override is not a profile; else the configured one.
export function sessionDefaultProfile(inputs: DefaultProfileInputs): SessionRoutingProfile {
  const override = isJsonObject(inputs.workspaceRouting) ? inputs.workspaceRouting["profile"] : undefined;
  return !inputs.locked && typeof override === "string" && isRoutingProfile(override) ? override : inputs.configured;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
