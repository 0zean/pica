import { hunkPatch, normalizeRemoteUrl } from "@pica/core";
import type {
  Commit,
  FileDiff,
  GitError,
  GitHubAuthError,
  GitHubAuthResult,
  GitHubHost,
  GitService,
  GitWorkingChanges,
  Hunk,
  PullRequestClient,
  Repo,
  Result,
  Status,
  StatusEntry,
  Store,
} from "@pica/core";
import { RpcFailure } from "./errors.ts";
import type { ErrorCodeName } from "./errors.ts";
import type { MethodResult, MethodRouter } from "./router.ts";

// A-08: the review's `git.*` methods and `github.createPullRequest`, over the R-01 git service.
export interface EngineReviewOptions {
  readonly store: Store;
  readonly git: ReviewGit;
  readonly githubHost: GitHubHost;
  // Signs in to `githubHost` and returns a client for it; only `github.createPullRequest` asks.
  readonly pullRequests: () => GitHubAuthResult<PullRequestClient>;
}

type ReviewGit = GitService & GitWorkingChanges;
type GitStatusDto = MethodResult<"git.status">["status"];
type StatusEntryDto = GitStatusDto["entries"][number];
type FileDiffDto = MethodResult<"git.diff">["files"][number];
type ChangeKind = NonNullable<StatusEntryDto["staged"]>;
type CommitDto = MethodResult<"git.commit">["commit"];

const gitErrorCodes: Readonly<Record<GitError["code"], ErrorCodeName>> = {
  "git.not_installed": "git_failed",
  "git.not_a_repository": "invalid_state",
  "git.invalid_argument": "invalid_params",
  "git.unknown_revision": "invalid_params",
  "git.nothing_to_commit": "invalid_state",
  "git.hook_blocked": "policy_denied",
  "git.push_rejected": "git_failed",
  "git.command_failed": "git_failed",
  "git.parse_failed": "git_failed",
};

const fileStates: Readonly<Record<string, ChangeKind | null>> = {
  unmodified: null,
  modified: "modified",
  typeChanged: "type_changed",
  added: "added",
  deleted: "deleted",
  renamed: "renamed",
  copied: "copied",
  unmerged: "unmerged",
};

