import type { ConfigError } from "../config/errors.ts";
import { resolveConfig, type ConfigLayerInput, type ResolvedConfig } from "../config/resolve.ts";
import type { Result } from "../result.ts";
import type { Workspace } from "../store/entities.ts";

export function workspaceConfigLayer(workspace: Workspace): ConfigLayerInput {
  return { layer: "workspace", source: `workspace:${workspace.id}`, value: workspace.settingsOverrides };
}

// The workspace's overrides take the workspace slot of E-04 (above user, below repo, under managed
// locks); any other workspace layer in `layers` is replaced by them.
export function resolveWorkspaceConfig(
  workspace: Workspace,
  layers: readonly ConfigLayerInput[],
): Result<ResolvedConfig, ConfigError> {
  return resolveConfig([...layers.filter((input) => input.layer !== "workspace"), workspaceConfigLayer(workspace)]);
}
