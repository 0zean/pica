import type { ConfigResult, ConfigWatch } from "../config/port.ts";
import type { ResolvedMcpRegistry } from "./types.ts";

export interface McpRegistryLoader {
  load(): ConfigResult<ResolvedMcpRegistry>;
  // Called with the reloaded registry, or the error, each time a watched file changes.
  watch(onChange: (result: ConfigResult<ResolvedMcpRegistry>) => void): ConfigWatch;
}