export function registerGitHandlers(router: MethodRouter, options: EngineReviewOptions): void {
  const { git } = options;
  const worktree = (sessionId: string, repoId: string, access: Access): string =>
    sessionWorktree(options.store, sessionId, repoId, access);
  const serial = serialPerPath();

  router.register("git.status", async ({ sessionId, repoId }) => {
    const path = worktree(sessionId, repoId, "read");
    return { status: toStatusDto(unwrap(await git.status(path))) };
  });

  router.register("git.diff", async ({ sessionId, repoId, staged, paths }) => {
    const path = worktree(sessionId, repoId, "read");
    if (staged) {
      return { files: (await stagedDiff(git, path, paths)).map((file) => toFileDiffDto(file)) };
    }
    const { tracked, untracked } = await unstagedDiff(git, path, paths);
    return {
      files: [...tracked.map((file) => toFileDiffDto(file)), ...untracked.map((file) => toFileDiffDto(file, true))],
    };
  });

  router.register("git.stage", ({ sessionId, repoId, path, hunkIndexes }) => {
    const root = worktree(sessionId, repoId, "write");
    return serial(root, async () => {
      if (hunkIndexes === undefined) {
        unwrap(await git.stage(root, [path]));
      } else {
        const file = await onlyFile(git, root, path, "unstaged");
        unwrap(await git.apply(root, unwrap(hunkPatch(file, hunkIndexes, "forward")), { cached: true, reverse: false }));
      }
      return done;
    });
  });

  router.register("git.unstage", ({ sessionId, repoId, path, hunkIndexes }) => {
    const root = worktree(sessionId, repoId, "write");
    return serial(root, async () => {
      if (hunkIndexes === undefined) {
        const entry = await statusEntry(git, root, path);
        const original = entry !== undefined && "originalPath" in entry ? [entry.originalPath] : [];
        unwrap(await git.unstage(root, [path, ...original]));
      } else {
        const file = await onlyFile(git, root, path, "staged");
        unwrap(await git.apply(root, unwrap(hunkPatch(file, hunkIndexes, "reverse")), { cached: true, reverse: true }));
      }
      return done;
    });
  });

  router.register("git.discard", ({ sessionId, repoId, path, hunkIndexes }) => {
    const root = worktree(sessionId, repoId, "write");
    return serial(root, async () => {
      if (hunkIndexes !== undefined) {
        const file = await onlyFile(git, root, path, "unstaged");
        unwrap(await git.apply(root, unwrap(hunkPatch(file, hunkIndexes, "reverse")), { cached: false, reverse: true }));
      } else if ((await statusEntry(git, root, path))?.kind === "untracked") {
        unwrap(await git.clean(root, [path]));
      } else {
        unwrap(await git.restore(root, [path]));
      }
      return done;
    });
  });

  router.register("git.commit", ({ sessionId, repoId, message }) => {
    const root = worktree(sessionId, repoId, "write");
    return serial(root, async () => {
      const { hash } = unwrap(await git.commit(root, { message }));
      const [commit] = unwrap(await git.log(root, { ref: hash, maxCount: 1 }));
      if (commit === undefined) throw new RpcFailure("git_failed", `commit ${hash} is not in the log`);
      return { commit: toCommitDto(commit) };
    });
  });

  router.register("git.push", ({ sessionId, repoId }) => {
    const root = worktree(sessionId, repoId, "write");
    return serial(root, async () => {
      const { branch } = unwrap(await git.status(root));
      if (branch.head === null) {
        throw new RpcFailure("invalid_state", "HEAD is detached, so there is no branch to push");
      }
      const remote = branch.upstream?.split("/")[0] ?? "origin";
      unwrap(await git.push(root, { remote, branch: branch.head, setUpstream: branch.upstream === null }));
      return done;
    });
  });

  router.register("git.branches", async ({ repoId }) => {
    const branches = unwrap(await git.branches(repoPath(options.store, repoId)));
    return {
      branches: branches.map((branch) => ({
        name: branch.name,
        current: branch.current,
        upstream: branch.upstream,
        headCommit: branch.commit,
      })),
    };
  });

  router.register("git.log", async ({ repoId, ref, limit }) => {
    const path = repoPath(options.store, repoId);
    const commits = unwrap(await git.log(path, { ...(ref === undefined ? {} : { ref }), maxCount: limit }));
    return { commits: commits.map(toCommitDto) };
  });

  router.register("github.createPullRequest", async ({ sessionId, repoId, title, body, base, draft }) => {
    const root = worktree(sessionId, repoId, "write");
    const repo = repoRecord(options.store, repoId);
    const github = gitHubRepo(repo.remoteUrl, options.githubHost);
    const { branch } = unwrap(await git.status(root));
    if (branch.head === null) {
      throw new RpcFailure("invalid_state", "HEAD is detached, so there is no branch to open a pull request from");
    }
    if (branch.upstream === null) {
      throw new RpcFailure("invalid_state", `push ${branch.head} before opening a pull request`, {
        reason: "review.not_pushed",
      });
    }
    const into = base ?? repo.defaultBranch;
    if (into === null) {
      throw new RpcFailure("invalid_params", "the repo has no default branch, so name the base branch");
    }
    const client = authorized(await options.pullRequests());
    const opened = authorized(
      await client.create({
        repo: github,
        head: branch.head,
        base: into,
        title,
        body,
        ...(draft === undefined ? {} : { draft }),
      }),
    );
    return { pullRequest: { number: opened.number, url: opened.url, head: branch.head, base: into } };
  });
}

const done = { ok: true } as const;

type Access = "read" | "write";

// Until R-10 gives sessions worktrees of their own, a session works in the repo's checkout, so its
// worktree of a repo is the repo's local path, and only write roots may be changed.
function sessionWorktree(store: Store, sessionId: string, repoId: string, access: Access): string {
  const session = store.sessions.get(sessionId);
  if (!session.ok) {
    throw new RpcFailure(session.error.code === "store.not_found" ? "not_found" : "internal_error", session.error.message);
  }
  const path = repoPath(store, repoId);
  const roots = access === "write" ? session.value.writeRoots : [...session.value.writeRoots, ...session.value.referenceRoots];
  if (!roots.includes(path)) {
    const role = access === "write" ? "writes" : "uses";
    throw new RpcFailure("invalid_params", `session ${sessionId} ${role} no checkout of repo ${repoId}`, {
      reason: "review.repo_not_in_session",
    });
  }
  return path;
}

function repoRecord(store: Store, repoId: string): Repo {
  const repo = store.repos.get(repoId);
  if (!repo.ok) {
    throw new RpcFailure(repo.error.code === "store.not_found" ? "not_found" : "internal_error", repo.error.message);
  }
  return repo.value;
}

function repoPath(store: Store, repoId: string): string {
  const repo = repoRecord(store, repoId);
  if (repo.localPath === null) throw new RpcFailure("invalid_state", `repo ${repoId} is not cloned`);
  return repo.localPath;
}

function gitHubRepo(remoteUrl: string, host: GitHubHost): { owner: string; name: string } {
  const remote = normalizeRemoteUrl(remoteUrl);
  const [owner, name, ...rest] = remote.ok ? remote.value.segments : [];
  if (!remote.ok || remote.value.host !== host.host || owner === undefined || name === undefined || rest.length > 0) {
    throw new RpcFailure("invalid_state", `${remoteUrl} is not a repository on ${host.host}`, {
      reason: "review.not_on_github",
    });
  }
  return { owner, name };
}

