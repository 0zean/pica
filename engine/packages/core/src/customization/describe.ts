import type { CustomizationItem, CustomizationProblem } from "@pica/protocol";
import type { AgentIssue } from "../agents/index.ts";
import { agentName, validateAgent } from "../agents/index.ts";
import type { Result } from "../result.ts";
import type { LocationSpec } from "./locations.ts";

export interface ParsedFrontmatter {
  readonly frontmatter: unknown;
  readonly body: string;
}

// C-02's frontmatter parser (adapters), so a file here reads exactly as the agent loader reads it.
export type FrontmatterParser = (path: string, text: string) => Result<ParsedFrontmatter, readonly AgentIssue[]>;

// One file as listed, before precedence decides its status.
export type DescribedFile = Omit<CustomizationItem, "status" | "overriddenBy">;

const namePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isValidItemName(name: string): boolean {
  return namePattern.test(name) && !name.endsWith(".md");
}

export function describeFile(spec: LocationSpec, path: string, text: string, parse: FrontmatterParser): DescribedFile {
  const name = itemName(spec, path);
  const checked = check(spec, path, name, text, parse);
  return {
    kind: spec.kind,
    name,
    locationId: spec.id,
    layer: spec.layer,
    repoId: spec.repoId,
    path,
    description: checked.description,
    text,
    problems: checked.problems,
    writable: spec.writable,
    ...(spec.lockedBy === undefined ? {} : { lockedBy: spec.lockedBy }),
  };
}

function itemName(spec: LocationSpec, path: string): string {
  const parts = path.split("/");
  switch (spec.layout) {
    case "agent-files":
      return agentName(path);
    case "skill-folders":
      return parts.at(-2) ?? path;
    case "instruction-files":
      return (parts.at(-1) ?? path).replace(/\.instructions\.md$/, "");
    case "single-file":
      return spec.label;
  }
}

interface Checked {
  readonly description: string | null;
  readonly problems: CustomizationProblem[];
}

function check(spec: LocationSpec, path: string, name: string, text: string, parse: FrontmatterParser): Checked {
  if (spec.kind === "instructions") {
    return { description: null, problems: text.trim() === "" ? [{ field: "text", message: "the file is empty" }] : [] };
  }
  const parsed = parse(path, text);
  if (!parsed.ok) {
    return { description: null, problems: parsed.error.map(problem) };
  }
  if (spec.kind === "agent") {
    return checkAgent(spec, path, parsed.value);
  }
  return checkSkill(name, parsed.value);
}

// The C-02 validator itself, in the layer of the location: what this accepts, the loader accepts.
function checkAgent(spec: LocationSpec, path: string, parsed: ParsedFrontmatter): Checked {
  const validated = validateAgent({ layer: spec.agentLayer ?? "user", path, ...parsed });
  if (validated.ok) {
    return { description: validated.value.description, problems: [] };
  }
  return { description: textField(parsed.frontmatter, "description"), problems: validated.error.map(problem) };
}

// Agent Skills: `description` is required; `name`, when given, is the skill's folder name.
function checkSkill(name: string, parsed: ParsedFrontmatter): Checked {
  const problems: CustomizationProblem[] = [];
  const description = textField(parsed.frontmatter, "description");
  if (description === null) {
    problems.push({ field: "description", message: "required, and must be non-empty text" });
  }
  const declared = isRecord(parsed.frontmatter) ? parsed.frontmatter["name"] : undefined;
  if (declared !== undefined && declared !== name) {
    problems.push({ field: "name", message: `must be the skill's folder name, "${name}"` });
  }
  if (!isValidItemName(name)) {
    problems.push({ field: "name", message: `folder name "${name}" is not a valid skill name` });
  }
  if (parsed.body.trim() === "") {
    problems.push({ field: "prompt", message: "the body after the frontmatter must contain the skill's instructions" });
  }
  return { description, problems };
}

function problem(issue: AgentIssue): CustomizationProblem {
  return { field: issue.field, message: issue.message };
}

function textField(frontmatter: unknown, key: string): string | null {
  const value = isRecord(frontmatter) ? frontmatter[key] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
