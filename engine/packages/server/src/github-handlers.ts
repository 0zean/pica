import { listTeamRepos, listTeams } from "@pica/core";
import type {
  DiscoveryError,
  DiscoveryFilter,
  GitHubAuthResult,
  GitHubCredential,
  GitHubHost,
  GitHubRestClient,
  Result,
} from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { MethodResult, MethodRouter } from "./router.ts";

type TeamDto = MethodResult<"github.listTeams">["teams"][number];
type GitHubRepoDto = MethodResult<"github.listTeamRepos">["repos"][number];

// A-12: the GitHub host the engine signs in to, and how it signs in.
export interface EngineGitHubOptions {
  readonly host: GitHubHost;
  // The first verified credential with `scopes`, from the provider chain (R-04).
  credential(scopes: readonly string[]): GitHubAuthResult<GitHubCredential>;
  restClient(credential: GitHubCredential): GitHubRestClient;
  readonly filter: DiscoveryFilter;
}

const discoveryScopes = ["read:org"];

// `github.authStatus`, `github.listTeams` and `github.listTeamRepos` for the team browser.
export function registerGitHubHandlers(router: MethodRouter, options: EngineGitHubOptions): void {
  router.register("github.authStatus", async ({ host }) => {
    checkHost(options.host, host);
    const credential = await options.credential([]);
    if (credential.ok) {
      const { provider, login, scopes } = credential.value;
      return { host: options.host.host, signedIn: true, provider, login, scopes: [...(scopes ?? [])] };
    }
    if (credential.error.code === "auth_required") {
      return { host: options.host.host, signedIn: false, provider: null, login: null, scopes: [] };
    }
    return answered(credential);
  });
  router.register("github.listTeams", async ({ host }) => {
    checkHost(options.host, host);
    const client = await discoveryClient(options);
    const teams = answered(await listTeams(client)).map((team): TeamDto => ({ ...team }));
    teams.sort((left, right) => left.org.localeCompare(right.org) || left.name.localeCompare(right.name));
    return { teams };
  });
  router.register("github.listTeamRepos", async ({ host, org, teamSlug }) => {
    checkHost(options.host, host);
    const client = await discoveryClient(options);
    const repos = answered(await listTeamRepos(client, org, teamSlug, options.filter));
    return {
      repos: repos.map(
        (repo): GitHubRepoDto => ({
          fullName: repo.fullName,
          cloneUrl: repo.cloneUrl,
          archived: repo.archived,
          fork: repo.fork,
          topics: [...repo.topics],
        }),
      ),
    };
  });
}

async function discoveryClient(options: EngineGitHubOptions): Promise<GitHubRestClient> {
  return options.restClient(answered(await options.credential(discoveryScopes)));
}

// The engine signs in to one host; naming another is a mistake the client can show.
function checkHost(configured: GitHubHost, requested: string | undefined): void {
  if (requested === undefined || requested.toLowerCase() === configured.host) return;
  throw new RpcFailure("invalid_params", `Pica is set up for ${configured.host}, not ${requested}.`, {
    reason: "github.unknown_host",
    host: configured.host,
  });
}

// GitHub failures keep their stable code and `fix` (PLAN.md §4.5).
function answered<T>(result: Result<T, DiscoveryError>): T {
  if (result.ok) return result.value;
  const error = result.error;
  const fix = "fix" in error ? error.fix : undefined;
  throw new RpcFailure(error.code, error.message, error.details === undefined ? undefined : { ...error.details }, fix);
}
