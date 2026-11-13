import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { TestClient } from "../helpers.ts";
import type { JsonObject } from "../helpers.ts";
import { call, createSession, isState, openSeededStore, received, subscribe, waitForEvent } from "./helpers.ts";
import type { WireEvent } from "./helpers.ts";

interface EngineProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exited: Promise<NodeJS.Signals | null>;
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function startEngineProcess(args: readonly string[]): Promise<EngineProcess> {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      join(import.meta.dirname, "processes", "fake-engine.ts"),
      ...args,
    ],
    { stdio: "pipe" },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
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
  expect(JSON.parse(first.value)).toMatchObject({ ready: true });
  return { child, exited };
}

const beforeKill = {
  version: 1,
  models: [{ id: "model-a", name: "Model A" }],
  defaultModel: "model-a",
  turns: [
    {
      steps: [
        { type: "text", content: "Running the migration." },
        { type: "toolCall", name: "shell", arguments: { command: "make migrate" }, result: "", hangs: true },
      ],
    },
  ],
};

const afterRestart = {
  ...beforeKill,
  turns: [{ prompt: "carry on", steps: [{ type: "text", content: "Picking up where we left off." }] }],
};

function summary(events: readonly WireEvent[]): unknown[] {
  return events.map((event) => [event.type, event.payload["to"] ?? event.payload["reason"] ?? event.payload["text"] ?? null]);
}

describe("engine restart", () => {
  it("leaves a session killed mid-run resumable, and resuming continues from the next event", async () => {
    const dir = await mkdtemp(join(tmpdir(), "picad-restart-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const dbPath = join(dir, "pica.db");
    openSeededStore(dbPath).close();
    await writeFile(join(dir, "before.json"), JSON.stringify(beforeKill));
    await writeFile(join(dir, "after.json"), JSON.stringify(afterRestart));
    const socket = join(dir, "run", "picad.sock");
    const common = ["--socket", socket, "--db", dbPath];

    const first = await startEngineProcess([...common, "--scenario", join(dir, "before.json")]);
    const client = await TestClient.connectAndHello(socket);
    const sessionId = await createSession(client);
    const subscriptionId = await subscribe(client, sessionId);
    await call(client, "session.send", { sessionId, text: "migrate the database", mode: "send" });
    await waitForEvent(client, subscriptionId, (event) => event.type === "tool.started");
    const seenBeforeKill = received(client, subscriptionId);
    const lastSeqBeforeKill = Math.max(...seenBeforeKill.map((event) => event.seq));

    first.child.kill("SIGKILL");
    expect(await first.exited).toBe("SIGKILL");
    client.close();

    await startEngineProcess([...common, "--scenario", join(dir, "after.json"), "--resumable", sessionId]);
    const next = await TestClient.connectAndHello(socket);
    const stored = await call(next, "session.get", { sessionId });
    expect((stored["session"] as JsonObject)["state"]).toBe("resumable");

    const resumedSubscription = await subscribe(next, sessionId, lastSeqBeforeKill);
    const resumed = await call(next, "session.resume", { sessionId });
    expect((resumed["session"] as JsonObject)["state"]).toBe("idle");
    await call(next, "session.send", { sessionId, text: "carry on", mode: "send" });
    await waitForEvent(next, resumedSubscription, (event) => event.type === "assistant.message");
    await waitForEvent(next, resumedSubscription, (event) => isState("idle")(event) && event.payload["from"] === "running");

    const afterKill = received(next, resumedSubscription);
    expect(afterKill.map((event) => event.seq)).toEqual(afterKill.map((_, index) => lastSeqBeforeKill + 1 + index));
    expect(summary(afterKill)).toEqual([
      ["session.aborted", "engine"],
      ["session.state_changed", "resumable"],
      ["session.state_changed", "idle"],
      ["session.state_changed", "running"],
      ["user.message", "carry on"],
      ["assistant.message", "Picking up where we left off."],
      ["session.state_changed", "idle"],
    ]);

    const wholeLog = await subscribe(next, sessionId, 0);
    const lastSeq = afterKill.at(-1)?.seq ?? 0;
    await next.waitFor(() => received(next, wholeLog).length === lastSeq);
    const replayed = received(next, wholeLog);
    expect(replayed.map((event) => event.seq)).toEqual(replayed.map((_, index) => index + 1));
    expect(replayed.slice(0, seenBeforeKill.length)).toEqual(seenBeforeKill);
    next.close();
  });
});
