// Replaces secret values the engine has handled with a marker before text reaches a log, event,
// status, or database row. `createSecretScrubber` (redaction/) adds patterns for values it never saw.
export interface McpSecretRedactor {
  remember(value: string): void;
  redact(text: string): string;
}

export const mcpRedactedText = "[redacted]";

// Shorter values would erase ordinary words; such secrets are not redacted (docs/mcp-secrets.md).
export const mcpRedactMinLength = 4;

export function createMcpSecretRedactor(): McpSecretRedactor {
  const values = new Set<string>();
  let pattern: RegExp | undefined;
  return {
    remember(value) {
      if (value.length < mcpRedactMinLength || values.has(value)) {
        return;
      }
      // Text often carries a secret serialized: inside a JSON string, or percent-encoded in a URL.
      for (const form of [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value)]) {
        values.add(form);
      }
      // One pass over the text, longest value first, so a replacement never forms a new match.
      const alternatives = [...values].sort((a, b) => b.length - a.length).map(escapeRegExp);
      pattern = new RegExp(alternatives.join("|"), "g");
    },
    redact(text) {
      return pattern === undefined ? text : text.replace(pattern, mcpRedactedText);
    },
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

// The server's `Logger` shape.
export interface McpRedactableLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// Passes every line through `redactor` first, so secrets the engine handled never reach the log.
export function createRedactingLogger(log: McpRedactableLogger, redactor: McpSecretRedactor): McpRedactableLogger {
  return {
    info: (message) => {
      log.info(redactor.redact(message));
    },
    warn: (message) => {
      log.warn(redactor.redact(message));
    },
    error: (message) => {
      log.error(redactor.redact(message));
    },
  };
}
