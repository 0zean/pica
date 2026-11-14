import { requestFailed } from "../github/errors.ts";
import { err, ok } from "../result.ts";
import { applyDiscoveryFilter, parseAll, type DiscoveryFilter, type DiscoveryResult } from "./discovery.ts";
import { parseRepo, type DiscoveredRepo } from "./model.ts";
import { fetchAllPages } from "./paging.ts";
import type { GitHubRestClient } from "./ports.ts";
import { listingPath, matchesSelector, type DiscoverySelector } from "./selectors.ts";

// What a source last resolved to, before the archived/fork filter, plus the ETag to revalidate it with.
export interface DiscoverySnapshot {
  readonly etag: string | null;
  readonly repos: readonly DiscoveredRepo[];
  readonly syncedAt: string;
}

export interface RepoDiff {
  readonly added: readonly DiscoveredRepo[];
  readonly removed: readonly DiscoveredRepo[];
}

export interface SourceSync extends RepoDiff {
  // True when GitHub answered 304: the snapshot is the previous one, unchanged.
  readonly notModified: boolean;
  readonly snapshot: DiscoverySnapshot;
  // The snapshot's repos after the filter.
  readonly repos: readonly DiscoveredRepo[];
}

export interface SyncOptions {
  readonly filter: DiscoveryFilter;
  readonly now: string;
}

// Revalidates a source against GitHub and reports which repos it gained and lost since `previous`.
export async function syncRepoSource(
  client: GitHubRestClient,
  selector: DiscoverySelector,
  previous: DiscoverySnapshot | null,
  options: SyncOptions,
): DiscoveryResult<SourceSync> {
  const listing = await fetchAllPages(client, listingPath(selector), previous?.etag ?? null);
  if (!listing.ok) {
    return listing;
  }
  const before = applyDiscoveryFilter(previous?.repos ?? [], options.filter);
  if (listing.value.status === "not_modified") {
    return previous === null
      ? err(requestFailed(client.host, `${client.host.host} answered 304 to an unconditional request`))
      : ok({ notModified: true, snapshot: previous, repos: before, added: [], removed: [] });
  }
  const parsed = parseAll(client, listing.value.items, parseRepo, "repository");
  if (!parsed.ok) {
    return parsed;
  }
  const snapshot: DiscoverySnapshot = {
    etag: listing.value.etag,
    repos: parsed.value.filter((repo) => matchesSelector(selector, repo)),
    syncedAt: options.now,
  };
  const after = applyDiscoveryFilter(snapshot.repos, options.filter);
  return ok({ notModified: false, snapshot, repos: after, ...diffRepos(before, after) });
}

// Compared by identity (normalized remote URL); both lists come back sorted by it.
export function diffRepos(before: readonly DiscoveredRepo[], after: readonly DiscoveredRepo[]): RepoDiff {
  const beforeIds = new Set(before.map((repo) => repo.remoteUrl));
  const afterIds = new Set(after.map((repo) => repo.remoteUrl));
  return {
    added: sortByIdentity(after.filter((repo) => !beforeIds.has(repo.remoteUrl))),
    removed: sortByIdentity(before.filter((repo) => !afterIds.has(repo.remoteUrl))),
  };
}

function sortByIdentity(repos: DiscoveredRepo[]): DiscoveredRepo[] {
  return repos.sort((a, b) => a.remoteUrl.localeCompare(b.remoteUrl));
}
