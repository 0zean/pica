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
  "subagent.started": z.object({ toolCallId: Id, agent: z.string().min(1), model: Id }),
  "subagent.completed": z.object({
    toolCallId: Id,
    agent: z.string().min(1),
    model: Id,
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
