import { ok, type Result } from "../result.ts";
import { parseFailed, type GitError } from "./errors.ts";

export type PushOutcome = "fastForward" | "forced" | "deleted" | "created" | "rejected" | "upToDate";

export interface PushedRef {
  readonly outcome: PushOutcome;
  readonly localRef: string;
  readonly remoteRef: string;
  readonly summary: string;
}

export interface PushResult {
  readonly destination: string;
  readonly refs: readonly PushedRef[];
}

const outcomes: Readonly<Record<string, PushOutcome>> = {
  " ": "fastForward",
  "+": "forced",
  "-": "deleted",
  "*": "created",
  "!": "rejected",
  "=": "upToDate",
};

// Reads the stdout of `git push --porcelain`.
export function parsePush(raw: string): Result<PushResult, GitError> {
  let destination: string | undefined;
  const refs: PushedRef[] = [];
  for (const line of raw.split("\n")) {
    if (line === "" || line === "Done") {
      continue;
    }
    if (line.startsWith("To ")) {
      destination = line.slice(3);
      continue;
    }
    // Informational lines such as "branch 'x' set up to track 'origin/x'." carry no ref.
    if (!/^.\t/.test(line)) {
      continue;
    }
    const match = /^(.)\t([^:\t]*):([^\t]+)\t(.*)$/.exec(line);
    const outcome = outcomes[match?.[1] ?? ""];
    if (match === null || outcome === undefined) {
      return parseFailed("push", `unexpected line "${line}"`);
    }
    refs.push({ outcome, localRef: match[2] ?? "", remoteRef: match[3] ?? "", summary: match[4] ?? "" });
  }
  if (destination === undefined) {
    return parseFailed("push", "no destination line");
  }
  return ok({ destination, refs });
}
