import { err, ok, type Result } from "../result.ts";
import type { WorktreeError } from "./errors.ts";

export const worktreeBranchPrefix = "pica/";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const maxSlugLength = 64;

// Slugs are lowercase words joined by single hyphens, so every branch name is valid for git and for a path.
export function worktreeBranchName(slug: string): Result<string, WorktreeError> {
  if (slug.length > maxSlugLength || !slugPattern.test(slug)) {
    return err({
      code: "worktree.invalid_slug",
      message: `"${slug}" is not a valid slug: use up to ${String(maxSlugLength)} lowercase letters, digits, and single hyphens`,
    });
  }
  return ok(`${worktreeBranchPrefix}${slug}`);
}
