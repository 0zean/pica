import type { JsonValue, RuntimeEvent, RuntimeEventDataMap, RuntimeEventType, ToolResult } from "@pica/core";
import type { SessionEvent } from "@github/copilot-sdk";
import { classifyError } from "./errors.ts";

// One AI credit is 10^9 nano-AIU (S-03: the sum matches `getMetrics` to the nano-AIU).
const nanoAiuPerCredit = 1_000_000_000;

export interface EventContext {
  readonly sessionId: string;
  readonly workingDirectory: string;
  modifiedResult(toolCallId: string): ToolResult | undefined;
  deniedReason(toolCallId: string): string | undefined;
}

// Maps one SDK session event to the runtime event the port promises, or `undefined` for the many
// SDK events the port does not model.
//
// Sub-agents: every event from inside a sub-agent carries its id in the envelope `agentId`, and so
// do its `subagent.*` events (S-02). The `task` call id is used only when the envelope has none.
export function toRuntimeEvent(event: SessionEvent, context: EventContext): RuntimeEvent | undefined {
  const scope = event.agentId === undefined || event.agentId === "" ? {} : { agentId: event.agentId };
  switch (event.type) {
    case "session.start":
      return wrap(event, "session.start", {
        sessionId: event.data.sessionId,
        model: event.data.selectedModel ?? "",
        workingDirectory: event.data.context?.cwd ?? context.workingDirectory,
      });
    case "session.resume":
      return wrap(event, "session.resume", { sessionId: context.sessionId });
    case "session.model_change":
      return wrap(event, "session.model_change", { model: event.data.newModel });
    case "user.message":
      return wrap(event, "user.message", { messageId: event.data.messageId ?? event.id, content: event.data.content });
    case "assistant.turn_start":
      return wrap(event, "assistant.turn_start", { turnId: event.data.turnId });
    case "assistant.turn_end":
      return wrap(event, "assistant.turn_end", { turnId: event.data.turnId });
    case "assistant.message_delta":
      return wrap(event, "assistant.message_delta", {
        messageId: event.data.messageId,
        deltaContent: event.data.deltaContent,
        ...scope,
      });
    case "assistant.message":
      // A message that only carries tool requests has no text for the host to show.
      return event.data.content === ""
        ? undefined
        : wrap(event, "assistant.message", { messageId: event.data.messageId, content: event.data.content, ...scope });
    case "tool.execution_start":
      return wrap(event, "tool.execution_start", {
        toolCallId: event.data.toolCallId,
        toolName: event.data.toolName,
        arguments: event.data.arguments ?? null,
        ...scope,
      });
    case "tool.execution_complete":
      return toolCompleted(event, context, scope);
    case "permission.requested":
      return permissionRequested(event);
    case "permission.completed":
      return wrap(event, "permission.completed", {
        requestId: event.data.requestId,
        approved: event.data.result.kind.startsWith("approved"),
      });
    case "subagent.started":
      return wrap(event, "subagent.started", {
        toolCallId: event.data.toolCallId,
        agentId: subagentId(event, event.data.toolCallId),
        agentName: event.data.agentName,
        model: event.data.model ?? "",
      });
    case "subagent.completed":
      return wrap(event, "subagent.completed", {
        toolCallId: event.data.toolCallId,
        agentId: subagentId(event, event.data.toolCallId),
        agentName: event.data.agentName,
        ...subagentModels(event.data.model, event.data.firstDispatchedModel),
        totalTokens: event.data.totalTokens ?? 0,
      });
    case "subagent.failed":
      return wrap(event, "subagent.failed", {
        toolCallId: event.data.toolCallId,
        agentId: subagentId(event, event.data.toolCallId),
        agentName: event.data.agentName,
        error: event.data.error,
      });
    case "assistant.usage":
      return wrap(event, "assistant.usage", {
        model: event.data.model,
        ...inputSplit(event.data.inputTokens ?? 0, event.data.cacheReadTokens ?? 0),
        outputTokens: event.data.outputTokens ?? 0,
        ...(event.data.copilotUsage === undefined ? {} : { billedCredits: event.data.copilotUsage.totalNanoAiu / nanoAiuPerCredit }),
        ...(event.data.initiator === undefined ? {} : { initiator: event.data.initiator }),
        ...(event.data.cost === undefined ? {} : { premiumRequests: event.data.cost }),
        ...scope,
      });
    case "session_limits_exhausted.requested":
      return wrap(event, "session_limits_exhausted.requested", {
        requestId: event.data.requestId,
        usedAiCredits: event.data.usedAiCredits,
        maxAiCredits: event.data.maxAiCredits,
      });
    case "session_limits_exhausted.completed":
      return wrap(event, "session_limits_exhausted.completed", {
        requestId: event.data.requestId,
        maxAiCredits: event.data.response.action === "cancel" ? null : (event.data.response.maxAiCredits ?? null),
      });
    case "session.usage_info":
      return wrap(event, "session.usage_info", {
        currentTokens: event.data.currentTokens,
        tokenLimit: event.data.tokenLimit,
      });
    case "session.error":
      return wrap(event, "session.error", { code: classifyError(event.data), message: event.data.message });
    case "abort":
      return wrap(event, "abort", { reason: event.data.reason });
    case "session.idle":
      return wrap(event, "session.idle", {});
    default:
      return undefined;
  }
}

