import type { AgentDef } from "@pica/protocol";
import type { RoutingProfileName } from "./profiles.ts";

// The guide is part of the cached prompt prefix (PLAN.md §5.5): it depends only on the profile and
// the agent set, never on session state, so every session with the same inputs gets the same bytes.
export function delegationGuide(profile: RoutingProfileName, agents: readonly AgentDef[]): string {
  if (profile === "off") {
    return "";
  }
  const sorted = [...agents].sort((a, b) => compareNames(a.name, b.name));
  const has = (name: string): boolean => sorted.some((agent) => agent.name === name);
  const lines = [
    "# Delegation",
    "",
    "You are the main agent and run on the reasoning tier. Sub-agents run on the cheaper worker tier.",
    "Hand them work that does not need your judgment, and keep planning, decisions and review for yourself.",
    "",
    "## Sub-agents",
    "",
    ...(sorted.length === 0 ? ["None are available in this session."] : sorted.map(agentLine)),
    "",
    "## Rules",
    "",
    ...rules(profile, has),
  ];
  return `${lines.join("\n")}\n`;
}

function agentLine(agent: AgentDef): string {
  return `- \`${agent.name}\` (${agent.tier}): ${agent.description}`;
}

function rules(profile: Exclude<RoutingProfileName, "off">, has: (name: string) => boolean): string[] {
  const lines: string[] = [];
  if (has("bulk-reader")) {
    lines.push(
      "- Reads of large files are denied. Ask `bulk-reader` a specific question about the file, or read a line range.",
      "- Large tool output is truncated and saved to a file. Ask `bulk-reader` about that file instead of reading it whole.",
    );
  }
  if (has("repo-scout")) {
    lines.push("- To find where something lives across the workspace's repositories, ask `repo-scout`.");
  }
  lines.push(...writeRules(profile, has("code-writer")));
  lines.push("- Shell commands that write files into the repository (redirects, `tee`, `cp`) are denied as well.");
  return lines;
}

function writeRules(profile: Exclude<RoutingProfileName, "off">, hasCodeWriter: boolean): string[] {
  if (profile === "strict") {
    return hasCodeWriter
      ? ["- You have no tools that write files. Send every change to `code-writer` as a precise spec, then review what it reports."]
      : ["- You have no tools that write files."];
  }
  return hasCodeWriter
    ? [
        "- You have no tool that creates files. Ask `code-writer` to create new files from a precise spec.",
        "- Make small edits to existing files yourself; send mechanical or repetitive edits to `code-writer`.",
      ]
    : ["- You have no tool that creates files."];
}

export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
