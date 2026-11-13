import { spawn } from "node:child_process";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@pica/protocol";
import { TestClient, helloParams, makeSocketDir } from "./helpers.ts";

// PLAN.md §9: engine start to `engine.hello` reply < 1.5 s.
const BUDGET_MS = 1500;
const RUNS = 3;
const MAIN = join(import.meta.dirname, "..", "src", "main.ts");

async function startToHelloMs(): Promise<number> {
  const paths = await makeSocketDir();
  const started = performance.now();
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", MAIN, "--socket", paths.socketPath],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
  try {
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const ready = await lines.next();
    expect(JSON.parse(String(ready.value))).toEqual({ ready: true, socket: paths.socketPath });
    const client = await TestClient.connect(paths.socketPath);
    const response = await client.request("engine.hello", helloParams(PROTOCOL_VERSION.major));
    const elapsed = performance.now() - started;
    expect("result" in response).toBe(true);
    client.close();
    child.kill("SIGTERM");
    expect(await exited).toBe(0);
    return elapsed;
  } finally {
    child.kill("SIGKILL");
    await paths.remove();
  }
}

describe("picad startup", () => {
  it(`answers engine.hello within ${String(BUDGET_MS)} ms of process start (median of ${String(RUNS)})`, async () => {
    const samples: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      samples.push(await startToHelloMs());
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(RUNS / 2)] ?? Number.POSITIVE_INFINITY;
    console.log(`picad start to hello: ${samples.map((ms) => ms.toFixed(0)).join(", ")} ms; median ${median.toFixed(0)} ms`);
    expect(median).toBeLessThan(BUDGET_MS);
  }, 30_000);
});
