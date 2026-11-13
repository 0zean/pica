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
});

const OutputDelegation = z.strictObject({
  maxBytes: ByteCount.default(16384),
});

const Delegation = z.strictObject({
  read: ReadDelegation.prefault({}),
  output: OutputDelegation.prefault({}),
});

const Routing = z.strictObject({
  profile: RoutingProfile.default("balanced"),
  tiers: TierSettings.prefault({}),
  delegation: Delegation.prefault({}),
});

const Budget = z.strictObject({
  sessionCredits: Credits.default(300),
  workspaceDailyCredits: Credits.default(3000),
});

const Permissions = z.strictObject({
  mode: PermissionMode.default("ask"),
});

export const PicaConfig = z.strictObject({
  $schema: z.string().optional(),
  routing: Routing.prefault({}),
  budget: Budget.prefault({}),
  permissions: Permissions.prefault({}),
});

export type PicaConfig = z.output<typeof PicaConfig>;

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
