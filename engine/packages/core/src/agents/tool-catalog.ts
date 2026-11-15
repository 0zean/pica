import type { AgentSourceLayer } from "@pica/protocol";

export type ToolKind = "read" | "search" | "write" | "shell" | "web" | "agent" | "other";

export interface BuiltinTool {
  readonly name: string;
  readonly kind: ToolKind;
  /** Set on the write tool that makes new files; `balanced` removes it from the main agent (C-05). */
  readonly createsFiles?: true;
}

// The runtime's built-in tools as `tools.list` reports them (SDK 1.0.28, docs/spikes/S-02-tools.json),
// plus the names some models call instead once `auto` routes to them: `rg` for `grep` (S-02) and
// `apply_patch`, whose patch text can add files (S-04). Those two are not in `tools.list`.
export const builtinTools: readonly BuiltinTool[] = [
  { name: "view", kind: "read" },
  { name: "grep", kind: "search" },
  { name: "rg", kind: "search" },
  { name: "glob", kind: "search" },
  { name: "create", kind: "write", createsFiles: true },
  { name: "edit", kind: "write" },
  { name: "apply_patch", kind: "write", createsFiles: true },
  { name: "bash", kind: "shell" },
  { name: "read_bash", kind: "shell" },
  { name: "stop_bash", kind: "shell" },
  { name: "list_bash", kind: "shell" },
  { name: "web_fetch", kind: "web" },
  { name: "task", kind: "agent" },
  { name: "read_agent", kind: "agent" },
  { name: "list_agents", kind: "agent" },
  { name: "write_agent", kind: "agent" },
  { name: "skill", kind: "other" },
];

const shellTools = ["bash", "read_bash", "stop_bash", "list_bash"];
const agentTools = ["task", "read_agent", "list_agents", "write_agent"];

// The custom-agent tool aliases from the Copilot custom agents reference, matched without regard
// to case. S-02 confirmed the tool names they expand to, not the aliases themselves. `todo` has
// no tool on this runtime, so it expands to nothing rather than failing validation.
const aliases: Readonly<Record<string, readonly string[]>> = {
  execute: shellTools,
  shell: shellTools,
  bash: shellTools,
  powershell: shellTools,
  read: ["view"],
  notebookread: ["view"],
  edit: ["create", "edit", "apply_patch"],
  multiedit: ["create", "edit", "apply_patch"],
  write: ["create", "edit", "apply_patch"],
  notebookedit: ["create", "edit", "apply_patch"],
  search: ["grep", "rg", "glob"],
  grep: ["grep", "rg", "glob"],
  glob: ["grep", "rg", "glob"],
  agent: agentTools,
  "custom-agent": agentTools,
  task: agentTools,
  web: ["web_fetch"],
  websearch: ["web_fetch"],
  webfetch: ["web_fetch"],
  skill: ["skill"],
  todo: [],
  todowrite: [],
};

const mcpToolPattern = /^[A-Za-z0-9._-]+\/([A-Za-z0-9._-]+|\*)$/;

export function toolKind(name: string): ToolKind | "mcp" | undefined {
  if (mcpToolPattern.test(name)) {
    return "mcp";
  }
  return builtinTools.find((tool) => tool.name === name)?.kind;
}

// Copilot's own `.github/agents` files use alias semantics, where `edit` also means create.
// Pica's layers name built-in tools exactly and fall back to an alias.
export function expandTool(name: string, layer: AgentSourceLayer): readonly string[] | undefined {
  const alias = aliases[name.toLowerCase()];
  const exact = toolKind(name) === undefined ? undefined : [name];
  return layer === "github_agents" ? (alias ?? exact) : (exact ?? alias);
}
