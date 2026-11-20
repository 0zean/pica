import { err, ok } from "@pica/core";
import type { McpImportError, McpImportErrorCode, McpImportService, McpImportTarget, McpSecretWriter, Result } from "@pica/core";
import { methods } from "@pica/protocol";
import { RpcFailure } from "./errors.ts";
import type { ErrorCodeName } from "./errors.ts";
import type { MethodParams, MethodRouter, RequestContext } from "./router.ts";

export interface McpImportHandlerDeps {
  readonly service: McpImportService;
  // The local checkout of a registered repo, for project files and repo-scope imports.
  readonly repoRoot: (repoId: string) => string | undefined;
  // A-13: health follows the files once servers are imported.
  readonly onImported?: () => void;
}

const errorCodes: Readonly<Record<McpImportErrorCode, ErrorCodeName>> = {
  "mcp_import.malformed_snippet": "invalid_params",
  "mcp_import.invalid_request": "invalid_params",
  "mcp_import.unknown_candidate": "not_found",
  "mcp_import.not_importable": "config_invalid",
  "mcp_import.conflict": "already_exists",
  "mcp_import.secret_store_failed": "secret_unresolved",
  "mcp_import.file_failed": "config_invalid",
};

// M-07: `mcp.importCandidates` and `mcp.import` (docs/mcp-import.md). Importing writes only
// `mcp.jsonc` and the Keychain; attaching a server to a session stays `mcp.attach`.
export function registerMcpImportHandlers(router: MethodRouter, deps: McpImportHandlerDeps): void {
  router.register("mcp.importCandidates", (params) => {
    const repoRoot = params.repoId === undefined ? undefined : requireRepo(deps, params.repoId);
    const sources = unwrap(
      deps.service.candidates({
        ...(repoRoot === undefined ? {} : { repoRoot }),
        ...(params.snippet === undefined ? {} : { snippet: params.snippet }),
      }),
    );
    return { sources };
  });

  router.register("mcp.import", async (params, context) => {
    const target = importTarget(deps, params);
    const repoRoot = params.repoId === undefined ? undefined : requireRepo(deps, params.repoId);
    const outcome = unwrap(
      await deps.service.import({
        target,
        ...(repoRoot === undefined ? {} : { repoRoot }),
        ...(params.candidates === undefined ? {} : { candidates: params.candidates }),
        ...(params.snippet === undefined ? {} : { snippet: params.snippet }),
        secrets: brokerSecretWriter(context),
      }),
    );
    deps.onImported?.();
    return { ...outcome, servers: [...outcome.servers], secretRefs: [...outcome.secretRefs], notes: [...outcome.notes] };
  });
}

function importTarget(deps: McpImportHandlerDeps, params: MethodParams<"mcp.import">): McpImportTarget {
  switch (params.scope) {
    case "global":
      return { scope: "global" };
    case "workspace":
      if (params.workspaceId === undefined) {
        throw new RpcFailure("invalid_params", "Importing at workspace scope needs a workspaceId.", { reason: "mcp_import.workspace_required" });
      }
      return { scope: "workspace", workspaceId: params.workspaceId };
    case "repo":
      if (params.repoId === undefined) {
        throw new RpcFailure("invalid_params", "Importing at repo scope needs a repoId.", { reason: "mcp_import.repo_required" });
      }
      return { scope: "repo", repoRoot: requireRepo(deps, params.repoId) };
  }
}

function requireRepo(deps: McpImportHandlerDeps, repoId: string): string {
  const root = deps.repoRoot(repoId);
  if (root === undefined) {
    throw new RpcFailure("not_found", `Repo ${repoId} has no local checkout.`, { repoId });
  }
  return root;
}

// The app stores each moved secret in its Keychain under the reference text (docs/engine-client.md).
function brokerSecretWriter(context: RequestContext): McpSecretWriter {
  return {
    async store(secretRef, value): Promise<Result<void, { readonly message: string }>> {
      const reply = await context.request("secrets.set", { secretRef, value });
      if (!reply.ok) {
        return err({ message: `the client answered ${reply.code}` });
      }
      return methods["secrets.set"].result.safeParse(reply.result).success
        ? ok(undefined)
        : err({ message: "the client answered secrets.set with an invalid result" });
    },
  };
}

function unwrap<T>(result: Result<T, McpImportError>): T {
  if (result.ok) {
    return result.value;
  }
  const { code, message, issues, details } = result.error;
  throw new RpcFailure(errorCodes[code], message, { reason: code, issues, ...details });
}
