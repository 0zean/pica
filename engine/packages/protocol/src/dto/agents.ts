import * as z from "zod";

export const Tier = z.enum(["reasoning", "worker"]);
export const AgentSourceLayer = z.enum(["builtin", "user", "workspace", "repo", "github_agents"]);

export const AgentDef = z.object({
  name: z.string().min(1),
  description: z.string(),
  tier: Tier,
  tools: z.array(z.string().min(1)),
  prompt: z.string(),
  sourceLayer: AgentSourceLayer,
  sourcePath: z.string().nullable(),
});

export type Tier = z.infer<typeof Tier>;
export type AgentSourceLayer = z.infer<typeof AgentSourceLayer>;
export type AgentDef = z.infer<typeof AgentDef>;
