import { err, ok, type Result } from "../result.ts";
import type { FileDiff, Hunk } from "./diff.ts";
import type { GitError } from "./errors.ts";
import { quotePath } from "./quoting.ts";

// `forward` patches apply to the diff's old side (staging into the index); `reverse` ones are applied
// with `git apply -R` to its new side (unstaging, or discarding from the working tree).
export type HunkPatchDirection = "forward" | "reverse";

// A patch with only some of a file's hunks, for `git apply` to stage, unstage or discard them. Only a
// modified text file can be split: other changes (added, deleted, renamed, binary) move as a whole file.
export function hunkPatch(
  file: FileDiff,
  hunkIndexes: readonly number[],
  direction: HunkPatchDirection = "forward",
): Result<string, GitError> {
  if (file.change !== "modified" || file.binary || file.submodule !== null || file.oldMode !== file.newMode) {
    return invalid(`${file.path} is ${describe(file)}, so it can only be changed as a whole file`);
  }
  const wanted = [...new Set(hunkIndexes)].sort((a, b) => a - b);
  if (wanted.length === 0) return invalid("no hunks were given");
  const missing = wanted.find((index) => !Number.isInteger(index) || index < 0 || index >= file.hunks.length);
  if (missing !== undefined) {
    return invalid(`${file.path} has ${String(file.hunks.length)} hunks, so there is no hunk ${String(missing)}`);
  }
  const oldName = quotePath(`a/${file.path}`);
  const newName = quotePath(`b/${file.path}`);
  const lines = [`diff --git ${oldName} ${newName}`, `--- ${oldName}`, `+++ ${newName}`];
  // Hunks left out move the side the patch is not applied to; `git apply` also searches near the stated
  // line, but only the counts inside each hunk have to be exact.
  let skippedGrowth = 0;
  let next = 0;
  for (const index of wanted) {
    for (; next < index; next += 1) {
      const skipped = file.hunks[next];
      if (skipped !== undefined && !wanted.includes(next)) skippedGrowth += skipped.newLines - skipped.oldLines;
    }
    next = index + 1;
    const hunk = file.hunks[index];
    if (hunk === undefined) continue;
    const shift = direction === "forward" ? { old: 0, new: -skippedGrowth } : { old: skippedGrowth, new: 0 };
    lines.push(...hunkLines(hunk, shift));
  }
  return ok(`${lines.join("\n")}\n`);
}

function hunkLines(hunk: Hunk, shift: { readonly old: number; readonly new: number }): string[] {
  const oldStart = hunk.oldStart + shift.old;
  const newStart = hunk.newStart + shift.new;
  const header = `@@ -${range(oldStart, hunk.oldLines)} +${range(newStart, hunk.newLines)} @@${hunk.section === "" ? "" : ` ${hunk.section}`}`;
  const body = hunk.lines.flatMap((line) => {
    const marker = line.kind === "context" ? " " : line.kind === "added" ? "+" : "-";
    return line.noNewlineAtEnd ? [`${marker}${line.text}`, "\\ No newline at end of file"] : [`${marker}${line.text}`];
  });
  return [header, ...body];
}

function range(start: number, count: number): string {
  return count === 1 ? String(start) : `${String(start)},${String(count)}`;
}

function describe(file: FileDiff): string {
  if (file.binary) return "binary";
  if (file.submodule !== null) return "a submodule";
  if (file.change !== "modified") return file.change;
  return "changing mode";
}

function invalid(message: string): { readonly ok: false; readonly error: GitError } {
  return err({ code: "git.invalid_argument", message });
}
