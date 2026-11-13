import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { agentError, err, resolveAgents } from "@pica/core";
import type { AgentDocument, AgentError, AgentIssue, AgentLoader, Result } from "@pica/core";
import type { AgentDef, AgentSourceLayer } from "@pica/protocol";
import { parseAgentFile } from "./frontmatter.ts";

// A directory of agent files, or files held elsewhere (workspace agents live in the store).
export type AgentSource =
  | { readonly layer: AgentSourceLayer; readonly dir: string }
  | { readonly layer: AgentSourceLayer; readonly files: readonly SourceFile[] };

interface SourceFile {
  readonly path: string;
  readonly text: string;
}

interface ReadFailure {
  readonly issue: AgentIssue;
}

export class MarkdownAgentLoader implements AgentLoader {
  readonly #sources: readonly AgentSource[];

  constructor(sources: readonly AgentSource[]) {
    this.#sources = sources;
  }

  load(): Result<readonly AgentDef[], AgentError> {
    const documents: AgentDocument[] = [];
    const readFailures: AgentIssue[] = [];
    const parseFailures: AgentIssue[] = [];
    for (const source of this.#sources) {
      for (const file of readSource(source)) {
        if ("issue" in file) {
          readFailures.push(file.issue);
          continue;
        }
        const parsed = parseAgentFile(file.path, file.text);
        if (parsed.ok) {
          documents.push({ layer: source.layer, path: file.path, ...parsed.value });
        } else {
          parseFailures.push(...parsed.error);
        }
      }
    }
    if (readFailures.length > 0) {
      return err(agentError("agents.read_failed", readFailures));
    }
    if (parseFailures.length > 0) {
      return err(agentError("agents.parse_error", parseFailures));
    }
    return resolveAgents(documents);
  }
}

function readSource(source: AgentSource): (SourceFile | ReadFailure)[] {
  if ("files" in source) {
    return [...source.files];
  }
  const listed = listAgentFiles(source.dir);
  if (!Array.isArray(listed)) {
    return [listed];
  }
  return listed.map((path) => {
    try {
      return { path, text: readFileSync(path, "utf8") };
    } catch (thrown) {
      return failure(path, thrown);
    }
  });
}

// A missing directory is an absent layer, not an error.
function listAgentFiles(dir: string): string[] | ReadFailure {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (thrown) {
    return isMissing(thrown) ? [] : failure(dir, thrown);
  }
  return names
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => join(dir, name));
}

function failure(file: string, thrown: unknown): ReadFailure {
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  return { issue: { file, field: "", message } };
}

function isMissing(thrown: unknown): boolean {
  return typeof thrown === "object" && thrown !== null && "code" in thrown && thrown.code === "ENOENT";
}
