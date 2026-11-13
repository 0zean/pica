import type { McpScope, McpServerDef } from "@pica/protocol";

// Where a definition came from: Pica's own `mcp.jsonc`, or a file another tool owns.
export type McpSourceFormat = "pica" | "vscode" | "mcp-json" | "copilot-cli";

export interface McpLayerInput {
  readonly scope: McpScope;
  readonly format: McpSourceFormat;
  readonly source: string;
  readonly value: unknown;
  // Substituted for VS Code's `${workspaceFolder}` and `${userHome}`.
  readonly root?: string;
  readonly home?: string;
}

// One server entry in Pica's file shape, still unvalidated, with its key path in the source file.
export interface McpServerEntryInput {
  readonly id: string;
  readonly keyPath: readonly string[];
  readonly entry: Readonly<Record<string, unknown>>;
}

export interface McpImportNote {
  readonly source: string;
  readonly keyPath: string;
  readonly message: string;
}

export interface McpServerOrigin {
  readonly scope: McpScope;
  readonly format: McpSourceFormat;
  readonly source: string;
}

export interface ResolvedMcpServer {
  readonly definition: McpServerDef;
  readonly origin: McpServerOrigin;
  // Definitions with the same id in lower-precedence sources, highest first.
  readonly shadowed: readonly McpServerOrigin[];
}

export interface ResolvedMcpRegistry {
  // Sorted by id.
  readonly servers: readonly ResolvedMcpServer[];
  readonly notes: readonly McpImportNote[];
}
