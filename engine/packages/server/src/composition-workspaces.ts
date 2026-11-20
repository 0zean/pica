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
import type {
  DiscoveryResult,
  GitHubCredentialProvider,
  GitHubHost,
  GitHubRestClient,
  RepoRegistry,
  Store,
  WorkspaceService,
} from "@pica/core";
import type { EngineReviewOptions } from "./git-handlers.ts";
import type { EngineGitHubOptions } from "./github-handlers.ts";

// The GitHub host discovery signs in to and the providers it tries. Tests point it at a stub server.
export interface GitHubAccessSettings {
  readonly host: GitHubHost;
  readonly providers: readonly GitHubCredentialProvider[];
}

// Production signs in through the GitHub CLI (`gh auth login`, or GH_TOKEN) on github.com; PATs
// from the Keychain and other hosts are a follow-up.
export function defaultGitHubAccess(env: Readonly<Record<string, string | undefined>>): GitHubAccessSettings {
  return {
    host: resolveGitHubHost({ host: "github.com" }),
    providers: [createGhCliCredentialProvider({ run: spawnGitHubCommand(env) })],
  };
}

export function gitHubOptions(access: GitHubAccessSettings): EngineGitHubOptions {
  const { host, providers } = access;
  const verifier = createGitHubTokenVerifier();
  return {
    host,
    credential: (scopes) => resolveGitHubCredential(providers, verifier, { host, scopes, interactive: false }),
    restClient: (credential) => createGitHubRestClient({ host, provider: credential.provider, token: credential.token }),
    filter: defaultDiscoveryFilter,
  };
}

export interface WorkspaceComposition {
  readonly store: Store;
  readonly dataDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly newId?: () => string;
}

// R-03 and R-06 over git and GitHub.
export function workspaceOptions(
  deps: WorkspaceComposition,
  github: EngineGitHubOptions = gitHubOptions(defaultGitHubAccess(deps.env)),
): {
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
  const client = async (): DiscoveryResult<GitHubRestClient> => {
    const credential = await github.credential(["read:org"]);
    if (!credential.ok) return err(credential.error);
    return ok(github.restClient(credential.value));
  };
  const workspaces = createWorkspaceService({
    workspaces: store.workspaces,
    repos: store.repos,
    discovery: { client, filter: github.filter },
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
