import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, defaultCommandDenyList, withRealPaths, type PolicyContext, type ToolCall, type ToolTarget } from "@pica/core";
import { PicaConfig } from "@pica/protocol";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realPath } from "../../src/index.ts";

// `base` is the temp dir as written; on macOS it lives under a symlink (/var → /private/var).
let base: string;
let real: string;
let repo: string;
let lib: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "pica-sandbox-"));
  real = realpathSync.native(base);
  repo = join(base, "work/repo");
  lib = join(base, "ref/lib");
  for (const dir of [join(repo, "src"), lib, join(base, "outside")]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(repo, "src/a.ts"), "");
  symlinkSync(join(base, "outside"), join(repo, "out"));
  symlinkSync("..", join(repo, "up"));
  symlinkSync("../../ref/lib", join(repo, "ref"));
  symlinkSync(join(base, "outside/new.txt"), join(repo, "dangling"));
  symlinkSync("loop", join(repo, "loop"));
  symlinkSync("src", join(repo, "current"));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("realPath", () => {
  it("resolves the temp dir's own symlinks like the OS", async () => {
    expect(await realPath(repo)).toBe(join(real, "work/repo"));
  });

  it("follows an absolute link out of the tree", async () => {
    expect(await realPath(join(repo, "out/x"))).toBe(join(real, "outside/x"));
  });

  it("climbs from a link's target on .. instead of normalizing first", async () => {
    expect(await realPath(`${repo}/out/../escaped`)).toBe(join(real, "escaped"));
    expect(await realPath(`${repo}/up/../etc`)).toBe(join(real, "etc"));
  });

  it("follows a relative link", async () => {
    expect(await realPath(join(repo, "ref/a.ts"))).toBe(join(real, "ref/lib/a.ts"));
  });

  it("follows a dangling link to where a write would land", async () => {
    expect(await realPath(join(repo, "dangling"))).toBe(join(real, "outside/new.txt"));
  });

  it("keeps a missing tail as written", async () => {
    expect(await realPath(join(repo, "src/new/../b.ts"))).toBe(join(real, "work/repo/src/b.ts"));
  });

  it("stops following a link loop", async () => {
    expect(await realPath(join(repo, "loop/x"))).toBe(join(real, "work/repo/loop/x"));
  });

  it("agrees with the OS on every existing path it is fuzzed with", async () => {
    const segment = fc.constantFrom("work", "repo", "src", "a.ts", "out", "up", "ref", "lib", "current", "outside", "..", ".", "");
    await fc.assert(
      fc.asyncProperty(fc.array(segment, { maxLength: 8 }), async (parts) => {
        const path = `${base}/${parts.join("/")}`;
        let expected: string;
        try {
          expected = realpathSync.native(path);
        } catch {
          return;
        }
        expect(await realPath(path)).toBe(expected);
      }),
      { numRuns: 2000, seed: 7009 },
    );
  });
});

describe("session scope on a real filesystem", () => {
  function context(mode: "ask" | "auto"): PolicyContext {
    return {
      cwd: repo,
      writeRoots: [repo],
      referenceRoots: [lib],
      config: PicaConfig.parse({ permissions: { mode } }),
      managed: [],
      commandDenyList: defaultCommandDenyList,
    };
  }

  async function decideOn(target: ToolTarget, mode: "ask" | "auto" = "auto"): Promise<{ outcome: string; ruleId: string }> {
    const call: ToolCall = { id: "call", tool: "tool", agent: "main", target };
    const { outcome, ruleId } = decide(call, await withRealPaths(call, context(mode), realPath));
    return { outcome, ruleId };
  }

  it("allows a write inside the write root", async () => {
    expect(await decideOn({ kind: "write", path: "src/a.ts" })).toEqual({ outcome: "allow", ruleId: "permission.auto" });
    expect(await decideOn({ kind: "write", path: "current/b.ts" })).toEqual({ outcome: "allow", ruleId: "permission.auto" });
  });

  it("denies a write through a symlink leading out of every root", async () => {
    expect(await decideOn({ kind: "write", path: "out/x" })).toEqual({ outcome: "deny", ruleId: "safety.outside-roots" });
    expect(await decideOn({ kind: "write", path: "dangling" })).toEqual({ outcome: "deny", ruleId: "safety.outside-roots" });
    expect(await decideOn({ kind: "write", path: "up/../../etc/hosts" })).toEqual({ outcome: "deny", ruleId: "safety.outside-roots" });
  });

  it("denies a write through a symlink into a reference root", async () => {
    expect(await decideOn({ kind: "write", path: "ref/a.ts" })).toEqual({ outcome: "deny", ruleId: "safety.outside-write-roots" });
  });

  it("allows reading a reference root through a symlink", async () => {
    expect(await decideOn({ kind: "read", path: "ref/a.ts", sizeBytes: 1 }, "ask")).toEqual({ outcome: "allow", ruleId: "permission.read-only" });
  });

  it("asks, or denies in auto mode, for a shell redirect through a symlink out of the write roots", async () => {
    const target: ToolTarget = { kind: "shell", command: "echo x > out/log.txt", cwd: repo };
    expect(await decideOn(target, "ask")).toEqual({ outcome: "ask", ruleId: "safety.shell-outside-write-roots" });
    expect(await decideOn(target, "auto")).toEqual({ outcome: "deny", ruleId: "safety.shell-outside-write-roots" });
  });
});
