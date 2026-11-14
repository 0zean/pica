import { err, ok } from "../result.ts";
import type { WorkspaceError } from "../workspaces/errors.ts";
import type { WorkspaceService } from "../workspaces/service.ts";
import { repoToolError, type RepoToolError } from "./errors.ts";
import type { RepoToolsDeps } from "./ports.ts";

// Binds the repo tools to one workspace through the R-06 service, cloning lazily on first use.
export function workspaceRepoSource(
  workspaces: Pick<WorkspaceService, "repos" | "ensureCloned">,
  workspaceId: string,
): Pick<RepoToolsDeps, "repos" | "ensureCloned"> {
  return {
    repos: () => {
      const repos = workspaces.repos(workspaceId);
      return Promise.resolve(repos.ok ? repos : err(fromWorkspace(repos.error)));
    },
    ensureCloned: async (repoId) => {
      const cloned = await workspaces.ensureCloned(repoId);
      return cloned.ok ? ok(cloned.value) : err(fromWorkspace(cloned.error));
    },
  };
}

function fromWorkspace(error: WorkspaceError): RepoToolError {
  const code = error.code === "workspace.clone_failed" ? "repo_tools.not_cloned" : "repo_tools.io_failed";
  return repoToolError(code, error.message);
}
