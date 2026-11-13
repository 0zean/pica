import { readFileSync } from "node:fs";
import { err, ok, type Result } from "@pica/core";
import {
  findNodeAtLocation,
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError,
} from "jsonc-parser";
import type { ZodType } from "zod";
import { scenarioSchema, type Scenario } from "./scenario-schema.ts";

export interface ScenarioIssue {
  readonly line: number;
  readonly column: number;
  readonly path: string;
  readonly message: string;
}

export interface ScenarioError {
  readonly file: string;
  readonly issues: readonly ScenarioIssue[];
}

// One line per issue, `file:line:column: path: message`, so editors can jump to it.
export function formatScenarioError(error: ScenarioError): string {
  return error.issues
    .map((issue) => `${error.file}:${String(issue.line)}:${String(issue.column)}: ${issue.path}: ${issue.message}`)
    .join("\n");
}

export function loadScenarioFile(file: string): Result<Scenario, ScenarioError> {
  return parseScenario(readFileSync(file, "utf8"), file);
}

export function parseScenario(text: string, file: string): Result<Scenario, ScenarioError> {
  return parseJsoncWithSchema(text, file, scenarioSchema);
}

// Shared by scenario files and Copilot replay transcripts: JSONC in, schema-checked value out.
export function parseJsoncWithSchema<T>(text: string, file: string, schema: ZodType<T>): Result<T, ScenarioError> {
  const syntaxErrors: ParseError[] = [];
  const tree = parseTree(text, syntaxErrors, { allowTrailingComma: true, disallowComments: false });
  if (syntaxErrors.length > 0 || tree === undefined) {
    const issues = syntaxErrors.map((parseError) => ({
      ...position(text, parseError.offset),
      path: "(syntax)",
      message: printParseErrorCode(parseError.error),
    }));
    return err({ file, issues: issues.length > 0 ? issues : [{ line: 1, column: 1, path: "(syntax)", message: "empty file" }] });
  }
  const parsed = schema.safeParse(getNodeValue(tree) as unknown);
  if (parsed.success) {
    return ok(parsed.data);
  }
  const issues = parsed.error.issues.map((issue) => {
    const path = issue.path.filter((segment) => typeof segment !== "symbol");
    // Point at the offending key itself rather than the object that contains it.
    if (issue.code === "unrecognized_keys" && issue.keys[0] !== undefined) {
      path.push(issue.keys[0]);
    }
    return {
      ...position(text, nearestNode(tree, path).offset),
      path: path.length === 0 ? "(root)" : path.join("."),
      message: issue.message,
    };
  });
  return err({ file, issues });
}

// Missing keys have no node of their own, so the issue points at the closest enclosing value.
function nearestNode(tree: Node, path: readonly (string | number)[]): Node {
  for (let length = path.length; length > 0; length -= 1) {
    const node = findNodeAtLocation(tree, path.slice(0, length));
    if (node !== undefined) {
      return node.parent?.type === "property" ? node.parent : node;
    }
  }
  return tree;
}

function position(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line: before.split("\n").length, column: offset - lineStart + 1 };
}
