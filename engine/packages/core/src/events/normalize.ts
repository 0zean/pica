import { eventPayloads } from "@pica/protocol";
import type { EventPayload, EventType } from "@pica/protocol";
import type { JsonObject, JsonValue } from "../json.ts";
import type { RuntimeEvent, RuntimeEventOf, RuntimeEventType } from "../runtime/index.ts";
import { checkPayload } from "./validate.ts";

// A runtime event as it arrives from an adapter: its `type` may be one Pica has never seen.
export interface IncomingRuntimeEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly type: string;
  readonly data: unknown;
}

export type EventDraftOf<T extends EventType> = {
  readonly type: T;
  readonly payload: EventPayload<T>;
  readonly timestamp: string;
};

export type EventDraft = { [T in EventType]: EventDraftOf<T> }[EventType];

export interface NormalizerContext {
  readonly sessionId: string;
  readonly rootAgent: string;
}

interface SubagentInfo {
  readonly name: string;
  readonly toolCallId: string;
  readonly startedAt: string;
}

interface ToolInfo {
  readonly toolName: string;
  readonly agent: string;
  readonly parentToolCallId: string | null;
}

// What the normalizer remembers between events: open sub-agents by agentId and open tool calls by
// toolCallId, so later events that carry only ids can name their agent and tool.
export interface NormalizerState {
  readonly subagents: ReadonlyMap<string, SubagentInfo>;
  readonly tools: ReadonlyMap<string, ToolInfo>;
  // Tool calls closed by an abort; the runtime may still report them completing.
  readonly interrupted: ReadonlySet<string>;
}

export interface Normalized {
  readonly state: NormalizerState;
  readonly drafts: readonly EventDraft[];
}

export const initialNormalizerState: NormalizerState = { subagents: new Map(), tools: new Map(), interrupted: new Set() };

export const resultPreviewChars = 2000;

type Handler<T extends RuntimeEventType> = (
  state: NormalizerState,
  event: RuntimeEventOf<T>,
  context: NormalizerContext,
) => Normalized;

type Handlers = { readonly [T in RuntimeEventType]: Handler<T> };

// Lifecycle events drive the session state machine, which emits `session.state_changed`.
const lifecycle = (state: NormalizerState): Normalized => ({ state, drafts: [] });

