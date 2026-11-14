import type { FileDiff } from "../git/diff.ts";
import type { GitService } from "../git/port.ts";
import type { ChangeSet, ChangeSetFailure } from "./types.ts";

// Git's well-known empty tree, so a branch started in an unborn repository diffs as all additions.
const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export type ChangeSetRepoDiff =
  | { readonly repo: string; readonly worktreePath: string; readonly ok: true; readonly files: FileDiff[] }
  | { readonly repo: string; readonly worktreePath: string; readonly ok: false; readonly error: ChangeSetFailure };

// What each repository's branch has committed since its worktree was created. A failure in one repository
// is reported in its entry and does not hide the others.
export async function changeSetDiffs(git: GitService, changeSet: ChangeSet): Promise<ChangeSetRepoDiff[]> {
  return Promise.all(
    changeSet.members.map(async (member): Promise<ChangeSetRepoDiff> => {
      const where = { repo: member.repo, worktreePath: member.worktree.path };
      const diff = await git.diff(member.worktree.path, { kind: "commits", from: member.baseCommit ?? emptyTree, to: "HEAD" });
      return diff.ok
        ? { ...where, ok: true, files: diff.value }
        : { ...where, ok: false, error: { code: diff.error.code, message: diff.error.message } };
    }),
  );
}
