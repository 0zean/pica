import { ok, type Result } from "../result.ts";
import { parseFailed, type GitError } from "./errors.ts";

const branchFields = ["%(refname)", "%(objectname)", "%(upstream)", "%(upstream:track,nobracket)", "%(HEAD)", "%(symref)"];

// Arguments after `git for-each-ref` whose output parseBranches reads: one ref per line, NUL between fields.
export const branchArgs = [`--format=${branchFields.join("%00")}`, "refs/heads", "refs/remotes"] as const;

export interface Branch {
  readonly name: string;
  readonly ref: string;
  readonly kind: "local" | "remote";
  readonly commit: string;
  readonly current: boolean;
  readonly upstream: string | null;
  readonly upstreamGone: boolean;
  readonly ahead: number | null;
  readonly behind: number | null;
}

const prefixes = [
  { prefix: "refs/heads/", kind: "local" },
  { prefix: "refs/remotes/", kind: "remote" },
] as const;

export function parseBranches(raw: string): Result<Branch[], GitError> {
  const branches: Branch[] = [];
  for (const line of raw.split("\n").filter((candidate) => candidate !== "")) {
    const [ref = "", commit = "", upstream = "", track = "", head = "", symref = ""] = line.split("\0");
    if (symref !== "") {
      continue;
    }
    const kind = prefixes.find((candidate) => ref.startsWith(candidate.prefix));
    const counts = parseTrack(track);
    if (kind === undefined || counts === undefined || !/^[0-9a-f]+$/.test(commit)) {
      return parseFailed("branches", `bad ref line "${line.replaceAll("\0", " | ")}"`);
    }
    const hasUpstream = upstream !== "" && !counts.gone;
    branches.push({
      name: ref.slice(kind.prefix.length),
      ref,
      kind: kind.kind,
      commit,
      current: head === "*",
      upstream: upstream === "" ? null : shortName(upstream),
      upstreamGone: counts.gone,
      ahead: hasUpstream ? counts.ahead : null,
      behind: hasUpstream ? counts.behind : null,
    });
  }
  return ok(branches);
}

function shortName(ref: string): string {
  const match = prefixes.find((candidate) => ref.startsWith(candidate.prefix));
  return match === undefined ? ref : ref.slice(match.prefix.length);
}

// `upstream:track,nobracket` is "", "gone", "ahead N", "behind N", or "ahead N, behind M".
function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } | undefined {
  if (track === "gone") {
    return { ahead: 0, behind: 0, gone: true };
  }
  const match = /^(?:ahead (\d+))?(?:, )?(?:behind (\d+))?$/.exec(track);
  if (match === null) return undefined;
  return { ahead: Number(match[1] ?? "0"), behind: Number(match[2] ?? "0"), gone: false };
}
