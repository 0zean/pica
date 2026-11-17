import type { PicaConfig } from "@pica/protocol";
import { builtinTools, type BuiltinTool } from "../agents/tool-catalog.ts";

export type RoutingProfileName = PicaConfig["routing"]["profile"];

export const routingProfileNames: readonly RoutingProfileName[] = ["off", "balanced", "strict"];

// Writes are routed by removing tools (PLAN.md §5.4). The exception is a tool whose created files the
// engine can see: `balanced` keeps `apply_patch` for edits and denies a patch that creates a file
// (`cost.patch-add-file`, D-23), since without it the main agent edits with `sed -i` and scripts.
const mainAgentHides: Readonly<Record<RoutingProfileName, (tool: BuiltinTool) => boolean>> = {
  off: () => false,
  balanced: (tool) => tool.createsFiles === true && tool.createsGated !== true,
  strict: (tool) => tool.kind === "write",
};

export function mainAgentTools(profile: RoutingProfileName): readonly string[] {
  const hides = mainAgentHides[profile];
  return builtinTools
    .filter((tool) => !hides(tool))
    .map((tool) => tool.name)
    .sort();
}
