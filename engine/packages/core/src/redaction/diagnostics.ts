import type { EventType, SessionEvent } from "@pica/protocol";
import type { JsonObject, JsonValue } from "../json.ts";
import { scrubSecrets, scrubSecretsDeep } from "./scrub.ts";

// Event fields that carry what the user, the model, or a tool wrote: prompts, replies, tool
// arguments and results. They can hold file contents, so a bundle records only their size.
const contentFields: { readonly [T in EventType]?: readonly string[] } = {
  "user.message": ["text"],
  "assistant.delta": ["text"],
  "assistant.message": ["text"],
  "tool.started": ["arguments"],
  "tool.completed": ["resultPreview"],
  "tool.failed": ["error"],
  "runtime.unknown": ["raw"],
};

export interface DiagnosticsSessionInput {
  // The session's DTO or any JSON summary of it; it is scrubbed, not filtered.
  readonly session: JsonObject;
  readonly events: readonly SessionEvent[];
}

export interface DiagnosticsInput {
  readonly generatedAt: string;
  readonly environment: JsonObject;
  readonly config: JsonValue;
  readonly sessions: readonly DiagnosticsSessionInput[];
  readonly logs: readonly string[];
}

export interface DiagnosticsEvent {
  readonly seq: number;
  readonly type: EventType;
  readonly timestamp: string;
  readonly payload: JsonObject;
}

export interface DiagnosticsSession {
  readonly session: JsonValue;
  readonly events: readonly DiagnosticsEvent[];
}

export interface DiagnosticsBundle {
  readonly format: "pica-diagnostics";
  readonly version: 1;
  readonly generatedAt: string;
  readonly environment: JsonValue;
  readonly config: JsonValue;
  readonly sessions: readonly DiagnosticsSession[];
  readonly logs: readonly string[];
}

export const diagnosticsBundleVersion = 1;

// The bundle a user attaches to a bug report: everything is scrubbed of secrets, and no event
// field that can hold file contents is copied. H-04 adds the engine's own state to the input.
export function buildDiagnosticsBundle(input: DiagnosticsInput): DiagnosticsBundle {
  return {
    format: "pica-diagnostics",
    version: diagnosticsBundleVersion,
    generatedAt: input.generatedAt,
    environment: scrubSecretsDeep(input.environment),
    config: scrubSecretsDeep(input.config),
    sessions: input.sessions.map((entry) => ({
      session: scrubSecretsDeep(entry.session),
      events: entry.events.map(diagnosticsEvent),
    })),
    logs: input.logs.map(scrubSecrets),
  };
}

function diagnosticsEvent(event: SessionEvent): DiagnosticsEvent {
  const omit = contentFields[event.type] ?? [];
  const payload: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries<unknown>(event.payload)) {
    payload[key] = omit.includes(key) ? omitted(value) : scrubSecretsDeep(value);
  }
  return { seq: event.seq, type: event.type, timestamp: event.timestamp, payload };
}

// `{ omitted: "content", chars }`; for an object such as tool arguments, also its key names, which
// say what was passed but not what it was.
function omitted(value: unknown): JsonObject {
  const chars = typeof value === "string" ? value.length : value === undefined ? 0 : JSON.stringify(value).length;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { omitted: "content", chars, keys: Object.keys(value).map(scrubSecrets) };
  }
  return { omitted: "content", chars };
}
