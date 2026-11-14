export {
  applyDiscoveryFilter,
  defaultDiscoveryFilter,
  listOrganizations,
  listOrgProperties,
  listTeamRepos,
  listTeams,
  type DiscoveryFilter,
  type DiscoveryResult,
} from "./discovery.ts";
export type { DiscoveryError } from "./errors.ts";
export type { DiscoveredOrganization, DiscoveredProperty, DiscoveredRepo, DiscoveredTeam } from "./model.ts";
export { nextPageUrl } from "./paging.ts";
export type { GitHubPage, GitHubRestClient } from "./ports.ts";
export { listingPath, matchesSelector, selectorForSource, type DiscoverySelector } from "./selectors.ts";
export {
  diffRepos,
  syncRepoSource,
  type DiscoverySnapshot,
  type RepoDiff,
  type SourceSync,
  type SyncOptions,
} from "./sync.ts";
