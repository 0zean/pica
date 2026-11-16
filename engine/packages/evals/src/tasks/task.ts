import type { CheckResult } from "../check-helpers.ts";
import type { FixtureRepoName } from "../fixture-repos.ts";

export type TaskCategory = "large-file-question" | "test-scaffolding" | "config-generation" | "multi-file-edit";

export interface CheckContext {
  // The working copy after the session.
  readonly workdir: string;
  // The main agent's last message.
  readonly answer: string;
}

export interface EvalTask {
  readonly id: string;
  readonly category: TaskCategory;
  readonly repo: FixtureRepoName;
  readonly prompt: string;
  check(context: CheckContext): CheckResult;
  // A known-good solution: applies its edits to `workdir` and returns its answer. The checks are
  // tested against it, and the FakeRuntime suite run plays it in place of a model.
  solve(workdir: string): string;
}