function toolCompleted(
  event: Extract<SessionEvent, { type: "tool.execution_complete" }>,
  context: EventContext,
  scope: { readonly agentId?: string },
): RuntimeEvent {
  const { toolCallId, success, result, error } = event.data;
  const denied = context.deniedReason(toolCallId);
  if (denied !== undefined) {
    return wrap(event, "tool.execution_complete", {
      toolCallId,
      success: false,
      result: { content: error?.message ?? `Denied by Pica policy: ${denied}` },
      ...scope,
    });
  }
  return wrap(event, "tool.execution_complete", {
    toolCallId,
    success,
    result: context.modifiedResult(toolCallId) ?? {
      content: success ? (result?.content ?? "") : (error?.message ?? result?.content ?? ""),
    },
    ...scope,
  });
}

// Copilot's `inputTokens` includes cache reads (S-01), which the port counts separately and prices
// at the cached rate. Cache writes stay in `inputTokens`: the port has no rate of their own.
function inputSplit(input: number, cacheRead: number): { readonly inputTokens: number; readonly cachedInputTokens: number } {
  const cachedInputTokens = Math.min(cacheRead, input);
  return { inputTokens: input - cachedInputTokens, cachedInputTokens };
}

// `model` on `subagent.completed` is the one requested; `firstDispatchedModel` is the one used (S-03).
function subagentModels(
  requested: string | undefined,
  used: string | undefined,
): { readonly model: string; readonly requestedModel?: string } {
  if (used === undefined || used === "" || used === requested) {
    return { model: requested ?? "" };
  }
  return requested === undefined || requested === "" ? { model: used } : { model: used, requestedModel: requested };
}

function subagentId(event: SessionEvent, toolCallId: string): string {
  return event.agentId === undefined || event.agentId === "" ? toolCallId : event.agentId;
}

function permissionRequested(event: Extract<SessionEvent, { type: "permission.requested" }>): RuntimeEvent {
  const request = event.data.permissionRequest as unknown as Readonly<Record<string, unknown>>;
  const toolName = typeof request.toolName === "string" ? request.toolName : String(request.kind);
  const reason = typeof request.hookMessage === "string" ? { reason: request.hookMessage } : {};
  return wrap(event, "permission.requested", {
    requestId: event.data.requestId,
    toolCallId: typeof request.toolCallId === "string" ? request.toolCallId : "",
    toolName,
    arguments: (request.toolArgs ?? null) as JsonValue,
    ...reason,
  });
}

function wrap<T extends RuntimeEventType>(
  event: SessionEvent,
  type: T,
  data: RuntimeEventDataMap[T],
): RuntimeEvent {
  return { id: event.id, timestamp: event.timestamp, type, data } as RuntimeEvent;
}
