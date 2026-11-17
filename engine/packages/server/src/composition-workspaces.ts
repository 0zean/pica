import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  createGhCliCredentialProvider,
  createGitCliService,
  createGitHubPullRequestClient,
  createGitHubRestClient,
  createGitHubTokenVerifier,
  createGitRepoRegistryOps,
  createRepoDirectories,
  spawnGitHubCommand,
} from "@pica/adapters";
import {
  createRepoRegistry,
  createWorkspaceService,
  defaultDiscoveryFilter,
  err,
  ok,
  resolveGitHubCredential,
  resolveGitHubHost,
} from "@pica/core";
import type { DiscoveryResult, GitHubRestClient, RepoRegistry, Store, WorkspaceService } from "@pica/core";
import type { EngineReviewOptions } from "./git-handlers.ts";

export interface WorkspaceComposition {
  readonly store: Store;
  readonly dataDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly newId?: () => string;
}

// R-03 and R-06 over git and GitHub. Discovery authenticates through the GitHub CLI (`gh auth
// login`, or GH_TOKEN) on github.com; PATs from the Keychain and other hosts are a follow-up.
export function workspaceOptions(deps: WorkspaceComposition): {
  readonly workspaces: WorkspaceService;
  readonly repos: RepoRegistry;
} {
  const { store, env } = deps;
  const newId = deps.newId ?? randomUUID;
  const repos = createRepoRegistry({
    repos: store.repos,
    git: createGitCliService({ env }),
    registryGit: createGitRepoRegistryOps({ env }),
    directories: createRepoDirectories(),
    managedRoot: join(deps.dataDir, "repos"),
    newId,
  });
  const host = resolveGitHubHost({ host: "github.com" });
  const providers = [createGhCliCredentialProvider({ run: spawnGitHubCommand(env) })];
  const verifier = createGitHubTokenVerifier();
  const client = async (): DiscoveryResult<GitHubRestClient> => {
    const credential = await resolveGitHubCredential(providers, verifier, { host, scopes: ["read:org"], interactive: false });
    if (!credential.ok) return err(credential.error);
    return ok(createGitHubRestClient({ host, provider: credential.value.provider, token: credential.value.token }));
  };
  const workspaces = createWorkspaceService({
    workspaces: store.workspaces,
    repos: store.repos,
    discovery: { client, filter: defaultDiscoveryFilter },
    clone: (remoteUrl) => repos.addByUrl(remoteUrl),
    newId,
    clock: () => new Date().toISOString(),
  });
  return { workspaces, repos };
}

// A-08: the review over the same git service, opening pull requests with the GitHub CLI's token.
export function reviewOptions(deps: Pick<WorkspaceComposition, "store" | "env">): EngineReviewOptions {
  const { env } = deps;
  const githubHost = resolveGitHubHost({ host: "github.com" });
  const providers = [createGhCliCredentialProvider({ run: spawnGitHubCommand(env) })];
  const verifier = createGitHubTokenVerifier();
  return {
    store: deps.store,
    git: createGitCliService({ env }),
    githubHost,
    pullRequests: async () => {
      const credential = await resolveGitHubCredential(providers, verifier, {
        host: githubHost,
        scopes: ["repo"],
        interactive: false,
      });
      if (!credential.ok) return err(credential.error);
      return ok(
        createGitHubPullRequestClient({ host: githubHost, provider: credential.value.provider, token: credential.value.token }),
      );
    },
  };
}
