import type { AgentDef } from "@pica/protocol";
import { MarkdownAgentLoader, builtinAgentsDir } from "@pica/adapters";

export function builtinAgents(): readonly AgentDef[] {
  const result = new MarkdownAgentLoader([{ layer: "builtin", dir: builtinAgentsDir }]).load();
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

export function builtinAgent(name: string): AgentDef {
  const agent = builtinAgents().find((candidate) => candidate.name === name);
  if (agent === undefined) {
    throw new Error(`no built-in agent ${name}`);
  }
  return agent;
}
