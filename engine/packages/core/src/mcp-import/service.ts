import type {
  McpFileImportedFrom,
  McpImportCandidate,
  McpImportNote,
  McpImportPlatform,
  McpImportSelection,
  McpImportSnippet,
  McpImportSource,
  McpServerDef,
} from "@pica/protocol";
import type { ConfigError } from "../config/errors.ts";
import { isRecord } from "../mcp/import/foreign.ts";
import type { ForeignImport } from "../mcp/import/foreign.ts";
import { err, ok } from "../result.ts";
import type { Result } from "../result.ts";
import { homeRelative, isWithin } from "./key-paths.ts";
import { parseMcpSnippet } from "./paste.ts";
import { readMcpPlatformFile } from "./platforms.ts";
import type { McpPlatformFileRead } from "./platforms.ts";
import { prepareMcpImport } from "./prepare.ts";
import type { McpImportDraft, PreparedMcpImport } from "./prepare.ts";

// Where imported entries are written: Pica's own `mcp.jsonc` at one scope.
export type McpImportTarget =
  | { readonly scope: "global" }
  | { readonly scope: "workspace"; readonly workspaceId: string }
  | { readonly scope: "repo"; readonly repoRoot: string };

export interface McpImportWrite {
  readonly id: string;
  readonly entry: Readonly<Record<string, unknown>>;
}

// Adapter port: finds platform files and reads and writes Pica's `mcp.jsonc`.
export interface McpImportFiles {
  // Every platform file that exists. A missing file is left out; one that cannot be read or
  // parsed is returned as unreadable. Never throws.
  discover(repoRoot?: string): readonly McpPlatformFileRead[];
  // The target file's parsed value, undefined when it does not exist yet.
  readTarget(target: McpImportTarget): Result<{ readonly file: string; readonly value: unknown }, ConfigError>;
  // Adds the entries under `servers`, keeping the rest of the file (comments included).
  writeTarget(target: McpImportTarget, entries: readonly McpImportWrite[]): Result<{ readonly file: string }, ConfigError>;
}

// Stores a secret in the app's Keychain broker (`secrets.set`).
export interface McpSecretWriter {
  store(secretRef: string, value: string): Promise<Result<void, { readonly message: string }>>;
}

export type McpImportErrorCode =
  | "mcp_import.malformed_snippet"
  | "mcp_import.invalid_request"
  | "mcp_import.unknown_candidate"
  | "mcp_import.not_importable"
  | "mcp_import.conflict"
  | "mcp_import.secret_store_failed"
  | "mcp_import.file_failed";

