import { Tier } from "@pica/protocol";
import type { AgentDef, AgentSourceLayer } from "@pica/protocol";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import type { AgentIssue } from "./errors.ts";
import { expandTool } from "./tool-catalog.ts";

// One agent file after its frontmatter has been parsed, before validation.
export interface AgentDocument {
  readonly layer: AgentSourceLayer;
  readonly path: string;
  readonly frontmatter: unknown;
  readonly body: string;
}

// Copilot custom-agent fields that Pica accepts in a file but does not use. `model` is ignored
// because tiers choose the model (D-09).
const ignoredFields = new Set([
  "name",
  "model",
  "target",
  "infer",
  "disable-model-invocation",
  "user-invocable",
  "mcp-servers",
  "metadata",
]);
const usedFields = new Set(["description", "tier", "tools"]);
const namePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validateAgent(document: AgentDocument): Result<AgentDef, readonly AgentIssue[]> {
  const issues: AgentIssue[] = [];
  const issue = (field: string, message: string): void => {
    issues.push({ file: document.path, field, message });
  };

  const name = agentName(document.path);
  if (!namePattern.test(name)) {
    issue("name", `file name "${name}" is not a valid agent name`);
  }
  const fields = isRecord(document.frontmatter) ? document.frontmatter : {};
  if (!isRecord(document.frontmatter)) {
    issue("", "frontmatter must be a mapping");
  }
  for (const key of Object.keys(fields)) {
    if (!usedFields.has(key) && !ignoredFields.has(key)) {
      issue(key, "unknown field");
    }
  }
  const description = fields.description;
  if (typeof description !== "string" || description.trim() === "") {
    issue("description", "required, and must be non-empty text");
  }
  const tier = Tier.safeParse(fields.tier ?? "worker");
  if (!tier.success) {
    issue("tier", `unknown tier ${JSON.stringify(fields.tier)}; expected one of ${Tier.options.join(", ")}`);
  }
  const tools = validateTools(fields.tools, document.layer, issue);
  const prompt = document.body.trim();
  if (prompt === "") {
    issue("prompt", "the body after the frontmatter must contain the agent's prompt");
  }

  if (issues.length > 0 || !tier.success || typeof description !== "string") {
    return err(issues);
  }
  return ok({
    name,
    description: description.trim(),
    tier: tier.data,
    tools,
    prompt,
    sourceLayer: document.layer,
    sourcePath: document.layer === "builtin" ? null : document.path,
  });
}

// Copilot accepts a YAML list or one comma-separated string.
function validateTools(
  value: unknown,
  layer: AgentSourceLayer,
  issue: (field: string, message: string) => void,
): string[] {
  const listed = typeof value === "string" ? value.split(",").map((tool) => tool.trim()) : value;
  if (!Array.isArray(listed) || listed.length === 0) {
    issue("tools", "required: list the agent's tools explicitly");
    return [];
  }
  const expanded = new Set<string>();
  for (const [index, tool] of listed.entries()) {
    const names = typeof tool === "string" ? expandTool(tool, layer) : undefined;
    if (tool === "*") {
      issue(`tools[${String(index)}]`, `"*" is not allowed; list the agent's tools explicitly`);
    } else if (names === undefined) {
      issue(`tools[${String(index)}]`, `unknown tool ${JSON.stringify(tool)}`);
    } else {
      names.forEach((name) => expanded.add(name));
    }
  }
  return [...expanded].sort();
}

// The file name is the agent's identity, as in Copilot: `bulk-reader.md` or `bulk-reader.agent.md`.
export function agentName(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/(\.agent)?\.md$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
