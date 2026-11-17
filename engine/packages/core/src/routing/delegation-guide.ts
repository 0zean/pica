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
  // The rules come first: a call the gates deny still costs a main-agent turn (C-11).
  const lines = [
    "# Delegation",
    "",
    "You are the main agent and run on the reasoning tier. Sub-agents run on the cheaper worker tier.",
    "Every call you make costs a turn on the reasoning tier, and a call the rules below deny is a wasted turn.",
    "",
    "## Rules",
    "",
    ...rules(profile, has),
    "",
    "## Sub-agents",
    "",
    ...(sorted.length === 0 ? ["None are available in this session."] : sorted.map(agentLine)),
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
      "- A whole read of a large file (tens of KB or more) is denied, and so is a search that prints its matching lines. " +
        "Read a range of a few hundred lines with `view` and `view_range`, or ask `bulk-reader` one specific question about the file.",
      "- Large tool output is truncated and saved to a file. Ask `bulk-reader` about that file instead of reading it whole.",
    );
  }
  if (has("repo-scout")) {
    lines.push("- To find where something lives across the workspace's repositories, ask `repo-scout`.");
  }
  lines.push(...writeRules(profile, has("code-writer")));
  return lines;
}

function writeRules(profile: Exclude<RoutingProfileName, "off">, hasCodeWriter: boolean): string[] {
  const shell =
    "- A shell command that writes a file into the repository (a redirect, a heredoc, `tee`, `touch`, or a `cp`, `mv` or `install` destination) is denied. Do not try it.";
  const spec = hasCodeWriter
    ? [
        "- Give `code-writer` everything in the prompt: each file's path and its full content, or the exact edits. " +
          "It does not explore the repository or run anything, and it stops after a few tool calls. Run the tests or checks yourself afterwards.",
        "- `code-writer` cannot create directories. For a file in a directory that may not exist yet, run `mkdir -p` on it before you delegate.",
      ]
    : [];
  if (profile === "strict") {
    return [
      hasCodeWriter
        ? "- You have no tools that write files. Send every change to `code-writer` as a precise spec, then check what it reports."
        : "- You have no tools that write files.",
      shell,
      ...spec,
    ];
  }
  return [
    hasCodeWriter
      ? "- You have no tool that creates files. To create a file, ask `code-writer`."
      : "- You have no tool that creates files.",
    shell,
    "- Edit existing files yourself: `edit` for a few changes, or one `sed -i` command or script for the same change across many files." +
      (hasCodeWriter ? " That costs less than delegating it." : ""),
    ...spec,
  ];
}

export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