async function stagedDiff(git: ReviewGit, root: string, paths: readonly string[] | undefined): Promise<FileDiff[]> {
  return unwrap(await git.diff(root, { kind: "staged" }, paths));
}

// Untracked files have no diff of their own, so each is shown against nothing.
async function unstagedDiff(
  git: ReviewGit,
  root: string,
  paths: readonly string[] | undefined,
): Promise<{ readonly tracked: FileDiff[]; readonly untracked: FileDiff[] }> {
  const tracked = unwrap(await git.diff(root, { kind: "unstaged" }, paths));
  const status = unwrap(await git.status(root));
  const wanted = paths === undefined ? undefined : new Set(paths);
  const untracked = status.entries.filter(
    (entry) => entry.kind === "untracked" && (wanted === undefined || wanted.has(entry.path)),
  );
  const added: FileDiff[] = [];
  for (const entry of untracked) {
    const files = unwrap(await git.untrackedDiff(root, entry.path));
    added.push(...files.map((file) => ({ ...file, path: entry.path, oldPath: entry.path })));
  }
  return { tracked, untracked: added };
}

async function onlyFile(git: ReviewGit, root: string, path: string, side: "staged" | "unstaged"): Promise<FileDiff> {
  const files = unwrap(await git.diff(root, { kind: side }, [path]));
  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) throw new RpcFailure("invalid_state", `${path} has no ${side} changes`);
  return file;
}

async function statusEntry(git: ReviewGit, root: string, path: string): Promise<StatusEntry | undefined> {
  return unwrap(await git.status(root)).entries.find((entry) => entry.path === path);
}

// Two clicks in a row must not run git on one repository at once: both would want its index lock.
function serialPerPath(): <T>(path: string, run: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return (path, run) => {
    const previous = tails.get(path) ?? Promise.resolve();
    const next = previous.then(run, run);
    const tail = next.catch(() => undefined);
    tails.set(path, tail);
    void tail.then(() => {
      if (tails.get(path) === tail) tails.delete(path);
    });
    return next;
  };
}

function unwrap<T>(result: Result<T, GitError>): T {
  if (result.ok) return result.value;
  const { code, message, stderr } = result.error;
  throw new RpcFailure(gitErrorCodes[code], message, { reason: code, ...(stderr === undefined ? {} : { stderr }) });
}

function authorized<T>(result: Result<T, GitHubAuthError>): T {
  if (result.ok) return result.value;
  const { code, message, fix, details } = result.error;
  throw new RpcFailure(code, message, details === undefined ? undefined : { ...details }, fix);
}

export function toStatusDto(status: Status): GitStatusDto {
  return {
    branch: status.branch.head,
    upstream: status.branch.upstream,
    ahead: status.branch.ahead ?? 0,
    behind: status.branch.behind ?? 0,
    entries: status.entries.flatMap((entry): StatusEntryDto[] => {
      switch (entry.kind) {
        case "ignored":
          return [];
        case "untracked":
          return [{ path: entry.path, originalPath: null, staged: null, unstaged: "untracked", submodule: false }];
        default:
          return [
            {
              path: entry.path,
              originalPath: entry.kind === "renamed" || entry.kind === "copied" ? entry.originalPath : null,
              staged: entry.kind === "unmerged" ? "unmerged" : (fileStates[entry.index] ?? null),
              unstaged: entry.kind === "unmerged" ? "unmerged" : (fileStates[entry.worktree] ?? null),
              submodule: entry.submodule !== null,
            },
          ];
      }
    }),
  };
}

export function toFileDiffDto(file: FileDiff, untracked = false): FileDiffDto {
  return {
    path: file.path,
    originalPath: file.oldPath === file.path ? null : file.oldPath,
    change: untracked ? "untracked" : file.change,
    binary: file.binary,
    hunks: file.hunks.map(toHunkDto),
  };
}

function toHunkDto(hunk: Hunk): FileDiffDto["hunks"][number] {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  const lines = hunk.lines.map((line) => {
    switch (line.kind) {
      case "context":
        return { kind: line.kind, text: line.text, oldLine: oldLine++, newLine: newLine++ };
      case "removed":
        return { kind: line.kind, text: line.text, oldLine: oldLine++, newLine: null };
      case "added":
        return { kind: line.kind, text: line.text, oldLine: null, newLine: newLine++ };
    }
  });
  const old = hunk.oldLines === 1 ? String(hunk.oldStart) : `${String(hunk.oldStart)},${String(hunk.oldLines)}`;
  const next = hunk.newLines === 1 ? String(hunk.newStart) : `${String(hunk.newStart)},${String(hunk.newLines)}`;
  const section = hunk.section === "" ? "" : ` ${hunk.section}`;
  return { header: `@@ -${old} +${next} @@${section}`, lines };
}

function toCommitDto(commit: Commit): CommitDto {
  return {
    sha: commit.hash,
    author: commit.authorName,
    timestamp: new Date(commit.authoredAt * 1000).toISOString(),
    subject: commit.subject,
  };
}
