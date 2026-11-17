import type { FilesError, FilesErrorCode, FilesService, Result } from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { ErrorCodeName } from "./errors.ts";
import type { MethodRouter } from "./router.ts";

const errorCodes: Readonly<Record<FilesErrorCode, ErrorCodeName>> = {
  "files.repo_not_found": "not_found",
  "files.workspace_not_found": "not_found",
  "files.not_cloned": "invalid_state",
  "files.outside_repo": "invalid_params",
  "files.not_found": "not_found",
  "files.binary": "invalid_state",
  "files.io_failed": "internal_error",
};

function unwrap<T>(result: Result<T, FilesError>): T {
  if (result.ok) return result.value;
  throw new RpcFailure(errorCodes[result.error.code], result.error.message, { reason: result.error.code });
}

// A-09: the file tree, the viewer and quick open (docs/files.md).
export function registerFilesHandlers(router: MethodRouter, files: FilesService): void {
  router.register("files.list", async ({ repoId, directory }) => ({
    entries: unwrap(await files.list(repoId, directory)).map((entry) => ({ ...entry })),
  }));
  router.register("files.read", async ({ repoId, path }) => unwrap(await files.read(repoId, path)));
  router.register("files.quickOpen", async ({ workspaceId, query, limit }) => ({
    hits: unwrap(await files.quickOpen(workspaceId, query, limit)).map((hit) => ({ ...hit })),
  }));
}
