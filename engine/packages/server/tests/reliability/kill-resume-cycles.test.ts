import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { TestClient } from "../helpers.ts";
import type { JsonObject } from "../helpers.ts";
import { call, createSession, openSeededStore, received, subscribe } from "../sessions/helpers.ts";
import type { WireEvent } from "../sessions/helpers.ts";

// H-05: kill -9 the engine at a different point of a turn, restart it, resume the session, and
// repeat. Every event any client received must still be in the log, unchanged, with no gap in seq.
//
// PICA_KILL_CYCLES sets the number of cycles. `make verify` and CI run the default, 100 locally
// and 25 when CI is set (GitHub's runners start Node about three times slower); run
// `PICA_KILL_CYCLES=100 pnpm vitest run tests/reliability` to give CI's run the full count.
const cycles = Number(process.env["PICA_KILL_CYCLES"] ?? (process.env["CI"] === undefined ? 100 : 25));

const turn = {
  steps: [
    { type: "text", content: "Looking at the schema." },
    { type: "toolCall", name: "view", arguments: { path: "schema.sql" }, result: "CREATE TABLE accounts (...)" },
    { type: "text", content: "Writing the migration." },
    { type: "toolCall", name: "edit", arguments: { path: "migrate.sql" }, result: "ok" },
    { type: "usage", model: "model-a", inputTokens: 1200, outputTokens: 80 },
    { type: "text", content: "Running it." },
    { type: "toolCall", name: "shell", arguments: { command: "make migrate" }, result: "", hangs: true },
  ],
};
const scenarioFile = { version: 1, models: [{ id: "model-a", name: "Model A" }], defaultModel: "model-a", turns: [turn] };

interface EngineProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exited: Promise<NodeJS.Signals | null>;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function startEngineProcess(args: readonly string[]): Promise<EngineProcess> {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", join(import.meta.dirname, "..", "sessions", "processes", "fake-engine.ts"), ...args],
    { stdio: "pipe" },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  const exited = new Promise<NodeJS.Signals | null>((resolve) => {
    child.on("exit", (_code, signal) => {
      resolve(signal);
    });
  });
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const first = await lines.next();
  if (first.done === true) {
    await exited;
    throw new Error(`engine exited before it was ready: ${stderr}`);
  }
  return { child, exited };
}

// Replays the log after `fromSeq` and checks it against every event received so far.
async function expectLogKeeps(
  client: TestClient,
  sessionId: string,
  seen: ReadonlyMap<number, WireEvent>,
  fromSeq = 0,
): Promise<number> {
  const session = (await call(client, "session.get", { sessionId }))["session"] as JsonObject;
  const lastSeq = session["lastSeq"] as number;
  const subscription = await subscribe(client, sessionId, fromSeq);
  await client.waitFor(() => received(client, subscription).length === lastSeq - fromSeq);
  const log = received(client, subscription);
  expect(log.map((event) => event.seq)).toEqual(log.map((_, index) => fromSeq + index + 1));
  const lost = [...seen.values()]
    .filter((event) => event.seq > fromSeq)
    .filter((event) => JSON.stringify(log[event.seq - fromSeq - 1]) !== JSON.stringify(event));
  expect(lost).toEqual([]);
  return lastSeq;
}

describe("kill and resume (H-05)", () => {
  it(`loses no event over ${String(cycles)} consecutive kill-and-resume cycles`, { timeout: cycles * 2_000 + 30_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "picad-h05-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const dbPath = join(dir, "pica.db");
    openSeededStore(dbPath).close();
    const scenarioPath = join(dir, "scenario.json");
    await writeFile(scenarioPath, JSON.stringify(scenarioFile));
    const socket = join(dir, "s");
    const seen = new Map<number, WireEvent>();
    let sessionId: string | undefined;
    let previousCycleFrom = 0;

    for (let cycle = 0; cycle < cycles; cycle += 1) {
      const resumable = sessionId === undefined ? [] : ["--resumable", sessionId];
      const engine = await startEngineProcess(["--socket", socket, "--db", dbPath, "--scenario", scenarioPath, ...resumable]);
      const client = await TestClient.connectAndHello(socket);
      let afterSeq = 0;
      if (sessionId === undefined) {
        sessionId = await createSession(client);
      } else {
        // Each restart checks the cycle before it; the last restart checks the whole log.
        afterSeq = await expectLogKeeps(client, sessionId, seen, previousCycleFrom);
        const resumed = await call(client, "session.resume", { sessionId });
        expect((resumed["session"] as JsonObject)["state"]).toBe("idle");
      }
      previousCycleFrom = afterSeq;
      const live = await subscribe(client, sessionId, afterSeq);
      await call(client, "session.send", { sessionId, text: `cycle ${String(cycle)}`, mode: "send" });
      // Kill after a different number of the turn's events each cycle, from its first to its hanging tool call.
      const killAfter = 1 + ((cycle * 5) % 12);
      await client.waitFor(() => received(client, live).length >= killAfter);
      engine.child.kill("SIGKILL");
      expect(await engine.exited).toBe("SIGKILL");
      for (const event of received(client, live)) seen.set(event.seq, event);
      client.close();
    }

    const engine = await startEngineProcess(["--socket", socket, "--db", dbPath, "--scenario", scenarioPath, "--resumable", sessionId ?? ""]);
    const client = await TestClient.connectAndHello(socket);
    const lastSeq = await expectLogKeeps(client, sessionId ?? "", seen);
    expect(seen.size).toBeGreaterThanOrEqual(cycles * 2);
    expect(lastSeq).toBeGreaterThanOrEqual(seen.size);
    client.close();
    engine.child.kill("SIGKILL");
  });
});
