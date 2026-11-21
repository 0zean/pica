import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probeGitInstall } from "../../src/index.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pica-probe-git-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function script(name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe("probeGitInstall (A-15)", () => {
  it("reports the installed git's version", async () => {
    const git = await probeGitInstall({ env: process.env, cwd: dir });
    expect(git.status).toBe("installed");
    expect(git.version).toMatch(/^\d+\.\d+/);
    expect(git.message).toBeNull();
  });

  it("reports git missing when it cannot be run", async () => {
    const git = await probeGitInstall({ gitPath: join(dir, "no-git"), env: process.env, cwd: dir });
    expect(git).toMatchObject({ status: "missing", version: null });
    expect(git.message).toContain("no-git");
  });

  it("reports macOS's stub without the Command Line Tools as missing, with what it said", async () => {
    const stub = script("git", 'echo "xcode-select: note: No developer tools were found, requesting install." >&2\nexit 1');
    expect(await probeGitInstall({ gitPath: stub, env: process.env, cwd: dir })).toEqual({
      status: "missing",
      version: null,
      message: "xcode-select: note: No developer tools were found, requesting install.",
    });
  });

  it("names the exit code when a failing git says nothing", async () => {
    const silent = script("git", "exit 69");
    expect((await probeGitInstall({ gitPath: silent, env: process.env, cwd: dir })).message).toBe("git --version exited with 69");
  });
});
