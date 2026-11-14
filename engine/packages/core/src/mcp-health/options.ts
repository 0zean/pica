// Defaults and the restart schedule are described in docs/mcp-health.md.
export interface McpRestartPolicy {
  // Restarts tried after a crash before the server is marked `failed`.
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly multiplier: number;
  // A connection that lived this long counts as stable and resets the attempt count.
  readonly stableAfterMs: number;
}

export interface McpHealthOptions {
  // A `tools/list` slower than this marks the server `degraded`.
  readonly slowMs: number;
  readonly timeoutMs: number;
  readonly checkIntervalMs: number;
  readonly restart: McpRestartPolicy;
}

export type McpHealthOptionsInput = Partial<Omit<McpHealthOptions, "restart">> & {
  readonly restart?: Partial<McpRestartPolicy>;
};

export const defaultMcpHealthOptions: McpHealthOptions = {
  slowMs: 2_000,
  timeoutMs: 15_000,
  checkIntervalMs: 60_000,
  restart: { maxAttempts: 5, initialDelayMs: 1_000, maxDelayMs: 30_000, multiplier: 2, stableAfterMs: 60_000 },
};

export function mcpHealthOptions(input: McpHealthOptionsInput = {}): McpHealthOptions {
  return {
    slowMs: input.slowMs ?? defaultMcpHealthOptions.slowMs,
    timeoutMs: input.timeoutMs ?? defaultMcpHealthOptions.timeoutMs,
    checkIntervalMs: input.checkIntervalMs ?? defaultMcpHealthOptions.checkIntervalMs,
    restart: { ...defaultMcpHealthOptions.restart, ...input.restart },
  };
}

// `attempt` counts from 1.
export function mcpRestartDelayMs(policy: McpRestartPolicy, attempt: number): number {
  return Math.min(policy.maxDelayMs, policy.initialDelayMs * policy.multiplier ** (attempt - 1));
}
