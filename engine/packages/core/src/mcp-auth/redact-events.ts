import type { EventDraft, EventLog } from "../events/index.ts";
import type { McpSecretRedactor } from "./redact.ts";

// An event log that redacts every string in a draft before it is stored or delivered, so a tool
// result or message that echoes a secret the engine handled never reaches an event or a row.
export function createRedactingEventLog(log: EventLog, redactor: McpSecretRedactor): EventLog {
  return {
    append: (sessionId, draft) => log.append(sessionId, redactDraft(draft, redactor)),
    subscribe: (sessionId, afterSeq, listener) => log.subscribe(sessionId, afterSeq, listener),
  };
}

function redactDraft(draft: EventDraft, redactor: McpSecretRedactor): EventDraft {
  // Redaction replaces strings with strings, so the draft keeps its type; `append` validates it again.
  return {
    ...draft,
    payload: redactDeep(draft.payload, redactor),
    timestamp: draft.timestamp,
  } as EventDraft;
}

export function redactDeep(value: unknown, redactor: McpSecretRedactor): unknown {
  if (typeof value === "string") {
    return redactor.redact(value);
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactDeep(item, redactor));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]: [string, unknown]) => [redactor.redact(key), redactDeep(item, redactor)]),
    );
  }
  return value;
}
