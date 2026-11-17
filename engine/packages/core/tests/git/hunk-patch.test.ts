import { describe, expect, it } from "vitest";
import { hunkPatch, parseDiff } from "../../src/index.ts";
import type { FileDiff } from "../../src/index.ts";
import { quotePath, unquotePath } from "../../src/git/quoting.ts";

// A-08: patches of chosen hunks, which the review hands to `git apply`.

const twoHunks = [
  "diff --git a/story.txt b/story.txt",
  "index 1111111..2222222 100644",
  "--- a/story.txt",
  "+++ b/story.txt",
  "@@ -1,3 +1,4 @@",
  " one",
  "+one and a half",
  " two",
  " three",
  "@@ -20,3 +21,2 @@ section",
  " twenty",
  "-twenty-one",
  " twenty-two",
  "",
].join("\n");

function file(raw: string): FileDiff {
  const parsed = parseDiff(raw);
  if (!parsed.ok || parsed.value[0] === undefined) throw new Error("fixture does not parse");
  return parsed.value[0];
}

describe("hunkPatch", () => {
  it("keeps a later hunk's old side and moves its new side by the hunks left out", () => {
    const patch = hunkPatch(file(twoHunks), [1]);
    expect(patch).toEqual({
      ok: true,
      value: [
        "diff --git a/story.txt b/story.txt",
        "--- a/story.txt",
        "+++ b/story.txt",
        "@@ -20,3 +20,2 @@ section",
        " twenty",
        "-twenty-one",
        " twenty-two",
        "",
      ].join("\n"),
    });
  });

  it("moves the old side instead for a patch applied in reverse", () => {
    const patch = hunkPatch(file(twoHunks), [1], "reverse");
    expect(patch.ok && patch.value.split("\n")[3]).toBe("@@ -21,3 +21,2 @@ section");
  });

  it("keeps every hunk in order when all are chosen, whatever order they are given in", () => {
    const patch = hunkPatch(file(twoHunks), [1, 0, 1]);
    expect(patch.ok && patch.value.split("\n").filter((line) => line.startsWith("@@"))).toEqual([
      "@@ -1,3 +1,4 @@",
      "@@ -20,3 +21,2 @@ section",
    ]);
  });

  it("keeps the no-newline marker", () => {
    const raw = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1 +1 @@", "-a", "\\ No newline at end of file", "+b", "\\ No newline at end of file", ""].join("\n");
    const patch = hunkPatch(file(raw), [0]);
    expect(patch.ok && patch.value).toBe(`${raw.split("\n").slice(0, 3).join("\n")}\n${raw.split("\n").slice(3).join("\n")}`);
  });

  it("refuses hunks that do not exist and files that only move whole", () => {
    expect(hunkPatch(file(twoHunks), [2])).toMatchObject({ ok: false, error: { code: "git.invalid_argument" } });
    expect(hunkPatch(file(twoHunks), [])).toMatchObject({ ok: false, error: { code: "git.invalid_argument" } });
    const added = ["diff --git a/n b/n", "new file mode 100644", "--- /dev/null", "+++ b/n", "@@ -0,0 +1 @@", "+n", ""].join("\n");
    expect(hunkPatch(file(added), [0])).toMatchObject({ ok: false, error: { code: "git.invalid_argument" } });
    const binary = ["diff --git a/b b/b", "index 1..2 100644", "Binary files a/b and b/b differ", ""].join("\n");
    expect(hunkPatch(file(binary), [0])).toMatchObject({ ok: false, error: { code: "git.invalid_argument" } });
  });

  it("quotes paths git would quote", () => {
    const name = "caf\\303\\251.txt";
    const header = [`diff --git "a/${name}" "b/${name}"`, `--- "a/${name}"`, `+++ "b/${name}"`];
    const raw = [...header, "@@ -1 +1 @@", "-a", "+b", ""].join("\n");
    expect(file(raw).path).toBe("café.txt");
    expect(hunkPatch(file(raw), [0])).toEqual({ ok: true, value: raw });
  });
});

describe("quotePath", () => {
  it("leaves plain paths alone and round-trips the rest through unquotePath", () => {
    expect(quotePath("a/plain name.txt")).toBe("a/plain name.txt");
    for (const path of ['a\tb"c\\d', "café", "line\nbreak"]) {
      expect(quotePath(path).startsWith('"')).toBe(true);
      expect(unquotePath(quotePath(path))).toBe(path);
    }
  });
});
