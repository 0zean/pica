import type { JsonValue } from "../json.ts";
import type { RuntimeErrorCode } from "./errors.ts";
import type { ToolResult } from "./hooks.ts";

// The runtime's own event stream, modelled on the Copilot SDK's session events (PLAN.md §2.1).
// It is not Pica's `SessionEvent`; E-07 maps one to the other.
//
// `agentId` is set when the event comes from inside a sub-agent. Whether the Copilot runtime
// reports it for every event is unverified until S-02, so consumers must treat it as optional.

export interface RuntimeEventDataMap {
  "session.start": { readonly sessionId: string; readonly model: string; readonly workingDirectory: string };
  "session.resume": { readonly sessionId: string };
  "user.message": { readonly messageId: string; readonly content: string };
  "assistant.turn_start": { readonly turnId: string };
  "assistant.message_delta": { readonly messageId: string; readonly deltaContent: string; readonly agentId?: string };
  "assistant.message": { readonly messageId: string; readonly content: string; readonly agentId?: string };
  "tool.execution_start": {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly arguments: JsonValue;
    readonly agentId?: string;
  };
  "tool.execution_complete": {
    readonly toolCallId: string;
    readonly success: boolean;
    readonly result: ToolResult;
    readonly agentId?: string;
  };
  "permission.requested": {
    readonly requestId: string;
    readonly toolCallId: string;
    readonly toolName: string;
    readonly arguments: JsonValue;
    readonly reason?: string;
  };
  "permission.completed": { readonly requestId: string; readonly approved: boolean };
  "subagent.started": {
    readonly toolCallId: string;
    readonly agentId: string;
    readonly agentName: string;
    readonly model: string;
  };
  // `model` is the model the sub-agent ran on; `requestedModel` is set when the runtime ran
  // another than the one requested (S-03).
  "subagent.completed": {
    readonly toolCallId: string;
    readonly agentId: string;
    readonly agentName: string;
    readonly model: string;
    readonly requestedModel?: string;
    readonly totalTokens: number;
  };
  "subagent.failed": {
    readonly toolCallId: string;
    readonly agentId: string;
    readonly agentName: string;
    readonly error: string;
  };
  // `billedCredits`: what the call was billed, when the runtime reports it (Copilot's
  // `copilotUsage.totalNanoAiu`). It is the only cost on plans without token prices (S-03).
  "assistant.usage": {
    readonly model: string;
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly outputTokens: number;
    readonly billedCredits?: number;
    // Who the runtime bills the call to (`user`, `agent`, `sub-agent`) and the premium requests it
    // counted (Copilot's `initiator` and `cost`).
    readonly initiator?: string;
    readonly premiumRequests?: number;
    readonly agentId?: string;
  };
  // The session's credit spend reached `maxAiCredits` after a model call; the next call waits for
  // `resolveSessionLimit` (PLAN.md §2.1).
  "session_limits_exhausted.requested": {
    readonly requestId: string;
    readonly usedAiCredits: number;
    readonly maxAiCredits: number;
  };
  // `maxAiCredits` is the new limit, or null when the blocked call was cancelled.
  "session_limits_exhausted.completed": { readonly requestId: string; readonly maxAiCredits: number | null };
  "session.usage_info": { readonly currentTokens: number; readonly tokenLimit: number };
  "session.error": { readonly code: RuntimeErrorCode; readonly message: string };
  abort: { readonly reason: string };
  "assistant.turn_end": { readonly turnId: string };
  "session.idle": Readonly<Record<string, never>>;
}

export type RuntimeEventType = keyof RuntimeEventDataMap;

export type RuntimeEventOf<T extends RuntimeEventType> = {
  readonly id: string;
  readonly timestamp: string;
  readonly type: T;
  readonly data: RuntimeEventDataMap[T];
};

export type RuntimeEvent = { [T in RuntimeEventType]: RuntimeEventOf<T> }[RuntimeEventType];

export type RuntimeEventListener = (event: RuntimeEvent) => void;
