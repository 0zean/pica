import * as z from "zod";
import { Count, Id, Timestamp } from "../common.ts";

export const SecretRef = z.object({ secretRef: z.string().min(1) });
const StringOrSecret = z.union([z.string(), SecretRef]);

export const McpScope = z.enum(["global", "workspace", "repo"]);

export const McpTransport = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()),
    env: z.record(z.string(), StringOrSecret),
    cwd: z.string().nullable(),
  }),
  z.object({
    type: z.enum(["http", "sse"]),
    url: z.url(),
    headers: z.record(z.string(), StringOrSecret),
  }),
]);

export const McpServerDef = z.object({
  id: Id,
  name: z.string().min(1),
  transport: McpTransport,
  toolAllowlist: z.array(z.string().min(1)).nullable(),
  scope: McpScope,
});

export const McpServerStatus = z.object({
  serverId: Id,
  state: z.enum(["connecting", "healthy", "degraded", "needs_auth", "failed", "stopped"]),
  lastError: z.string().nullable(),
  tools: z.array(z.string()),
  latencyMs: z.number().nonnegative().nullable(),
  toolDefinitionTokens: Count.nullable(),
  checkedAt: Timestamp.nullable(),
});

export type SecretRef = z.infer<typeof SecretRef>;
export type McpScope = z.infer<typeof McpScope>;
export type McpTransport = z.infer<typeof McpTransport>;
export type McpServerDef = z.infer<typeof McpServerDef>;
export type McpServerStatus = z.infer<typeof McpServerStatus>;
