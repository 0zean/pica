import { memberRepoIds } from "@pica/core";
import type { RepoRegistry, RepoRegistryError, RepoRegistryErrorCode, Result, WorkspaceService } from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { ErrorCodeName } from "./errors.ts";
import type { MethodRouter } from "./router.ts";
import { toRepoDto } from "./workspace-handlers.ts";

const errorCodes: Readonly<Record<RepoRegistryErrorCode, ErrorCodeName>> = {
  "repo.invalid_url": "invalid_params",
  "repo.no_remote": "invalid_params",
  "repo.not_found": "not_found",
  "repo.path_exists": "conflict",
  "repo.clone_failed": "git_failed",
  "repo.has_local_work": "refused_without_force",
  "repo.outside_managed_root": "invalid_state",
  "repo.git_failed": "git_failed",
  "repo.store_failed": "internal_error",
  "repo.filesystem_failed": "internal_error",
};

function unwrap<T>(result: Result<T, RepoRegistryError>): T {
  if (result.ok) return result.value;
  const { code, message, localWork } = result.error;
  throw new RpcFailure(errorCodes[code], message, {
    reason: code,
    ...(localWork === undefined
      ? {}
      : { uncommittedPaths: [...localWork.uncommittedPaths], unpushedCommits: localWork.unpushedCommits }),
  });
}

// R-03: register a repo in place or as a managed clone, and remove one. A repo a workspace still
// includes is not removed: its pins and source lists would point at nothing.
export function registerRepoHandlers(router: MethodRouter, registry: RepoRegistry, workspaces?: WorkspaceService): void {
  router.register("repo.addPath", async ({ path }) => ({ repo: toRepoDto(unwrap(await registry.addByPath(path))) }));
  router.register("repo.addUrl", async ({ url }) => ({ repo: toRepoDto(unwrap(await registry.addByUrl(url))) }));
  router.register("repo.remove", async ({ id, force }) => {
    const listed = workspaces?.list();
    const using = listed?.ok === true ? listed.value.filter((workspace) => memberRepoIds(workspace).includes(id)) : [];
    if (using.length > 0) {
      throw new RpcFailure(
        "invalid_state",
        `${using.map((workspace) => workspace.name).join(", ")} still include${using.length === 1 ? "s" : ""} this repo; remove it from ${using.length === 1 ? "that workspace" : "those workspaces"} first`,
        { reason: "repo.in_use", workspaceIds: using.map((workspace) => workspace.id) },
      );
    }
    unwrap(await registry.remove(id, { force }));
    return { ok: true } as const;
  });
}
