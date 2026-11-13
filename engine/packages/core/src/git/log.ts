import { ok, type Result } from "../result.ts";
import { parseFailed, type GitError } from "./errors.ts";

const logFields = ["%H", "%P", "%an", "%ae", "%at", "%cn", "%ce", "%ct", "%s", "%b"] as const;

// Arguments after `git log` whose output parseLog reads: NUL between fields and after each commit.
export const logArgs = ["-z", "--no-color", `--format=${logFields.join("%x00")}`] as const;

export interface Commit {
  readonly hash: string;
  readonly parents: readonly string[];
  readonly authorName: string;
  readonly authorEmail: string;
  readonly authoredAt: number;
  readonly committerName: string;
  readonly committerEmail: string;
  readonly committedAt: number;
  readonly subject: string;
  readonly body: string;
}

export function parseLog(raw: string): Result<Commit[], GitError> {
  if (raw === "") {
    return ok([]);
  }
  const fields = raw.split("\0");
  if (fields.at(-1) === "") {
    fields.pop();
  }
  if (fields.length % logFields.length !== 0) {
    return parseFailed("log", `${String(fields.length)} fields is not a whole number of commits`);
  }
  const commits: Commit[] = [];
  for (let i = 0; i < fields.length; i += logFields.length) {
    const [hash = "", parents = "", an = "", ae = "", at = "", cn = "", ce = "", ct = "", subject = "", body = ""] =
      fields.slice(i, i + logFields.length);
    if (!/^[0-9a-f]+$/.test(hash) || !/^\d+$/.test(at) || !/^\d+$/.test(ct)) {
      return parseFailed("log", `bad commit record starting "${hash}"`);
    }
    commits.push({
      hash,
      parents: parents === "" ? [] : parents.split(" "),
      authorName: an,
      authorEmail: ae,
      authoredAt: Number(at),
      committerName: cn,
      committerEmail: ce,
      committedAt: Number(ct),
      subject,
      body: body.replace(/\n+$/, ""),
    });
  }
  return ok(commits);
}
