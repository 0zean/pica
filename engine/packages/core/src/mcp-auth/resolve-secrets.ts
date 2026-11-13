import type { McpServerDef, McpTransport, SecretRef } from "@pica/protocol";
import {
  formatMcpSecretReference,
  parseMcpSecretReference,
  scanMcpSecretPlaceholders,
  type McpSecretReference,
} from "../mcp/secret-reference.ts";
import { err, ok, type Result } from "../result.ts";
import { mcpMalformedSecret, mcpSecretSourceFailed, mcpSecretUnresolved, type McpAuthError } from "./errors.ts";
import type { McpSecretRedactor } from "./redact.ts";
import type { McpSecretSources } from "./secret-source.ts";

export type McpLaunchTransport =
  | {
      readonly type: "stdio";
      readonly command: string;
      readonly args: readonly string[];
      readonly env: Readonly<Record<string, string>>;
      readonly cwd: string | null;
    }
  | { readonly type: "http" | "sse"; readonly url: string; readonly headers: Readonly<Record<string, string>> };

// A server definition with every secret reference replaced by its value, ready to hand to the runtime.
// It holds secrets: it is never logged, stored, or sent to the client.
export interface McpServerLaunch {
  readonly serverId: string;
  readonly name: string;
  readonly transport: McpLaunchTransport;
  readonly toolAllowlist: readonly string[] | null;
}

type SecretValue = string | SecretRef;

const placeholderPattern = /\$\{secret:([^}]*)\}/g;

// Reads every reference in `env`, `headers`, and `args` once, in definition order, and substitutes it.
// Each value read is given to `redactor` before it is returned.
export async function resolveMcpServerSecrets(
  definition: McpServerDef,
  sources: McpSecretSources,
  redactor: McpSecretRedactor,
): Promise<Result<McpServerLaunch, McpAuthError>> {
  const references = collectReferences(definition.id, definition.transport);
  if (!references.ok) {
    return references;
  }
  const values = new Map<string, string>();
  const unresolved: McpSecretReference[] = [];
  for (const reference of references.value) {
    const read = await sources[reference.provider].read(reference);
    if (!read.ok) {
      return err(mcpSecretSourceFailed(definition.id, reference, redactor.redact(read.error.message)));
    }
    if (read.value === null || read.value.length === 0) {
      unresolved.push(reference);
    } else {
      redactor.remember(read.value);
      values.set(formatMcpSecretReference(reference), read.value);
    }
  }
  if (unresolved.length > 0) {
    return err(mcpSecretUnresolved(definition.id, unresolved));
  }
  return ok({
    serverId: definition.id,
    name: definition.name,
    transport: substituteTransport(definition.transport, values),
    toolAllowlist: definition.toolAllowlist,
  });
}

function collectReferences(
  serverId: string,
  transport: McpTransport,
): Result<readonly McpSecretReference[], McpAuthError> {
  const found = new Map<string, McpSecretReference>();
  const values: SecretValue[] =
    transport.type === "stdio"
      ? [...transport.args, ...Object.values(transport.env)]
      : Object.values(transport.headers);
  for (const value of values) {
    if (typeof value !== "string") {
      const reference = parseMcpSecretReference(value.secretRef);
      if (reference === undefined) {
        return err(mcpMalformedSecret(serverId, `{ secretRef: "${value.secretRef}" }`));
      }
      found.set(formatMcpSecretReference(reference), reference);
      continue;
    }
    const scan = scanMcpSecretPlaceholders(value);
    const malformed = scan.malformed[0];
    if (malformed !== undefined) {
      return err(mcpMalformedSecret(serverId, malformed));
    }
    for (const reference of scan.references) {
      found.set(formatMcpSecretReference(reference), reference);
    }
  }
  return ok([...found.values()]);
}

function substituteTransport(transport: McpTransport, values: ReadonlyMap<string, string>): McpLaunchTransport {
  if (transport.type === "stdio") {
    return {
      type: "stdio",
      command: transport.command,
      args: transport.args.map((arg) => substitute(arg, values)),
      env: substituteRecord(transport.env, values),
      cwd: transport.cwd,
    };
  }
  return { type: transport.type, url: transport.url, headers: substituteRecord(transport.headers, values) };
}

function substituteRecord(
  record: Readonly<Record<string, SecretValue>>,
  values: ReadonlyMap<string, string>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, substitute(value, values)]));
}

function substitute(value: SecretValue, values: ReadonlyMap<string, string>): string {
  if (typeof value !== "string") {
    return values.get(value.secretRef) ?? "";
  }
  // One pass with a function replacer, so a secret is inserted literally and never itself substituted.
  return value.replace(placeholderPattern, (placeholder, inner: string) => {
    const reference = parseMcpSecretReference(inner);
    return reference === undefined ? placeholder : (values.get(formatMcpSecretReference(reference)) ?? "");
  });
}
