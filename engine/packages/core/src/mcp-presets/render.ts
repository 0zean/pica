import type { McpPreset, McpPresetIssue, McpScope, McpServerDef, PicaMcpServerEntry } from "@pica/protocol";
import { buildMcpDefinitions, mcpServerIdPattern } from "../mcp/definitions.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import { publicParameter, validateMcpPresetParameters } from "./parameters.ts";
import { mcpPresetSpecs } from "./presets.ts";
import type { McpPresetContext } from "./presets.ts";

export type McpPresetErrorCode = "mcp_preset.unknown" | "mcp_preset.invalid";

export interface McpPresetError {
  readonly code: McpPresetErrorCode;
  readonly presetId: string;
  readonly message: string;
  readonly issues: readonly McpPresetIssue[];
}

export interface McpPresetRenderOptions {
  // Defaults to the preset id.
  readonly serverId?: string;
  // Defaults to global.
  readonly scope?: McpScope;
}

// A preset a user has configured. Only enabled ones become servers; none is enabled by default.
export interface McpPresetSelection extends McpPresetRenderOptions {
  readonly presetId: string;
  readonly enabled: boolean;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export function listMcpPresets(context: McpPresetContext = {}): McpPreset[] {
  return mcpPresetSpecs.map((spec) => ({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters(context).map(publicParameter),
  }));
}

// The entry as it would be written to Pica's `mcp.jsonc`, with secrets as references.
export function renderMcpPresetEntry(
  presetId: string,
  parameters: Readonly<Record<string, unknown>>,
  context: McpPresetContext = {},
): Result<PicaMcpServerEntry, McpPresetError> {
  const spec = mcpPresetSpecs.find((candidate) => candidate.id === presetId);
  if (spec === undefined) {
    const known = mcpPresetSpecs.map((candidate) => candidate.id).join(", ");
    return err({ code: "mcp_preset.unknown", presetId, message: `No MCP preset ${presetId}; presets are ${known}.`, issues: [] });
  }
  const { values, issues } = validateMcpPresetParameters(spec.parameters(context), parameters);
  if (issues.length > 0) {
    return err(invalid(spec.id, issues));
  }
  const entry = spec.entry(values, context);
  return isIssueList(entry) ? err(invalid(spec.id, entry)) : ok(entry);
}

export function renderMcpPreset(
  presetId: string,
  parameters: Readonly<Record<string, unknown>>,
  options: McpPresetRenderOptions = {},
  context: McpPresetContext = {},
): Result<McpServerDef, McpPresetError> {
  const serverId = options.serverId ?? presetId;
  const entry = renderMcpPresetEntry(presetId, parameters, context);
  if (!entry.ok) {
    return entry;
  }
  if (!mcpServerIdPattern.test(serverId)) {
    return err(invalid(presetId, [{ parameter: "serverId", message: "must match [A-Za-z0-9][A-Za-z0-9._-]*" }]));
  }
  // The same checks a hand-written definition gets, including the inline-secret rule.
  const built = buildMcpDefinitions(`preset:${presetId}`, options.scope ?? "global", [
    { id: serverId, keyPath: [serverId], entry: entry.value },
  ]);
  if (!built.ok) {
    return err(invalid(presetId, built.error.issues.map((issue) => ({ parameter: issue.keyPath, message: issue.message }))));
  }
  const [definition] = built.value;
  return definition === undefined ? err(invalid(presetId, [{ parameter: "serverId", message: "rendered nothing" }])) : ok(definition);
}

// The servers the enabled presets contribute: none unless a user enabled one.
export function renderEnabledMcpPresets(
  selections: readonly McpPresetSelection[],
  context: McpPresetContext = {},
): Result<McpServerDef[], McpPresetError[]> {
  const errors: McpPresetError[] = [];
  const servers: McpServerDef[] = [];
  const used = new Set<string>();
  for (const selection of selections.filter((candidate) => candidate.enabled)) {
    const rendered = renderMcpPreset(selection.presetId, selection.parameters, selection, context);
    if (!rendered.ok) {
      errors.push(rendered.error);
    } else if (used.has(rendered.value.id)) {
      errors.push(invalid(selection.presetId, [{ parameter: "serverId", message: `${rendered.value.id} is already used by another enabled preset` }]));
    } else {
      used.add(rendered.value.id);
      servers.push(rendered.value);
    }
  }
  return errors.length > 0 ? err(errors) : ok(servers);
}

function isIssueList(value: PicaMcpServerEntry | readonly McpPresetIssue[]): value is readonly McpPresetIssue[] {
  return Array.isArray(value);
}

function invalid(presetId: string, issues: readonly McpPresetIssue[]): McpPresetError {
  const lines = issues.map((issue) => `${issue.parameter}: ${issue.message}`);
  return { code: "mcp_preset.invalid", presetId, issues, message: `MCP preset ${presetId}: ${lines.join("; ")}` };
}