const handlers: Handlers = {
  "session.start": lifecycle,
  "session.resume": lifecycle,
  // No Pica event shows the session's model yet; the timeline takes it from `usage.recorded`.
  "session.model_change": lifecycle,
  "assistant.turn_start": lifecycle,
  "assistant.turn_end": lifecycle,
  "session.idle": lifecycle,
  "user.message": (state, event) =>
    emit(state, draft(event, "user.message", { text: event.data.content, mode: "send" })),
  "assistant.message_delta": (state, event, context) =>
    emit(
      state,
      draft(event, "assistant.delta", {
        messageId: event.data.messageId,
        agent: agentName(state, event.data.agentId, context),
        text: event.data.deltaContent,
      }),
    ),
  "assistant.message": (state, event, context) =>
    emit(
      state,
      draft(event, "assistant.message", {
        messageId: event.data.messageId,
        agent: agentName(state, event.data.agentId, context),
        text: event.data.content,
      }),
    ),
  "tool.execution_start": toolStarted,
  "tool.execution_complete": toolCompleted,
  "permission.requested": (state, event, context) =>
    emit(
      state,
      draft(event, "approval.requested", {
        id: event.data.requestId,
        sessionId: context.sessionId,
        kind: "tool_call",
        toolCallId: event.data.toolCallId,
        summary: event.data.reason ?? `${event.data.toolName} needs approval`,
      }),
    ),
  "permission.completed": (state, event) =>
    emit(
      state,
      draft(event, "approval.resolved", {
        approvalId: event.data.requestId,
        choice: event.data.approved ? "allow_once" : "deny",
      }),
    ),
  "subagent.started": subagentStarted,
  "subagent.completed": subagentCompleted,
  "subagent.failed": (state, event) =>
    emit(
      withoutSubagent(state, event.data.agentId),
      draft(event, "subagent.failed", {
        toolCallId: event.data.toolCallId,
        agent: event.data.agentName,
        error: event.data.error,
      }),
    ),
  "assistant.usage": (state, event, context) =>
    emit(
      state,
      draft(event, "usage.recorded", {
        sessionId: context.sessionId,
        agent: agentName(state, event.data.agentId, context),
        model: event.data.model,
        inputTokens: event.data.inputTokens,
        cachedInputTokens: event.data.cachedInputTokens,
        outputTokens: event.data.outputTokens,
        // The billed cost when the runtime reports one; otherwise the usage ledger prices the call
        // from token prices as the event is logged (core/src/usage).
        credits: event.data.billedCredits ?? 0,
        timestamp: event.timestamp,
        ...(event.data.agentId === undefined ? {} : { agentInstanceId: event.data.agentId }),
        ...(event.data.initiator === undefined ? {} : { initiator: event.data.initiator }),
        ...(event.data.premiumRequests === undefined ? {} : { premiumRequests: event.data.premiumRequests }),
      }),
    ),
  "session_limits_exhausted.requested": (state, event, context) =>
    emit(
      state,
      draft(event, "approval.requested", {
        id: event.data.requestId,
        sessionId: context.sessionId,
        kind: "budget",
        toolCallId: null,
        summary: `Session budget of ${String(event.data.maxAiCredits)} credits is used up`,
      }),
      draft(event, "budget.exhausted", {
        spentCredits: event.data.usedAiCredits,
        limitCredits: event.data.maxAiCredits,
        approvalId: event.data.requestId,
      }),
    ),
  "session_limits_exhausted.completed": (state, event) =>
    emit(
      state,
      draft(event, "approval.resolved", {
        approvalId: event.data.requestId,
        choice: event.data.maxAiCredits === null ? "deny" : "allow_once",
      }),
    ),
  "session.usage_info": (state, event) =>
    emit(
      state,
      draft(event, "context.usage", {
        currentTokens: event.data.currentTokens,
        tokenLimit: event.data.tokenLimit,
      }),
    ),
  "session.error": (state, event) =>
    emit(state, draft(event, "session.error", { code: event.data.code, message: event.data.message })),
  // The session service records `abort` itself with the reason it aborted for; this is the fallback.
  abort: (state, event) => {
    const interrupted = interruptOpen(state, event.timestamp);
    return emit(interrupted.state, ...interrupted.drafts, draft(event, "session.aborted", { reason: "user" }));
  },
};

// Maps one runtime event to the Pica events it stands for. Anything that cannot be mapped (an
// unknown type, or data that does not fit) becomes a single `runtime.unknown`, never an exception.
export function normalizeRuntimeEvent(
  state: NormalizerState,
  event: IncomingRuntimeEvent,
  context: NormalizerContext,
): Normalized {
  if (!isKnownType(event.type)) {
    return unknown(state, event);
  }
  let mapped: Normalized;
  try {
    mapped = runHandler(state, event as RuntimeEvent, context);
  } catch {
    return unknown(state, event);
  }
  const invalid = mapped.drafts.some(
    (candidate) => !checkPayload(eventPayloads[candidate.type], candidate.payload).ok,
  );
  return invalid ? unknown(state, event) : mapped;
}

function runHandler(state: NormalizerState, event: RuntimeEvent, context: NormalizerContext): Normalized {
  const handler = handlers[event.type] as Handler<typeof event.type>;
  return handler(state, event, context);
}

function isKnownType(type: string): type is RuntimeEventType {
  return Object.hasOwn(handlers, type);
}

function unknown(state: NormalizerState, event: IncomingRuntimeEvent): Normalized {
  return emit(state, {
    type: "runtime.unknown",
    payload: { runtimeType: event.type === "" ? "(empty)" : event.type, raw: event },
    timestamp: event.timestamp,
  });
}

function toolStarted(
  state: NormalizerState,
  event: RuntimeEventOf<"tool.execution_start">,
  context: NormalizerContext,
): Normalized {
  const info: ToolInfo = {
    toolName: event.data.toolName,
    agent: agentName(state, event.data.agentId, context),
    parentToolCallId: parentToolCall(state, event.data.agentId),
  };
  const args = event.data.arguments;
  const argumentsRecord = isJsonObject(args) ? args : { value: args };
  return emit(
    { ...state, tools: new Map(state.tools).set(event.data.toolCallId, info) },
    draft(event, "tool.started", { toolCallId: event.data.toolCallId, ...info, arguments: argumentsRecord }),
  );
}

