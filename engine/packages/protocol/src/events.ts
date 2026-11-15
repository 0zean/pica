import * as z from "zod";
import { Count, Credits, Id, Seq, Timestamp } from "./common.ts";
import { PolicyDecision, ApprovalChoice, ApprovalRequest } from "./dto/policy.ts";
import { SessionState } from "./dto/session.ts";
import { UsageRecord } from "./dto/usage.ts";

const ToolCall = z.object({
  toolCallId: Id,
  toolName: z.string().min(1),
  agent: z.string().min(1),
  parentToolCallId: Id.nullable(),
});

// Payload per event type. `type` values are stable; adding one is a minor protocol bump.
//
// Versioning: a type's payload only ever gains optional fields. An incompatible change gets a new
// type name instead, so every event already in a session log still parses with the current schemas
// and replay needs no per-event version field.
export const eventPayloads = {
  "session.state_changed": z.object({ from: SessionState.nullable(), to: SessionState }),
  "user.message": z.object({ text: z.string(), mode: z.enum(["send", "steer", "queue"]) }),
  "assistant.delta": z.object({ messageId: Id, agent: z.string().min(1), text: z.string() }),
  "assistant.message": z.object({ messageId: Id, agent: z.string().min(1), text: z.string() }),
  "tool.started": ToolCall.extend({ arguments: z.record(z.string(), z.unknown()) }),
  "tool.completed": ToolCall.extend({
    resultPreview: z.string(),
    resultBytes: Count,
    spilledArtifactPath: z.string().nullable(),
  }),
  "tool.failed": ToolCall.extend({ error: z.string() }),
  // `model` on `subagent.started` is the one requested; the runtime may run another (S-03).
  "subagent.started": z.object({ toolCallId: Id, agent: z.string().min(1), model: Id }),
  // `model` is the one the sub-agent ran on; `requestedModel` is set when that differs (S-03).
  "subagent.completed": z.object({
    toolCallId: Id,
    agent: z.string().min(1),
    model: Id,
    requestedModel: Id.optional(),
    totalTokens: Count,
    durationMs: Count,
  }),
  "subagent.failed": z.object({ toolCallId: Id, agent: z.string().min(1), error: z.string() }),
  "policy.decision": PolicyDecision,
  "approval.requested": ApprovalRequest,
  "approval.resolved": z.object({ approvalId: Id, choice: ApprovalChoice }),
  "usage.recorded": UsageRecord,
  "context.usage": z.object({ currentTokens: Count, tokenLimit: Count }),
  "budget.warning": z.object({ spentCredits: Credits, limitCredits: Credits }),
  "budget.exhausted": z.object({ spentCredits: Credits, limitCredits: Credits, approvalId: Id }),
  "session.aborted": z.object({ reason: z.enum(["user", "budget", "engine"]) }),
  "session.error": z.object({ code: z.string().min(1), message: z.string() }),
  "runtime.unknown": z.object({ runtimeType: z.string().min(1), raw: z.unknown() }),
} as const;

export type EventType = keyof typeof eventPayloads;
export const eventTypes = Object.keys(eventPayloads) as EventType[];

export type EventPayload<T extends EventType> = z.output<(typeof eventPayloads)[T]>;

export interface SessionEventOf<T extends EventType> {
  readonly sessionId: string;
  readonly seq: number;
  readonly timestamp: string;
  readonly type: T;
  readonly payload: EventPayload<T>;
}

export type SessionEvent = { [T in EventType]: SessionEventOf<T> }[EventType];

function eventVariant<T extends EventType>(type: T) {
  return z.object({
    sessionId: Id,
    seq: Seq,
    timestamp: Timestamp,
    type: z.literal(type),
    payload: eventPayloads[type],
  });
}

export const eventSchemas = Object.fromEntries(
  eventTypes.map((type) => [type, eventVariant(type)]),
) as { [T in EventType]: ReturnType<typeof eventVariant<T>> };

export const SessionEvent = z.discriminatedUnion(
  "type",
  eventTypes.map((type) => eventSchemas[type]) as [
    ReturnType<typeof eventVariant>,
    ...ReturnType<typeof eventVariant>[],
  ],
);
