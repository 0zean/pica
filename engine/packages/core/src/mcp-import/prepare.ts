import { PicaMcpServerEntry } from "@pica/protocol";
import type { McpFileImportedFrom, McpImportNote, McpScope, McpServerDef } from "@pica/protocol";
import { buildMcpDefinitions, mcpServerIdPattern } from "../mcp/definitions.ts";
import { findMcpInlineSecretPaths } from "../mcp/inline-secrets.ts";
import { formatMcpSecretReference, mcpSecretPlaceholder, scanMcpSecretPlaceholders } from "../mcp/secret-reference.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";

// A secret moved out of an entry: the app stores `value` in the Keychain under `secretRef`.
export interface MovedMcpSecret {
  readonly secretRef: string;
  readonly keyPath: string;
  readonly value: string;
}

export interface PreparedMcpImport {
  readonly id: string;
  // The entry as written to `mcp.jsonc`: secrets replaced by references, origin recorded.
  readonly entry: Readonly<Record<string, unknown>>;
  readonly definition: McpServerDef;
  readonly secrets: readonly MovedMcpSecret[];
}

export interface McpImportDraft {
  readonly keyPath: readonly string[];
  readonly entry: Readonly<Record<string, unknown>>;
  readonly importedFrom: McpFileImportedFrom;
}

const authScheme = /^(\s*(?:bearer|basic|token|apikey|api-key)\s+)(\S.*)$/i;

// Moves every inline secret (docs/secret-references.md) into a keychain reference named
// `mcp/<id>/<field>`, the names M-03's settings pane lists under the server.
export function prepareMcpImport(draft: McpImportDraft, id: string, scope: McpScope): Result<PreparedMcpImport, McpImportNote[]> {
  const at = (...rest: readonly string[]): string => [...draft.keyPath, ...rest].join(".");
  if (!mcpServerIdPattern.test(id)) {
    return err([{ keyPath: at(), message: `server id "${id}" must match [A-Za-z0-9][A-Za-z0-9._-]*` }]);
  }
  const parsed = PicaMcpServerEntry.safeParse(draft.entry);
  if (!parsed.success) {
    return err(definitionIssues(draft, id, scope, draft.entry));
  }
  const entry = structuredClone(parsed.data) as Record<string, unknown>;
  const secrets: MovedMcpSecret[] = [];
  const issues: McpImportNote[] = [];
  const names = new Set<string>();
  const secretName = (label: string): string => {
    const base = `mcp/${id}/${label.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "secret"}`;
    let name = base;
    for (let n = 2; names.has(name); n++) {
      name = `${base}-${String(n)}`;
    }
    names.add(name);
    return name;
  };
  for (const path of findMcpInlineSecretPaths(parsed.data, [])) {
    const moved = moveSecret(entry, path, secretName);
    if ("issue" in moved) {
      issues.push({ keyPath: at(...path), message: moved.issue });
    } else {
      secrets.push({ ...moved, keyPath: at(...path) });
    }
  }
  if (issues.length > 0) {
    return err(issues);
  }
  const written = { ...entry, importedFrom: draft.importedFrom };
  const built = buildMcpDefinitions("import", scope, [{ id, keyPath: draft.keyPath, entry: written }]);
  if (!built.ok) {
    return err(built.error.issues.map(({ keyPath, message }) => ({ keyPath, message })));
  }
  const definition = built.value[0];
  return definition === undefined ? err([{ keyPath: at(), message: "not a server entry" }]) : ok({ id, entry: written, definition, secrets });
}

function definitionIssues(draft: McpImportDraft, id: string, scope: McpScope, entry: Readonly<Record<string, unknown>>): McpImportNote[] {
  const built = buildMcpDefinitions("import", scope, [{ id, keyPath: draft.keyPath, entry }]);
  return built.ok ? [] : built.error.issues.map(({ keyPath, message }) => ({ keyPath, message }));
}

type Moved = { readonly secretRef: string; readonly value: string } | { readonly issue: string };

function moveSecret(entry: Record<string, unknown>, path: readonly string[], secretName: (label: string) => string): Moved {
  const [field, key] = path;
  if (field === "env" || field === "headers") {
    const record = entry[field] as Record<string, unknown>;
    const value = record[key ?? ""];
    if (typeof value !== "string" || key === undefined) {
      return { issue: "not a string" };
    }
    const replaced = replaceSecret(value, secretName(key));
    if (!("issue" in replaced)) {
      record[key] = replaced.text;
    }
    return replaced;
  }
  if (field === "args") {
    const args = entry["args"] as string[];
    const index = Number(key);
    const arg = args[index] ?? "";
    const flag = /^(--?([A-Za-z0-9_-]+)=)(.*)$/.exec(arg);
    const previous = /^--?([A-Za-z0-9_-]+)$/.exec(args[index - 1] ?? "");
    const label = `args-${flag?.[2] ?? previous?.[1] ?? String(index)}`;
    const replaced = replaceSecret(flag === null ? arg : (flag[3] ?? ""), secretName(label));
    if (!("issue" in replaced)) {
      args[index] = flag === null ? replaced.text : `${flag[1] ?? ""}${replaced.text}`;
    }
    return replaced;
  }
  return { issue: `holds a secret, and Pica allows secret references only in env, headers, and args; remove it from ${field ?? "the entry"} before importing` };
}

function replaceSecret(value: string, name: string): ({ readonly text: string } & Moved) | { readonly issue: string } {
  if (scanMcpSecretPlaceholders(value).references.length > 0) {
    return { issue: "mixes a secret reference with an inline secret; edit it so the secret is in one place" };
  }
  const reference = { provider: "keychain" as const, name };
  const secretRef = formatMcpSecretReference(reference);
  const scheme = authScheme.exec(value);
  if (scheme !== null) {
    return { text: `${scheme[1] ?? ""}${mcpSecretPlaceholder(reference)}`, secretRef, value: scheme[2] ?? "" };
  }
  return { text: mcpSecretPlaceholder(reference), secretRef, value };
}
