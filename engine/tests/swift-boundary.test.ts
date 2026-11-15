import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "..", "..", "tools", "lint", "swift-boundary.sh");
const roots: string[] = [];
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function lint(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "pica-swift-boundary-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const result = spawnSync("sh", [script, root], { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

describe("swift boundary lint (PLAN.md §4.3)", () => {
  it("passes Swift that talks only to the engine", () => {
    expect(lint({ "Pica/App.swift": 'let socket = "picad.sock"\n' }).status).toBe(0);
  });

  it.each([
    ['process.executableURL = URL(fileURLWithPath: "/usr/bin/git")'],
    ['process.arguments = ["git", "status"]'],
    ['let url = URL(string: "https://api.github.com/user")'],
    ['let url = URL(string: "https://github.com/login")'],
    ['let url = URL(string: "https://api.octo.ghe.com/user")'],
  ])("fails on %s and names the file", (line) => {
    const result = lint({ "Packages/Feature/Sources/Bad.swift": `${line}\n` });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Bad.swift:1");
  });

  it("honours an allow comment and skips build output", () => {
    expect(
      lint({
        "Pica/Links.swift": 'let help = "https://github.com/0zean/pica" // swift-boundary: allow (help link)\n',
        ".derived/Gen.swift": 'let x = "git"\n',
      }).status,
    ).toBe(0);
  });
});
