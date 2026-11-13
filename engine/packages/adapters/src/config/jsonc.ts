import { configError, err, ok } from "@pica/core";
import type { ConfigError, ConfigIssue, Result } from "@pica/core";
import { findNodeAtLocation, getNodeValue, parseTree, printParseErrorCode } from "jsonc-parser";
import type { Node, ParseError } from "jsonc-parser";

export interface ParsedConfigFile {
  readonly file: string;
  readonly text: string;
  readonly tree: Node | undefined;
  readonly value: unknown;
}

const options = { disallowComments: false, allowTrailingComma: true, allowEmptyContent: true };

export function parseConfigFile(file: string, text: string): Result<ParsedConfigFile, ConfigError> {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, options);
  if (errors.length > 0) {
    const issues = errors.map((error) => ({
      keyPath: "",
      message: printParseErrorCode(error.error),
      ...lineAndColumn(text, error.offset),
    }));
    return err(configError("config.parse_error", file, issues));
  }
  const value: unknown = tree === undefined ? {} : getNodeValue(tree);
  return ok({ file, text, tree, value });
}

// Adds the line and column of each issue's key to a validation error for this file.
export function locateIssues(error: ConfigError, parsed: ParsedConfigFile): ConfigError {
  const issues: ConfigIssue[] = error.issues.map((issue) => {
    const offset = keyOffset(parsed.tree, issue.keyPath);
    return offset === undefined ? issue : { ...issue, ...lineAndColumn(parsed.text, offset) };
  });
  return configError(error.code, error.file, issues);
}

function keyOffset(tree: Node | undefined, keyPath: string): number | undefined {
  if (tree === undefined) {
    return undefined;
  }
  const path = keyPath === "" ? [] : keyPath.split(".");
  for (let length = path.length; length >= 0; length -= 1) {
    const node = findNodeAtLocation(tree, path.slice(0, length));
    if (node !== undefined) {
      const property = node.parent?.type === "property" ? node.parent : undefined;
      return (property ?? node).offset;
    }
  }
  return undefined;
}

function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line: before.split("\n").length, column: offset - lineStart + 1 };
}
