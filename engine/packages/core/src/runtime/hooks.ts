import type { JsonValue } from "../json.ts";

export interface ToolResult {
  readonly content: string;
}

export interface ToolUseInput {
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: JsonValue;
  readonly agentId?: string;
}

// "ask" makes the runtime emit `permission.requested` and wait for `resolvePermission`.
export type PreToolUseDecision =
  | { readonly decision: "allow" }
  | { readonly decision: "deny"; readonly reason: string }
  | { readonly decision: "ask"; readonly reason?: string };

export interface PostToolUseInput extends ToolUseInput {
  readonly success: boolean;
  readonly result: ToolResult;
}

export type PostToolUseOutcome =
  | { readonly kind: "keep" }
  | { readonly kind: "modify"; readonly result: ToolResult };

// Hooks are called for every tool call, including those made inside a sub-agent. A hook that
// throws or rejects is treated as a deny (pre) or keep (post); the runtime never rethrows.
export interface RuntimeHooks {
  readonly onPreToolUse?: (input: ToolUseInput) => Promise<PreToolUseDecision>;
  readonly onPostToolUse?: (input: PostToolUseInput) => Promise<PostToolUseOutcome>;
}
