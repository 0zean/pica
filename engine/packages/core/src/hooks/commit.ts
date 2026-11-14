import type { GitService } from "../git/index.ts";
import { err } from "../result.ts";
import { runUserHooks } from "./run.ts";
import type { HookRunReport, UserHookDeps } from "./types.ts";

// The R-01 git service with `beforeCommit` hooks in front of `commit`. A failing hook blocks the
// commit with `git.hook_blocked`; the hook's output is in `stderr`.
export function withBeforeCommitHooks(
  git: GitService,
  deps: UserHookDeps,
  onReport?: (report: HookRunReport) => void,
): GitService {
  return {
    ...git,
    async commit(repo, options) {
      const scope = { cwd: repo, writeRoots: [repo], referenceRoots: [] };
      const report = await runUserHooks(deps, "beforeCommit", scope, {
        PICA_REPO: repo,
        PICA_COMMIT_MESSAGE: options.message,
      });
      onReport?.(report);
      const { failure } = report;
      if (failure !== undefined) {
        return err({
          code: "git.hook_blocked",
          message: `commit blocked: ${failure.message}`,
          stderr: failure.output,
          ...(failure.exitCode === undefined ? {} : { exitCode: failure.exitCode }),
        });
      }
      return git.commit(repo, options);
    },
  };
}
