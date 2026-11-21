import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const work = mkdtempSync(join(tmpdir(), "pica-bundle-"));
const out = join(work, "engine");
const main = fileURLToPath(new URL("./main.ts", import.meta.url));

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

function bundle(version: string): void {
  execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", main, "--out", out, "--version", version], {
    stdio: "pipe",
  });
}

async function helloFromBundle(): Promise<unknown> {
  const socket = join(work, "picad.sock");
  const engine = spawn(process.execPath, [join(out, "picad.mjs"), "--socket", socket], {
    env: { HOME: work, PATH: process.env["PATH"] ?? "" },
    stdio: ["ignore", "pipe", "ignore"],
  });
  try {
    const ready = await new Promise<string>((resolve) => {
      createInterface({ input: engine.stdout }).once("line", resolve);
    });
    expect(JSON.parse(ready)).toMatchObject({ ready: true });
    return await new Promise((resolve, reject) => {
      const conn = connect(socket, () => {
        conn.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "engine.hello", params: { protocolVersion: { major: 1, minor: 0 }, client: { name: "bundle-test", version: "0" } } })}\n`,
        );
      });
      createInterface({ input: conn }).once("line", (line) => {
        conn.end();
        resolve(JSON.parse(line));
      });
      conn.on("error", reject);
    });
  } finally {
    engine.kill("SIGTERM");
  }
}

describe("the release bundle of picad (H-06)", () => {
  it("rejects a version that is not x.y.z", () => {
    expect(() => {
      bundle("next");
    }).toThrow();
  });

  it("runs from one file and reports the version it was bundled with", async () => {
    bundle("9.8.7");
    expect(existsSync(join(out, "builtin", "repo-scout.md"))).toBe(true);
    expect(await helloFromBundle()).toMatchObject({ result: { engineVersion: "9.8.7" } });
  }, 30_000);
});
