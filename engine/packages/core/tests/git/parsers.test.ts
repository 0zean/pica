import { describe, expect, it } from "vitest";
import { parseBranches, parseDiff, parseLog, parsePush, parseStatus } from "../../src/index.ts";
import { unquotePath } from "../../src/git/quoting.ts";

describe("unquotePath", () => {
  it("returns unquoted paths unchanged", () => {
    expect(unquotePath("plain name.txt")).toBe("plain name.txt");
  });

  it("decodes C escapes and octal UTF-8 bytes", () => {
    expect(unquotePath('"a\\tb\\"c\\\\d\\303\\251"')).toBe('a\tb"c\\dé');
  });

  it("rejects malformed quoting", () => {
    expect(unquotePath('"unterminated')).toBeUndefined();
    expect(unquotePath('"bad \\q escape"')).toBeUndefined();
  });
});

describe("parseStatus", () => {
  it("reads ignored entries and copies", () => {
    const raw = ["! build/out.o", "2 C. N... 100644 100644 100644 aaa bbb C75 copy.txt", "orig.txt", ""].join("\0");
    expect(parseStatus(raw)).toEqual({
      ok: true,
      value: {
        branch: { commit: null, head: null, upstream: null, ahead: null, behind: null },
        entries: [
          { kind: "ignored", path: "build/out.o" },
          {
            kind: "copied",
            path: "copy.txt",
            originalPath: "orig.txt",
            similarity: 75,
            index: "copied",
            worktree: "unmodified",
            submodule: null,
          },
        ],
      },
    });
  });

  it("fails with a parse error instead of throwing on unknown records", () => {
    const result = parseStatus("X what\0");
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("git.parse_failed");
  });

  it("fails on a rename record with no original path", () => {
    expect(parseStatus("2 R. N... 100644 100644 100644 a b R100 new.txt\0").ok).toBe(false);
  });
});

describe("parseDiff", () => {
  it("returns no files for empty output", () => {
    expect(parseDiff("")).toEqual({ ok: true, value: [] });
  });

  it("treats an empty line inside a hunk as blank context", () => {
    const raw = ["diff --git a/f b/f", "--- a/f", "+++ b/f", "@@ -1,2 +1,2 @@", "", "-x", "+y", ""].join("\n");
    const result = parseDiff(raw);
    expect(result.ok && result.value[0]?.hunks[0]?.lines[0]).toEqual({
      kind: "context",
      text: "",
      noNewlineAtEnd: false,
    });
  });

  it("fails when a hunk is shorter than its header says", () => {
    const raw = ["diff --git a/f b/f", "--- a/f", "+++ b/f", "@@ -1,3 +1,3 @@", " a", ""].join("\n");
    expect(parseDiff(raw).ok).toBe(false);
  });

  it("fails on an unknown header line", () => {
    expect(parseDiff("diff --git a/f b/f\nsurprise header\n").ok).toBe(false);
  });

  it("fails on output that is not a diff", () => {
    expect(parseDiff("warning: something\n").ok).toBe(false);
  });
});

describe("parseLog", () => {
  const commit = (hash: string, parents: string, body: string): string[] => [
    hash,
    parents,
    "Ann",
    "ann@example.test",
    "1700000000",
    "Cam",
    "cam@example.test",
    "1700000060",
    "Subject",
    body,
  ];

  it("reads NUL-delimited commits, including multi-line bodies and merges", () => {
    const raw = [...commit("aa11", "bb22 cc33", "Line one\n\nLine two\n"), ...commit("bb22", "", "")].join("\0") + "\0";
    const result = parseLog(raw);
    expect(result.ok && result.value).toEqual([
      {
        hash: "aa11",
        parents: ["bb22", "cc33"],
        authorName: "Ann",
        authorEmail: "ann@example.test",
        authoredAt: 1700000000,
        committerName: "Cam",
        committerEmail: "cam@example.test",
        committedAt: 1700000060,
        subject: "Subject",
        body: "Line one\n\nLine two",
      },
      expect.objectContaining({ hash: "bb22", parents: [], body: "" }),
    ]);
  });

  it("fails on a truncated record", () => {
    expect(parseLog("aa11\0bb22\0").ok).toBe(false);
  });
});

describe("parseBranches", () => {
  it("reads local and remote refs, tracking counts, and skips symbolic refs", () => {
    const line = (...fields: string[]): string => fields.join("\0");
    const raw = [
      line("refs/heads/main", "aa11", "refs/remotes/origin/main", "ahead 2, behind 3", "*", ""),
      line("refs/heads/old", "bb22", "refs/remotes/origin/old", "gone", " ", ""),
      line("refs/heads/solo", "cc33", "", "", " ", ""),
      line("refs/remotes/origin/HEAD", "aa11", "", "", " ", "refs/remotes/origin/main"),
      line("refs/remotes/origin/main", "dd44", "", "", " ", ""),
      "",
    ].join("\n");
    const result = parseBranches(raw);
    expect(result.ok && result.value).toEqual([
      expect.objectContaining({ name: "main", kind: "local", current: true, upstream: "origin/main", ahead: 2, behind: 3 }),
      expect.objectContaining({ name: "old", upstream: "origin/old", upstreamGone: true, ahead: null }),
      expect.objectContaining({ name: "solo", upstream: null, ahead: null, behind: null }),
      expect.objectContaining({ name: "origin/main", kind: "remote", commit: "dd44", current: false }),
    ]);
  });

  it("fails on a ref outside heads and remotes", () => {
    expect(parseBranches("refs/tags/v1\0aa11\0\0\0 \0\n").ok).toBe(false);
  });
});

describe("parsePush", () => {
  it("reads porcelain ref lines", () => {
    const raw = [
      "To ../remote.git",
      " \trefs/heads/main:refs/heads/main\taa11..bb22",
      "!\trefs/heads/dev:refs/heads/dev\t[rejected] (non-fast-forward)",
      "-\t:refs/heads/gone\t[deleted]",
      "Done",
      "",
    ].join("\n");
    expect(parsePush(raw)).toEqual({
      ok: true,
      value: {
        destination: "../remote.git",
        refs: [
          { outcome: "fastForward", localRef: "refs/heads/main", remoteRef: "refs/heads/main", summary: "aa11..bb22" },
          {
            outcome: "rejected",
            localRef: "refs/heads/dev",
            remoteRef: "refs/heads/dev",
            summary: "[rejected] (non-fast-forward)",
          },
          { outcome: "deleted", localRef: "", remoteRef: "refs/heads/gone", summary: "[deleted]" },
        ],
      },
    });
  });

  it("ignores informational lines but not malformed ref lines", () => {
    const tracking = "To r\nbranch 'x' set up to track 'origin/x'.\n*\trefs/heads/x:refs/heads/x\t[new branch]\n";
    expect(parsePush(tracking).ok && parsePush(tracking)).toMatchObject({ value: { refs: [{ outcome: "created" }] } });
    expect(parsePush("To r\n?\trefs/heads/x:refs/heads/x\tsummary\n").ok).toBe(false);
  });

  it("fails without a destination line", () => {
    expect(parsePush("").ok).toBe(false);
  });
});
