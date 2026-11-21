import { ManagedPolicyFile } from "@pica/protocol";
import { configError } from "../config/errors.ts";
import type { ConfigError, ConfigIssue } from "../config/errors.ts";
import { schemaIssues, validateLayer } from "../config/validate.ts";
import type { JsonObject } from "../json.ts";
import type { ManagedModelPolicy } from "../models/index.ts";
import type { ManagedMcpAllowlist, ManagedRule } from "../policy/index.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import type { ManagedPolicy } from "./types.ts";

type RuleEntry = NonNullable<ManagedPolicyFile["rules"]>[number];
type McpServers = NonNullable<ManagedPolicyFile["mcpServers"]>;

export function compileManagedPolicy(source: string, value: unknown): Result<ManagedPolicy, ConfigError> {
  const parsed = ManagedPolicyFile.safeParse(value);
  if (!parsed.success) {
    return err(configError("config.invalid", source, schemaIssues(parsed.error.issues)));
  }
  const file = parsed.data;
  const issues: ConfigIssue[] = [];
  const configLocks = compileConfigLocks(source, file.config, issues);
  const rules = (file.rules ?? []).flatMap((entry, index) => compileRule(file.id, entry, index, issues));
  if (issues.length > 0) {
    return err(configError("config.invalid", source, issues));
  }
  return ok({
    id: file.id,
    source,
    models: compileModels(file.models),
    mcpAllowlist: compileMcpAllowlist(file.id, file.mcpServers),
    budget: { maxSessionCredits: file.budget?.maxSessionCredits, maxWorkspaceDailyCredits: file.budget?.maxWorkspaceDailyCredits },
    minimumPermissionMode: file.permissions?.minimumMode,
    rules,
    configLocks,
    ...(file.customization !== undefined && { lockedCustomizations: file.customization.locked }),
  });
}

function compileModels(models: ManagedPolicyFile["models"]): ManagedModelPolicy {
  return {
    ...(models?.allow !== undefined && { allow: models.allow }),
    ...(models?.deny !== undefined && { deny: models.deny }),
  };
}

function compileConfigLocks(source: string, value: unknown, issues: ConfigIssue[]): JsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }
  const validated = validateLayer(source, value);
  if (validated.ok) {
    return validated.value;
  }
  issues.push(...validated.error.issues.map((issue) => ({ ...issue, keyPath: joinPath("config", issue.keyPath) })));
  return undefined;
}

function compileMcpAllowlist(policyId: string, servers: McpServers | undefined): ManagedMcpAllowlist | undefined {
  if (servers === undefined) {
    return undefined;
  }
  return {
    id: `${policyId}.mcp-servers`,
    servers: servers.allow.map((entry) => ({
      id: entry.id,
      ...(entry.url !== undefined && { url: entry.url }),
      ...(entry.command !== undefined && { command: entry.command }),
    })),
  };
}

function compileRule(policyId: string, entry: RuleEntry, index: number, issues: ConfigIssue[]): ManagedRule[] {
  const { commandPattern } = entry;
  const rule: ManagedRule = {
    id: `${policyId}.${entry.id}`,
    reason: entry.reason,
    ...(entry.tools !== undefined && { tools: entry.tools }),
    ...(entry.kinds !== undefined && { kinds: entry.kinds }),
    ...(entry.agents !== undefined && { agents: entry.agents }),
    ...(entry.pathPrefixes !== undefined && { pathPrefixes: entry.pathPrefixes }),
    ...(entry.mcpServers !== undefined && { mcpServers: entry.mcpServers }),
  };
  if (commandPattern === undefined) {
    return [rule];
  }
  try {
    return [{ ...rule, commandPattern: new RegExp(commandPattern) }];
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    issues.push({ keyPath: `rules.${String(index)}.commandPattern`, message });
    return [];
  }
}

function joinPath(prefix: string, keyPath: string): string {
  return keyPath === "" ? prefix : `${prefix}.${keyPath}`;
}
