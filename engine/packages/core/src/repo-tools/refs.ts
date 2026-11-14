import { normalizeRemoteUrl } from "../repos/remote-url.ts";
import { err, ok, type Result } from "../result.ts";
import type { Repo } from "../store/entities.ts";
import { repoToolError, type RepoToolError } from "./errors.ts";

// How a workspace repo is named to the model. `mention` is the short name unless another repo in the
// workspace shares it, then the qualified `owner/name`; both always resolve.
export interface RepoRef {
  readonly repo: Repo;
  readonly name: string;
  readonly qualifiedName: string;
  readonly mention: string;
}

export function repoRefs(repos: readonly Repo[]): readonly RepoRef[] {
  const named = repos.map((repo) => ({ repo, ...repoNames(repo) }));
  const counts = new Map<string, number>();
  for (const entry of named) {
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  }
  return named
    .map((entry) => ({ ...entry, mention: (counts.get(entry.name) ?? 0) > 1 ? entry.qualifiedName : entry.name }))
    .sort((a, b) => compareText(a.mention, b.mention) || compareText(a.repo.id, b.repo.id));
}

// A token with a slash matches the qualified name only; a bare one matches short names.
export function findRepo(refs: readonly RepoRef[], token: string): Result<RepoRef, RepoToolError> {
  const wanted = token.toLowerCase();
  const qualified = wanted.includes("/");
  const matches = refs.filter((ref) => (qualified ? ref.qualifiedName : ref.name).toLowerCase() === wanted);
  const [first] = matches;
  if (first === undefined) {
    return err(repoToolError("repo_tools.repo_not_found", `no repo named "${token}" in this workspace`));
  }
  if (matches.length > 1) {
    const candidates = matches.map((ref) => ref.qualifiedName);
    return err({
      code: "repo_tools.repo_ambiguous",
      message: `"${token}" matches ${candidates.join(", ")}; use the owner/name form`,
      candidates,
    });
  }
  return ok(first);
}

// Code-point order, so results do not depend on the host's locale.
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function repoNames(repo: Repo): { readonly name: string; readonly qualifiedName: string } {
  const remote = normalizeRemoteUrl(repo.remoteUrl);
  const segments = remote.ok ? remote.value.segments : (repo.localPath ?? repo.id).split("/").filter((part) => part !== "");
  const name = segments.at(-1) ?? repo.id;
  const owner = segments.at(-2);
  return { name, qualifiedName: owner === undefined ? name : `${owner}/${name}` };
}
