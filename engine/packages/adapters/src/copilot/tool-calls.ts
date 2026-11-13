import type { ToolResult } from "@pica/core";

// The SDK's hook inputs name the tool but not the tool call (`BaseHookInput` has no
// `toolCallId`). The runtime emits `tool.execution_start` before it runs `preToolUse`, so each
// hook is matched to the oldest started call of the same tool that has not had that hook yet.
// A `toolCallId` on the hook input, if the runtime sends one, wins. S-02 checks the ordering.
export class ToolCallLedger {
  private readonly awaitingPre: { id: string; name: string }[] = [];
  private readonly awaitingPost: { id: string; name: string }[] = [];
  private readonly modified = new Map<string, ToolResult>();

  started(toolCallId: string, toolName: string): void {
    this.awaitingPre.push({ id: toolCallId, name: toolName });
  }

  claimForPre(toolName: string, explicitId: string | undefined): string {
    const id = take(this.awaitingPre, toolName, explicitId);
    this.awaitingPost.push({ id, name: toolName });
    return id;
  }

  claimForPost(toolName: string, explicitId: string | undefined): string {
    return take(this.awaitingPost, toolName, explicitId);
  }

  denied(toolCallId: string): void {
    const index = this.awaitingPost.findIndex((call) => call.id === toolCallId);
    if (index >= 0) this.awaitingPost.splice(index, 1);
  }

  modify(toolCallId: string, result: ToolResult): void {
    this.modified.set(toolCallId, result);
  }

  // The post hook's result replaces what the model sees; the event stream reports the same.
  modifiedResult(toolCallId: string): ToolResult | undefined {
    return this.modified.get(toolCallId);
  }

  clear(): void {
    this.awaitingPre.length = 0;
    this.awaitingPost.length = 0;
    this.modified.clear();
  }
}

function take(queue: { id: string; name: string }[], toolName: string, explicitId: string | undefined): string {
  const index = queue.findIndex((call) => (explicitId === undefined ? call.name === toolName : call.id === explicitId));
  if (index < 0) {
    return explicitId ?? "";
  }
  const [call] = queue.splice(index, 1);
  return call?.id ?? "";
}
