import type { McpServerDef } from "@pica/protocol";
import type { McpServerLaunch } from "../mcp-auth/resolve-secrets.ts";
import type { McpToolDefinition } from "../mcp-attach/types.ts";
import type { Result } from "../result.ts";

// `auth`: the server refused our credentials (HTTP 401/403, or no usable token). `exited`: the
// connection or process ended. Messages never contain secret values.
export type McpProbeFailureKind = "auth" | "unreachable" | "exited" | "protocol" | "timeout";

export interface McpProbeFailure {
  readonly kind: McpProbeFailureKind;
  readonly message: string;
}

export interface McpConnection {
  // Every page of `tools/list`.
  listTools(): Promise<Result<readonly McpToolDefinition[], McpProbeFailure>>;
  close(): Promise<void>;
}

// Called at most once, when the connection ends without `close()`: a stdio process exiting, or a
// stream dropping.
export type McpExitListener = (reason: string) => void;

export interface McpConnector {
  connect(definition: McpServerDef, onExit: McpExitListener): Promise<Result<McpConnection, McpProbeFailure>>;
}

// The adapter side of `McpConnector`: it receives the definition with secrets already substituted.
export interface McpLaunchConnector {
  connect(launch: McpServerLaunch, onExit: McpExitListener): Promise<Result<McpConnection, McpProbeFailure>>;
}

export type McpCancelTimer = () => void;

// Injected so backoff, timeouts, and periodic checks run on a fake clock in tests.
export interface McpHealthClock {
  // Milliseconds since the epoch.
  now(): number;
  setTimer(delayMs: number, run: () => void): McpCancelTimer;
}
