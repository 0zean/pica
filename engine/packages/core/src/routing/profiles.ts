import type { PicaConfig } from "@pica/protocol";
import { builtinTools, type BuiltinTool } from "../agents/tool-catalog.ts";

export type RoutingProfileName = PicaConfig["routing"]["profile"];

export const routingProfileNames: readonly RoutingProfileName[] = ["off", "balanced", "strict"];

// Writes are routed by removing tools, not by denying calls (PLAN.md §5.4).
const mainAgentHides: Readonly<Record<RoutingProfileName, (tool: BuiltinTool) => boolean>> = {
  off: () => false,
  balanced: (tool) => tool.createsFiles === true,
  strict: (tool) => tool.kind === "write",
};

export function mainAgentTools(profile: RoutingProfileName): readonly string[] {
  const hides = mainAgentHides[profile];
  return builtinTools
    .filter((tool) => !hides(tool))
    .map((tool) => tool.name)
    .sort();
}
