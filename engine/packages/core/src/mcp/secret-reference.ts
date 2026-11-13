// The secret-reference syntax M-03 resolves (docs/secret-references.md).
//
// A reference names where a secret lives, never the secret: `<provider>:<name>`. In a string it is
// written `${secret:<provider>:<name>}`; a value that is a single reference becomes the protocol's
// `{ secretRef: "<provider>:<name>" }`.

export type McpSecretProvider = "keychain" | "env";

export interface McpSecretReference {
  readonly provider: McpSecretProvider;
  readonly name: string;
}

export interface McpSecretScan {
  readonly references: readonly McpSecretReference[];
  readonly malformed: readonly string[];
  // The value with every `${secret:…}` placeholder removed.
  readonly literal: string;
}

const namePatterns: Readonly<Record<McpSecretProvider, RegExp>> = {
  keychain: /^[A-Za-z0-9][A-Za-z0-9._/-]*$/,
  env: /^[A-Za-z_][A-Za-z0-9_]*$/,
};

const placeholderPattern = /\$\{secret:([^}]*)\}/g;
const wholePlaceholderPattern = /^\$\{secret:([^}]*)\}$/;

export function parseMcpSecretReference(text: string): McpSecretReference | undefined {
  const separator = text.indexOf(":");
  if (separator < 0) {
    return undefined;
  }
  const provider = text.slice(0, separator);
  const name = text.slice(separator + 1);
  if (provider !== "keychain" && provider !== "env") {
    return undefined;
  }
  return namePatterns[provider].test(name) ? { provider, name } : undefined;
}

export function formatMcpSecretReference(reference: McpSecretReference): string {
  return `${reference.provider}:${reference.name}`;
}

export function mcpSecretPlaceholder(reference: McpSecretReference): string {
  return `\${secret:${formatMcpSecretReference(reference)}}`;
}

export function scanMcpSecretPlaceholders(value: string): McpSecretScan {
  const references: McpSecretReference[] = [];
  const malformed: string[] = [];
  for (const match of value.matchAll(placeholderPattern)) {
    const reference = parseMcpSecretReference(match[1] ?? "");
    if (reference === undefined) {
      malformed.push(match[0]);
    } else {
      references.push(reference);
    }
  }
  return { references, malformed, literal: value.replace(placeholderPattern, "") };
}

// The reference when `value` is exactly one placeholder and nothing else.
export function wholeMcpSecretReference(value: string): McpSecretReference | undefined {
  const match = wholePlaceholderPattern.exec(value);
  return match === null ? undefined : parseMcpSecretReference(match[1] ?? "");
}