function toolCompleted(state: NormalizerState, event: RuntimeEventOf<"tool.execution_complete">): Normalized {
  const { toolCallId, result } = event.data;
  const started = state.tools.get(toolCallId);
  if (started === undefined && state.interrupted.has(toolCallId)) {
    return emit(state);
  }
  if (started === undefined) {
    throw new Error(`tool call ${toolCallId} completed without starting`);
  }
  const tools = new Map(state.tools);
  tools.delete(toolCallId);
  const next = { ...state, tools };
  const call = { toolCallId, ...started };
  if (!event.data.success) {
    return emit(next, draft(event, "tool.failed", { ...call, error: result.content }));
  }
  return emit(
    next,
    draft(event, "tool.completed", {
      ...call,
      resultPreview: result.content.slice(0, resultPreviewChars),
      resultBytes: new TextEncoder().encode(result.content).byteLength,
      spilledArtifactPath: null,
    }),
  );
}

function subagentStarted(
  state: NormalizerState,
  event: RuntimeEventOf<"subagent.started">,
): Normalized {
  const { agentId, agentName: name, toolCallId, model } = event.data;
  const info: SubagentInfo = { name, toolCallId, startedAt: event.timestamp };
  return emit(
    { ...state, subagents: new Map(state.subagents).set(agentId, info) },
    draft(event, "subagent.started", { toolCallId, agent: name, model }),
  );
}

// After an abort the runtime still reports the interrupted sub-agent as completed (S-03); it was
// already closed as failed by `interruptOpen`, so a completion for an agent not open is dropped.
function subagentCompleted(state: NormalizerState, event: RuntimeEventOf<"subagent.completed">): Normalized {
  const { agentId, toolCallId, agentName: name, model, requestedModel, totalTokens } = event.data;
  const open = state.subagents.get(agentId);
  if (open === undefined) {
    return emit(state);
  }
  return emit(
    withoutSubagent(state, agentId),
    draft(event, "subagent.completed", {
      toolCallId,
      agent: name,
      model,
      ...(requestedModel === undefined ? {} : { requestedModel }),
      totalTokens,
      durationMs: elapsedMs(open.startedAt, event.timestamp),
    }),
  );
}

const interruptedError = "Interrupted: the turn was aborted";

// An abort ends the turn without completing its open tool calls or sub-agents (S-03); they are
// closed here as failed so the timeline does not show them running forever.
export function interruptOpen(state: NormalizerState, timestamp: string): Normalized {
  const at = { timestamp };
  const tools = [...state.tools].map(([toolCallId, info]) =>
    draft(at, "tool.failed", { toolCallId, ...info, error: interruptedError }),
  );
  const subagents = [...state.subagents.values()].map((info) =>
    draft(at, "subagent.failed", { toolCallId: info.toolCallId, agent: info.name, error: interruptedError }),
  );
  const interrupted = new Set([...state.interrupted, ...state.tools.keys()]);
  return { state: { subagents: new Map(), tools: new Map(), interrupted }, drafts: [...tools, ...subagents] };
}

function withoutSubagent(state: NormalizerState, agentId: string): NormalizerState {
  const subagents = new Map(state.subagents);
  subagents.delete(agentId);
  return { ...state, subagents };
}

// An agentId Pica never saw start is reported as itself rather than guessed.
function agentName(state: NormalizerState, agentId: string | undefined, context: NormalizerContext): string {
  if (agentId === undefined) {
    return context.rootAgent;
  }
  return state.subagents.get(agentId)?.name ?? agentId;
}

function parentToolCall(state: NormalizerState, agentId: string | undefined): string | null {
  return agentId === undefined ? null : (state.subagents.get(agentId)?.toolCallId ?? null);
}

function elapsedMs(from: string | undefined, to: string): number {
  if (from === undefined) {
    return 0;
  }
  const elapsed = Date.parse(to) - Date.parse(from);
  return Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0;
}

function draft<T extends EventType>(
  event: { readonly timestamp: string },
  type: T,
  payload: EventPayload<T>,
): EventDraftOf<T> {
  return { type, payload, timestamp: event.timestamp };
}

function emit(state: NormalizerState, ...drafts: readonly EventDraft[]): Normalized {
  return { state, drafts };
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
