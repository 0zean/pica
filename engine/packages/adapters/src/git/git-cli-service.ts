import {
  branchArgs,
  diffArgs,
  err,
  logArgs,
  ok,
  parseBranches,
  parseDiff,
  parseLog,
  parsePush,
  parseStatus,
  statusArgs,
  type CommitOptions,
  type DiffTarget,
  type FileDiff,
  type GitError,
  type GitResult,
  type GitService,
  type GitWorkingChanges,
  type LogOptions,
  type PushOptions,
  type PushResult,
  type Result,
} from "@pica/core";
import { runGit, type GitOutput, type GitProcessOptions } from "./run-git.ts";

export interface GitCliOptions {
  readonly gitPath?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export function createGitCliService(options: GitCliOptions = {}): GitService & GitWorkingChanges {
  const process: GitProcessOptions = {
    gitPath: options.gitPath ?? "git",
    env: options.env ?? globalThis.process.env,
  };
  const git = (repo: string, args: readonly string[], input?: string): GitResult<string> =>
    runChecked(process, repo, args, input);

  return {
    async status(repo) {
      return andThen(await git(repo, ["status", ...statusArgs]), parseStatus);
    },

    async diff(repo, target, paths = []) {
      const revisions = diffRevisions(target);
      if (!revisions.ok) return revisions;
      const args = ["diff", ...diffArgs, ...revisions.value, "--", ...paths];
      return andThen(await git(repo, args), parseDiff);
    },

    async branches(repo) {
      return andThen(await git(repo, ["for-each-ref", ...branchArgs]), parseBranches);
    },

    async log(repo, logOptions = {}) {
      const args = logCommand(logOptions);
      if (!args.ok) return args;
      const output = await git(repo, args.value);
      if (!output.ok && logOptions.ref === undefined && isUnbornHead(output.error)) {
        return ok([]);
      }
      return andThen(output, parseLog);
    },

    async stage(repo, paths) {
      if (paths.length === 0) return invalidArgument("stage needs at least one path");
      return andThen(await git(repo, ["add", "--all", "--", ...paths]), () => ok(undefined));
    },

    async untrackedDiff(repo, path) {
      return diffUntracked(process, repo, path);
    },

    async unstage(repo, paths) {
      if (paths.length === 0) return invalidArgument("unstage needs at least one path");
      // `reset` also works before the first commit, where `restore --staged` has no HEAD to restore from.
      return andThen(await git(repo, ["reset", "--quiet", "--", ...paths]), () => ok(undefined));
    },

    async restore(repo, paths) {
      if (paths.length === 0) return invalidArgument("restore needs at least one path");
      return andThen(await git(repo, ["checkout", "--", ...paths]), () => ok(undefined));
    },

    async clean(repo, paths) {
      if (paths.length === 0) return invalidArgument("clean needs at least one path");
      return andThen(await git(repo, ["clean", "--force", "--quiet", "--", ...paths]), () => ok(undefined));
    },

    async apply(repo, patch, applyOptions) {
      const args = [
        "apply",
        "--whitespace=nowarn",
        ...(applyOptions.cached ? ["--cached"] : []),
        ...(applyOptions.reverse ? ["--reverse"] : []),
        "-",
      ];
      return andThen(await git(repo, args, patch), () => ok(undefined));
    },

    async commit(repo, commitOptions) {
      return commitChanges(process, repo, commitOptions);
    },

    async push(repo, pushOptions) {
      return pushBranch(process, repo, pushOptions);
    },
  };
}

async function runChecked(
  process: GitProcessOptions,
  repo: string,
  args: readonly string[],
  input?: string,
): GitResult<string> {
  const output = await runGit(process, repo, args, input);
  if (!output.ok) return output;
  return output.value.exitCode === 0 ? ok(output.value.stdout) : err(failure(args, output.value));
}

function andThen<T, U>(result: Result<T, GitError>, next: (value: T) => Result<U, GitError>): Result<U, GitError> {
  return result.ok ? next(result.value) : result;
}

function diffRevisions(target: DiffTarget): Result<string[], GitError> {
  switch (target.kind) {
    case "unstaged":
      return ok([]);
    case "staged":
      return ok(["--cached"]);
    case "head":
      return ok(["--end-of-options", "HEAD"]);
    case "commits":
      return checkRevisions([target.from, target.to], () => ["--end-of-options", target.from, target.to]);
  }
}

function logCommand(options: LogOptions): Result<string[], GitError> {
  const maxCount = options.maxCount;
  if (maxCount !== undefined && (!Number.isInteger(maxCount) || maxCount < 1)) {
    return invalidArgument(`maxCount must be a positive integer, not ${String(maxCount)}`);
  }
  const refs = options.ref === undefined ? [] : [options.ref];
  return checkRevisions(refs, () => [
    "log",
    ...logArgs,
    ...(maxCount === undefined ? [] : [`--max-count=${String(maxCount)}`]),
    "--end-of-options",
    ...refs,
    "--",
    ...(options.paths ?? []),
  ]);
}

// `git diff --no-index` exits with 1 when the files differ, which for a new file they always do.
async function diffUntracked(process: GitProcessOptions, repo: string, path: string): GitResult<FileDiff[]> {
  if (path === "" || path.startsWith("-")) return invalidArgument(`"${path}" is not a valid path`);
  const args = ["diff", "--no-index", ...diffArgs, "--", "/dev/null", path];
  const output = await runGit(process, repo, args);
  if (!output.ok) return output;
  if (output.value.exitCode !== 0 && output.value.exitCode !== 1) return err(failure(args, output.value));
  return parseDiff(output.value.stdout);
}

async function commitChanges(
  process: GitProcessOptions,
  repo: string,
  options: CommitOptions,
): GitResult<{ hash: string }> {
  if (options.message.trim() === "") return invalidArgument("the commit message is empty");
  const args = ["commit", "--file=-", ...(options.allowEmpty === true ? ["--allow-empty"] : [])];
  const output = await runGit(process, repo, args, options.message);
  if (!output.ok) return output;
  if (output.value.exitCode !== 0) {
    return err(isNothingToCommit(output.value) ? nothingToCommit(output.value) : failure(args, output.value));
  }
  const head = await runChecked(process, repo, ["rev-parse", "--verify", "HEAD"]);
  return andThen(head, (stdout) => ok({ hash: stdout.trim() }));
}

async function pushBranch(
  process: GitProcessOptions,
  repo: string,
  options: PushOptions,
): GitResult<PushResult> {
  const checked = checkRevisions([options.remote, options.branch], () => [
    "push",
    "--porcelain",
    ...(options.setUpstream === true ? ["--set-upstream"] : []),
    ...(options.forceWithLease === true ? ["--force-with-lease"] : []),
    "--end-of-options",
    options.remote,
    `refs/heads/${options.branch}:refs/heads/${options.branch}`,
  ]);
  if (!checked.ok) return checked;
  const output = await runGit(process, repo, checked.value);
  if (!output.ok) return output;
  const parsed = parsePush(output.value.stdout);
  const rejected = parsed.ok ? parsed.value.refs.filter((ref) => ref.outcome === "rejected") : [];
  if (rejected.length > 0) {
    const summary = rejected.map((ref) => `${ref.remoteRef} ${ref.summary}`).join("; ");
    return err({
      code: "git.push_rejected",
      message: `push rejected: ${summary}`,
      exitCode: output.value.exitCode,
      stderr: output.value.stderr.trim(),
    });
  }
  return output.value.exitCode === 0 ? parsed : err(failure(checked.value, output.value));
}

// Names that start with "-" would be read as options by git.
function checkRevisions(names: readonly string[], build: () => string[]): Result<string[], GitError> {
  const bad = names.find((name) => name === "" || name.startsWith("-"));
  return bad === undefined ? ok(build()) : invalidArgument(`"${bad}" is not a valid ref or remote name`);
}

function invalidArgument(message: string): { readonly ok: false; readonly error: GitError } {
  return err({ code: "git.invalid_argument", message });
}

function failure(args: readonly string[], output: GitOutput): GitError {
  const stderr = output.stderr.trim();
  const base = { exitCode: output.exitCode, stderr };
  if (/not a git repository/i.test(stderr)) {
    return { code: "git.not_a_repository", message: firstLine(stderr), ...base };
  }
  if (/unknown revision|bad revision|ambiguous argument|bad default revision|needed a single revision/i.test(stderr)) {
    return { code: "git.unknown_revision", message: firstLine(stderr), ...base };
  }
  const message = `git ${args[0] ?? ""} exited with ${String(output.exitCode)}: ${firstLine(stderr)}`;
  return { code: "git.command_failed", message, ...base };
}

function isUnbornHead(error: GitError): boolean {
  return /does not have any commits yet/.test(error.stderr ?? "");
}

function isNothingToCommit(output: GitOutput): boolean {
  return output.exitCode === 1 && /nothing (added )?to commit|no changes added to commit/.test(output.stdout);
}

function nothingToCommit(output: GitOutput): GitError {
  return {
    code: "git.nothing_to_commit",
    message: "there are no staged changes to commit",
    exitCode: output.exitCode,
    stderr: output.stderr.trim(),
  };
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}
