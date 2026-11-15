import { createMcpImportFiles } from "@pica/adapters";
import { createMcpImportService } from "@pica/core";
import type { EngineMcpImportOptions } from "./engine.ts";

// The production MCP import (M-07): platform files under the user's home directory, written to
// Pica's own `mcp.jsonc`. Repo ids resolve through workspaces once `picad` composes them.
export function mcpImportOptions(homeDir: string): EngineMcpImportOptions {
  return { service: createMcpImportService({ files: createMcpImportFiles({ homeDir }), home: homeDir }) };
}
