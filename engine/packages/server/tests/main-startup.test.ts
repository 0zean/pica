import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// The CLI starts picad as `node --experimental-strip-types main.ts` (cli/src/engine-process.ts),
// with no build step. Every module picad loads must be runnable that way (`erasableSyntaxOnly`).
const main = join(import.meta.dirname, "..", "src", "main.ts");
// A short directory: macOS limits a Unix socket path to 104 bytes.
const dir = mkdtempSync(join(tmpdir(), "picad-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("picad main", () => {
  it("starts under node's type stripping and prints its ready line", { timeout: 30_000 }, async () => {
    const socket = join(dir, "s");
    const child = spawn(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", main, "--socket", socket], {
      env: { ...process.env, HOME: dir },
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const ready = await new Promise<string>((resolve, reject) => {
      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.includes("\n")) resolve(stdout.split("\n")[0] ?? "");
      });
      child.on("exit", (code) => {
        reject(new Error(`picad exited with ${String(code)}: ${stderr}`));
      });
    });
    child.kill("SIGTERM");
    expect(JSON.parse(ready)).toEqual({ ready: true, socket });
  });
});