export interface McpImportError {
  readonly code: McpImportErrorCode;
  readonly message: string;
  readonly issues: readonly McpImportNote[];
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface McpImportOutcome {
  readonly servers: readonly McpServerDef[];
  readonly file: string;
  readonly secretRefs: readonly string[];
  readonly notes: readonly McpImportNote[];
}

export interface McpCandidatesRequest {
  readonly repoRoot?: string;
  readonly snippet?: McpImportSnippet;
}

export interface McpImportRequest {
  readonly target: McpImportTarget;
  // Where candidates are discovered; the repo whose project files were listed.
  readonly repoRoot?: string;
  readonly candidates?: readonly McpImportSelection[];
  readonly snippet?: McpImportSnippet;
  readonly secrets: McpSecretWriter;
}

export interface McpImportService {
  candidates(request: McpCandidatesRequest): Result<McpImportSource[], McpImportError>;
  // Stores the moved secrets, then writes the file. Nothing is attached to any session.
  import(request: McpImportRequest): Promise<Result<McpImportOutcome, McpImportError>>;
}

export interface McpImportServiceDeps {
  readonly files: McpImportFiles;
  // Written as `~` in recorded origins and listed sources.
  readonly home?: string;
}

interface Candidate extends McpImportDraft {
  readonly view: McpImportCandidate;
}

interface SourceCandidates {
  readonly source: McpImportSource;
  readonly candidates: readonly Candidate[];
}

export function createMcpImportService(deps: McpImportServiceDeps): McpImportService {
  const display = (path: string): string => homeRelative(path, deps.home);

  const discover = (repoRoot: string | undefined): SourceCandidates[] =>
    deps.files.discover(repoRoot).map((file) => {
      if ("unreadable" in file) {
        const source = { platform: file.platform, source: display(file.file), candidates: [], notes: [{ keyPath: "", message: `could not be read: ${file.unreadable}` }] };
        return { source, candidates: [] };
      }
      return sourceCandidates(file.platform, display(file.file), readMcpPlatformFile(file).map((section) => ({
        project: section.project === null ? null : display(section.project),
        imported: section.imported,
        relabel: (path: string) => path,
      })));
    });

  const pasted = (snippet: McpImportSnippet): Result<SourceCandidates, McpImportError> => {
    const parsed = parseMcpSnippet(snippet.text, snippet.name);
    if (!parsed.ok) {
      const where = parsed.error.keyPath === "" ? "the snippet" : parsed.error.keyPath;
      return err({ code: "mcp_import.malformed_snippet", message: `${where}: ${parsed.error.message}`, issues: [parsed.error] });
    }
    return ok(sourceCandidates("paste", "paste", [{ project: null, imported: parsed.value.imported, relabel: parsed.value.relabel }]));
  };

  return {
    candidates(request) {
      if (request.snippet !== undefined) {
        const found = pasted(request.snippet);
        return found.ok ? ok([found.value.source]) : found;
      }
      return ok(discover(request.repoRoot).map((found) => found.source));
    },

    async import(request) {
      const chosen = choose(request, discover, pasted);
      if (!chosen.ok) {
        return chosen;
      }
      const existing = deps.files.readTarget(request.target);
      if (!existing.ok) {
        return err(fileFailed(existing.error));
      }
      const prepared = prepareAll(chosen.value, request.target.scope, existingIds(existing.value.value));
      if (!prepared.ok) {
        return prepared;
      }
      const secrets = prepared.value.flatMap((entry) => entry.secrets);
      for (const secret of secrets) {
        const stored = await request.secrets.store(secret.secretRef, secret.value);
        if (!stored.ok) {
          return err({
            code: "mcp_import.secret_store_failed",
            message: `The secret at ${secret.keyPath} could not be stored as ${secret.secretRef}: ${stored.error.message}. Nothing was imported.`,
            issues: [{ keyPath: secret.keyPath, message: stored.error.message }],
            details: { secretRef: secret.secretRef },
          });
        }
      }
      const written = deps.files.writeTarget(request.target, prepared.value.map(({ id, entry }) => ({ id, entry })));
      if (!written.ok) {
        return err(fileFailed(written.error));
      }
      return ok({
        servers: prepared.value.map((entry) => entry.definition),
        file: written.value.file,
        secretRefs: secrets.map((secret) => secret.secretRef),
        notes: chosen.value.flatMap(({ candidate }) => candidate.view.notes),
      });
    },
  };
}

interface Section {
  readonly project: string | null;
  readonly imported: ForeignImport;
  readonly relabel: (keyPath: string) => string;
}

function sourceCandidates(platform: McpImportPlatform, source: string, sections: readonly Section[]): SourceCandidates {
  const candidates: Candidate[] = [];
  const notes: McpImportNote[] = [];
  for (const { project, imported, relabel } of sections) {
    const claimed = new Set<object>();
    for (const input of imported.entries) {
      const prefix = input.keyPath.join(".");
      const mine = (list: readonly { readonly keyPath: string; readonly message: string }[]): McpImportNote[] =>
        list.filter((item) => isWithin(item.keyPath, prefix)).map((item) => {
          claimed.add(item);
          return { keyPath: relabel(item.keyPath), message: item.message };
        });
      const name = input.keyPath.at(-1) ?? input.id;
      const importedFrom: McpFileImportedFrom = {
        platform,
        ...(platform === "paste" ? {} : { source }),
        name,
        ...(project === null || platform !== "claude-code" ? {} : { project }),
      };
      const draft: McpImportDraft = { keyPath: input.keyPath, entry: input.entry, importedFrom };
      const issues = mine(imported.issues);
      const preview = issues.length === 0 ? prepareMcpImport(draft, input.id, "global") : undefined;
      const allIssues = preview === undefined || preview.ok ? issues : preview.error.map((issue) => ({ ...issue, keyPath: relabel(issue.keyPath) }));
      const definition = preview?.ok === true ? preview.value.definition : undefined;
      candidates.push({
        ...draft,
        view: {
          candidateId: JSON.stringify([platform, source, ...input.keyPath]),
          platform,
          name,
          id: input.id,
          project: platform === "claude-code" ? project : null,
          transport: definition?.transport ?? null,
          toolAllowlist: definition?.toolAllowlist ?? null,
          secretFields: preview?.ok === true ? preview.value.secrets.map((secret) => relabel(secret.keyPath)) : [],
          notes: mine(imported.notes),
          issues: allIssues,
        },
      });
    }
    for (const item of [...imported.notes, ...imported.issues]) {
      if (!claimed.has(item)) {
        notes.push({ keyPath: relabel(item.keyPath), message: item.message });
      }
    }
  }
  return { source: { platform, source, candidates: candidates.map((candidate) => candidate.view), notes }, candidates };
}

interface Chosen {
  readonly candidate: Candidate;
  readonly id: string;
}

function choose(
  request: McpImportRequest,
  discover: (repoRoot: string | undefined) => SourceCandidates[],
  pasted: (snippet: McpImportSnippet) => Result<SourceCandidates, McpImportError>,
): Result<Chosen[], McpImportError> {
  if ((request.candidates === undefined) === (request.snippet === undefined)) {
    return err({ code: "mcp_import.invalid_request", message: "Give either candidates or a snippet to import.", issues: [] });
  }
  if (request.snippet !== undefined) {
    const found = pasted(request.snippet);
    if (!found.ok) {
      return found;
    }
    const blocked = found.value.candidates.flatMap((candidate) => candidate.view.issues);
    const first = blocked[0];
    if (first !== undefined) {
      const where = first.keyPath === "" ? "the snippet" : first.keyPath;
      return err({ code: "mcp_import.malformed_snippet", message: `${where}: ${first.message}`, issues: blocked });
    }
    return ok(found.value.candidates.map((candidate) => ({ candidate, id: candidate.view.id })));
  }
  const selections = request.candidates ?? [];
  if (selections.length === 0) {
    return err({ code: "mcp_import.invalid_request", message: "Choose at least one server to import.", issues: [] });
  }
  const byId = new Map(discover(request.repoRoot).flatMap((found) => found.candidates).map((candidate) => [candidate.view.candidateId, candidate]));
  const chosen: Chosen[] = [];
  for (const selection of selections) {
    const candidate = byId.get(selection.candidateId);
    if (candidate === undefined) {
      return err({
        code: "mcp_import.unknown_candidate",
        message: "A chosen server is no longer in its platform's file; list the candidates again.",
        issues: [],
        details: { candidateId: selection.candidateId },
      });
    }
    chosen.push({ candidate, id: selection.id ?? candidate.view.id });
  }
  return ok(chosen);
}

function prepareAll(chosen: readonly Chosen[], scope: McpImportTarget["scope"], taken: ReadonlySet<string>): Result<PreparedMcpImport[], McpImportError> {
  const prepared: PreparedMcpImport[] = [];
  const ids = new Set<string>();
  for (const { candidate, id } of chosen) {
    if (taken.has(id) || ids.has(id)) {
      return err({
        code: "mcp_import.conflict",
        message: `A server with id "${id}" is already in the ${scope} mcp.jsonc${taken.has(id) ? "" : " import"}; choose another id.`,
        issues: [],
        details: { serverId: id },
      });
    }
    ids.add(id);
    if (candidate.view.issues.length > 0) {
      return err({
        code: "mcp_import.not_importable",
        message: `${candidate.view.name} from ${candidate.view.platform} cannot be imported: ${candidate.view.issues.map((issue) => `${issue.keyPath}: ${issue.message}`).join("; ")}`,
        issues: candidate.view.issues,
        details: { candidateId: candidate.view.candidateId },
      });
    }
    const result = prepareMcpImport(candidate, id, scope);
    if (!result.ok) {
      return err({ code: "mcp_import.not_importable", message: `${candidate.view.name} cannot be imported as "${id}": ${result.error.map((issue) => `${issue.keyPath}: ${issue.message}`).join("; ")}`, issues: result.error });
    }
    prepared.push(result.value);
  }
  return ok(prepared);
}

function existingIds(value: unknown): ReadonlySet<string> {
  const servers = isRecord(value) ? value["servers"] : undefined;
  return new Set(isRecord(servers) ? Object.keys(servers) : []);
}

function fileFailed(error: ConfigError): McpImportError {
  return {
    code: "mcp_import.file_failed",
    message: error.message,
    issues: error.issues.map(({ keyPath, message }) => ({ keyPath, message })),
    details: { file: error.file, configCode: error.code },
  };
}

