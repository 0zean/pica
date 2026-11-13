import type { JsonValue, PostToolUseOutcome, PreToolUseDecision, RuntimeHooks, ToolUseInput } from "@pica/core";
import type { SessionHooks } from "@github/copilot-sdk";
import type { ToolCallLedger } from "./tool-calls.ts";

type PreToolUseHookInput = Parameters<NonNullable<SessionHooks["onPreToolUse"]>>[0];
type PostToolUseHookInput = Parameters<NonNullable<SessionHooks["onPostToolUse"]>>[0];
type PreToolUseHookOutput = Exclude<Awaited<ReturnType<NonNullable<SessionHooks["onPreToolUse"]>>>, void>;
type PostToolUseHookOutput = Exclude<Awaited<ReturnType<NonNullable<SessionHooks["onPostToolUse"]>>>, void>;

// Pica's hooks see the SDK's tool hooks with call ids attached. A Pica hook that throws is a deny
// (pre) or keep (post); the SDK itself would treat a throw as "no decision", which allows.
export function bridgeHooks(hooks: RuntimeHooks, ledger: ToolCallLedger, sessionId: () => string): SessionHooks {
  return {
    onPreToolUse: async (input) => {
      const toolCallId = ledger.claimForPre(input.toolName, explicitToolCallId(input));
      if (hooks.onPreToolUse === undefined) return undefined;
      const decision = await preDecision(hooks.onPreToolUse, toolUseInput(input, toolCallId, sessionId()));
      if (decision.decision === "deny") {
        ledger.denied(toolCallId);
      }
      return toPreOutput(decision);
    },
    onPostToolUse: async (input) => {
      const toolCallId = ledger.claimForPost(input.toolName, explicitToolCallId(input));
      if (hooks.onPostToolUse === undefined) return undefined;
      const outcome = await postOutcome(hooks.onPostToolUse, {
        ...toolUseInput(input, toolCallId, sessionId()),
        success: input.toolResult.resultType === "success",
        result: { content: input.toolResult.textResultForLlm },
      });
      if (outcome.kind === "keep") return undefined;
      ledger.modify(toolCallId, outcome.result);
      const output: PostToolUseHookOutput = {
        modifiedResult: { ...input.toolResult, textResultForLlm: outcome.result.content },
      };
      return output;
    },
  };
}

function toolUseInput(input: PreToolUseHookInput, toolCallId: string, sessionId: string): ToolUseInput {
  return {
    sessionId,
    toolCallId,
    toolName: input.toolName,
    arguments: (input.toolArgs ?? null) as JsonValue,
    ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
  };
}

function toPreOutput(decision: PreToolUseDecision): PreToolUseHookOutput {
  switch (decision.decision) {
    case "allow":
      return { permissionDecision: "allow" };
    case "deny":
      return { permissionDecision: "deny", permissionDecisionReason: decision.reason };
    case "ask":
      return decision.reason === undefined
        ? { permissionDecision: "ask" }
        : { permissionDecision: "ask", permissionDecisionReason: decision.reason };
  }
}

async function preDecision(
  hook: NonNullable<RuntimeHooks["onPreToolUse"]>,
  input: ToolUseInput,
): Promise<PreToolUseDecision> {
  try {
    return await hook(input);
  } catch (error) {
    return { decision: "deny", reason: `preToolUse hook failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function postOutcome(
  hook: NonNullable<RuntimeHooks["onPostToolUse"]>,
  input: Parameters<NonNullable<RuntimeHooks["onPostToolUse"]>>[0],
): Promise<PostToolUseOutcome> {
  try {
    return await hook(input);
  } catch {
    return { kind: "keep" };
  }
}

function explicitToolCallId(input: PreToolUseHookInput | PostToolUseHookInput): string | undefined {
  const value: unknown = (input as unknown as Readonly<Record<string, unknown>>).toolCallId;
  return typeof value === "string" ? value : undefined;
}
