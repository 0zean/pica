import type { McpRedactableLogger, McpSecretRedactor } from "../mcp-auth/index.ts";

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  readonly ts: string;
  readonly level: LogLevel;
  readonly component: string;
  readonly msg: string;
}

export interface StructuredLogOptions {
  // Receives one JSON object per call, without the trailing newline.
  readonly write: (line: string) => void;
  readonly clock: () => string;
  readonly redactor: McpSecretRedactor;
  // How many recent lines `recent()` keeps for the diagnostics bundle.
  readonly capacity?: number;
}

export interface StructuredLog {
  logger(component: string): McpRedactableLogger;
  recent(): readonly string[];
}

export const defaultRecentLogLines = 500;

// Engine logs as JSON lines: `{ts, level, component, msg}`. The message is scrubbed before it is
// written or kept, so neither the log file nor a diagnostics bundle sees a secret.
export function createStructuredLog(options: StructuredLogOptions): StructuredLog {
  const capacity = options.capacity ?? defaultRecentLogLines;
  const recent: string[] = [];
  const emit = (level: LogLevel, component: string, message: string): void => {
    const entry: LogEntry = { ts: options.clock(), level, component, msg: options.redactor.redact(message) };
    const line = JSON.stringify(entry);
    recent.push(line);
    if (recent.length > capacity) {
      recent.shift();
    }
    options.write(line);
  };
  return {
    logger: (component) => ({
      info: (message) => {
        emit("info", component, message);
      },
      warn: (message) => {
        emit("warn", component, message);
      },
      error: (message) => {
        emit("error", component, message);
      },
    }),
    recent: () => [...recent],
  };
}
