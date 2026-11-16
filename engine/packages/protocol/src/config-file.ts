import * as z from "zod";
import { RoutingProfile } from "./dto/workspace.ts";

// The shape of every `config.jsonc` layer (PLAN.md §4.6, D-11). Every key is optional in a file;
// parsing `{}` yields the built-in defaults. Objects are strict so a misspelt key is an error.

export const PermissionMode = z.enum(["ask", "auto"]);

const ByteCount = z.number().int().nonnegative();
const Credits = z.number().nonnegative();
const TierSetting = z.string().min(1).describe('"auto" or a model id');

const TierSettings = z.strictObject({
  reasoning: TierSetting.default("auto"),
  worker: TierSetting.default("auto"),
});

const ReadDelegation = z.strictObject({
  minBytes: ByteCount.default(32768).describe("Main-agent reads at or above this size go to bulk-reader"),
  rangeExemptLines: z.number().int().positive().default(400).describe("Ranged reads up to this many lines stay with the main agent"),
  exclude: z
    .array(z.string().min(1))
    .default([])
    .describe("Glob patterns (relative to a session repo root, or absolute) the main agent may read whole at any size"),
});

const OutputDelegation = z.strictObject({
  maxBytes: ByteCount.default(16384),
});

const Delegation = z.strictObject({
  read: ReadDelegation.prefault({}),
  output: OutputDelegation.prefault({}),
});

const Routing = z.strictObject({
  profile: RoutingProfile.default("off"),
  tiers: TierSettings.prefault({}),
  delegation: Delegation.prefault({}),
});

const Budget = z.strictObject({
  sessionCredits: Credits.default(300),
  workspaceDailyCredits: Credits.default(3000),
});

export const McpToolPermission = z.enum(["allow", "ask", "deny"]);

// `server/tool` or `server/*` (docs/mcp-permissions.md).
const McpToolPermissionRule = z.strictObject({
  tool: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\/([A-Za-z0-9._-]+|\*)$/).describe('"server/tool" or "server/*"'),
  permission: McpToolPermission,
});

const Permissions = z.strictObject({
  mode: PermissionMode.default("ask"),
  mcpTools: z
    .array(McpToolPermissionRule)
    .optional()
    .describe("Per-tool MCP permissions; an exact tool beats server/*. Overrides mode and the write-class default"),
});

// X-03: shell commands the engine runs on Pica events (docs/user-hooks.md).
const UserHook = z.strictObject({
  name: z.string().min(1).optional().describe("Shown when the hook fails; defaults to the command"),
  command: z.string().min(1).describe("Run with /bin/sh -c in the session or repository directory"),
  timeoutSeconds: z.number().positive().max(600).default(60).describe("The hook is killed when it runs longer"),
});

const UserHooks = z.strictObject({
  sessionStart: z.array(UserHook).default([]),
  sessionEnd: z.array(UserHook).default([]),
  beforeCommit: z.array(UserHook).default([]).describe("A hook that exits non-zero blocks the commit"),
});

export const PicaConfig = z.strictObject({
  $schema: z.string().optional(),
  routing: Routing.prefault({}),
  budget: Budget.prefault({}),
  permissions: Permissions.prefault({}),
  hooks: UserHooks.prefault({}),
});

export type PicaConfig = z.output<typeof PicaConfig>;
export type McpToolPermission = z.output<typeof McpToolPermission>;
export type UserHook = z.output<typeof UserHook>;
export type UserHookEvent = keyof PicaConfig["hooks"];

export function buildConfigJsonSchema(): Record<string, unknown> {
  const schema: Record<string, unknown> = z.toJSONSchema(PicaConfig, { target: "draft-2020-12", io: "input" });
  return {
    ...schema,
    $id: "urn:pica:config",
    title: "Pica configuration (config.jsonc)",
  };
}

export function serializeConfigJsonSchema(): string {
  return `${JSON.stringify(buildConfigJsonSchema(), null, 2)}\n`;
}
