import { parseDocument } from "yaml";
import { err, ok } from "@pica/core";
import type { AgentIssue, Result } from "@pica/core";

export interface AgentFile {
  readonly frontmatter: unknown;
  readonly body: string;
}

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseAgentFile(path: string, text: string): Result<AgentFile, AgentIssue[]> {
  const match = frontmatterPattern.exec(text);
  if (match === null) {
    return err([{ file: path, field: "", message: "missing frontmatter: the file must start with a --- block" }]);
  }
  const document = parseDocument(match[1] ?? "", { prettyErrors: false });
  if (document.errors.length > 0) {
    return err(
      document.errors.map((error) => ({
        // Line numbers are within the file; the opening --- is line 1.
        file: `${path}:${String((error.linePos?.[0].line ?? 0) + 1)}`,
        field: "",
        message: error.message.split("\n")[0] ?? error.message,
      })),
    );
  }
  return ok({ frontmatter: document.toJS() as unknown, body: text.slice(match[0].length) });
}
