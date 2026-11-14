import { err, ok, type Result } from "../result.ts";
import type { RepoSource } from "../store/entities.ts";
import { invalidSelector, type DiscoveryError } from "./errors.ts";
import type { DiscoveredRepo } from "./model.ts";
import { pageSize } from "./paging.ts";

// What a non-manual RepoSource (PLAN.md §4.4) selects. Property selectors are stored as `name=value`.
export type DiscoverySelector =
  | { readonly kind: "team"; readonly org: string; readonly teamSlug: string }
  | { readonly kind: "topic"; readonly org: string; readonly topic: string }
  | { readonly kind: "property"; readonly org: string; readonly name: string; readonly value: string };

export function selectorForSource(
  source: Pick<RepoSource, "kind" | "org" | "selector">,
): Result<DiscoverySelector, DiscoveryError> {
  const details = { kind: source.kind, org: source.org, selector: source.selector };
  if (source.kind === "manual") {
    return err(invalidSelector("A manual source lists its repos itself; there is nothing to discover.", details));
  }
  const org = source.org?.trim() ?? "";
  const selector = source.selector.trim();
  if (org.length === 0 || selector.length === 0) {
    return err(invalidSelector(`A ${source.kind} source needs an organization and a selector.`, details));
  }
  if (source.kind === "team") {
    return ok({ kind: "team", org, teamSlug: selector });
  }
  if (source.kind === "topic") {
    return ok({ kind: "topic", org, topic: selector.toLowerCase() });
  }
  const separator = selector.indexOf("=");
  const name = selector.slice(0, separator).trim();
  const value = selector.slice(separator + 1).trim();
  if (separator < 0 || name.length === 0 || value.length === 0) {
    return err(invalidSelector("A property source's selector has the form name=value.", details));
  }
  return ok({ kind: "property", org, name, value });
}

// Topic and property sources filter the organization's repository list, which carries `topics` and
// `custom_properties`, so every kind is one paginated listing with one ETag.
export function listingPath(selector: DiscoverySelector): string {
  const org = encodeURIComponent(selector.org);
  if (selector.kind === "team") {
    return `/orgs/${org}/teams/${encodeURIComponent(selector.teamSlug)}/repos?per_page=${String(pageSize)}`;
  }
  return `/orgs/${org}/repos?type=all&per_page=${String(pageSize)}`;
}

export function matchesSelector(selector: DiscoverySelector, repo: DiscoveredRepo): boolean {
  if (selector.kind === "team") {
    return true;
  }
  if (selector.kind === "topic") {
    return repo.topics.some((topic) => topic.toLowerCase() === selector.topic);
  }
  return (repo.customProperties[selector.name] ?? []).includes(selector.value);
}
