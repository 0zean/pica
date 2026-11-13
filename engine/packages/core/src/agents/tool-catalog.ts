import type { AgentSourceLayer } from "@pica/protocol";

export type ToolKind = "read" | "search" | "write" | "shell" | "web" | "agent" | "other";

export interface BuiltinTool {
  readonly name: string;
  readonly kind: ToolKind;
}

// TODO(S-02): provisional. Replace with the tool names recorded in docs/spikes/S-02-tools.json
// once S-02 has run against the real runtime. These are the Copilot CLI built-in tools as
// documented, not yet observed.
export const provisionalBuiltinTools: readonly BuiltinTool[] = [
  { name: "view", kind: "read" },
  { name: "grep", kind: "search" },
  { name: "glob", kind: "search" },
  { name: "create", kind: "write" },
  { name: "edit", kind: "write" },
  { name: "bash", kind: "shell" },
  { name: "read_bash", kind: "shell" },
  { name: "write_bash", kind: "shell" },
  { name: "stop_bash", kind: "shell" },
  { name: "list_bash", kind: "shell" },
  { name: "web_fetch", kind: "web" },
  { name: "task", kind: "agent" },
  { name: "update_todo", kind: "other" },
];

// The custom-agent tool aliases from the Copilot custom agents reference, matched without
// regard to case. TODO(S-02): confirm each alias expands to these names.
const aliases: Readonly<Record<string, readonly string[]>> = {
  execute: ["bash", "read_bash", "write_bash", "stop_bash", "list_bash"],
  shell: ["bash", "read_bash", "write_bash", "stop_bash", "list_bash"],
  bash: ["bash", "read_bash", "write_bash", "stop_bash", "list_bash"],
  powershell: ["bash", "read_bash", "write_bash", "stop_bash", "list_bash"],
  read: ["view"],
  notebookread: ["view"],
  edit: ["create", "edit"],
  multiedit: ["create", "edit"],
  write: ["create", "edit"],
  notebookedit: ["create", "edit"],
  search: ["grep", "glob"],
  grep: ["grep", "glob"],
  glob: ["grep", "glob"],
  agent: ["task"],
  "custom-agent": ["task"],
  task: ["task"],
  web: ["web_fetch"],
  websearch: ["web_fetch"],
  webfetch: ["web_fetch"],
  todo: ["update_todo"],
  todowrite: ["update_todo"],
};

const mcpToolPattern = /^[A-Za-z0-9._-]+\/([A-Za-z0-9._-]+|\*)$/;

export function toolKind(name: string): ToolKind | "mcp" | undefined {
  if (mcpToolPattern.test(name)) {
    return "mcp";
  }
  return provisionalBuiltinTools.find((tool) => tool.name === name)?.kind;
}

// Copilot's own `.github/agents` files use alias semantics, where `edit` also means create.
// Pica's layers name built-in tools exactly and fall back to an alias.
export function expandTool(name: string, layer: AgentSourceLayer): readonly string[] | undefined {
  const alias = aliases[name.toLowerCase()];
  const exact = toolKind(name) === undefined ? undefined : [name];
  return layer === "github_agents" ? (alias ?? exact) : (exact ?? alias);
}
