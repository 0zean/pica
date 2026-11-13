import { PicaMcpServerEntry } from "@pica/protocol";
import type { McpScope, McpServerDef, PicaMcpFileValue, SecretRef } from "@pica/protocol";
import type { ConfigIssue } from "../config/errors.ts";
import { configError } from "../config/errors.ts";
import type { ConfigError } from "../config/errors.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import { findMcpInlineSecrets } from "./inline-secrets.ts";
import { formatMcpSecretReference, parseMcpSecretReference, scanMcpSecretPlaceholders, wholeMcpSecretReference } from "./secret-reference.ts";
import type { McpServerEntryInput } from "./types.ts";

// Matches the server part of an MCP tool name, `server/tool` (agents/tool-catalog.ts).
export const mcpServerIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const referenceFields = new Set(["env", "headers", "args"]);

export function buildMcpDefinitions(
  source: string,
  scope: McpScope,
  inputs: readonly McpServerEntryInput[],
): Result<McpServerDef[], ConfigError> {
  const invalid: ConfigIssue[] = [];
  const secrets: ConfigIssue[] = [];
  const definitions: McpServerDef[] = [];
  for (const input of inputs) {
    if (!mcpServerIdPattern.test(input.id)) {
      invalid.push({ keyPath: input.keyPath.join("."), message: "server id must match [A-Za-z0-9][A-Za-z0-9._-]*" });
      continue;
    }
    const parsed = PicaMcpServerEntry.safeParse(input.entry);
    if (!parsed.success) {
      invalid.push(...parsed.error.issues.flatMap((issue) => zodIssues(input.keyPath, issue)));
      continue;
    }
    const referenceIssues = checkReferences(parsed.data, input.keyPath);
    invalid.push(...referenceIssues);
    secrets.push(...findMcpInlineSecrets(parsed.data, input.keyPath));
    if (referenceIssues.length === 0) {
      definitions.push(toDefinition(input.id, scope, parsed.data));
    }
  }
  if (invalid.length > 0) {
    return err(configError("config.invalid", source, invalid));
  }
  if (secrets.length > 0) {
    return err(configError("config.inline_secret", source, secrets));
  }
  return ok(definitions);
}

interface ZodIssueLike {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly keys?: readonly string[];
}

function zodIssues(prefix: readonly string[], issue: ZodIssueLike): ConfigIssue[] {
  const path = [...prefix, ...issue.path.map(String)];
  if (issue.code === "unrecognized_keys" && issue.keys !== undefined) {
    return issue.keys.map((key) => ({ keyPath: [...path, key].join("."), message: "unknown key" }));
  }
  return [{ keyPath: path.join("."), message: issue.message }];
}

function checkReferences(entry: PicaMcpServerEntry, keyPath: readonly string[]): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const [path, value] of entryStrings(entry)) {
    const fullPath = [...keyPath, ...path].join(".");
    const scan = scanMcpSecretPlaceholders(value);
    for (const placeholder of scan.malformed) {
      issues.push({ keyPath: fullPath, message: `malformed secret reference ${placeholder} (docs/secret-references.md)` });
    }
    if (scan.references.length > 0 && !referenceFields.has(path[0] ?? "")) {
      issues.push({ keyPath: fullPath, message: "secret references are allowed only in env, headers, and args" });
    }
  }
  for (const [path, reference] of objectReferences(entry)) {
    if (parseMcpSecretReference(reference) === undefined) {
      issues.push({ keyPath: [...keyPath, ...path].join("."), message: `malformed secret reference "${reference}" (docs/secret-references.md)` });
    }
  }
  return issues;
}

function entryStrings(entry: PicaMcpServerEntry): [string[], string][] {
  const strings: [string[], string][] = [];
  if (entry.name !== undefined) {
    strings.push([["name"], entry.name]);
  }
  if (entry.type === "stdio") {
    strings.push([["command"], entry.command]);
    if (entry.cwd !== undefined) {
      strings.push([["cwd"], entry.cwd]);
    }
    (entry.args ?? []).forEach((arg, index) => strings.push([["args", String(index)], arg]));
    strings.push(...recordStrings("env", entry.env ?? {}));
  } else {
    strings.push([["url"], entry.url]);
    strings.push(...recordStrings("headers", entry.headers ?? {}));
  }
  (entry.tools ?? []).forEach((tool, index) => strings.push([["tools", String(index)], tool]));
  return strings;
}

function recordStrings(field: string, record: Readonly<Record<string, PicaMcpFileValue>>): [string[], string][] {
  return Object.entries(record).flatMap(([key, value]): [string[], string][] =>
    typeof value === "string" ? [[[field, key], value]] : [],
  );
}

function objectReferences(entry: PicaMcpServerEntry): [string[], string][] {
  const record = entry.type === "stdio" ? (entry.env ?? {}) : (entry.headers ?? {});
  const field = entry.type === "stdio" ? "env" : "headers";
  return Object.entries(record).flatMap(([key, value]): [string[], string][] =>
    typeof value === "string" ? [] : [[[field, key], value.secretRef]],
  );
}

function toDefinition(id: string, scope: McpScope, entry: PicaMcpServerEntry): McpServerDef {
  const common = { id, name: entry.name ?? id, toolAllowlist: entry.tools ?? null, scope };
  if (entry.type === "stdio") {
    return {
      ...common,
      transport: {
        type: "stdio",
        command: entry.command,
        args: entry.args ?? [],
        env: protocolValues(entry.env ?? {}),
        cwd: entry.cwd ?? null,
      },
    };
  }
  return { ...common, transport: { type: entry.type, url: entry.url, headers: protocolValues(entry.headers ?? {}) } };
}

function protocolValues(record: Readonly<Record<string, PicaMcpFileValue>>): Record<string, string | SecretRef> {
  const values: Record<string, string | SecretRef> = {};
  for (const [key, value] of Object.entries(record)) {
    const reference = typeof value === "string" ? wholeMcpSecretReference(value) : undefined;
    values[key] = reference === undefined ? value : { secretRef: formatMcpSecretReference(reference) };
  }
  return values;
}
