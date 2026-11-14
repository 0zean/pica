import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRepoCardService, defaultRepoCardMaxBytes } from "@pica/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFileRepoCardCache, createGitRepoCardSource } from "../../src/index.ts";
import { git, gitEnv, makeFixtureRoot, value } from "./helpers.ts";

let root: string;
let bigRepo: string;

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// A repo with far more of everything than fits: many languages, nested manifests, entry points,
// long CODEOWNERS rules and multi-byte names.
beforeAll(() => {
  root = makeFixtureRoot();
  bigRepo = join(root, "big");
  git(root, "init", "--quiet", "--initial-branch=main", bigRepo);
  const extensions = ["ts", "js", "py", "go", "swift", "java", "kt", "rs", "rb", "php", "c", "cpp", "sh"];
  for (let index = 0; index < 120; index += 1) {
    const service = `services/sérvice-${String(index).padStart(3, "0")}`;
    write(join(bigRepo, service, "package.json"), `{"name":"s${String(index)}"}\n`);
    write(join(bigRepo, service, `main.${extensions[index % extensions.length] ?? "ts"}`), "x\n");
    write(join(bigRepo, "cmd", `tool-${String(index)}`, "main.go"), "package main\n");
  }
  write(join(bigRepo, "package.json"), JSON.stringify({ bin: Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [`bin${String(index)}`, `./bin/${"long-name-".repeat(5)}${String(index)}.js`]),
  ), scripts: { build: "x", test: "y" } }));
  write(join(bigRepo, "Makefile"), "build:\n\ttrue\ntest:\n\ttrue\n");
  write(join(bigRepo, "go.mod"), "module x\n");
  write(join(bigRepo, "CODEOWNERS"), Array.from({ length: 200 }, (_, index) =>
    `/services/sérvice-${String(index)}/ @acme/team-${String(index)} @owner-${String(index)}`).join("\n"));
  git(bigRepo, "add", "-A");
  git(bigRepo, "commit", "--quiet", "-m", "Big repo");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("repo card size cap", () => {
  it.each([defaultRepoCardMaxBytes, 512, 120, 40, 1])("stays within a %i byte cap", async (maxBytes) => {
    const service = createRepoCardService({
      source: createGitRepoCardSource({ env: gitEnv }),
      cache: createFileRepoCardCache(join(root, `cache-${String(maxBytes)}`)),
      maxBytes,
    });
    const card = value(await service.card({ id: "big", name: "acme/ünïcode-big", path: bigRepo }));
    expect(Buffer.byteLength(card.text, "utf8")).toBeLessThanOrEqual(maxBytes);
    expect(card.text).not.toContain("�");
    if (maxBytes >= 512) expect(card.text).toMatch(/\(\+\d+ more\)/);
  });
});
