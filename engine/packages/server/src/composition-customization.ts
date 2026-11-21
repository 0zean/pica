import {
  builtinAgentsDir,
  createCustomizationFiles,
  parseAgentFile,
  userAgentsDir,
  userInstructionsFile,
  userSkillsDir,
  workspaceAgentsDir,
} from "@pica/adapters";
import { createCustomizationService, customizationError, err, ok } from "@pica/core";
import type { CustomizationRoots, CustomizationService, ManagedPolicy, WorkspaceService } from "@pica/core";

export interface CustomizationComposition {
  readonly homeDir: string;
  readonly workspaces: WorkspaceService;
  readonly policy: ManagedPolicy | undefined;
}

// X-02: agents, skills and instruction files of the user, a workspace and one of its repos.
export function customizationOptions(deps: CustomizationComposition): CustomizationService {
  const user = {
    builtinAgents: builtinAgentsDir,
    userAgents: userAgentsDir(deps.homeDir),
    userSkills: userSkillsDir(deps.homeDir),
    userInstructions: userInstructionsFile(deps.homeDir),
  };
  return createCustomizationService({
    roots: ({ workspaceId, repoId }) => {
      if (workspaceId === undefined) {
        return repoId === undefined
          ? ok(user)
          : err(customizationError("customization.scope_not_found", "a repo's files are listed with its workspace: give workspaceId too"));
      }
      const workspace = deps.workspaces.get(workspaceId);
      if (!workspace.ok) return err(customizationError("customization.scope_not_found", workspace.error.message));
      const roots: CustomizationRoots = { ...user, workspace: { id: workspaceId, agentsDir: workspaceAgentsDir(deps.homeDir, workspaceId) } };
      if (repoId === undefined) return ok(roots);
      const repos = deps.workspaces.repos(workspaceId);
      const repo = repos.ok ? repos.value.find((entry) => entry.id === repoId) : undefined;
      if (repo === undefined) {
        return err(customizationError("customization.scope_not_found", `repo ${repoId} is not in workspace ${workspaceId}`));
      }
      return ok({ ...roots, repo: { id: repo.id, root: repo.localPath } });
    },
    files: createCustomizationFiles(),
    parse: parseAgentFile,
    lockedBy: (kind) => (deps.policy?.lockedCustomizations?.includes(kind) === true ? deps.policy.id : undefined),
  });
}
