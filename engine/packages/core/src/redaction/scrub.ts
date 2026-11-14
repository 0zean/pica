import type { JsonValue } from "../json.ts";
import { mcpRedactedText, type McpSecretRedactor } from "../mcp-auth/redact.ts";

// Pattern-based scrubbing for secrets the engine never handled itself: tokens pasted into a prompt,
// printed by a tool, or echoed by an MCP server. docs/redaction.md lists the formats and the
// trade-offs behind each pattern.
export interface SecretPattern {
  readonly name: string;
  readonly pattern: RegExp;
  // Keeps the named groups `before` and `after` around the marker, so a redacted line still shows
  // which header or setting held the secret.
  readonly keepContext?: boolean;
}

// Characters that end an unquoted value in env files, query strings, headers, JSON, and shell.
const valueChar = String.raw`[^\s'"\x60,;&<>()[\]{}\\$]`;
const valueEnd = String.raw`(?=[\s'"\x60,;&<>)\]}\\]|$)`;

// A name such as `token`, `api_key`, `DD_APP_KEY`, `x-api-key`, `client_secret` or `db.password`.
// The last segment must be a whole word, so `monkey`, `max_tokens` and `tokenLimit` do not match.
const sensitiveName = String.raw`(?:[A-Za-z0-9]+[_.-])*(?:key|secret|token|password|passwd|pwd|pat|credentials?|apikey|appkey|accesskey|secretkey|authtoken|accesstoken|refreshtoken)`;

export const sensitiveKeyPattern = new RegExp(String.raw`^${sensitiveName}$`, "i");

export const secretPatterns: readonly SecretPattern[] = [
  {
    name: "pem-private-key",
    // A preview cut short can hold a key with no END line; everything after BEGIN is then redacted.
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----|[\s\S]*$)/g,
  },
  { name: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,255}\b/g },
  { name: "github-fine-grained-pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,255}/g },
  // The Copilot API token: `tid=…;exp=…;sku=…;…:<signature>`.
  { name: "copilot-token", pattern: /\btid=[^;\s"']+;exp=\d+;[^\s"'\\]*/g },
  { name: "clickup-token", pattern: /\bpk_\d+_[A-Za-z0-9]{20,}\b/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g },
  { name: "aws-access-key-id", pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g },
  {
    name: "authorization-header",
    pattern: new RegExp(
      String.raw`(?<before>authorization\\?["']?\s*[:=]\s*\\?["']?(?:(?:Bearer|Basic|token|Token)\s+)?)${valueChar}{8,}${valueEnd}`,
      "gi",
    ),
    keepContext: true,
  },
  {
    name: "bearer-token",
    pattern: new RegExp(String.raw`(?<before>\b[Bb]earer\s+)[A-Za-z0-9._~+/=-]{16,}`, "g"),
    keepContext: true,
  },
  {
    name: "url-credentials",
    pattern: /(?<before>\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:)[^\s@/"']+(?<after>@)/gi,
    keepContext: true,
  },
  {
    name: "quoted-assignment",
    // `name="value"`, `"name": "value"` or `name: 'value'`: everything up to the closing quote. A
    // value that starts with `$` is an environment or `${secret:…}` reference and is left alone.
    pattern: new RegExp(
      String.raw`(?<before>(?<![A-Za-z0-9]|\$\{)${sensitiveName}\\?["']?\s*[:=]\s*\\?(?<quote>["']))(?!\$)[^"'\n\\]+(?=\\?\k<quote>)`,
      "gi",
    ),
    keepContext: true,
  },
  {
    name: "assignment",
    // `name=value`, `name: value` and `--name value`, up to the first character that ends a value in
    // env files, query strings, headers and shell. `${secret:…}` and literals such as `null` are left alone.
    pattern: new RegExp(
      String.raw`(?<before>(?<![A-Za-z0-9]|\$\{)(?:--)?${sensitiveName}(?:\s*[:=]\s*|(?<=--[A-Za-z0-9_.-]+)\s+))` +
        String.raw`(?!(?:true|false|null|undefined|none)${valueEnd})${valueChar}{4,}${valueEnd}`,
      "gi",
    ),
    keepContext: true,
  },
];

export function scrubSecrets(text: string): string {
  let scrubbed = text;
  for (const { pattern, keepContext } of secretPatterns) {
    scrubbed = scrubbed.replace(pattern, keepContext === true ? `$<before>${mcpRedactedText}$<after>` : mcpRedactedText);
  }
  return scrubbed;
}

// Scrubs every string in a JSON-shaped value. A string under a sensitive key is redacted whole,
// unless it is a `${secret:…}` reference, which names a secret rather than holding one.
export function scrubSecretsDeep(value: unknown): JsonValue {
  if (typeof value === "string") {
    return scrubSecrets(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => scrubSecretsDeep(item));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]: [string, unknown]) => [scrubSecrets(key), scrubEntry(key, item)]),
    );
  }
  return null;
}

function scrubEntry(key: string, item: unknown): JsonValue {
  if (typeof item === "string" && item !== "" && sensitiveKeyPattern.test(key) && !isSecretReference(item)) {
    return mcpRedactedText;
  }
  return scrubSecretsDeep(item);
}

function isSecretReference(text: string): boolean {
  return /^\$\{secret:[^}]+\}$/.test(text) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(text);
}

// A redactor that removes the values the engine handled (M-03) and then every known token format,
// so it can stand in for the M-03 redactor in `createRedactingLogger` and `createRedactingEventLog`.
export function createSecretScrubber(known?: McpSecretRedactor): McpSecretRedactor {
  return {
    remember(value) {
      known?.remember(value);
    },
    redact(text) {
      return scrubSecrets(known === undefined ? text : known.redact(text));
    },
  };
}
