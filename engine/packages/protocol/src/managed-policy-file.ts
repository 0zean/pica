import * as z from "zod";
import { PermissionMode } from "./config-file.ts";

// The organization's managed policy (H-01): a root-owned JSONC file or a managed preferences
// payload with the same keys. No user layer can loosen anything set here.

const Name = z.string().min(1);
const Credits = z.number().nonnegative();

const ModelRestrictions = z.strictObject({
  allow: z.array(Name).optional().describe("Only these model ids may be used"),
  deny: z.array(Name).optional().describe("These model ids may never be used"),
});

const ManagedMcpServerEntry = z.strictObject({
  id: Name,
  url: Name.optional().describe("Pins the entry to this endpoint"),
  command: Name.optional().describe("Pins the entry to this command"),
});

const McpServerRestrictions = z.strictObject({
  allow: z.array(ManagedMcpServerEntry).describe("The only MCP servers a session may attach"),
});

const BudgetCeilings = z.strictObject({
  maxSessionCredits: Credits.optional().describe("Ceiling for budget.sessionCredits and any per-session budget"),
  maxWorkspaceDailyCredits: Credits.optional().describe("Ceiling for budget.workspaceDailyCredits"),
});

const PermissionFloor = z.strictObject({
  minimumMode: PermissionMode.optional().describe("The least strict permissions.mode allowed"),
});

const ManagedRuleEntry = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9._-]+$/),
  reason: Name,
  tools: z.array(Name).optional(),
  kinds: z.array(z.enum(["read", "write", "search", "shell", "mcp", "other"])).optional(),
  agents: z.array(Name).optional(),
  pathPrefixes: z.array(Name).optional(),
  mcpServers: z.array(Name).optional(),
  commandPattern: Name.optional().describe("A regular expression matched against shell commands"),
});

export const ManagedPolicyFile = z.strictObject({
  $schema: z.string().optional(),
  id: z.string().regex(/^[A-Za-z0-9._-]+$/).default("org").describe("Names the policy in decisions: managed:<id>"),
  models: ModelRestrictions.optional(),
  mcpServers: McpServerRestrictions.optional(),
  budget: BudgetCeilings.optional(),
  permissions: PermissionFloor.optional(),
  rules: z.array(ManagedRuleEntry).optional().describe("Tool calls these match are always denied"),
  config: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("config.jsonc keys to lock; every key set here ignores all other layers"),
});

export type ManagedPolicyFile = z.output<typeof ManagedPolicyFile>;
