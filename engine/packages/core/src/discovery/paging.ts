import { requestFailed } from "../github/errors.ts";
import { err, ok, type Result } from "../result.ts";
import type { DiscoveryError } from "./errors.ts";
import type { GitHubRestClient } from "./ports.ts";

export type Listing =
  | { readonly status: "not_modified" }
  | { readonly status: "ok"; readonly items: readonly unknown[]; readonly etag: string | null };

export const pageSize = 100;

// Fetches every page of a list endpoint. The ETag goes on the first page only: a 304 there means the
// listing the caller already holds stands, and nothing more is requested. The returned ETag is the first
// page's, which is what the next sync sends.
export async function fetchAllPages(
  client: GitHubRestClient,
  path: string,
  etag: string | null,
): Promise<Result<Listing, DiscoveryError>> {
  const items: unknown[] = [];
  const visited = new Set<string>();
  let firstEtag: string | null = null;
  let target: string | null = path;
  while (target !== null) {
    if (visited.has(target)) {
      return err(requestFailed(client.host, `${client.host.host} returned a pagination loop at ${target}`));
    }
    visited.add(target);
    const isFirst = visited.size === 1;
    const page = await client.get(target, isFirst ? etag : null);
    if (!page.ok) {
      return page;
    }
    if (page.value.status === "not_modified") {
      if (isFirst) {
        return ok({ status: "not_modified" });
      }
      return err(requestFailed(client.host, `${client.host.host} answered 304 to an unconditional request for ${target}`));
    }
    if (!Array.isArray(page.value.body)) {
      return err(requestFailed(client.host, `${client.host.host} answered ${target} with something other than a list`));
    }
    items.push(...(page.value.body as readonly unknown[]));
    if (isFirst) {
      firstEtag = page.value.etag;
    }
    target = nextPageUrl(page.value.link);
  }
  return ok({ status: "ok", items, etag: firstEtag });
}

// `Link: <https://api.github.com/...&page=2>; rel="next", <...>; rel="last"`
export function nextPageUrl(link: string | null): string | null {
  if (link === null) {
    return null;
  }
  for (const part of link.split(",")) {
    const match = /^\s*<([^>]+)>(.*)$/.exec(part);
    if (match?.[1] !== undefined && relations(match[2] ?? "").includes("next")) {
      return match[1];
    }
  }
  return null;
}

function relations(params: string): string[] {
  const rel = params
    .split(";")
    .map((param) => param.trim())
    .find((param) => param.startsWith("rel="));
  return rel === undefined ? [] : rel.slice("rel=".length).replaceAll('"', "").split(/\s+/);
}
