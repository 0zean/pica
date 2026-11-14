import type { GitHubRestClient } from "@pica/core";
import { createGitHubRestClient } from "../../src/index.ts";
import { startStubGitHub, stubHost, type StubGitHub, type StubRoute } from "../github/stub-github.ts";

export interface RepoFixture {
  readonly name: string;
  readonly archived?: boolean;
  readonly fork?: boolean;
  readonly topics?: readonly string[];
  readonly properties?: Readonly<Record<string, string | readonly string[] | null>>;
}

// A repository as the GitHub REST API returns it, trimmed to the fields discovery reads.
export function repoJson(org: string, repo: RepoFixture): Record<string, unknown> {
  return {
    full_name: `${org}/${repo.name}`,
    html_url: `https://ghe.example.test/${org}/${repo.name}`,
    clone_url: `https://ghe.example.test/${org}/${repo.name}.git`,
    default_branch: "main",
    archived: repo.archived ?? false,
    fork: repo.fork ?? false,
    topics: repo.topics ?? [],
    custom_properties: repo.properties ?? {},
  };
}

export function numberedRepos(count: number): RepoFixture[] {
  return Array.from({ length: count }, (_, index) => ({ name: `svc-${String(index).padStart(3, "0")}` }));
}

export interface ListingState {
  items: readonly unknown[];
  etag: string;
}

// Serves `state.items` from `path` (which ends in `per_page=100`) in pages of 100 with `Link` headers,
// as GitHub does. The first page carries `state.etag` and answers 304 when `If-None-Match` matches it.
export function listingRoutes(stub: () => StubGitHub, path: string, state: ListingState): Record<string, StubRoute> {
  const pages = Math.max(1, Math.ceil(state.items.length / 100));
  const routes: Record<string, StubRoute> = {};
  for (let page = 1; page <= pages; page += 1) {
    const pagePath = page === 1 ? path : `${path}&page=${String(page)}`;
    routes[`GET /api/v3${pagePath}`] = (request) => {
      const etag = page === 1 ? state.etag : `${state.etag}-p${String(page)}`;
      if (request.ifNoneMatch === etag) {
        return { status: 304, headers: { etag } };
      }
      return {
        headers: { etag, ...linkHeader(stub().url, path, page, Math.max(1, Math.ceil(state.items.length / 100))) },
        body: state.items.slice((page - 1) * 100, page * 100),
      };
    };
  }
  return routes;
}

function linkHeader(base: string, path: string, page: number, pages: number): Record<string, string> {
  const at = (n: number): string => `<${base}/api/v3${path}&page=${String(n)}>`;
  const links: string[] = [];
  if (page < pages) {
    links.push(`${at(page + 1)}; rel="next"`, `${at(pages)}; rel="last"`);
  }
  if (page > 1) {
    links.push(`${at(1)}; rel="first"`, `${at(page - 1)}; rel="prev"`);
  }
  return links.length === 0 ? {} : { link: links.join(", ") };
}

export interface DiscoveryStub {
  readonly stub: StubGitHub;
  readonly client: GitHubRestClient;
}

export async function startDiscoveryStub(
  routes: (stub: () => StubGitHub) => Record<string, StubRoute>,
): Promise<DiscoveryStub> {
  // Link headers carry the stub's URL, which exists only once the stub is listening.
  const holder: { stub?: StubGitHub } = {};
  const current = (): StubGitHub => {
    if (holder.stub === undefined) {
      throw new Error("stub not started");
    }
    return holder.stub;
  };
  const started = await startStubGitHub(routes(current));
  holder.stub = started;
  return { stub: started, client: createGitHubRestClient({ host: stubHost(started), provider: "pat", token: "ghp_test" }) };
}

export const teamReposPath = "/orgs/acme/teams/platform/repos?per_page=100";
export const orgReposPath = "/orgs/acme/repos?type=all&per_page=100";
