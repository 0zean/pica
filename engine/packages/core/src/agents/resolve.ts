import type { AgentDef, AgentSourceLayer } from "@pica/protocol";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import { agentError } from "./errors.ts";
import type { AgentError, AgentIssue } from "./errors.ts";
import { validateAgent } from "./validate.ts";
import type { AgentDocument } from "./validate.ts";

// Lowest to highest, following PLAN.md §4.6. `.github/agents` is shared with Copilot, so
// `.pica/agents` in the same repo, which only Pica reads, overrides it.
export const agentLayerPrecedence: readonly AgentSourceLayer[] = [
  "builtin",
  "user",
  "workspace",
  "github_agents",
  "repo",
];

// An agent in a higher layer replaces the whole definition of the same name below it.
export function resolveAgents(documents: readonly AgentDocument[]): Result<AgentDef[], AgentError> {
  const issues: AgentIssue[] = [];
  const byLayer = new Map<string, AgentDef>();
  for (const document of documents) {
    const validated = validateAgent(document);
    if (!validated.ok) {
      issues.push(...validated.error);
      continue;
    }
    const key = `${document.layer}/${validated.value.name}`;
    const existing = byLayer.get(key);
    if (existing !== undefined) {
      issues.push({
        file: document.path,
        field: "name",
        message: `agent "${validated.value.name}" is also defined in ${existing.sourcePath ?? "the built-in agents"}, in the same layer`,
      });
    }
    byLayer.set(key, validated.value);
  }
  if (issues.length > 0) {
    return err(agentError("agents.invalid", issues));
  }

  const resolved = new Map<string, AgentDef>();
  const ordered = [...byLayer.values()].sort(
    (a, b) => agentLayerPrecedence.indexOf(a.sourceLayer) - agentLayerPrecedence.indexOf(b.sourceLayer),
  );
  for (const agent of ordered) {
    resolved.set(agent.name, agent);
  }
  return ok([...resolved.values()].sort((a, b) => a.name.localeCompare(b.name)));
}
