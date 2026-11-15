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
  // Restarts of a crashed stdio server since it was last stable.
  restarts: Count,
});

// M-02: an optional, parameterized server definition (D-18). Listing a preset enables nothing.
export const McpPresetParameter = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  // `secretRef` values are references such as `keychain:<name>` or `env:<NAME>`, never secrets.
  kind: z.enum(["choice", "text", "url", "hostname", "identifier", "secretRef"]),
  required: z.boolean(),
  default: z.string().nullable(),
  choices: z.array(z.string().min(1)).nullable(),
  examples: z.array(z.string()),
  // The parameter applies only when another parameter has one of these values.
  onlyWhen: z.object({ parameter: z.string().min(1), values: z.array(z.string().min(1)) }).nullable(),
});

export const McpPreset = z.object({
  id: Id,
  name: z.string().min(1),
  description: z.string(),
  parameters: z.array(McpPresetParameter),
});

export const McpPresetIssue = z.object({ parameter: z.string().min(1), message: z.string().min(1) });

export type SecretRef = z.infer<typeof SecretRef>;
export type McpScope = z.infer<typeof McpScope>;
export type McpTransport = z.infer<typeof McpTransport>;
export type McpServerDef = z.infer<typeof McpServerDef>;
export type McpServerStatus = z.infer<typeof McpServerStatus>;
export type McpPresetParameter = z.infer<typeof McpPresetParameter>;
export type McpPreset = z.infer<typeof McpPreset>;
export type McpPresetIssue = z.infer<typeof McpPresetIssue>;
