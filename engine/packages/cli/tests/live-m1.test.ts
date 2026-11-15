import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ENGINE_ENTRY } from "@pica/server";

// Milestone M1 (live; PICA_LIVE=1 and a Copilot CLI login): from the CLI, against the real picad
// and Copilot, register this checkout, run "summarize the README", and read the tokens back from
// `pica usage`. It uses the signed-in user's Pica data directory, as the product does; the
// workspace and repo it registers are reused on the next run.
const live = process.env["PICA_LIVE"] === "1";
const CLI_MAIN = join(import.meta.dirname, "..", "src", "main.ts");
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname, encoding: "utf8" }).trim();
// A short directory: macOS limits a Unix socket path to 104 bytes.
const dir = mkdtempSync(join(tmpdir(), "pica-m1-"));
const socket = join(dir, "s");

function pica(args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", CLI_MAIN, "--socket", socket, ...args],
      { cwd: repoRoot, env: { ...process.env, PICA_ENGINE_ENTRY: ENGINE_ENTRY }, timeout: 280_000 },
      (error, stdout, stderr) => {
        resolve({ code: error === null ? 0 : Number(error.code), stdout, stderr });
      },
    );
  });
}

async function json<T>(args: readonly string[]): Promise<T> {
  const run = await pica(["--json", ...args]);
  if (run.code !== 0) throw new Error(`pica ${args.join(" ")} exited ${String(run.code)}: ${run.stderr}`);
  return JSON.parse(run.stdout.trim().split("\n")[0] ?? "") as T;
}

afterAll(() => {
  try {
    execFileSync("pkill", ["-f", dir]);
  } catch {
    // pkill exits 1 when nothing matched.
  }
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!live)("Milestone M1 live: headless slice", () => {
  it("runs `session new --repo . \"summarize the README\"` and `pica usage` shows the tokens", { timeout: 300_000 }, async () => {
    const name = "M1 check";
    const { workspaces } = await json<{ workspaces: { id: string; name: string }[] }>(["workspace", "list"]);
    const workspaceId =
      workspaces.find((workspace) => workspace.name === name)?.id ??
      (await json<{ workspace: { id: string } }>(["workspace", "create", name])).workspace.id;
    const { repo } = await json<{ repo: { id: string } }>(["repo", "add", ".", "--workspace", workspaceId]);

    const run = await pica(["session", "new", "--workspace", workspaceId, "--repo", repo.id, "summarize the README"]);
    console.log(run.stdout);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    const sessionId = /^Session (\S+)$/m.exec(run.stdout)?.[1];
    expect(sessionId).toBeDefined();

    const usage = await json<{ rows: { key: string; inputTokens: number; outputTokens: number }[] }>([
      "usage",
      "--session",
      sessionId ?? "",
      "--by",
      "agent",
    ]);
    console.log(JSON.stringify(usage));
    const main = usage.rows.find((row) => row.key === "main");
    expect(main?.inputTokens).toBeGreaterThan(0);
    expect(main?.outputTokens).toBeGreaterThan(0);
  });
});
