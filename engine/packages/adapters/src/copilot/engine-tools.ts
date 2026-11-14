import type { EngineTool, JsonValue } from "@pica/core";
import type { Tool, ToolResultObject } from "@github/copilot-sdk";

// Engine tools (R-08) become SDK tools; their calls still pass through the session's tool hooks.
export function toSdkTools(tools: readonly EngineTool[]): Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: { ...tool.parameters },
    handler: async (args: unknown): Promise<ToolResultObject> => {
      const output = await tool.invoke((args ?? null) as JsonValue);
      return output.ok
        ? { textResultForLlm: output.text, resultType: "success" }
        : { textResultForLlm: output.text, resultType: "failure", error: output.text };
    },
  }));
}
