import { requestFailed } from "../github/errors.ts";
import { err, ok, type Result } from "../result.ts";
import type { DiscoveryError } from "./errors.ts";
import {
  parseOrganization,
  parseProperty,
  parseRepo,
  parseTeam,
  type DiscoveredOrganization,
  type DiscoveredProperty,
  type DiscoveredRepo,
  type DiscoveredTeam,
} from "./model.ts";
import { fetchAllPages, pageSize } from "./paging.ts";
import type { GitHubRestClient } from "./ports.ts";
import { listingPath } from "./selectors.ts";

export type DiscoveryResult<T> = Promise<Result<T, DiscoveryError>>;

export interface DiscoveryFilter {
  readonly includeArchived: boolean;
  readonly includeForks: boolean;
}

export const defaultDiscoveryFilter: DiscoveryFilter = { includeArchived: false, includeForks: false };

export function applyDiscoveryFilter(repos: readonly DiscoveredRepo[], filter: DiscoveryFilter): DiscoveredRepo[] {
  return repos.filter((repo) => (filter.includeArchived || !repo.archived) && (filter.includeForks || !repo.fork));
}

export function listOrganizations(client: GitHubRestClient): DiscoveryResult<DiscoveredOrganization[]> {
  return listAll(client, `/user/orgs?per_page=${String(pageSize)}`, parseOrganization, "organization");
}

// Needs `read:org`, and SSO authorization for SAML-enforced organizations (PLAN.md §2.3).
export function listTeams(client: GitHubRestClient): DiscoveryResult<DiscoveredTeam[]> {
  return listAll(client, `/user/teams?per_page=${String(pageSize)}`, parseTeam, "team");
}

export async function listTeamRepos(
  client: GitHubRestClient,
  org: string,
  teamSlug: string,
  filter: DiscoveryFilter = defaultDiscoveryFilter,
): DiscoveryResult<DiscoveredRepo[]> {
  const repos = await listAll(client, listingPath({ kind: "team", org, teamSlug }), parseRepo, "repository");
  return repos.ok ? ok(applyDiscoveryFilter(repos.value, filter)) : repos;
}

// The organization's custom property definitions, for choosing a property selector.
export function listOrgProperties(client: GitHubRestClient, org: string): DiscoveryResult<DiscoveredProperty[]> {
  return listAll(client, `/orgs/${encodeURIComponent(org)}/properties/schema`, parseProperty, "custom property");
}

async function listAll<T>(
  client: GitHubRestClient,
  path: string,
  parse: (value: unknown) => T | undefined,
  noun: string,
): DiscoveryResult<T[]> {
  const listing = await fetchAllPages(client, path, null);
  if (!listing.ok) {
    return listing;
  }
  if (listing.value.status === "not_modified") {
    return err(requestFailed(client.host, `${client.host.host} answered 304 to an unconditional request for ${path}`));
  }
  return parseAll(client, listing.value.items, parse, noun);
}

export function parseAll<T>(
  client: GitHubRestClient,
  items: readonly unknown[],
  parse: (value: unknown) => T | undefined,
  noun: string,
): Result<T[], DiscoveryError> {
  const parsed: T[] = [];
  for (const item of items) {
    const value = parse(item);
    if (value === undefined) {
      return err(requestFailed(client.host, `${client.host.host} returned a ${noun} Pica could not read`));
    }
    parsed.push(value);
  }
  return ok(parsed);
}
