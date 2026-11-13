import type { AgentDocument } from "@pica/core";
import type { AgentSourceLayer } from "@pica/protocol";

export function agentDocument(
  layer: AgentSourceLayer,
  name: string,
  frontmatter: Record<string, unknown> = {},
  body = `Prompt for ${name} from ${layer}.`,
): AgentDocument {
  return {
    layer,
    path: `/${layer}/${name}.md`,
    frontmatter: { description: `${name} from ${layer}`, tier: "worker", tools: ["view"], ...frontmatter },
    body,
  };
}
