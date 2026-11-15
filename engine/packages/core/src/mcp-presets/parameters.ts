import type { McpPresetIssue, McpPresetParameter } from "@pica/protocol";
import { formatMcpSecretReference, parseMcpSecretReference, wholeMcpSecretReference } from "../mcp/secret-reference.ts";

// A parameter as a preset declares it. `missing` replaces the generic "is required" message when
// the reason is worth explaining (for example an endpoint Pica does not know).
export interface McpPresetParameterSpec extends McpPresetParameter {
  readonly missing?: string;
}

export type McpPresetValues = Readonly<Record<string, string>>;

export function parameter(
  spec: Pick<McpPresetParameterSpec, "name" | "label" | "description" | "kind"> & Partial<McpPresetParameterSpec>,
): McpPresetParameterSpec {
  return { required: false, default: null, choices: null, examples: [], onlyWhen: null, ...spec };
}

export function publicParameter(spec: McpPresetParameterSpec): McpPresetParameter {
  return {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    kind: spec.kind,
    required: spec.required,
    default: spec.default,
    choices: spec.choices,
    examples: spec.examples,
    onlyWhen: spec.onlyWhen,
  };
}

const hostnamePattern = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
// Snowflake unquoted identifiers.
const identifierPattern = /^[A-Za-z_][A-Za-z0-9_$]{0,254}$/;

const secretRefMessage =
  "must be a secret reference such as keychain:<name> or env:<NAME>, never the secret itself (docs/secret-references.md)";

// Checks raw input against the declared parameters and returns the values with defaults applied.
// Messages never repeat a value: a mistyped secret reference may be the secret itself.
export function validateMcpPresetParameters(
  specs: readonly McpPresetParameterSpec[],
  input: Readonly<Record<string, unknown>>,
): { readonly values: McpPresetValues; readonly issues: readonly McpPresetIssue[] } {
  const issues: McpPresetIssue[] = [];
  const raw: Record<string, string> = {};
  const known = new Set(specs.map((spec) => spec.name));
  for (const [name, value] of Object.entries(input)) {
    if (!known.has(name)) {
      issues.push({ parameter: name, message: "unknown parameter" });
    } else if (typeof value !== "string") {
      issues.push({ parameter: name, message: "must be a string" });
    } else if (value.trim() !== "") {
      raw[name] = value.trim();
    }
  }
  const values: Record<string, string> = {};
  for (const spec of specs) {
    const given = raw[spec.name];
    if (!applies(spec, values)) {
      if (given !== undefined) {
        const when = spec.onlyWhen;
        issues.push({ parameter: spec.name, message: `applies only when ${when?.parameter ?? ""} is ${(when?.values ?? []).join(" or ")}` });
      }
      continue;
    }
    const value = given ?? spec.default ?? undefined;
    if (value === undefined) {
      if (spec.required) {
        issues.push({ parameter: spec.name, message: spec.missing ?? "is required" });
      }
      continue;
    }
    const checked = checkKind(spec, value);
    if (typeof checked === "string") {
      values[spec.name] = checked;
    } else {
      issues.push({ parameter: spec.name, message: checked.message });
    }
  }
  return { values, issues };
}

function applies(spec: McpPresetParameterSpec, values: McpPresetValues): boolean {
  if (spec.onlyWhen === null) {
    return true;
  }
  const current = values[spec.onlyWhen.parameter];
  return current !== undefined && spec.onlyWhen.values.includes(current);
}

function checkKind(spec: McpPresetParameterSpec, value: string): string | { readonly message: string } {
  switch (spec.kind) {
    case "choice":
      return spec.choices?.includes(value) === true ? value : { message: `must be one of ${(spec.choices ?? []).join(", ")}` };
    case "hostname": {
      const host = value.toLowerCase();
      return hostnamePattern.test(host) ? host : { message: "must be a host name such as example.com, without a scheme or path" };
    }
    case "identifier":
      return identifierPattern.test(value)
        ? value
        : { message: "must be an identifier: a letter or underscore, then letters, digits, _ or $" };
    case "url":
      return checkUrl(value);
    case "secretRef": {
      const reference = wholeMcpSecretReference(value) ?? parseMcpSecretReference(value);
      return reference === undefined ? { message: secretRefMessage } : formatMcpSecretReference(reference);
    }
    case "text":
      return value;
  }
}

// An https URL without credentials; a bare host is read as `https://<host>`.
function checkUrl(value: string): string | { readonly message: string } {
  const message = "must be an https URL such as https://example.com/path, without credentials";
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  if (!URL.canParse(candidate)) {
    return { message };
  }
  const url = new URL(candidate);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || !hostnamePattern.test(url.hostname)) {
    return { message };
  }
  return url.href;
}
