import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { evalSuite, writeFixtureFiles } from "../src/index.ts";
import type { EvalTask, TaskCategory } from "../src/index.ts";

// C-10: each task's success check passes on its reference solution and fails on an empty one (the
// fixture untouched and no answer).
const root = mkdtempSync(join(tmpdir(), "pica-eval-checks-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function freshCopy(task: EvalTask, label: string): string {
  const dir = join(root, `${task.id}-${label}`);
  writeFixtureFiles(task.repo, dir);
  return dir;
}

describe("the C-10 suite", () => {
  it("has at least 15 tasks with unique ids, at least three in each category", () => {
    expect(evalSuite.length).toBeGreaterThanOrEqual(15);
    expect(new Set(evalSuite.map((task) => task.id)).size).toBe(evalSuite.length);
    const categories: TaskCategory[] = ["large-file-question", "comprehension", "test-scaffolding", "config-generation", "multi-file-edit"];
    for (const category of categories) {
      expect(evalSuite.filter((task) => task.category === category).length, category).toBeGreaterThanOrEqual(3);
    }
  });

  describe.each(evalSuite.map((task) => [task.id, task] as const))("%s", (_id, task) => {
    it("passes on the reference solution", () => {
      const workdir = freshCopy(task, "reference");
      const answer = task.solve(workdir);
      const result = task.check({ workdir, answer });
      expect(result.detail).toBeTypeOf("string");
      expect(result).toMatchObject({ passed: true });
    });

    it("fails on an empty solution", () => {
      const workdir = freshCopy(task, "empty");
      expect(task.check({ workdir, answer: "" })).toMatchObject({ passed: false });
    });
  });
});
