import { createGitRepoFiles, fileStat, realPath } from "@pica/adapters";
import { createFilesService, err, filesError, ok } from "@pica/core";
import type { FilesService, WorkspaceService } from "@pica/core";

// A-09: `files.*` over git's view of each workspace repo's checkout (R-08 `RepoFiles`).
export function filesOptions(workspaces: WorkspaceService, env: Readonly<Record<string, string | undefined>>): FilesService {
  return createFilesService({
    workspaceRepos: (workspaceId) => {
      const workspace = workspaces.get(workspaceId);
      if (!workspace.ok) return err(filesError("files.workspace_not_found", workspace.error.message));
      const repos = workspaces.repos(workspaceId);
      return repos.ok ? ok(repos.value) : err(filesError("files.io_failed", repos.error.message));
    },
    repo: (repoId) => {
      const repo = workspaces.repo(repoId);
      return repo.ok ? ok(repo.value) : err(filesError("files.repo_not_found", repo.error.message));
    },
    files: createGitRepoFiles({ env }),
    stat: fileStat,
    realPath,
    now: () => Date.now(),
  });
}
